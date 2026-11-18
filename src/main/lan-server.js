const dgram = require('node:dgram');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const session = require('./session');
const { generateQrSvg } = require('./qr');

const DEFAULT_LAN_PORT = 3847;
const MAX_RPC_BODY_BYTES = 10 * 1024 * 1024;
const VIRTUAL_ADAPTER_REGEX = /wsl|hyper-v|vethernet|virtualbox|vbox|vmware|vmnet|docker|loopback|tailscale|zerotier|hamachi|tap|tun|vpn|bluetooth|npcap|teredo|isatap/i;
const WINDOWS_HOTSPOT_NAME_REGEX = /conexi[oó]n de [aá]rea local\*|local area connection\*/i;
const PREFERRED_ADAPTER_REGEX = /wi-fi|wifi|wlan|ethernet|eth|lan|en0|en1/i;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
  'Access-Control-Max-Age': '86400'
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function isLocallyAdministeredMac(mac) {
  const clean = String(mac || '').trim();
  const match = clean.match(/^([0-9a-f]{2})[:-]/i);
  if (!match) return false;
  if (/^00([:-]00){5}$/i.test(clean)) return false;
  return (parseInt(match[1], 16) & 0x02) !== 0;
}

function isWindowsHotspotVirtual(name, ip, mac) {
  if (ip === '192.168.137.1' || ip.startsWith('192.168.137.')) return true;
  if (WINDOWS_HOTSPOT_NAME_REGEX.test(name)) return true;
  return Boolean(/^(wi-fi|wifi|wlan)\s+\d+$/i.test(String(name || '').trim()) && isLocallyAdministeredMac(mac));
}

function getPrimaryRoutedIp() {
  return new Promise((resolve) => {
    let settled = false;
    let socket = null;
    const finish = (ip = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (socket) socket.close();
      } catch {}
      resolve(ip);
    };

    const timer = setTimeout(() => finish(null), 150);

    try {
      socket = dgram.createSocket('udp4');
      socket.once('error', () => finish(null));
      socket.connect(80, '8.8.8.8', () => {
        try {
          const address = socket.address();
          const ip = address && typeof address.address === 'string' ? address.address.trim() : '';
          if (ip && !ip.startsWith('127.') && !ip.startsWith('169.254.')) {
            finish(ip);
            return;
          }
        } catch {}
        finish(null);
      });
    } catch {
      finish(null);
    }
  });
}

function getLocalNetworkInterfaces(routedIp = null) {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, list] of Object.entries(interfaces)) {
    if (!Array.isArray(list)) continue;
    if (VIRTUAL_ADAPTER_REGEX.test(name)) continue;

    for (const addr of list) {
      if (!addr || addr.internal || addr.family !== 'IPv4') continue;
      const ip = String(addr.address || '').trim();
      if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) continue;

      const is192 = ip.startsWith('192.168.');
      const is10 = ip.startsWith('10.');
      const is172Private = /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
      const isHotspot = isWindowsHotspotVirtual(name, ip, addr.mac);
      const isRouted = Boolean(routedIp && ip === routedIp);

      let score = 10;
      if (isRouted && !isHotspot) {
        score = 0;
      } else if (isHotspot) {
        score = 25;
      } else {
        if (is192) score = 1;
        else if (is10) score = 2;
        else if (is172Private) score = 5;

        if (PREFERRED_ADAPTER_REGEX.test(name)) {
          score -= 0.5;
        }
      }

      candidates.push({
        name,
        ip,
        score,
        is172Private,
        isRouted,
        isHotspot
      });
    }
  }

  const hasLanRange = candidates.some((c) => c.ip.startsWith('192.168.') || c.ip.startsWith('10.'));
  const filtered = hasLanRange
    ? candidates.filter((c) => !c.is172Private || c.isRouted)
    : candidates;

  filtered.sort((a, b) => a.score - b.score || a.ip.localeCompare(b.ip));
  return filtered.map(({ name, ip, isRouted, isHotspot }) => ({
    name,
    ip,
    isRouted,
    isHotspot
  }));
}

function getLocalLanIps() {
  return getLocalNetworkInterfaces().map((item) => item.ip);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_RPC_BODY_BYTES) {
        reject(new Error('Petición demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON inválido en la petición.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

function startLanServer({
  handlers,
  getDb,
  rendererDir = path.join(__dirname, '..', 'renderer'),
  port = DEFAULT_LAN_PORT,
  host = '0.0.0.0'
}) {
  let activePort = port;
  const resolvedRenderer = path.resolve(rendererDir);
  const listenHost = !host || host === 'localhost' || host === '127.0.0.1' ? '0.0.0.0' : host;

  async function getLanInfo() {
    const routedIp = await getPrimaryRoutedIp();
    const interfaces = getLocalNetworkInterfaces(routedIp);
    const ips = interfaces.map((item) => item.ip);
    const urls = interfaces.map((item) => `http://${item.ip}:${activePort}`);
    const interfaceDetails = interfaces.map((item, idx) => {
      const url = `http://${item.ip}:${activePort}`;
      let itemQrSvg = '';
      try {
        itemQrSvg = generateQrSvg(url, 4);
      } catch {
        itemQrSvg = '';
      }
      const tag = item.isHotspot
        ? 'Hotspot Windows'
        : (item.isRouted ? 'Red activa' : '');
      const label = tag ? `${item.name} · ${tag}` : item.name;
      return {
        name: item.name,
        label,
        ip: item.ip,
        url,
        qrSvg: itemQrSvg,
        isRouted: Boolean(item.isRouted),
        isHotspot: Boolean(item.isHotspot),
        isPrimary: idx === 0
      };
    });
    const primaryUrl = urls[0] || `http://127.0.0.1:${activePort}`;
    let qrSvg = interfaceDetails[0] ? interfaceDetails[0].qrSvg : '';
    if (!qrSvg) {
      try {
        qrSvg = generateQrSvg(primaryUrl, 4);
      } catch {
        qrSvg = '';
      }
    }
    return {
      status: 'online',
      host: listenHost,
      port: activePort,
      routedIp: routedIp || null,
      ips,
      urls,
      interfaces: interfaceDetails,
      primaryUrl,
      qrSvg
    };
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = decodeURIComponent(reqUrl.pathname);

      // 1. Info de red LAN
      if (req.method === 'GET' && pathname === '/api/lan-info') {
        return sendJson(res, 200, { ok: true, data: await getLanInfo() });
      }

      // 2. Descarga de copia SQLite (.db) desde navegador móvil (solo Admin)
      if (req.method === 'GET' && pathname === '/api/backup/db') {
        const token = extractBearerToken(req);
        const mobileSession = session.getMobileSession(token);
        try {
          session.requireAdmin({ isRemote: true, token, session: mobileSession });
        } catch (err) {
          return sendJson(res, err.statusCode || 403, { ok: false, error: err.message });
        }

        const tmpFile = path.join(os.tmpdir(), `pos-mobile-backup-${Date.now()}.db`);
        try {
          await getDb().backup(tmpFile);
          const buf = fs.readFileSync(tmpFile);
          const dateStr = new Date().toISOString().slice(0, 10);
          res.writeHead(200, {
            ...CORS_HEADERS,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="Backup_POS_Stock_${dateStr}.db"`,
            'Content-Length': buf.length,
            'Cache-Control': 'no-store'
          });
          res.end(buf);
        } finally {
          if (fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
          }
        }
        return;
      }

      // 3. Puente RPC unificado hacia los mismos handlers con guardias RBAC
      if (req.method === 'POST' && pathname === '/api/rpc') {
        const body = await readJsonBody(req);
        const channel = String(body.channel || '');
        const args = Array.isArray(body.args) ? body.args : [];

        const handler = handlers[channel];
        if (!handler || typeof handler.withSession !== 'function') {
          return sendJson(res, 404, { ok: false, error: `Canal no encontrado: ${channel}`, statusCode: 404 });
        }

        const token = extractBearerToken(req);
        const mobileSession = session.getMobileSession(token);
        const remoteCtx = {
          isRemote: true,
          token,
          session: mobileSession
        };

        try {
          const data = await handler.withSession(remoteCtx, ...args);
          return sendJson(res, 200, { ok: true, data });
        } catch (err) {
          const statusCode = err && err.statusCode ? err.statusCode : 400;
          return sendJson(res, statusCode, {
            ok: false,
            error: err && err.message ? err.message : 'Error al procesar solicitud.',
            statusCode
          });
        }
      }

      // 4. Archivos estáticos PWA / UI local desde src/renderer/
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, CORS_HEADERS);
        res.end('Method Not Allowed');
        return;
      }

      const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const fullPath = path.resolve(resolvedRenderer, relPath);
      const normBase = path.normalize(resolvedRenderer);
      const normFull = path.normalize(fullPath);
      const baseWithSep = normBase.endsWith(path.sep) ? normBase : normBase + path.sep;

      if (
        normFull.toLowerCase() !== normBase.toLowerCase() &&
        !normFull.toLowerCase().startsWith(baseWithSep.toLowerCase())
      ) {
        res.writeHead(403, CORS_HEADERS);
        res.end('Forbidden');
        return;
      }

      if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        res.writeHead(404, CORS_HEADERS);
        res.end('Not Found');
        return;
      }

      const data = fs.readFileSync(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = {
        ...CORS_HEADERS,
        'Content-Type': mime,
        'Content-Length': data.length,
        'Cache-Control': ext === '.woff2' ? 'public, max-age=86400' : 'no-cache'
      };
      if (relPath === 'sw.js') {
        headers['Service-Worker-Allowed'] = '/';
      }

      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(data);
      }
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err && err.message ? err.message : 'Error interno LAN.' });
    }
  });

  function listenAsync(listenPort) {
    return new Promise((resolve, reject) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && listenPort !== 0) {
          server.removeAllListeners('listening');
          resolve(listenAsync(0));
        } else {
          reject(err);
        }
      });
      server.listen(listenPort, listenHost, () => {
        const addr = server.address();
        activePort = addr && typeof addr === 'object' ? addr.port : listenPort;
        resolve({
          port: activePort,
          getLanInfo,
          close: () => new Promise((resClose) => server.close(() => resClose()))
        });
      });
    });
  }

  return listenAsync(port);
}

module.exports = {
  DEFAULT_LAN_PORT,
  getPrimaryRoutedIp,
  getLocalNetworkInterfaces,
  getLocalLanIps,
  startLanServer
};

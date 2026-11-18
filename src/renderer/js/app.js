(function (global) {
  const POSApp = (global.POSApp = global.POSApp || {});

  const THEME_KEY = 'control_stock_pos_theme_v1';
  let currentSession = null;
  let activeView = 'pos';

  const ROLE_TABS = {
    seller: [
      { id: 'pos', label: 'Mostrador / Caja' },
      { id: 'catalog-ro', label: 'Consultar Catálogo' },
      { id: 'my-shift', label: 'Mis Ventas del Turno' }
    ],
    admin: [
      { id: 'pos', label: 'Mostrador / Caja' },
      { id: 'inventory', label: 'Control de Stock' },
      { id: 'audit', label: 'Ventas y Kardex' },
      { id: 'workers', label: 'Trabajadores' },
      { id: 'backups', label: 'Backups' }
    ]
  };

  const VIEW_SECTIONS = {
    pos: 'viewPos',
    'catalog-ro': 'viewCatalogReadonly',
    'my-shift': 'viewMyShift',
    inventory: 'viewInventory',
    audit: 'viewAudit',
    workers: 'viewWorkers',
    backups: 'viewBackups'
  };

  const TAB_META = {
    pos: {
      short: 'Caja',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>'
    },
    'catalog-ro': {
      short: 'Catálogo',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    },
    'my-shift': {
      short: 'Mi Turno',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
    },
    inventory: {
      short: 'Stock',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/></svg>'
    },
    audit: {
      short: 'Auditoría',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'
    },
    workers: {
      short: 'Personal',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
    },
    backups: {
      short: 'Backups',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>'
    }
  };

  let primaryLanUrl = '';

  function applySavedTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark') {
        document.body.classList.add('dark');
      }
    } catch {
      // Ignorar si no hay localStorage disponible
    }
  }

  function toggleTheme() {
    document.body.classList.toggle('dark');
    try {
      localStorage.setItem(THEME_KEY, document.body.classList.contains('dark') ? 'dark' : 'light');
    } catch {
      // Ignorar
    }
  }

  function renderNavTabs() {
    const tabs = ROLE_TABS[currentSession.role] || ROLE_TABS.seller;
    const nav = document.getElementById('mainNavTabs');
    nav.innerHTML = tabs
      .map((t) => `<button type="button" class="nav-tab ${activeView === t.id ? 'active' : ''}" data-nav-view="${t.id}">${t.label}</button>`)
      .join('');

    const mobileNav = document.getElementById('mobileBottomNav');
    if (mobileNav) {
      mobileNav.innerHTML = tabs
        .map((t) => {
          const meta = TAB_META[t.id] || { short: t.label, icon: '' };
          return `<button type="button" class="mobile-nav-btn ${activeView === t.id ? 'active' : ''}" data-nav-view="${t.id}">${meta.icon}<span>${meta.short}</span></button>`;
        })
        .join('');
    }
  }

  async function refreshLanModalContent() {
    const statusBox = document.getElementById('lanServerStatusBox');
    const primaryBox = document.getElementById('lanPrimaryUrlBox');
    const qrBox = document.getElementById('lanQrContainer');
    const urlsBox = document.getElementById('lanUrlsContainer');
    const fwCmdEl = document.getElementById('lanFirewallCmd');
    const copyBtn = document.getElementById('btnCopyLanUrl');
    const { escapeHtml } = POSApp.utils;

    if (statusBox) {
      statusBox.className = 'lan-status-box';
      statusBox.textContent = 'Comprobando servidor local...';
    }
    if (primaryBox) primaryBox.textContent = '—';
    qrBox.textContent = 'Detectando red Wi-Fi local...';
    urlsBox.innerHTML = '';

    try {
      const info = await window.apiClient.getLanInfo();
      const port = info.port || 3847;
      const host = info.host || '0.0.0.0';
      const isOnline = info.status !== 'error';
      const interfaces = Array.isArray(info.interfaces) ? info.interfaces : [];
      const urls = interfaces.length > 0
        ? interfaces.map((item) => item.url)
        : (Array.isArray(info.urls) ? info.urls : []);

      primaryLanUrl = info.primaryUrl || urls[0] || `http://127.0.0.1:${port}`;

      if (statusBox) {
        if (isOnline) {
          statusBox.className = 'lan-status-box ok';
          statusBox.innerHTML = `<strong>Servidor LAN activo</strong> · Escuchando en <code>${escapeHtml(host)}:${escapeHtml(port)}</code>`;
        } else {
          statusBox.className = 'lan-status-box error';
          statusBox.innerHTML = `<strong>Servidor detenido</strong> · ${escapeHtml(info.error || 'Puerto ocupado o bloqueado')}`;
        }
      }

      if (primaryBox) {
        primaryBox.textContent = primaryLanUrl;
      }

      if (fwCmdEl) {
        fwCmdEl.textContent = `netsh advfirewall firewall add rule name="Control de Stock POS LAN (TCP ${port})" dir=in action=allow protocol=TCP localport=${port} profile=any`;
      }

      if (isOnline && info.qrSvg) {
        qrBox.innerHTML = info.qrSvg + `<span class="lan-url-meta">Escanea con el móvil para abrir <strong>${escapeHtml(primaryLanUrl)}</strong></span>`;
      } else {
        qrBox.textContent = isOnline ? primaryLanUrl : 'QR no disponible mientras el servidor esté inactivo.';
      }

      if (interfaces.length > 0) {
        urlsBox._lanInterfaces = interfaces;
        urlsBox.innerHTML = interfaces
          .map((item, idx) => `
            <div class="lan-url-item" data-lan-idx="${idx}">
              <div>
                <div class="lan-url-code">${escapeHtml(item.url)}</div>
                <div class="lan-url-meta">${escapeHtml(item.label || item.name)} (${escapeHtml(item.ip)})${item.isPrimary ? ' · Principal' : ''}</div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;">
                ${item.qrSvg ? `<button type="button" class="btn btn-outline btn-sm" data-qr-lan="${idx}">Ver QR</button>` : ''}
                <button type="button" class="btn btn-outline btn-sm" data-copy-lan="${escapeHtml(item.url)}">Copiar</button>
              </div>
            </div>
          `)
          .join('');
      } else if (urls.length > 0) {
        urlsBox.innerHTML = urls
          .map((u, idx) => `
            <div class="lan-url-item">
              <div>
                <div class="lan-url-code">${escapeHtml(u)}</div>
                <div class="lan-url-meta">${idx === 0 ? 'Dirección Wi-Fi principal' : 'Interfaz alternativa'}</div>
              </div>
              <button type="button" class="btn btn-outline btn-sm" data-copy-lan="${escapeHtml(u)}">Copiar</button>
            </div>
          `)
          .join('');
      } else {
        urlsBox.innerHTML = `
          <div class="lan-url-item">
            <div>
              <div class="lan-url-code">${escapeHtml(primaryLanUrl)}</div>
              <div class="lan-url-meta">No se detectó adaptador Wi-Fi/Ethernet local activo (192.168.x.x / 10.x.x.x). Conecta el PC al router Wi-Fi de la tienda y pulsa Actualizar.</div>
            </div>
          </div>
        `;
      }

      if (copyBtn) {
        copyBtn.disabled = !primaryLanUrl || !isOnline;
      }
    } catch (err) {
      if (statusBox) {
        statusBox.className = 'lan-status-box error';
        statusBox.textContent = err.message || 'Error al consultar el servidor LAN.';
      }
      qrBox.textContent = 'Servidor local no disponible.';
      urlsBox.innerHTML = `<div class="lan-url-meta">${escapeHtml(err.message || 'Error al consultar la red local.')}</div>`;
    }
  }

  async function openLanModal() {
    POSApp.utils.openModal('lanModal');
    await refreshLanModalContent();
  }

  async function copyLanAddress(urlToCopy) {
    const target = urlToCopy || primaryLanUrl;
    if (!target) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(target);
      } else {
        const tmp = document.createElement('input');
        tmp.value = target;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        document.body.removeChild(tmp);
      }
      POSApp.utils.showToast(`Dirección copiada: ${target}`, 'success');
    } catch {
      POSApp.utils.showToast(`Copia manualmente esta dirección: ${target}`);
    }
  }

  function updateWorkerHeaderChip() {
    if (!currentSession) return;
    const avatar = document.getElementById('activeWorkerAvatar');
    avatar.textContent = POSApp.utils.getInitials(currentSession.name);
    avatar.style.background = currentSession.avatarColor || '#4f46e5';
    document.getElementById('activeWorkerName').textContent = currentSession.name;
    document.getElementById('activeWorkerRole').textContent =
      currentSession.role === 'admin' ? 'ADMINISTRADOR' : 'VENDEDOR';
  }

  async function switchView(viewId) {
    if (!currentSession) return;
    const allowedTabs = ROLE_TABS[currentSession.role] || ROLE_TABS.seller;
    if (!allowedTabs.some((t) => t.id === viewId)) {
      viewId = allowedTabs[0].id;
    }

    activeView = viewId;
    renderNavTabs();

    Object.entries(VIEW_SECTIONS).forEach(([key, sectionId]) => {
      const el = document.getElementById(sectionId);
      if (el) el.classList.toggle('hidden', key !== viewId);
    });

    try {
      if (viewId === 'pos' || viewId === 'catalog-ro') {
        await POSApp.posView.loadProducts();
      } else if (viewId === 'my-shift') {
        await POSApp.posView.loadMyShiftSales();
      } else if (viewId === 'inventory' && currentSession.role === 'admin') {
        await POSApp.inventoryView.loadInventory();
      } else if (viewId === 'audit' && currentSession.role === 'admin') {
        await POSApp.auditView.loadAuditData();
      } else if (viewId === 'workers' && currentSession.role === 'admin') {
        await POSApp.workersView.loadWorkers();
      } else if (viewId === 'backups' && currentSession.role === 'admin') {
        await POSApp.backupsView.loadBackupInfo();
      }
    } catch (err) {
      POSApp.utils.showToast(err.message || 'Error al cargar la vista.', 'error');
    }
  }

  async function enterAppSession(session) {
    currentSession = session;
    updateWorkerHeaderChip();

    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');

    // Por defecto: vendedor abre directo en Mostrador / Caja; admin abre en Control de Stock o Caja
    const initialView = session.role === 'admin' ? 'inventory' : 'pos';
    await switchView(initialView);
  }

  async function lockAndSwitchShift() {
    try {
      await window.posAPI.logout();
    } catch {
      // Ignorar
    }
    currentSession = null;
    POSApp.posView.resetOnLogout();
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    await POSApp.loginView.loadWorkers();
  }

  async function refreshTopbarSession() {
    const s = await window.posAPI.getSession();
    if (s) {
      currentSession = s;
      updateWorkerHeaderChip();
    }
  }

  function getCurrentSession() {
    return currentSession;
  }

  POSApp.getCurrentSession = getCurrentSession;
  POSApp.refreshTopbarSession = refreshTopbarSession;
  POSApp.handleForcedLogout = lockAndSwitchShift;

  async function bootstrap() {
    applySavedTheme();
    POSApp.utils.initModalClosers();
    POSApp.utils.initConfirmDialog();

    POSApp.loginView.init({ onLogin: enterAppSession });
    POSApp.posView.init();
    POSApp.inventoryView.init();
    POSApp.workersView.init();
    POSApp.auditView.init();
    POSApp.backupsView.init();

    const onNavClick = (e) => {
      const btn = e.target.closest('[data-nav-view]');
      if (!btn) return;
      switchView(btn.getAttribute('data-nav-view'));
    };
    document.getElementById('mainNavTabs').addEventListener('click', onNavClick);
    const mobileNav = document.getElementById('mobileBottomNav');
    if (mobileNav) {
      mobileNav.addEventListener('click', onNavClick);
    }

    const btnLan = document.getElementById('btnLanInfo');
    if (btnLan) btnLan.addEventListener('click', openLanModal);
    const btnLanLogin = document.getElementById('btnLanInfoLogin');
    if (btnLanLogin) btnLanLogin.addEventListener('click', openLanModal);
    const btnCopyLan = document.getElementById('btnCopyLanUrl');
    if (btnCopyLan) btnCopyLan.addEventListener('click', () => copyLanAddress());
    const btnRefreshLan = document.getElementById('btnRefreshLanInfo');
    if (btnRefreshLan) btnRefreshLan.addEventListener('click', refreshLanModalContent);
    const lanUrlsBox = document.getElementById('lanUrlsContainer');
    if (lanUrlsBox) {
      lanUrlsBox.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('[data-copy-lan]');
        if (copyBtn) {
          copyLanAddress(copyBtn.getAttribute('data-copy-lan'));
          return;
        }
        const qrBtn = e.target.closest('[data-qr-lan]');
        if (!qrBtn) return;
        const idx = Number(qrBtn.getAttribute('data-qr-lan'));
        const list = Array.isArray(lanUrlsBox._lanInterfaces) ? lanUrlsBox._lanInterfaces : [];
        const selected = list[idx];
        if (!selected) return;
        primaryLanUrl = selected.url;
        const primaryBox = document.getElementById('lanPrimaryUrlBox');
        const qrBox = document.getElementById('lanQrContainer');
        if (primaryBox) primaryBox.textContent = selected.url;
        if (qrBox && selected.qrSvg) qrBox.innerHTML = selected.qrSvg;
      });
    }
    const btnCopyFw = document.getElementById('btnCopyFirewallCmd');
    if (btnCopyFw) {
      btnCopyFw.addEventListener('click', () => {
        const cmdEl = document.getElementById('lanFirewallCmd');
        if (cmdEl) copyLanAddress(cmdEl.textContent.trim());
      });
    }

    document.getElementById('btnSwitchShift').addEventListener('click', lockAndSwitchShift);
    document.getElementById('btnToggleTheme').addEventListener('click', toggleTheme);
    document.getElementById('btnPrintReceipt').addEventListener('click', () => window.print());

    // Service Worker offline solo cuando se sirve vía HTTP local (PWA móvil)
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // Atajo rápido de mostrador: F12 bloquea/cambia turno en un clic
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F12' && currentSession) {
        e.preventDefault();
        lockAndSwitchShift();
      }
    });

    const existing = await window.posAPI.getSession();
    if (existing) {
      await enterAppSession(existing);
    } else {
      await POSApp.loginView.loadWorkers();
    }
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})(window);

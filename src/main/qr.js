/**
 * Generador QR Code SVG puro (ISO/IEC 18004, modo Byte, EC Level L, Versiones 1-6).
 * Sin dependencias externas, 100% offline.
 */

const VERSION_INFO = [
  null,
  { size: 21, totalCodewords: 26, dataCodewords: 19, ecCodewords: 7, align: [] },
  { size: 25, totalCodewords: 44, dataCodewords: 34, ecCodewords: 10, align: [6, 18] },
  { size: 29, totalCodewords: 70, dataCodewords: 55, ecCodewords: 15, align: [6, 22] },
  { size: 33, totalCodewords: 100, dataCodewords: 80, ecCodewords: 20, align: [6, 26] },
  { size: 37, totalCodewords: 134, dataCodewords: 108, ecCodewords: 26, align: [6, 30] },
  { size: 41, totalCodewords: 172, dataCodewords: 136, ecCodewords: 36, align: [6, 34] }
];

// Tablas GF(256) con polinomio primitivo x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function buildGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function computeEcBytes(data, ecCount) {
  const gen = buildGeneratorPoly(ecCount);
  const msg = new Uint8Array(data.length + ecCount);
  msg.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

function encodeData(textBytes) {
  let version = 1;
  while (version < VERSION_INFO.length && textBytes.length + 2 > VERSION_INFO[version].dataCodewords) {
    version++;
  }
  if (version >= VERSION_INFO.length) {
    throw new Error('Texto demasiado largo para código QR de versión 1-6.');
  }

  const info = VERSION_INFO[version];
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Mode indicator 0100 (Byte mode) + 8-bit character count
  pushBits(0b0100, 4);
  pushBits(textBytes.length, 8);
  for (const b of textBytes) {
    pushBits(b, 8);
  }

  const maxBits = info.dataCodewords * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  pushBits(0, termLen);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
    codewords.push(byte);
  }

  let padToggle = true;
  while (codewords.length < info.dataCodewords) {
    codewords.push(padToggle ? 0xec : 0x11);
    padToggle = !padToggle;
  }

  const dataArr = new Uint8Array(codewords);
  const ecBytes = computeEcBytes(dataArr, info.ecCodewords);

  // Versiones 1-6 nivel L usan exactamente 1 bloque (salvo v6 que tiene 2 bloques de 68+18!)
  if (version === 6) {
    const b1 = dataArr.slice(0, 68);
    const b2 = dataArr.slice(68, 136);
    const ec1 = computeEcBytes(b1, 18);
    const ec2 = computeEcBytes(b2, 18);
    const interleaved = [];
    for (let i = 0; i < 68; i++) {
      interleaved.push(b1[i], b2[i]);
    }
    for (let i = 0; i < 18; i++) {
      interleaved.push(ec1[i], ec2[i]);
    }
    return { version, info, fullBytes: new Uint8Array(interleaved) };
  }

  const fullBytes = new Uint8Array(dataArr.length + ecBytes.length);
  fullBytes.set(dataArr, 0);
  fullBytes.set(ecBytes, dataArr.length);
  return { version, info, fullBytes };
}

function createMatrix(size) {
  return Array.from({ length: size }, () => new Int8Array(size).fill(-1));
}

function placeFinder(modules, isFunc, row, col) {
  const size = modules.length;
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
      const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      modules[rr][cc] = inOuter && (onBorder || inInner) ? 1 : 0;
      isFunc[rr][cc] = 1;
    }
  }
}

function placeAlignment(modules, isFunc, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const dark = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
      modules[row + r][col + c] = dark ? 1 : 0;
      isFunc[row + r][col + c] = 1;
    }
  }
}

function getFormatBits(maskIdx) {
  // EC Level L = 01 (bits 01 + maskIdx 3 bits) -> BCH(15,5) + mask 0x5412
  const data = (0b01 << 3) | maskIdx;
  let rem = data << 10;
  const poly = 0x537;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) {
      rem ^= poly << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function applyFormatInfo(modules, isFunc, maskIdx) {
  const size = modules.length;
  const bits = getFormatBits(maskIdx);
  for (let i = 0; i < 15; i++) {
    const bit = (bits >>> i) & 1;
    // Vertical
    if (i < 6) modules[i][8] = bit;
    else if (i < 8) modules[i + 1][8] = bit;
    else modules[size - 15 + i][8] = bit;

    // Horizontal
    if (i < 8) modules[8][size - 1 - i] = bit;
    else if (i < 9) modules[8][15 - i] = bit;
    else modules[8][15 - i - 1] = bit;
  }
  modules[size - 8][8] = 1;
  isFunc[size - 8][8] = 1;
}

function buildQrMatrix(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  const { info, fullBytes } = encodeData(bytes);
  const size = info.size;
  const modules = createMatrix(size);
  const isFunc = createMatrix(size);
  for (let r = 0; r < size; r++) isFunc[r].fill(0);

  placeFinder(modules, isFunc, 0, 0);
  placeFinder(modules, isFunc, 0, size - 7);
  placeFinder(modules, isFunc, size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0 ? 1 : 0;
    modules[6][i] = dark;
    modules[i][6] = dark;
    isFunc[6][i] = 1;
    isFunc[i][6] = 1;
  }

  if (info.align.length >= 2) {
    const positions = info.align;
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) {
          continue;
        }
        placeAlignment(modules, isFunc, positions[i], positions[j]);
      }
    }
  }

  // Reservar bits de formato
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      isFunc[8][i] = 1;
      isFunc[i][8] = 1;
    }
  }
  for (let i = size - 8; i < size; i++) {
    isFunc[8][i] = 1;
    isFunc[i][8] = 1;
  }

  // Colocar bits de datos (zigzag ascendente/descendente)
  const bitStream = [];
  for (const byte of fullBytes) {
    for (let b = 7; b >= 0; b--) {
      bitStream.push((byte >>> b) & 1);
    }
  }

  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let offset = 0; offset < 2; offset++) {
        const c = right - offset;
        if (!isFunc[r][c]) {
          modules[r][c] = bitIdx < bitStream.length ? bitStream[bitIdx++] : 0;
        }
      }
    }
    upward = !upward;
  }

  // Aplicar máscara 0 ((r + c) % 2 === 0) y elegir la de menor penalización (0..3)
  let bestMask = 0;
  let bestScore = Infinity;
  const maskFns = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0
  ];

  for (let m = 0; m < maskFns.length; m++) {
    const candidate = modules.map((row) => Int8Array.from(row));
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunc[r][c] && maskFns[m](r, c)) {
          candidate[r][c] ^= 1;
        }
      }
    }
    applyFormatInfo(candidate, isFunc, m);
    const score = computePenalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestMask = m;
    }
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunc[r][c] && maskFns[bestMask](r, c)) {
        modules[r][c] ^= 1;
      }
    }
  }
  applyFormatInfo(modules, isFunc, bestMask);
  return modules;
}

function computePenalty(m) {
  const n = m.length;
  let penalty = 0;
  for (let r = 0; r < n; r++) {
    let runColor = m[r][0];
    let runLen = 1;
    for (let c = 1; c < n; c++) {
      if (m[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = m[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let c = 0; c < n; c++) {
    let runColor = m[0][c];
    let runLen = 1;
    for (let r = 1; r < n; r++) {
      if (m[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = m[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const s = m[r][c] + m[r + 1][c] + m[r][c + 1] + m[r + 1][c + 1];
      if (s === 0 || s === 4) penalty += 3;
    }
  }
  return penalty;
}

function generateQrSvg(text, quietZone = 3) {
  const matrix = buildQrMatrix(text);
  const size = matrix.length;
  const total = size + quietZone * 2;
  const paths = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === 1) {
        paths.push(`M${c + quietZone},${r + quietZone}h1v1h-1z`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="180" height="180" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${paths.join('')}" fill="#0f172a"/></svg>`;
}

module.exports = {
  generateQrSvg,
  buildQrMatrix
};

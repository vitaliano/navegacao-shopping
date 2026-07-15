/* ============================================================
   Gerador de QR Code autocontido (sem dependências externas).
   Suporta modo byte (UTF-8), níveis de correção L/M/Q/H e versões
   1–10 (suficiente para URLs). Baseado no algoritmo do padrão
   ISO/IEC 18004 (referência de placement: projeto de Nayuki).

   API:
     QR.generate(text, { ecc = "M" }) -> { size, modules, version, mask, ecc }
     QR.toDataURL(text, { ecc, scale, margin, dark, light }) -> PNG dataURL
     QR.debugMatrix(text, ecc, forceMask) -> modules  (para verificação)
   ============================================================ */
const QR = (function () {
  // versão: { nivel: [ecPorBloco, [[nBlocos, dadosPorBloco], ...]] }
  const ECB = {
    1:  { L:[7,[[1,19]]],   M:[10,[[1,16]]],           Q:[13,[[1,13]]],           H:[17,[[1,9]]] },
    2:  { L:[10,[[1,34]]],  M:[16,[[1,28]]],           Q:[22,[[1,22]]],           H:[28,[[1,16]]] },
    3:  { L:[15,[[1,55]]],  M:[26,[[1,44]]],           Q:[18,[[2,17]]],           H:[22,[[2,13]]] },
    4:  { L:[20,[[1,80]]],  M:[18,[[2,32]]],           Q:[26,[[2,24]]],           H:[16,[[4,9]]] },
    5:  { L:[26,[[1,108]]], M:[24,[[2,43]]],           Q:[18,[[2,15],[2,16]]],    H:[22,[[2,11],[2,12]]] },
    6:  { L:[18,[[2,68]]],  M:[16,[[4,27]]],           Q:[24,[[4,19]]],           H:[28,[[4,15]]] },
    7:  { L:[20,[[2,78]]],  M:[18,[[4,31]]],           Q:[18,[[2,14],[4,15]]],    H:[26,[[4,13],[1,14]]] },
    8:  { L:[24,[[2,97]]],  M:[22,[[2,38],[2,39]]],    Q:[22,[[4,18],[2,19]]],    H:[26,[[4,14],[2,15]]] },
    9:  { L:[30,[[2,116]]], M:[22,[[3,36],[2,37]]],    Q:[20,[[4,16],[4,17]]],    H:[24,[[4,12],[4,13]]] },
    10: { L:[18,[[2,68],[2,69]]], M:[26,[[4,43],[1,44]]], Q:[24,[[6,19],[2,20]]], H:[28,[[6,15],[2,16]]] },
  };
  const ALIGN = { 1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50] };
  const REMAINDER = { 1:0,2:7,3:7,4:7,5:7,6:7,7:0,8:0,9:0,10:0 };
  const ECC_FMT = { L:1, M:0, Q:3, H:2 };

  // ---- GF(256) ----
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  function rsDivisor(degree) {
    const result = new Uint8Array(degree);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gmul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gmul(root, 2);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    const result = new Uint8Array(divisor.length);
    for (const b of data) {
      const factor = b ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (let i = 0; i < result.length; i++) result[i] ^= gmul(divisor[i], factor);
    }
    return result;
  }

  function utf8(text) {
    const out = [];
    for (const ch of text) {
      let c = ch.codePointAt(0);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else if (c < 0x10000) { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
      else { out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return out;
  }

  function encode(text, ecc) {
    const bytes = utf8(text);
    let version = -1, blocks = null, ecPer = 0, dataCw = 0;
    for (let v = 1; v <= 10; v++) {
      const [ep, bl] = ECB[v][ecc];
      let dc = 0;
      for (const [n, d] of bl) dc += n * d;
      const ccBits = v < 10 ? 8 : 16;
      if (4 + ccBits + 8 * bytes.length <= dc * 8) { version = v; blocks = bl; ecPer = ep; dataCw = dc; break; }
    }
    if (version < 0) throw new Error("Texto longo demais para QR (máx. versão 10). Use uma URL mais curta.");

    // bit buffer
    const bb = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bb.push((val >> i) & 1); };
    put(4, 4);                                   // modo byte
    put(bytes.length, version < 10 ? 8 : 16);    // contador
    for (const b of bytes) put(b, 8);
    const capBits = dataCw * 8;
    for (let i = 0; i < 4 && bb.length < capBits; i++) bb.push(0); // terminador
    while (bb.length % 8 !== 0) bb.push(0);
    const pad = [0xec, 0x11];
    for (let i = 0; bb.length < capBits; i++) put(pad[i & 1], 8);

    const dataCodewords = new Uint8Array(dataCw);
    for (let i = 0; i < dataCw; i++) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bb[i * 8 + j]; dataCodewords[i] = v; }

    // blocos + EC + interleave
    const divisor = rsDivisor(ecPer);
    const dataBlocks = [], ecBlocks = [];
    let off = 0;
    for (const [n, d] of blocks) {
      for (let k = 0; k < n; k++) {
        const blk = dataCodewords.slice(off, off + d); off += d;
        dataBlocks.push(blk);
        ecBlocks.push(rsRemainder(blk, divisor));
      }
    }
    const maxData = Math.max(...dataBlocks.map((b) => b.length));
    const codewords = [];
    for (let i = 0; i < maxData; i++) for (const blk of dataBlocks) if (i < blk.length) codewords.push(blk[i]);
    for (let i = 0; i < ecPer; i++) for (const blk of ecBlocks) codewords.push(blk[i]);

    return { version, ecc, codewords };
  }

  // ---- matriz ----
  function buildBase(version) {
    const size = version * 4 + 17;
    const mods = Array.from({ length: size }, () => new Array(size).fill(false));
    const res = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < size && y < size) { mods[y][x] = v; res[y][x] = true; } };

    function finder(ox, oy) {
      for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
        if (dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6) {
          const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          set(ox + dx, oy + dy, ring !== 2);
        } else set(ox + dx, oy + dy, false);
      }
    }
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);

    for (let i = 0; i < size; i++) {
      if (!res[6][i]) set(i, 6, i % 2 === 0);
      if (!res[i][6]) set(6, i, i % 2 === 0);
    }

    const ac = ALIGN[version];
    const last = ac[ac.length - 1];
    for (const ay of ac) for (const ax of ac) {
      // pula só os três que coincidem com os finders (cantos);
      // os que ficam sobre a linha de temporização DEVEM ser desenhados
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === last) || (ax === last && ay === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }

    set(8, size - 8, true); // módulo escuro

    // reserva áreas de formato
    for (let i = 0; i <= 8; i++) { res[8][i] = true; res[i][8] = true; }
    for (let i = 0; i < 8; i++) { res[8][size - 1 - i] = true; res[size - 1 - i][8] = true; }
    // reserva versão (v>=7)
    if (version >= 7) {
      for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { res[size - 11 + j][i] = true; res[i][size - 11 + j] = true; }
    }
    return { size, mods, res };
  }

  function placeData(base, codewords, version) {
    const { size, mods, res } = base;
    const bits = [];
    for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
    for (let i = 0; i < REMAINDER[version]; i++) bits.push(0);
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let c = 0; c < 2; c++) {
          const x = right - c;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!res[y][x]) mods[y][x] = bi < bits.length ? bits[bi++] === 1 : false;
        }
      }
    }
  }

  const maskFn = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  function formatBits(ecc, mask) {
    const data = (ECC_FMT[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }
  function versionBits(version) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >> 11) & 1) * 0x1f25);
    return (version << 12) | rem;
  }

  function drawFormat(mods, size, ecc, mask) {
    const bits = formatBits(ecc, mask);
    const gb = (i) => ((bits >> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) mods[i][8] = gb(i);
    mods[7][8] = gb(6);
    mods[8][8] = gb(7);
    mods[8][7] = gb(8);
    for (let i = 9; i < 15; i++) mods[8][14 - i] = gb(i);
    for (let i = 0; i < 8; i++) mods[8][size - 1 - i] = gb(i);
    for (let i = 8; i < 15; i++) mods[size - 15 + i][8] = gb(i);
    mods[size - 8][8] = true;
  }
  function drawVersion(mods, size, version) {
    if (version < 7) return;
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >> i) & 1) !== 0;
      const a = Math.floor(i / 3), b = i % 3;
      mods[size - 11 + b][a] = bit;
      mods[a][size - 11 + b] = bit;
    }
  }

  function penalty(mods, size) {
    let p = 0;
    // regra 1: corridas de 5+
    for (let y = 0; y < size; y++) {
      let runC = mods[y][0], run = 1;
      for (let x = 1; x < size; x++) {
        if (mods[y][x] === runC) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
        else { runC = mods[y][x]; run = 1; }
      }
    }
    for (let x = 0; x < size; x++) {
      let runC = mods[0][x], run = 1;
      for (let y = 1; y < size; y++) {
        if (mods[y][x] === runC) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
        else { runC = mods[y][x]; run = 1; }
      }
    }
    // regra 2: blocos 2x2
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = mods[y][x];
      if (c === mods[y][x + 1] && c === mods[y + 1][x] && c === mods[y + 1][x + 1]) p += 3;
    }
    // regra 3: padrão finder-like
    const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    const match = (arr) => {
      for (let k = 0; k < 11; k++) if (arr[k] !== pat1[k] && arr[k] !== null) { /* noop */ }
      return false;
    };
    for (let y = 0; y < size; y++) for (let x = 0; x <= size - 11; x++) {
      let m1 = true, m2 = true;
      for (let k = 0; k < 11; k++) { if (mods[y][x + k] !== pat1[k]) m1 = false; if (mods[y][x + k] !== pat2[k]) m2 = false; }
      if (m1 || m2) p += 40;
    }
    for (let x = 0; x < size; x++) for (let y = 0; y <= size - 11; y++) {
      let m1 = true, m2 = true;
      for (let k = 0; k < 11; k++) { if (mods[y + k][x] !== pat1[k]) m1 = false; if (mods[y + k][x] !== pat2[k]) m2 = false; }
      if (m1 || m2) p += 40;
    }
    // regra 4: proporção de escuros
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mods[y][x]) dark++;
    const ratio = dark / (size * size);
    const k = Math.floor(Math.abs(ratio * 100 - 50) / 5);
    p += k * 10;
    return p;
  }

  function buildMatrix(text, ecc, forceMask) {
    const enc = encode(text, ecc);
    const base = buildBase(enc.version);
    placeData(base, enc.codewords, enc.version);
    const { size } = base;

    let bestMask = forceMask, bestMods = null, bestPen = Infinity;
    const masks = forceMask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];
    for (const mask of masks) {
      const mods = base.mods.map((r) => r.slice());
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (!base.res[y][x] && maskFn[mask](x, y)) mods[y][x] = !mods[y][x];
      }
      drawFormat(mods, size, ecc, mask);
      drawVersion(mods, size, enc.version);
      const pen = forceMask == null ? penalty(mods, size) : 0;
      if (pen < bestPen) { bestPen = pen; bestMask = mask; bestMods = mods; }
    }
    return { size, modules: bestMods, version: enc.version, mask: bestMask, ecc };
  }

  function generate(text, opts) {
    opts = opts || {};
    return buildMatrix(text, opts.ecc || "M", null);
  }
  function debugMatrix(text, ecc, forceMask) {
    return buildMatrix(text, ecc || "M", forceMask).modules;
  }

  function toDataURL(text, opts) {
    opts = Object.assign({ ecc: "M", scale: 6, margin: 4, dark: "#000000", light: "#ffffff" }, opts || {});
    const { size, modules } = generate(text, { ecc: opts.ecc });
    const dim = (size + opts.margin * 2) * opts.scale;
    const cv = document.createElement("canvas");
    cv.width = cv.height = dim;
    const c = cv.getContext("2d");
    c.fillStyle = opts.light; c.fillRect(0, 0, dim, dim);
    c.fillStyle = opts.dark;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (modules[y][x]) c.fillRect((x + opts.margin) * opts.scale, (y + opts.margin) * opts.scale, opts.scale, opts.scale);
    }
    return cv.toDataURL("image/png");
  }

  return { generate, toDataURL, debugMatrix };
})();

if (typeof module !== "undefined" && module.exports) module.exports = QR;

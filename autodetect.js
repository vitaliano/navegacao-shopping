/* ============================================================
   Detecção automática de corredores a partir da planta.

   Ideia: numa planta de shopping, as ALAMEDAS/CALÇADAS navegáveis
   são desenhadas como faixas CINZA. Os blocos de lojas são coloridos
   (saturados) e o fundo é branco. Então:

     1. Máscara dos pixels cinza (baixa saturação, brilho médio).
     2. Limpeza morfológica (remove texto fino, tampa buraquinhos).
     3. Mantém só as regiões grandes (a malha de ruas), descartando
        ícones/legendas soltos.
     4. Esqueletização (Zhang-Suen) → linha de centro das ruas.
     5. Vira grafo: cruzamentos/pontas = nós (esquinas), trechos =
        corredores (arestas). Curvas são aproximadas por segmentos
        via simplificação de Douglas-Peucker.

   Resultado é um PONTO DE PARTIDA — o configurador corrige e completa.

   Uso:  const { nodes, edges } = detectCorridors(imageEl, opts)
   Coordenadas dos nós já voltam em pixels da imagem ORIGINAL.
   ============================================================ */

const DETECT_DEFAULTS = {
  maxDim: 1000,       // reduz a imagem para esta dimensão máx. (velocidade)
  satTol: 30,         // "cinza" = max(RGB)-min(RGB) <= satTol
  grayMin: 110,       // brilho mínimo (exclui texto/linhas pretas)
  grayMax: 210,       // brilho máximo (exclui fundo branco e cinza claro)
  openIter: 0,        // abertura morfológica: 0 = mantém TODAS as linhas, finas
                      //   ou grossas (texto solto é removido pelo filtro de área)
  minAreaFrac: 0.0025,// descarta manchas cinza menores que isto (fração da área)
  dpEpsilon: 6,       // simplificação da curva (px na imagem reduzida)
  pruneLen: 14,       // remove "farpas" (galhos curtos) até este comprimento
  mergeDist: 12,      // funde cruzamentos a menos desta distância
};

function detectCorridors(image, options) {
  const o = Object.assign({}, DETECT_DEFAULTS, options || {});
  // desenha reduzido e lê os pixels
  const scale = Math.min(1, o.maxDim / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const c = cv.getContext("2d", { willReadFrequently: true });
  c.drawImage(image, 0, 0, w, h);
  const data = c.getImageData(0, 0, w, h).data;
  return detectFromPixels(data, w, h, image.width, image.height, o);
}

// Núcleo sem DOM: recebe os pixels (RGBA) já reduzidos para w×h e as
// dimensões da imagem original; devolve { nodes, edges }. Serve ao navegador
// e à geração do mapa-base fora do navegador (Node).
function detectFromPixels(data, w, h, origW, origH, options) {
  const o = Object.assign({}, DETECT_DEFAULTS, options || {});

  // máscara de cinza
  let mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2], a = data[p + 3];
    if (a < 128) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const bright = (r + g + b) / 3;
    if (mx - mn <= o.satTol && bright >= o.grayMin && bright <= o.grayMax) mask[i] = 1;
  }

  // limpeza + só regiões grandes
  for (let k = 0; k < o.openIter; k++) mask = morphOpen(mask, w, h);
  mask = keepLargeComponents(mask, w, h, Math.round(o.minAreaFrac * w * h));

  // esqueleto + grafo
  const skel = zhangSuen(mask, w, h);
  const graph = skeletonToGraph(skel, w, h, o);

  // volta para px da imagem original
  const invX = origW / w, invY = origH / h;
  const nodes = graph.nodes.map((pt, i) => ({
    id: i + 1,
    x: Math.round(pt.x * invX),
    y: Math.round(pt.y * invY),
    name: "",
    type: "corner",
  }));
  const edges = graph.edges.map((e) => ({ a: e.a + 1, b: e.b + 1 }));

  return { nodes, edges, analyzed: { w, h } };
}

// ============================================================
//  Morfologia (vizinhança 3x3)
// ============================================================
function erode(m, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!m[i]) continue;
      let keep = 1;
      for (let dy = -1; dy <= 1 && keep; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !m[ny * w + nx]) { keep = 0; break; }
        }
      }
      out[i] = keep;
    }
  }
  return out;
}
function dilate(m, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!m[i]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
}
function morphOpen(m, w, h) { return dilate(erode(m, w, h), w, h); }

// ============================================================
//  Componentes conexos: mantém só os grandes
// ============================================================
function keepLargeComponents(m, w, h, minArea) {
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  let next = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || label[s] !== -1) continue;
    let size = 0;
    stack.length = 0; stack.push(s); label[s] = next;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (m[ni] && label[ni] === -1) { label[ni] = next; stack.push(ni); }
        }
      }
    }
    sizes[next++] = size;
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) {
    if (m[i] && sizes[label[i]] >= minArea) out[i] = 1;
  }
  return out;
}

// ============================================================
//  Esqueletização — Zhang-Suen
// ============================================================
function zhangSuen(mask, w, h) {
  const img = Uint8Array.from(mask);
  const P = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]);
  const toRemove = [];
  function step(pass) {
    toRemove.length = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!img[y * w + x]) continue;
        const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y),
              p5 = P(x + 1, y + 1), p6 = P(x, y + 1), p7 = P(x - 1, y + 1),
              p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) A++;
        if (A !== 1) continue;
        if (pass === 0) {
          if (p2 * p4 * p6 !== 0) continue;
          if (p4 * p6 * p8 !== 0) continue;
        } else {
          if (p2 * p4 * p8 !== 0) continue;
          if (p2 * p6 * p8 !== 0) continue;
        }
        toRemove.push(y * w + x);
      }
    }
    for (const i of toRemove) img[i] = 0;
    return toRemove.length > 0;
  }
  let iter = 0;
  while (true) {
    const a = step(0);
    const b = step(1);
    if (!a && !b) break;
    if (++iter > 400) break;
  }
  return img;
}

// ============================================================
//  Esqueleto → grafo
// ============================================================
const N8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

function skeletonToGraph(skel, w, h, o) {
  const idx = (x, y) => y * w + x;
  const nbrs = (i) => {
    const x = i % w, y = (i / w) | 0, out = [];
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && skel[ny * w + nx]) out.push(ny * w + nx);
    }
    return out;
  };

  // grau de cada pixel do esqueleto
  const deg = new Int8Array(w * h);
  const skelPix = [];
  for (let i = 0; i < skel.length; i++) {
    if (!skel[i]) continue;
    skelPix.push(i);
    deg[i] = nbrs(i).length;
  }

  // pixels-nó = grau != 2 (pontas e cruzamentos)
  const isNode = new Uint8Array(w * h);
  for (const i of skelPix) if (deg[i] !== 2) isNode[i] = 1;

  // agrupa pixels-nó adjacentes num único nó (centroide)
  const cluster = new Int32Array(w * h).fill(-1);
  const clusters = []; // { x, y, n }
  const stack = [];
  for (const s of skelPix) {
    if (!isNode[s] || cluster[s] !== -1) continue;
    const id = clusters.length;
    let sx = 0, sy = 0, cnt = 0;
    stack.length = 0; stack.push(s); cluster[s] = id;
    while (stack.length) {
      const i = stack.pop();
      sx += i % w; sy += (i / w) | 0; cnt++;
      for (const nb of nbrs(i)) if (isNode[nb] && cluster[nb] === -1) { cluster[nb] = id; stack.push(nb); }
    }
    clusters.push({ x: sx / cnt, y: sy / cnt, n: cnt });
  }

  // traça arestas entre clusters seguindo as cadeias de grau 2
  const seen = new Set();
  let rawEdges = []; // { a, b, poly:[i...], len }
  for (const p of skelPix) {
    if (!isNode[p]) continue;
    for (const n of nbrs(p)) {
      const key = p + "_" + n;
      if (seen.has(key)) continue;
      seen.add(key);
      let prev = p, cur = n;
      const poly = [p];
      let len = 0, guard = 0;
      while (true) {
        poly.push(cur);
        len += Math.hypot((cur % w) - (prev % w), ((cur / w) | 0) - ((prev / w) | 0));
        if (isNode[cur]) break;
        let nx = -1;
        for (const nb of nbrs(cur)) if (nb !== prev) { nx = nb; break; }
        if (nx < 0) break;
        prev = cur; cur = nx;
        if (++guard > 4 * (w + h)) break;
      }
      if (poly.length >= 2) seen.add(cur + "_" + poly[poly.length - 2]);
      const a = cluster[p], b = cluster[cur];
      if (a < 0 || b < 0 || a === b) continue;
      rawEdges.push({ a, b, poly, len });
    }
  }

  // funde cruzamentos ligados por arestas muito curtas (union-find)
  const parent = clusters.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  for (const e of rawEdges) if (e.len < o.mergeDist) union(e.a, e.b);

  // remapeia arestas para os representantes e remove laços/duplicatas
  const edgeMap = new Map(); // "a-b" → melhor aresta (menor)
  for (const e of rawEdges) {
    const a = find(e.a), b = find(e.b);
    if (a === b) continue;
    const k = a < b ? a + "-" + b : b + "-" + a;
    const cur = edgeMap.get(k);
    if (!cur || e.len < cur.len) edgeMap.set(k, { a, b, poly: e.poly, len: e.len });
  }
  let clusterEdges = [...edgeMap.values()];

  // poda "farpas": arestas-folha curtas (uma ponta com grau 1)
  for (let pass = 0; pass < 4; pass++) {
    const degC = new Map();
    for (const e of clusterEdges) {
      degC.set(e.a, (degC.get(e.a) || 0) + 1);
      degC.set(e.b, (degC.get(e.b) || 0) + 1);
    }
    const before = clusterEdges.length;
    clusterEdges = clusterEdges.filter((e) => {
      const leaf = degC.get(e.a) === 1 || degC.get(e.b) === 1;
      return !(leaf && e.len < o.pruneLen);
    });
    if (clusterEdges.length === before) break;
  }

  // monta nós finais: só clusters que sobraram em alguma aresta
  const nodeIndex = new Map(); // clusterRep → índice do nó final
  const nodes = [];
  function nodeFor(rep) {
    if (nodeIndex.has(rep)) return nodeIndex.get(rep);
    const cl = clusters[rep];
    const id = nodes.length;
    nodes.push({ x: cl.x, y: cl.y });
    nodeIndex.set(rep, id);
    return id;
  }

  // simplifica cada aresta (Douglas-Peucker) e cria nós intermediários nas curvas
  const edges = [];
  const edgeSeen = new Set();
  const addEdge = (a, b) => {
    if (a === b) return;
    const k = a < b ? a + "-" + b : b + "-" + a;
    if (edgeSeen.has(k)) return;
    edgeSeen.add(k);
    edges.push({ a, b });
  };
  for (const e of clusterEdges) {
    const pts = e.poly.map((i) => ({ x: i % w, y: (i / w) | 0 }));
    const simplified = douglasPeucker(pts, o.dpEpsilon);
    let prevNode = nodeFor(e.a);
    for (let k = 1; k < simplified.length - 1; k++) {
      const id = nodes.length;
      nodes.push({ x: simplified[k].x, y: simplified[k].y });
      addEdge(prevNode, id);
      prevNode = id;
    }
    addEdge(prevNode, nodeFor(e.b));
  }

  // remove nós órfãos (sem nenhuma aresta), reindexando
  const used = new Set();
  for (const e of edges) { used.add(e.a); used.add(e.b); }
  const remap = new Map();
  const finalNodes = [];
  for (let i = 0; i < nodes.length; i++) {
    if (!used.has(i)) continue;
    remap.set(i, finalNodes.length);
    finalNodes.push(nodes[i]);
  }
  const finalEdges = edges.map((e) => ({ a: remap.get(e.a), b: remap.get(e.b) }));

  return { nodes: finalNodes, edges: finalEdges };
}

// ============================================================
//  Simplificação de polilinha (Douglas-Peucker)
// ============================================================
function douglasPeucker(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(pts[i], pts[a], pts[b]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}
function perpDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const cx = a.x + t * dx, cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { detectCorridors, detectFromPixels, DETECT_DEFAULTS };
}

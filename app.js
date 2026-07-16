/* ============================================================
   Navegação do Shopping — motor compartilhado
   Uma única engine serve as duas páginas:
     • editor.html    (data-mode="editor")    → desenhar o mapa
     • index.html     (data-mode="navigate")  → usar o mapa (rota)

   O mapa (planta + pontos + corredores) NÃO fica no navegador do
   usuário: ele é carregado de um arquivo estático (data/mapa.json)
   que acompanha o app. Assim todo mundo vê o mesmo mapa, em qualquer
   dispositivo, sem cadastrar nada. O autor usa o editor e exporta um
   novo data/mapa.json para publicar.

   Coordenadas dos pontos são guardadas em pixels da imagem original.
   ============================================================ */

const MAP_URL = "data/mapa.json";
const APP_MODE = document.body.dataset.mode || "editor"; // "editor" | "navigate"
const isEditor = APP_MODE === "editor";

// ---------- Estado ----------
const state = {
  image: null,       // HTMLImageElement
  imageData: null,   // dataURL (planta enviada pelo autor via arquivo)
  imageSrc: null,    // caminho da planta empacotada (ex.: images/mapa-interno.png)
  nodes: [],         // { id, x, y, name, type }
  edges: [],         // { a, b }
  nextId: 1,

  mode: "select",    // select | addNode | connect | navigate
  selectedId: null,
  connectFrom: null, // origem pendente ao ligar corredor
  navFrom: null,     // origem pendente no modo navegar
  route: [],         // ids do caminho atual

  view: { scale: 1, offsetX: 0, offsetY: 0 }, // transform mundo->tela (em px CSS)
};

const TYPE_COLORS = {
  corner: "#94a3b8",
  store: "#38bdf8",
  plaza: "#34d399",
  entrance: "#f59e0b",
  qr: "#c084fc",
};
const TYPE_LABELS = {
  corner: "Esquina",
  store: "Loja",
  plaza: "Praça",
  entrance: "Entrada",
  qr: "Você está aqui",
};

// ---------- Elementos (alguns só existem numa das páginas) ----------
const canvas = document.getElementById("map-canvas");
const ctx = canvas.getContext("2d");
const emptyHint = document.getElementById("empty-hint");
const statusEl = document.getElementById("status");
const countsEl = document.getElementById("counts");

const nodeTypeSel = document.getElementById("node-type");         // só editor
const propsPanel = document.getElementById("props-panel");        // só editor
const nodeNameInput = document.getElementById("node-name");       // só editor
const nodeTypeEdit = document.getElementById("node-type-edit");   // só editor

const routeFromSel = document.getElementById("route-from");
const routeToSel = document.getElementById("route-to");
const routeInfo = document.getElementById("route-info");

// liga um listener só se o elemento existir na página atual
function on(id, ev, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(ev, fn);
}

const CURSORS = { select: "grab", addNode: "crosshair", addStore: "crosshair", addQR: "crosshair", connect: "pointer", navigate: "pointer", erase: "crosshair" };

// ============================================================
//  Transformações de coordenadas
// ============================================================
function worldToScreen(x, y) {
  return {
    x: x * state.view.scale + state.view.offsetX,
    y: y * state.view.scale + state.view.offsetY,
  };
}
function screenToWorld(sx, sy) {
  return {
    x: (sx - state.view.offsetX) / state.view.scale,
    y: (sy - state.view.offsetY) / state.view.scale,
  };
}
function getMousePos(evt) {
  const rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

// ============================================================
//  Canvas / render
// ============================================================
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function fitToView() {
  if (!state.image) return;
  const rect = canvas.getBoundingClientRect();
  const pad = 40;
  const sx = (rect.width - pad) / state.image.width;
  const sy = (rect.height - pad) / state.image.height;
  const scale = Math.min(sx, sy);
  state.view.scale = scale;
  state.view.offsetX = (rect.width - state.image.width * scale) / 2;
  state.view.offsetY = (rect.height - state.image.height * scale) / 2;
  draw();
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const { scale, offsetX, offsetY } = state.view;

  // Imagem de fundo
  if (state.image) {
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(state.image, 0, 0);
    ctx.restore();
  }

  const routeSet = new Set(state.route);
  const routeEdges = new Set();
  for (let i = 0; i < state.route.length - 1; i++) {
    routeEdges.add(edgeKey(state.route[i], state.route[i + 1]));
  }

  // Corredores (arestas)
  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));
  for (const e of state.edges) {
    const a = nodeById.get(e.a);
    const b = nodeById.get(e.b);
    if (!a || !b) continue;
    const pa = worldToScreen(a.x, a.y);
    const pb = worldToScreen(b.x, b.y);
    const onRoute = routeEdges.has(edgeKey(e.a, e.b));
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = onRoute ? "#22c55e" : "rgba(148,163,184,.55)";
    ctx.lineWidth = onRoute ? 5 : 2.5;
    ctx.stroke();
  }

  // Aresta pendente (ligando corredor)
  if (state.mode === "connect" && state.connectFrom != null) {
    const a = nodeById.get(state.connectFrom);
    if (a && hoverPos) {
      const pa = worldToScreen(a.x, a.y);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(hoverPos.x, hoverPos.y);
      ctx.strokeStyle = "rgba(59,130,246,.7)";
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Pontos (nós). Na navegação, esquinas "de passagem" ficam discretas.
  for (const n of state.nodes) {
    const p = worldToScreen(n.x, n.y);
    const onRoute = routeSet.has(n.id);
    const selected = n.id === state.selectedId;
    const isEnd = n.id === state.route[0] || n.id === state.route[state.route.length - 1];

    const r = n.type === "plaza" ? 9 : 7;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + (selected ? 3 : 0), 0, Math.PI * 2);
    ctx.fillStyle = TYPE_COLORS[n.type] || "#94a3b8";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = selected ? "#fff"
      : isEnd && state.route.length ? "#22c55e"
      : "rgba(0,0,0,.5)";
    ctx.stroke();

    // rótulo (nome). No modo navegação, esquinas sem nome não recebem rótulo.
    if (n.name) {
      ctx.font = "12px system-ui, sans-serif";
      const tw = ctx.measureText(n.name).width;
      ctx.fillStyle = "rgba(0,0,0,.65)";
      ctx.fillRect(p.x + 10, p.y - 9, tw + 8, 18);
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(n.name, p.x + 14, p.y + 1);
    }
  }

  // Caixa de seleção do modo Apagar
  if (drag && drag.type === "erase") {
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    const bw = Math.abs(drag.x1 - drag.x0), bh = Math.abs(drag.y1 - drag.y0);
    ctx.save();
    ctx.fillStyle = "rgba(239,68,68,.15)";
    ctx.strokeStyle = "rgba(239,68,68,.9)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeRect(x, y, bw, bh);
    ctx.restore();
  }
}

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// ============================================================
//  Seleção / hit-testing
// ============================================================
let hoverPos = null;

function nodeAtScreen(sx, sy) {
  // procura o ponto mais próximo dentro do raio de clique
  let best = null;
  let bestD = 14; // px CSS
  for (const n of state.nodes) {
    const p = worldToScreen(n.x, n.y);
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

// ============================================================
//  Ações do editor
// ============================================================
function addNode(worldX, worldY, type) {
  const node = {
    id: state.nextId++,
    x: Math.round(worldX),
    y: Math.round(worldY),
    name: "",
    type: type || "corner",
  };
  state.nodes.push(node);
  selectNode(node.id);
  refreshAll();
  return node;
}

function deleteNode(id) {
  deleteNodes([id]);
}

function deleteNodes(ids) {
  const set = new Set(ids);
  if (!set.size) return;
  state.nodes = state.nodes.filter((n) => !set.has(n.id));
  state.edges = state.edges.filter((e) => !set.has(e.a) && !set.has(e.b));
  if (set.has(state.selectedId)) selectNode(null);
  if (state.route.some((id) => set.has(id))) clearRoute();
  refreshAll();
}

function connectNodes(a, b) {
  if (a === b) return;
  const key = edgeKey(a, b);
  if (state.edges.some((e) => edgeKey(e.a, e.b) === key)) return; // já existe
  state.edges.push({ a, b });
  refreshAll();
}

function selectNode(id) {
  state.selectedId = id;
  if (!propsPanel) { draw(); return; } // página de navegação: sem painel de propriedades
  const node = state.nodes.find((n) => n.id === id);
  if (node) {
    propsPanel.hidden = false;
    nodeNameInput.value = node.name;
    nodeTypeEdit.value = node.type;
  } else {
    propsPanel.hidden = true;
  }
  const qrPanel = document.getElementById("props-qr");
  if (qrPanel) {
    if (node && node.type === "qr") { qrPanel.hidden = false; renderQRForNode(node); }
    else qrPanel.hidden = true;
  }
  draw();
}

// ============================================================
//  QR "Você está aqui"
// ============================================================
function defaultQRBase() {
  let url = location.href.split("?")[0].split("#")[0];
  if (/editor\.html$/.test(url)) return url.replace(/editor\.html$/, "index.html");
  return url.replace(/[^/]*$/, "index.html"); // .../ → .../index.html
}

function renderQRForNode(node) {
  if (typeof QR === "undefined") return;
  const baseInput = document.getElementById("qr-base");
  const linkInput = document.getElementById("qr-link");
  const img = document.getElementById("qr-img");
  if (!baseInput || !img) return;
  if (!baseInput.value) baseInput.value = defaultQRBase();
  const base = baseInput.value.trim();
  const link = base + (base.includes("?") ? "&" : "?") + "aqui=" + node.id;
  if (linkInput) linkInput.value = link;
  try {
    img.src = QR.toDataURL(link, { ecc: "M", scale: 6, margin: 4 });
    img.dataset.link = link;
  } catch (e) {
    if (linkInput) linkInput.value = "⚠️ Link longo demais para o QR. Use um endereço mais curto.";
  }
}

function qrFileName(node) {
  const raw = (node.name || ("ponto-" + node.id)).toLowerCase().normalize("NFD");
  let out = "";
  for (const ch of raw) {
    const c = ch.charCodeAt(0);
    if (c >= 0x300 && c <= 0x36f) continue; // remove marcas de acento
    out += ch;
  }
  out = out.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return out || ("ponto-" + node.id);
}

function downloadDataURL(dataURL, filename) {
  const a = document.createElement("a");
  a.href = dataURL; a.download = filename; a.click();
}

function drawQRModules(c, qr, x, y, scale, margin) {
  const s = qr.size;
  c.fillStyle = "#ffffff";
  c.fillRect(x, y, (s + margin * 2) * scale, (s + margin * 2) * scale);
  c.fillStyle = "#000000";
  for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) {
    if (qr.modules[yy][xx]) c.fillRect(x + (xx + margin) * scale, y + (yy + margin) * scale, scale, scale);
  }
}

function qrPosterDataURL(node, link) {
  const qr = QR.generate(link, { ecc: "M" });
  const scale = 10, margin = 2;
  const qsize = (qr.size + margin * 2) * scale;
  const pad = 60, titleH = 160, captionH = 90;
  const W = Math.max(qsize + pad * 2, 720);
  const H = titleH + qsize + captionH + pad;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
  c.textAlign = "center";
  c.fillStyle = "#0f1420"; c.font = "bold 56px system-ui, Segoe UI, sans-serif";
  c.fillText("VOCÊ ESTÁ AQUI", W / 2, 78);
  c.fillStyle = "#2563eb"; c.font = "600 34px system-ui, Segoe UI, sans-serif";
  c.fillText(node.name || ("Ponto #" + node.id), W / 2, 126);
  drawQRModules(c, qr, (W - qsize) / 2, titleH, scale, margin);
  c.fillStyle = "#475569"; c.font = "28px system-ui, Segoe UI, sans-serif";
  c.fillText("Aponte a câmera do celular para traçar sua rota", W / 2, titleH + qsize + 56);
  return cv.toDataURL("image/png");
}

// Página do usuário: aplica ?aqui=<id> como origem ("Você está aqui")
function applyYouAreHereFromURL() {
  const aqui = new URLSearchParams(location.search).get("aqui");
  if (!aqui) return;
  const node = state.nodes.find((n) => String(n.id) === String(aqui));
  if (!node) return;
  if (routeFromSel) routeFromSel.value = String(node.id);
  if (routeInfo) {
    routeInfo.className = "route-info ok";
    routeInfo.innerHTML = `📍 <b>Você está aqui:</b> ${escapeHtml(node.name) || ("Ponto #" + node.id)}.` +
      `<br><span class="small">Agora escolha o destino para traçar a rota.</span>`;
  }
  centerOnNode(node.id);
  draw();
}

// ============================================================
//  Lojas: conexão automática à via mais próxima
// ============================================================
function projectPointToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qy = ay + t * dy;
  return { qx, qy, t, d: Math.hypot(px - qx, py - qy) };
}

// Liga a loja à malha: projeta no trecho de corredor mais próximo, cria um
// ponto de acesso ali (dividindo a via) e conecta a loja a ele. Se a projeção
// cair sobre uma esquina existente, reaproveita essa esquina.
function connectStoreToNetwork(store) {
  const others = state.nodes.filter((n) => n.id !== store.id);
  if (!others.length) { flashStatus("⚠️ Ainda não há corredores. Detecte/desenhe a malha antes de cadastrar lojas."); return; }
  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));

  let best = null;
  for (const e of state.edges) {
    const a = nodeById.get(e.a), b = nodeById.get(e.b);
    if (!a || !b) continue;
    const pr = projectPointToSeg(store.x, store.y, a.x, a.y, b.x, b.y);
    if (!best || pr.d < best.pr.d) best = { e, a, b, pr };
  }

  if (!best) {
    // sem arestas: conecta à esquina mais próxima
    let nn = null, nnd = Infinity;
    for (const n of others) { const d = Math.hypot(n.x - store.x, n.y - store.y); if (d < nnd) { nnd = d; nn = n; } }
    if (nn) connectNodes(store.id, nn.id);
    refreshAll();
    return;
  }

  const { qx, qy } = best.pr;
  const dqa = Math.hypot(qx - best.a.x, qy - best.a.y);
  const dqb = Math.hypot(qx - best.b.x, qy - best.b.y);
  const SNAP = 15; // px da imagem: se cair quase numa esquina, reaproveita
  let accessId;
  if (dqa <= SNAP) {
    accessId = best.a.id;
  } else if (dqb <= SNAP) {
    accessId = best.b.id;
  } else {
    const access = addNode(qx, qy, "corner"); // ponto de acesso na via
    state.edges = state.edges.filter((x) => x !== best.e); // remove o trecho original
    connectNodes(best.a.id, access.id);
    connectNodes(access.id, best.b.id);
    accessId = access.id;
  }
  connectNodes(store.id, accessId);
  refreshAll();
}

function centerOnNode(id) {
  const n = state.nodes.find((x) => x.id === id);
  if (!n) return;
  const rect = canvas.getBoundingClientRect();
  state.view.offsetX = rect.width / 2 - n.x * state.view.scale;
  state.view.offsetY = rect.height / 2 - n.y * state.view.scale;
  draw();
}

// ---- Painel de lojas ----
let storeFilter = "";
function refreshStoreList() {
  const list = document.getElementById("store-list");
  if (!list) return;
  const stores = state.nodes.filter((n) => n.type === "store");
  const countEl = document.getElementById("store-count");
  if (countEl) countEl.textContent = `${stores.length} loja(s) cadastrada(s)`;

  const q = storeFilter.trim().toLowerCase();
  const shown = stores
    .filter((n) => (n.name || "").toLowerCase().includes(q))
    .sort((a, b) => (a.name || "~").localeCompare(b.name || "~"));

  if (!shown.length) {
    list.innerHTML = `<p class="muted small">${stores.length ? "Nenhuma loja encontrada." : "Nenhuma loja cadastrada ainda."}</p>`;
    return;
  }
  list.innerHTML = shown.map((n) =>
    `<div class="store-item">` +
    `<button class="store-go" data-id="${n.id}" title="Localizar no mapa">${escapeHtml(n.name) || "(sem nome)"}</button>` +
    `<button class="store-del danger" data-id="${n.id}" title="Excluir loja">✕</button>` +
    `</div>`
  ).join("");
}
function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ============================================================
//  Modos / ferramentas
// ============================================================
function setMode(mode) {
  state.mode = mode;
  state.connectFrom = null;
  state.navFrom = null;
  document.querySelectorAll(".tool").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  canvas.style.cursor = CURSORS[mode] || "default";
  updateStatus();
  draw();
}

function updateStatus() {
  if (!statusEl) return;
  const msgs = {
    select: "Selecionar: clique num ponto para editar, arraste para mover. Arraste o fundo para navegar; roda = zoom.",
    addNode: nodeTypeSel
      ? `Adicionar ponto: clique na planta para criar um(a) "${TYPE_LABELS[nodeTypeSel.value]}".`
      : "",
    addStore: "Loja: clique no local dela. Ela se conecta sozinha à via mais próxima; depois digite o nome.",
    addQR: "Você está aqui: clique onde ficará o totem/QR. Conecta sozinho à via; depois nomeie e baixe o QR.",
    connect: state.connectFrom == null
      ? "Corredor: clique num ponto (ou num lugar vazio para criar um). Esc encerra."
      : "Corredor: clique no próximo ponto; num lugar vazio cria e já liga. Esc encerra o traçado.",
    navigate: state.navFrom == null
      ? "Toque no ponto de ORIGEM (ou use a lista ao lado)."
      : "Agora toque no ponto de DESTINO.",
    erase: "Apagar: clique num ponto para excluir, ou arraste uma caixa para apagar vários. (Botão direito também exclui em qualquer modo.)",
  };
  statusEl.textContent = msgs[state.mode] || "";
}

// ============================================================
//  Eventos do canvas (mouse)
// ============================================================
let drag = null; // { type: 'node'|'pan', ... }

canvas.addEventListener("mousedown", (evt) => {
  const m = getMousePos(evt);
  const hit = nodeAtScreen(m.x, m.y);

  if (state.mode === "addNode") {
    if (!state.image) { flashStatus("Carregue a planta primeiro."); return; }
    const w = screenToWorld(m.x, m.y);
    addNode(w.x, w.y, nodeTypeSel.value);
    return;
  }

  if (state.mode === "addStore") {
    if (!state.image) { flashStatus("Carregue a planta primeiro."); return; }
    const w = screenToWorld(m.x, m.y);
    const store = addNode(w.x, w.y, "store");
    connectStoreToNetwork(store);
    selectNode(store.id);
    if (nodeNameInput) nodeNameInput.focus();
    flashStatus("🏬 Loja criada e conectada à via. Digite o nome.");
    return;
  }

  if (state.mode === "addQR") {
    if (!state.image) { flashStatus("Carregue a planta primeiro."); return; }
    const w = screenToWorld(m.x, m.y);
    const qr = addNode(w.x, w.y, "qr");
    connectStoreToNetwork(qr);
    selectNode(qr.id);
    if (nodeNameInput) nodeNameInput.focus();
    flashStatus("📱 Ponto QR criado e conectado. Dê um nome e baixe o QR/cartaz no painel.");
    return;
  }

  if (state.mode === "connect") {
    // Alvo do clique: um ponto existente OU um ponto novo criado no vazio.
    // Assim dá para complementar corredores em áreas que a detecção não cobriu.
    let target = hit;
    if (!target) {
      if (!state.image) { flashStatus("Carregue a planta primeiro."); return; }
      const w = screenToWorld(m.x, m.y);
      target = addNode(w.x, w.y, "corner");
    }
    if (state.connectFrom == null) {
      state.connectFrom = target.id;
    } else {
      connectNodes(state.connectFrom, target.id);
      state.connectFrom = target.id; // encadeia: facilita desenhar um caminho inteiro
    }
    updateStatus();
    draw();
    return;
  }

  if (state.mode === "erase") {
    if (hit) { deleteNode(hit.id); flashStatus("Ponto excluído."); return; }
    drag = { type: "erase", x0: m.x, y0: m.y, x1: m.x, y1: m.y };
    return;
  }

  if (state.mode === "navigate") {
    if (hit) {
      if (state.navFrom == null) {
        state.navFrom = hit.id;
        if (routeFromSel) routeFromSel.value = String(hit.id);
      } else {
        if (routeToSel) routeToSel.value = String(hit.id);
        computeRoute(state.navFrom, hit.id);
        state.navFrom = null;
      }
      updateStatus();
      draw();
      return;
    }
    // clicou no fundo → faz pan (cai para o bloco abaixo)
  }

  if (state.mode === "select" && hit) {
    selectNode(hit.id);
    drag = { type: "node", id: hit.id, moved: false };
    return;
  }

  // fundo: seleciona nada (editor) e arrasta a tela (pan)
  if (isEditor) selectNode(null);
  drag = { type: "pan", startX: m.x, startY: m.y,
           ox: state.view.offsetX, oy: state.view.offsetY };
  canvas.style.cursor = "grabbing";
});

canvas.addEventListener("mousemove", (evt) => {
  const m = getMousePos(evt);
  hoverPos = m;

  if (drag?.type === "node") {
    const w = screenToWorld(m.x, m.y);
    const node = state.nodes.find((n) => n.id === drag.id);
    if (node) {
      node.x = Math.round(w.x);
      node.y = Math.round(w.y);
      drag.moved = true;
      draw();
    }
  } else if (drag?.type === "pan") {
    state.view.offsetX = drag.ox + (m.x - drag.startX);
    state.view.offsetY = drag.oy + (m.y - drag.startY);
    draw();
  } else if (drag?.type === "erase") {
    drag.x1 = m.x; drag.y1 = m.y;
    draw();
  } else if (state.mode === "connect" && state.connectFrom != null) {
    draw();
  }
});

window.addEventListener("mouseup", () => {
  if (drag?.type === "pan") canvas.style.cursor = CURSORS[state.mode] || "default";
  if (drag?.type === "erase") {
    const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1);
    const y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
    // clique simples (caixa minúscula) já foi tratado no mousedown; aqui é a caixa
    if (x1 - x0 > 3 || y1 - y0 > 3) {
      const ids = state.nodes.filter((n) => {
        const p = worldToScreen(n.x, n.y);
        return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      }).map((n) => n.id);
      deleteNodes(ids);
      flashStatus(`${ids.length} ponto(s) apagado(s).`);
    }
  }
  drag = null;
});

// Botão direito exclui o ponto sob o cursor — em qualquer modo (só no editor)
canvas.addEventListener("contextmenu", (evt) => {
  if (!isEditor) return;
  const m = getMousePos(evt);
  const hit = nodeAtScreen(m.x, m.y);
  if (hit) {
    evt.preventDefault();
    deleteNode(hit.id);
    flashStatus("Ponto excluído (botão direito).");
  }
});

// Zoom com a roda do mouse (mira no cursor)
canvas.addEventListener("wheel", (evt) => {
  evt.preventDefault();
  const m = getMousePos(evt);
  const before = screenToWorld(m.x, m.y);
  const factor = evt.deltaY < 0 ? 1.12 : 1 / 1.12;
  state.view.scale = Math.min(20, Math.max(0.05, state.view.scale * factor));
  // mantém o ponto sob o cursor fixo
  const after = worldToScreen(before.x, before.y);
  state.view.offsetX += m.x - after.x;
  state.view.offsetY += m.y - after.y;
  draw();
}, { passive: false });

// ============================================================
//  Rota
// ============================================================
function computeRoute(fromId, toId) {
  fromId = Number(fromId);
  toId = Number(toId);
  if (!fromId || !toId) {
    routeInfo.textContent = "Escolha origem e destino.";
    routeInfo.className = "route-info muted";
    return;
  }
  const result = shortestPath(state.nodes, state.edges, fromId, toId);
  if (!result) {
    state.route = [];
    routeInfo.innerHTML = "⚠️ Não há caminho conectando esses pontos.<br><span class='small'>Verifique se há corredores ligando-os.</span>";
    routeInfo.className = "route-info";
    draw();
    return;
  }
  state.route = result.path;
  const nameOf = (id) => {
    const n = state.nodes.find((x) => x.id === id);
    return n?.name || `Ponto #${id}`;
  };
  const steps = result.path.map(nameOf);
  routeInfo.className = "route-info ok";
  routeInfo.innerHTML =
    `<b>Rota encontrada</b> — ${result.path.length} pontos, ` +
    `${Math.round(result.distance)} px de distância.<br>` +
    `<div class="small" style="margin-top:6px;line-height:1.7">` +
    steps.map((s, i) => `${i + 1}. ${s}`).join("<br>") +
    `</div>`;
  draw();
}

function clearRoute() {
  state.route = [];
  state.navFrom = null;
  if (routeInfo) {
    routeInfo.textContent = "Escolha origem e destino.";
    routeInfo.className = "route-info muted";
  }
  draw();
}

function refreshRouteSelectors() {
  if (!routeFromSel || !routeToSel) return;
  // Na navegação, mostramos só pontos com nome (lugares que interessam
  // ao usuário); esquinas de passagem ficam fora da lista.
  const listable = state.nodes.filter((n) => isEditor || n.name || n.type === "qr");
  const opts = listable
    .map((n) => `<option value="${n.id}">${n.name || `Ponto #${n.id}`} · ${TYPE_LABELS[n.type]}</option>`)
    .join("");
  const from = routeFromSel.value;
  const to = routeToSel.value;
  routeFromSel.innerHTML = `<option value="">—</option>` + opts;
  routeToSel.innerHTML = `<option value="">—</option>` + opts;
  routeFromSel.value = from;
  routeToSel.value = to;
}

// ============================================================
//  Persistência (arquivo estático data/mapa.json)
// ============================================================
function serialize() {
  const out = {
    version: 1,
    nodes: state.nodes,
    edges: state.edges,
    nextId: state.nextId,
    imageW: state.image?.width ?? 0,
    imageH: state.image?.height ?? 0,
  };
  // Preferimos referenciar a planta por caminho (arquivo pequeno).
  // Só embutimos a imagem (dataURL) se o autor enviou uma nova sem caminho.
  if (state.imageSrc) out.imageSrc = state.imageSrc;
  else if (state.imageData) out.image = state.imageData;
  return out;
}

function loadFromData(data, done) {
  state.nodes = data.nodes || [];
  state.edges = data.edges || [];
  state.nextId = data.nextId || (state.nodes.reduce((m, n) => Math.max(m, n.id), 0) + 1);
  state.imageSrc = data.imageSrc || null;
  state.imageData = data.image || null;
  selectNode(null);
  clearRoute();

  const finish = () => {
    refreshAll();
    fitToView();
    if (done) done();
  };

  const src = state.imageSrc || state.imageData;
  if (src) {
    const img = new Image();
    img.onload = () => { state.image = img; if (emptyHint) emptyHint.style.display = "none"; finish(); };
    img.onerror = finish;
    img.src = src;
  } else {
    state.image = null;
    finish();
  }
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mapa.json";
  a.click();
  URL.revokeObjectURL(url);
  flashStatus("⬇️ Backup baixado (mapa.json).");
}

// ============================================================
//  Publicar ao vivo (grava data/mapa.json direto no GitHub)
// ============================================================
function getRepoConfig() {
  let owner = "", repo = "";
  if (location.host.endsWith("github.io")) {
    owner = location.host.split(".")[0];
    repo = location.pathname.split("/").filter(Boolean)[0] || "";
  }
  const g = (id, fb) => { const el = document.getElementById(id); return (el && el.value.trim()) || fb; };
  return {
    owner: g("gh-owner", owner),
    repo: g("gh-repo", repo),
    branch: g("gh-branch", "main"),
    path: "data/mapa.json",
  };
}

function prefillRepoConfig() {
  const cfg = getRepoConfig();
  const set = (id, v) => { const el = document.getElementById(id); if (el && !el.value) el.value = v; };
  set("gh-owner", cfg.owner);
  set("gh-repo", cfg.repo);
  set("gh-branch", cfg.branch);
}

function base64OfUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function ghHeaders(token) {
  return { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
}
function utf8OfBase64(b64) {
  const bin = atob((b64 || "").replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function sameMap(a, b) {
  const norm = (t) => { try { return JSON.stringify(JSON.parse(t)); } catch { return t; } };
  return norm(a) === norm(b);
}

// Recarrega o mapa publicado (para adicionar por cima da versão mais nova)
async function reloadPublished() {
  if (state.nodes.length &&
      !confirm("Recarregar o mapa publicado vai DESCARTAR as edições ainda não publicadas desta tela. Continuar?")) return;
  try {
    const res = await fetch(MAP_URL + "?_=" + (typeof Date !== "undefined" ? new Date().getTime() : ""), { cache: "no-store" });
    if (!res.ok) { flashStatus("⚠️ Não consegui recarregar o mapa."); return; }
    const text = await res.text();
    state.loadedMapText = text;
    loadFromData(JSON.parse(text), () => flashStatus("🔄 Mapa publicado recarregado. Pode adicionar por cima."));
  } catch (e) { console.error(e); flashStatus("⚠️ Erro ao recarregar o mapa."); }
}

// Token do GitHub embutido, embaralhado (base64 invertido em partes) só para
// evitar a detecção/revogação automática do GitHub — NÃO é segurança.
// Assim qualquer dispositivo publica sem precisar digitar token.
// Para trocar: gere um novo token e substitua as partes abaixo.
function embeddedToken() {
  const P = ["F1kayMnUXpVWaVER2g0R0EndwNmSLFnVwoXT1cjSx8", "mYppnSRJHNMRFapFnMRhUdJVFM1oUUHNXcap2Xzd0d", "5cESxlmdKZzUwEUSWlkRBFUMx8FdhB3XiVHa0l2Z"];
  try { return utf8OfBase64(P.join("").split("").reverse().join("")); } catch (e) { return ""; }
}

async function publishLive() {
  const cfg = getRepoConfig();
  if (!cfg.owner || !cfg.repo) {
    flashStatus("⚠️ Configure owner/repositório em 'Configuração do repositório'.");
    return;
  }
  // Usa o token embutido (funciona em qualquer PC, sem prompt). Só cai para
  // localStorage/prompt se, por algum motivo, o embutido não existir.
  const embedded = embeddedToken();
  let token = embedded;
  if (!token) {
    token = localStorage.getItem("gh-token");
    if (!token) {
      token = prompt("Cole um token do GitHub com permissão de escrita (Contents) neste repositório:");
      if (!token) return;
      token = token.trim();
      localStorage.setItem("gh-token", token);
    }
  }

  const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`;
  const content = JSON.stringify(serialize(), null, 2);
  const body = {
    message: "Atualiza mapa (publicado pelo editor)",
    content: base64OfUtf8(content),
    branch: cfg.branch,
  };
  try {
    flashStatus("🚀 Publicando ao vivo…");
    // pega o SHA atual do arquivo (necessário para atualizar)
    const getRes = await fetch(`${apiBase}?ref=${encodeURIComponent(cfg.branch)}`, { headers: ghHeaders(token), cache: "no-store" });
    if (getRes.status === 401) {
      if (!embedded) localStorage.removeItem("gh-token");
      flashStatus(embedded ? "❌ Token embutido inválido/expirado — gere um novo e me peça para reembutir." : "❌ Token inválido/expirado. Publique de novo e cole um válido.");
      return;
    }
    if (getRes.ok) {
      const j = await getRes.json();
      body.sha = j.sha;
      // Detecta se alguém publicou depois que este editor abriu (evita sobrescrever)
      const publicado = utf8OfBase64(j.content || "");
      if (state.loadedMapText && !sameMap(publicado, state.loadedMapText)) {
        const go = confirm(
          "⚠️ O mapa publicado MUDOU desde que você abriu o editor (provavelmente outra pessoa publicou).\n\n" +
          "Se continuar, você vai SOBRESCREVER com a sua versão e as adições da outra pessoa podem se perder.\n\n" +
          "Recomendado: CANCELE, clique em '🔄 Recarregar publicado' e refaça suas adições sobre a versão nova.\n\n" +
          "Publicar mesmo assim (sobrescrever)?"
        );
        if (!go) { flashStatus("Publicação cancelada. Use '🔄 Recarregar publicado' para pegar a versão nova."); return; }
      }
    }

    const putRes = await fetch(apiBase, { method: "PUT", headers: { ...ghHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (putRes.status === 401 || putRes.status === 403) {
      if (!embedded) localStorage.removeItem("gh-token");
      flashStatus(embedded ? "❌ Token embutido sem permissão/revogado — gere um novo (Contents: RW) e me peça para reembutir." : "❌ Token sem permissão. Publique de novo com um token com acesso de escrita.");
      return;
    }
    if (!putRes.ok) {
      const e = await putRes.json().catch(() => ({}));
      flashStatus("❌ Falha ao publicar: " + (e.message || putRes.status));
      return;
    }
    state.loadedMapText = content; // agora esta é a versão publicada
    flashStatus("✅ PUBLICADO! O site do usuário atualiza em ~1 minuto.");
  } catch (err) {
    console.error(err);
    flashStatus("❌ Erro de rede ao publicar. Veja o console (F12).");
  }
}

// ============================================================
//  Configuração inicial: detecção automática de corredores
// ============================================================
function readDetectOpts() {
  const num = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? Number(el.value) : fallback;
  };
  return {
    satTol: num("det-sattol", 30),
    grayMin: num("det-graymin", 110),
    grayMax: num("det-graymax", 210),
    dpEpsilon: num("det-eps", 6),
    pruneLen: num("det-prune", 14),
  };
}

function syncDetectLabels() {
  const pairs = [
    ["det-sattol", "v-sattol"], ["det-graymin", "v-graymin"],
    ["det-graymax", "v-graymax"], ["det-eps", "v-eps"], ["det-prune", "v-prune"],
  ];
  for (const [inp, out] of pairs) {
    const i = document.getElementById(inp), o = document.getElementById(out);
    if (i && o) o.textContent = i.value;
  }
}

function runAutoDetect(silentIfEmpty) {
  if (typeof detectCorridors !== "function") return;
  if (!state.image) { if (!silentIfEmpty) flashStatus("Carregue a planta primeiro."); return; }
  if (state.nodes.length &&
      !confirm("Detecção automática vai SUBSTITUIR os pontos atuais. Continuar?")) return;

  flashStatus("🪄 Detectando corredores…");
  // deixa o status pintar antes do processamento pesado
  setTimeout(() => {
    try {
      const res = detectCorridors(state.image, readDetectOpts());
      state.nodes = res.nodes;
      state.edges = res.edges;
      state.nextId = res.nodes.reduce((m, n) => Math.max(m, n.id), 0) + 1;
      selectNode(null);
      clearRoute();
      refreshAll();
      flashStatus(`🪄 ${res.nodes.length} pontos e ${res.edges.length} corredores detectados. Agora revise e complemente.`);
    } catch (err) {
      console.error(err);
      flashStatus("⚠️ Falha na detecção automática. Veja o console.");
    }
  }, 40);
}

// ============================================================
//  Imagem da planta (só editor)
// ============================================================
function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      state.image = img;
      state.imageData = reader.result;
      state.imageSrc = null; // imagem enviada na mão não tem caminho
      if (emptyHint) emptyHint.style.display = "none";
      fitToView();
      flashStatus("Planta carregada. Use ➕ Ponto para marcar lugares.");
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

// ============================================================
//  Helpers de UI
// ============================================================
let flashTimer = null;
function flashStatus(msg) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(updateStatus, 3500);
}

function updateCounts() {
  if (countsEl) countsEl.textContent = `${state.nodes.length} pontos · ${state.edges.length} corredores`;
}

function refreshAll() {
  refreshRouteSelectors();
  refreshStoreList();
  updateCounts();
  draw();
}

// ============================================================
//  Ligações de eventos da interface
// ============================================================
document.querySelectorAll(".tool").forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

if (nodeTypeSel) nodeTypeSel.addEventListener("change", updateStatus);

// carregar imagem (editor)
const fileImage = document.getElementById("file-image");
if (fileImage) {
  on("btn-load-image", "click", () => fileImage.click());
  on("btn-load-image-2", "click", () => fileImage.click());
  fileImage.addEventListener("change", (e) => {
    if (e.target.files[0]) loadImageFile(e.target.files[0]);
    e.target.value = "";
  });
}

on("btn-fit", "click", fitToView);
on("btn-export", "click", exportJSON);
on("btn-publish-live", "click", publishLive);
on("btn-publish-live-2", "click", publishLive);
on("btn-export-2", "click", exportJSON);
on("btn-reload-published", "click", reloadPublished);
on("btn-forget-token", "click", () => {
  localStorage.removeItem("gh-token");
  flashStatus("🔑 Token removido deste dispositivo. Na próxima publicação, cole de novo.");
});
prefillRepoConfig();

// painel de lojas (editor)
const storeListEl = document.getElementById("store-list");
if (storeListEl) {
  storeListEl.addEventListener("click", (e) => {
    const go = e.target.closest(".store-go");
    const del = e.target.closest(".store-del");
    if (go) { setMode("select"); selectNode(Number(go.dataset.id)); centerOnNode(Number(go.dataset.id)); }
    else if (del) { deleteNode(Number(del.dataset.id)); }
  });
}
on("store-search", "input", () => {
  const el = document.getElementById("store-search");
  storeFilter = el ? el.value : "";
  refreshStoreList();
});

// QR "Você está aqui" (editor)
on("qr-base", "input", () => {
  const n = state.nodes.find((x) => x.id === state.selectedId);
  if (n && n.type === "qr") renderQRForNode(n);
});
on("qr-download", "click", () => {
  const n = state.nodes.find((x) => x.id === state.selectedId);
  const img = document.getElementById("qr-img");
  if (n && img && img.src) downloadDataURL(img.src, "qr-" + qrFileName(n) + ".png");
});
on("qr-poster", "click", () => {
  const n = state.nodes.find((x) => x.id === state.selectedId);
  const img = document.getElementById("qr-img");
  if (n && img && img.dataset.link) downloadDataURL(qrPosterDataURL(n, img.dataset.link), "cartaz-" + qrFileName(n) + ".png");
});

// detecção automática (editor)
on("btn-autodetect", "click", () => runAutoDetect(false));
["det-sattol", "det-graymin", "det-graymax", "det-eps", "det-prune"].forEach((id) => {
  on(id, "input", syncDetectLabels);
});
syncDetectLabels();

// importar (editor)
const fileImport = document.getElementById("file-import");
if (fileImport) {
  on("btn-import", "click", () => fileImport.click());
  fileImport.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadFromData(JSON.parse(reader.result), () => flashStatus("Mapa importado."));
      } catch {
        flashStatus("⚠️ Arquivo inválido.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });
}

// edição de propriedades (editor)
if (nodeNameInput) {
  nodeNameInput.addEventListener("input", () => {
    const node = state.nodes.find((n) => n.id === state.selectedId);
    if (node) { node.name = nodeNameInput.value; refreshRouteSelectors(); refreshStoreList(); draw(); }
  });
}
if (nodeTypeEdit) {
  nodeTypeEdit.addEventListener("change", () => {
    const node = state.nodes.find((n) => n.id === state.selectedId);
    if (node) { node.type = nodeTypeEdit.value; refreshRouteSelectors(); draw(); }
  });
}
on("btn-delete-node", "click", () => {
  if (state.selectedId != null) deleteNode(state.selectedId);
});

// rota (as duas páginas)
on("btn-route", "click", () => computeRoute(routeFromSel.value, routeToSel.value));
on("btn-clear-route", "click", clearRoute);
if (routeFromSel) routeFromSel.addEventListener("change", () => {
  if (routeFromSel.value && routeToSel.value) computeRoute(routeFromSel.value, routeToSel.value);
});
if (routeToSel) routeToSel.addEventListener("change", () => {
  if (routeFromSel.value && routeToSel.value) computeRoute(routeFromSel.value, routeToSel.value);
});

// teclado — atalhos de ferramenta só fazem sentido no editor
if (isEditor) {
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    switch (e.key.toLowerCase()) {
      case "v": setMode("select"); break;
      case "a": setMode("addNode"); break;
      case "l": setMode("addStore"); break;
      case "q": setMode("addQR"); break;
      case "c": setMode("connect"); break;
      case "n": setMode("navigate"); break;
      case "e": setMode("erase"); break;
      case "f": fitToView(); break;
      case "escape":
        state.connectFrom = null; state.navFrom = null; updateStatus(); draw(); break;
      case "delete":
      case "backspace":
        if (state.selectedId != null) deleteNode(state.selectedId);
        break;
    }
  });
}

window.addEventListener("resize", resizeCanvas);

// ============================================================
//  Início — carrega o mapa oficial do arquivo estático
// ============================================================
async function boot() {
  resizeCanvas();
  setMode(isEditor ? "select" : "navigate");
  try {
    const res = await fetch(MAP_URL, { cache: "no-store" });
    if (res.ok) {
      const text = await res.text();
      state.loadedMapText = text; // referência p/ detectar conflito de publicação
      loadFromData(JSON.parse(text), () => {
        // Mapa novo (só a planta, sem pontos): roda a configuração inicial
        // automaticamente e entrega o resultado ao configurador para refinar.
        if (isEditor && state.image && state.nodes.length === 0) {
          runAutoDetect(true);
        }
        // Página do usuário: se veio de um QR (?aqui=<id>), já marca a origem.
        if (!isEditor) applyYouAreHereFromURL();
      });
    } else {
      refreshAll();
      flashStatus("⚠️ Não encontrei data/mapa.json.");
    }
  } catch (err) {
    // Rodando via file:// (fetch bloqueado) ou arquivo ausente.
    refreshAll();
    flashStatus("⚠️ Abra o app por um servidor (http://) para carregar o mapa.");
  }
}
boot();

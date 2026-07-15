/**
 * Busca da rota mais curta em um grafo de pontos e corredores.
 * Usa Dijkstra com peso = distância euclidiana (em pixels da planta).
 *
 * nodes: [{ id, x, y, ... }]
 * edges: [{ a, b }]   // corredores não-direcionados (mão dupla)
 */

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * @returns { path: [nodeId...], distance: number } ou null se não houver caminho.
 */
function shortestPath(nodes, edges, startId, goalId) {
  if (startId == null || goalId == null) return null;
  if (startId === goalId) return { path: [startId], distance: 0 };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  if (!nodeById.has(startId) || !nodeById.has(goalId)) return null;

  // Lista de adjacência
  const adj = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    const a = nodeById.get(e.a);
    const b = nodeById.get(e.b);
    if (!a || !b) continue;
    const w = dist(a, b);
    adj.get(e.a).push({ to: e.b, w });
    adj.get(e.b).push({ to: e.a, w });
  }

  const distTo = new Map();
  const prev = new Map();
  for (const n of nodes) distTo.set(n.id, Infinity);
  distTo.set(startId, 0);

  // Fila de prioridade simples (suficiente para plantas de shopping).
  // Cada item: { id, d }. Marcamos visitados para ignorar entradas obsoletas.
  const visited = new Set();
  const pq = [{ id: startId, d: 0 }];

  while (pq.length) {
    // extrai o de menor distância
    let bestIdx = 0;
    for (let i = 1; i < pq.length; i++) {
      if (pq[i].d < pq[bestIdx].d) bestIdx = i;
    }
    const { id: u } = pq.splice(bestIdx, 1)[0];
    if (visited.has(u)) continue;
    visited.add(u);
    if (u === goalId) break;

    for (const { to, w } of adj.get(u)) {
      if (visited.has(to)) continue;
      const nd = distTo.get(u) + w;
      if (nd < distTo.get(to)) {
        distTo.set(to, nd);
        prev.set(to, u);
        pq.push({ id: to, d: nd });
      }
    }
  }

  if (distTo.get(goalId) === Infinity) return null;

  // Reconstrói o caminho
  const path = [];
  let cur = goalId;
  while (cur != null) {
    path.unshift(cur);
    if (cur === startId) break;
    cur = prev.get(cur);
  }
  return { path, distance: distTo.get(goalId) };
}

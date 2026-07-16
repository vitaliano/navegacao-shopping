/* ============================================================
   Porteiro — servidor publicador do mapa (Cloudflare Worker)

   O que faz: recebe do editor a senha do usuário e o mapa, confere a
   senha na lista de usuários e, se válida, grava data/mapa.json no
   GitHub usando UM token guardado aqui (secreto). Assim o staff nunca
   digita token: usa só a senha dele.

   Configurar em: Cloudflare > seu Worker > Settings > Variables and Secrets
     • GITHUB_TOKEN  (Secret)  → token fine-grained com Contents: Read and write
     • USERS         (Secret)  → JSON senha→nome, ex.:
                                 {"ana-2026":"Ana","bruno-2026":"Bruno"}
     • REPO   (opcional)       → "vitaliano/navegacao-shopping" (padrão abaixo)
     • BRANCH (opcional)       → "main"
     • MAP_PATH (opcional)     → "data/mapa.json"

   Duas ações (POST JSON):
     { "action":"verify",  "password":"..." }            → { ok, name }
     { "action":"publish", "password":"...", "map":{…} } → { ok, name } | { ok:false, error }
   ============================================================ */

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ ok: false, error: "use POST" }, 405, cors);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "json inválido" }, 400, cors); }

    const { action, password, map } = body || {};
    const users = safeParse(env.USERS) || {};
    const name = password ? users[password] : undefined;
    if (!name) return json({ ok: false, error: "senha inválida" }, 401, cors);

    if (action === "verify") return json({ ok: true, name }, 200, cors);

    if (action === "publish") {
      if (!map || typeof map !== "object") return json({ ok: false, error: "mapa ausente" }, 400, cors);
      const repo = env.REPO || "vitaliano/navegacao-shopping";
      const branch = env.BRANCH || "main";
      const path = env.MAP_PATH || "data/mapa.json";
      const api = `https://api.github.com/repos/${repo}/contents/${path}`;
      const gh = {
        "Authorization": "Bearer " + env.GITHUB_TOKEN,
        "Accept": "application/vnd.github+json",
        "User-Agent": "porteiro-mapa",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      try {
        // sha atual do arquivo (necessário para atualizar)
        let sha;
        const getRes = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers: gh });
        if (getRes.ok) sha = (await getRes.json()).sha;
        else if (getRes.status !== 404) {
          return json({ ok: false, error: "GitHub leu " + getRes.status }, 502, cors);
        }
        const content = JSON.stringify(map, null, 2);
        const putRes = await fetch(api, {
          method: "PUT",
          headers: { ...gh, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `Atualiza mapa (publicado por ${name})`,
            content: b64(content),
            sha,
            branch,
          }),
        });
        if (!putRes.ok) {
          const txt = await putRes.text();
          return json({ ok: false, error: "GitHub " + putRes.status + ": " + txt.slice(0, 140) }, 502, cors);
        }
        return json({ ok: true, name }, 200, cors);
      } catch (e) {
        return json({ ok: false, error: "erro: " + (e && e.message ? e.message : e) }, 500, cors);
      }
    }

    return json({ ok: false, error: "ação desconhecida" }, 400, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

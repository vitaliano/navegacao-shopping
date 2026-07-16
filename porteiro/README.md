# Porteiro (servidor publicador)

Pequeno serviço que deixa o staff publicar o mapa **usando só a senha de cada
um** — sem token do GitHub. O token fica guardado **aqui**, em segredo, e é
usado pelo porteiro para gravar `data/mapa.json` no repositório.

Roda como um **Cloudflare Worker** (grátis). O site continua no GitHub Pages.

## Passo a passo (uma única vez)

### 1. Criar o token do GitHub (1 token, 1 vez)
1. Acesse https://github.com/settings/personal-access-tokens/new
2. Name: `porteiro-mapa` · Expiration: à sua escolha
3. Resource owner: `vitaliano`
4. Repository access: **Only select repositories** → `navegacao-shopping`
5. Permissions → **Contents: Read and write**
6. **Generate token** e copie (`github_pat_...`).

### 2. Criar o Worker
1. Crie conta grátis em https://dash.cloudflare.com
2. Menu **Workers & Pages** → **Create** → **Create Worker**
3. Dê um nome (ex.: `porteiro-mapa`) → **Deploy** (cria um exemplo)
4. **Edit code** → apague tudo → cole o conteúdo de [`worker.js`](worker.js) → **Deploy**

### 3. Configurar os segredos
No Worker: **Settings → Variables and Secrets → Add**:
- `GITHUB_TOKEN` — tipo **Secret** — cole o token do passo 1
- `USERS` — tipo **Secret** — JSON com senha→nome, por exemplo:
  ```json
  {"ana-2026":"Ana Silva","bruno-2026":"Bruno Costa","fabio-2026":"Fabio"}
  ```
  (a **chave** é a senha que a pessoa digita; o **valor** é o nome dela)

*(Opcional: `REPO`, `BRANCH`, `MAP_PATH` — só se mudar do padrão.)*

### 4. Pegar a URL do Worker
Fica algo como `https://porteiro-mapa.SEU-SUBDOMINIO.workers.dev`.
Essa URL é colada no editor (constante `window.PORTEIRO_URL` em `editor.html`).

## Gerenciar usuários (dia a dia)
Para adicionar/remover pessoa ou trocar senha: edite o segredo **`USERS`** no
Worker e salve. Efeito imediato. Nada de token para ninguém.

## Segurança
- O token do GitHub **nunca** sai do Worker (não aparece no site).
- As senhas dos usuários ficam **só** no Worker (não no código do site).
- Cada publicação vira um commit assinado com o nome de quem publicou.

# Navegação do Shopping

App estático (HTML/CSS/JS puro, sem servidor) para navegar por um mapa de
shopping e traçar rotas entre pontos/lojas.

## Páginas
- **index.html** — página do usuário: escolhe origem/destino e vê a rota.
- **editor.html** — página do configurador: desenha corredores, cadastra lojas
  e publica o mapa. (Não é linkada a partir da página do usuário.)

## Arquivos
| Arquivo | Papel |
|---|---|
| `data/mapa.json` | **O mapa oficial** (planta + pontos + corredores). É o que o app carrega. |
| `images/mapa-interno.png` | Planta de fundo. |
| `app.js` | Motor: estado, render, edição, roteamento. |
| `autodetect.js` | Detecção automática de corredores a partir da planta. |
| `pathfinding.js` | Dijkstra (rota mais curta). |
| `qrcode.js` | Gerador de QR Code (para pontos "Você está aqui"). |
| `style.css` | Estilo. |

> O app precisa ser aberto por **http(s)://** (não `file://`), senão o
> navegador bloqueia o carregamento de `data/mapa.json`.

## Rodar localmente
```bash
python -m http.server 8000
# abra http://localhost:8000/index.html  (usuário)
#     http://localhost:8000/editor.html  (configurador)
```

## Publicar (colocar no ar)

O site é estático — qualquer hospedagem estática serve. Todos os caminhos são
relativos, então funciona também em subpasta (ex.: GitHub Pages).

### Opção 1 — Netlify (recomendado)
1. Crie conta em https://app.netlify.com
2. **Add new site → Deploy manually** e **arraste a pasta do projeto**.
3. Pronto: o site fica em `https://SEU-SITE.netlify.app`
   - Usuário: `.../index.html` (ou a raiz)
   - Configurador: `.../editor.html`

### Opção 2 — GitHub Pages
1. Suba a pasta para um repositório no GitHub.
2. **Settings → Pages → Deploy from a branch** → branch `main`, pasta `/root`.
3. O site fica em `https://SEU-USUARIO.github.io/SEU-REPO/`

## Fluxo de atualização (revisar e publicar)

Não há backend: o botão **Publicar** do editor **baixa** um `mapa.json`, não
grava no servidor. O ciclo de atualização é:

1. Quem atualiza abre **editor.html**, mexe nas lojas/corredores.
2. Clica em **⬇️ Publicar (JSON)** → baixa `mapa.json`.
3. Envia o arquivo para o responsável.
4. O responsável **substitui `data/mapa.json`** pelo recebido e **republica**
   (re-arrasta a pasta no Netlify, ou dá commit/push no GitHub).

Assim as mudanças só entram no ar após a sua revisão, e ninguém consegue
alterar o mapa público sozinho.

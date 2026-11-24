# Rubik's Cube

![Rubik's Cube: 2×2 to 12×12 in the browser](assets/banner.png)

A configurable NxN (2×2 to 12×12) cube you can solve in the browser. It uses plain ES modules and Three.js from a CDN, with no build step.

## Dependencies

The page has nothing to install: the root `package.json` has no dependencies and there is no build step. The optional real-cube server (`server/`) has its own dependencies, listed below.

| Dependency | Version | Used for | Loaded from |
|---|---|---|---|
| [Three.js](https://threejs.org/) | 0.187.0 (pinned) | Rendering (`js/cube.js`, `js/main.js`) | jsDelivr CDN via the import map in `index.html` |
| Three.js addon `TrackballControls` | 0.187.0 | Free camera rotation (`js/main.js`) | `three/addons/controls/TrackballControls.js` |
| Three.js addon `RoundedBoxGeometry` | 0.187.0 | Rounded cubies (`js/cube.js`) | `three/addons/geometries/RoundedBoxGeometry.js` |

To upgrade Three.js, change the version in both import map entries in `index.html`.

Server (`server/package.json`, pinned, installed with `npm ci` or by the Docker build):

| Dependency | Version | Used for |
|---|---|---|
| [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) | 1.32.2 | MCP Streamable HTTP endpoint |
| [zod](https://www.npmjs.com/package/zod) | 4.6.7 | MCP tool input schemas |
| [cubejs](https://github.com/ldez/cubejs) | 1.3.2, vendored in `server/vendor/cubejs` (MIT) | Kociemba two-phase solver and its move/pruning tables (also used by the optimal short search). Vendored because its npm package needlessly depends on `npm@6`, which pulls in about 27 MB of packages with known CVEs. Patched to take a deadline (it has no timeout option); see `server/vendor/cubejs/PATCHES.md`. |
| Docker image `node` | 26.13.1-alpine | Container runtime |

Runtime requirements:

- **Browser** with ES modules, import maps and WebGL (any current Chrome, Edge, Firefox or Safari). It needs internet access to reach the CDN.
- **Static file server**, because ES modules don't load over `file://`. Any server works.

Development tools (not installed by the project):

- **Node.js** with the built-in `node:test` runner, for `npm test`. Tested on Node 26.
- **[serve](https://www.npmjs.com/package/serve)**, fetched on demand by `npx` for `npm start`. Python's `http.server` works too.

## Deploy

Static only: copy the files to any static host. `.htaccess` (Apache) returns 404 for dotfiles (`.git`, `.env`), `server/`, `data/` and the build/package files, so a checkout can be served directly.

With real-cube mode, either run the Docker container (see [Real-cube mode + MCP server](#real-cube-mode--mcp-server)) from a checkout outside the web root and put HTTPS in front of it, or serve the checkout with Apache or nginx as below.

## Deploy on Apache or nginx

There is no build step, so the web server can serve a git checkout as it is (for example `/var/www/html/rubiks`, served at `https://example.com/rubiks/`). Updating is then just `git pull`.

```sh
cd /var/www/html
git clone https://github.com/Darknetzz/rubiks-cube.git rubiks
```

That is all the plain cube needs. Real-cube mode and the MCP endpoint also need the Node server, which the web server reaches through a reverse proxy. The page calls `api/…` relative to its own address, so it works in a subfolder without any settings: proxy `<folder>/api/` and `<folder>/mcp` to the Node server and let Apache or nginx serve the rest.

### 1. Run the Node server

Needs Node.js 20.6 or newer (for `--env-file`); the Docker image uses Node 26.

```sh
cd /var/www/html/rubiks/server && npm ci --omit=dev && cd ..
echo "MCP_TOKEN=$(openssl rand -hex 32)" > .env
mkdir -p data
PORT=3000 node --env-file=.env server/src/index.js   # try it: curl http://127.0.0.1:3000/healthz
```

Settings, in `.env` or the environment:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the server listens on (all interfaces; firewall it or proxy only) |
| `MCP_TOKEN` | none | Bearer token for `/mcp`; without it every MCP request is refused |
| `DATA_FILE` | `data/state.json` in the checkout | The default cube; other cubes go in `cubes/` next to it |
| `SOLVE_BUDGET_MS` | `2000` | Time budget for a whole solve |
| `SHORT_SEARCH_MS` | `300` | Time budget for the optimal search within it |

The user that runs the server must be able to write `data/` (or the folder of `DATA_FILE`). `.htaccess` hides `.env`, `data/` and `server/` from the web on Apache; the nginx config below does the same.

To keep it running, a systemd unit such as `/etc/systemd/system/rubiks-cube.service`:

```ini
[Unit]
Description=Rubik's Cube real-cube / MCP server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/html/rubiks
Environment=NODE_ENV=production PORT=3000
ExecStart=/usr/bin/node --env-file=.env server/src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```sh
sudo chown -R www-data: /var/www/html/rubiks/data
sudo systemctl daemon-reload
sudo systemctl enable --now rubiks-cube
```

Change `User=` and the `node` path to fit (with nvm, `ExecStart=/bin/bash -lc 'source ~/.nvm/nvm.sh && exec node --env-file=.env server/src/index.js'`). The server reads its solver tables at start, which takes a moment.

Instead of the systemd unit you can run the Docker container and proxy to its port (`8095` by default). `compose.yaml` publishes that port on all interfaces, so firewall it or change the mapping to `127.0.0.1:${CUBE_PORT:-8095}:3000`.

### 2a. Apache

`.htaccess` needs `AllowOverride FileInfo` (or `All`) for the folder; otherwise put its `RedirectMatch` line in the vhost. Enable the proxy modules and add to the site's vhost (for HTTPS, the `:443` one):

```sh
sudo a2enmod proxy proxy_http
```

```apache
# Rubik's Cube: real-cube API (with its live SSE stream) and the MCP endpoint
<Location /rubiks/api/>
    ProxyPass http://127.0.0.1:3000/api/ flushpackets=on
    ProxyPassReverse http://127.0.0.1:3000/api/
</Location>
<Location /rubiks/mcp>
    ProxyPass http://127.0.0.1:3000/mcp flushpackets=on
    ProxyPassReverse http://127.0.0.1:3000/mcp
</Location>
```

```sh
sudo apachectl configtest && sudo systemctl reload apache2
```

`flushpackets=on` sends the live view's server-sent events straight through instead of buffering them. The server pings the stream every 25 s, well inside Apache's default 60 s proxy timeout.

### 2b. nginx

nginx ignores `.htaccess`, so the config has to hide the same files:

```nginx
# inside the server { } block
location /rubiks/ {
    alias /var/www/html/rubiks/;
    index index.html;

    # same as .htaccess: only the static app is public
    location ~ ^/rubiks/(\.[^/]*|server|data|node_modules|tests|Dockerfile|compose\.yaml|package(-lock)?\.json|README\.md)(/|$) {
        return 404;
    }
}

# real-cube API (with its live SSE stream) and the MCP endpoint
location /rubiks/api/ {
    proxy_pass http://127.0.0.1:3000/api/;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
location = /rubiks/mcp {
    proxy_pass http://127.0.0.1:3000/mcp;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

```sh
sudo nginx -t && sudo systemctl reload nginx
```

When the checkout is the site's root instead of a subfolder, use `root /var/www/html/rubiks;` in place of the `alias` block and drop the `/rubiks` prefix everywhere.

### 3. Check it

- `https://example.com/rubiks/` shows the cube, and the real-cube button appears (the page shows it only when `api/state` answers).
- `curl https://example.com/rubiks/api/state` returns JSON.
- `curl https://example.com/rubiks/.env` and `…/server/src/index.js` return 404.
- The MCP URL for Claude is `https://example.com/rubiks/mcp`, with the header `Authorization: Bearer <MCP_TOKEN>`.

Serve it over HTTPS: the MCP token travels in a header.

## Run

ES modules don't load over `file://`, so serve the folder:

```sh
npm start              # npx serve .
# or: python -m http.server
```

## Features

- Cube size, turn speed, scramble length, colour scheme, sticker/body/background colours and key bindings, all saved in localStorage
- Colour scheme presets: **My cube** (the default: mirrored Japanese scheme, white top, yellow front, red right), Western / American (white top or yellow top), Japanese (white top, green front), or a custom one set face by face. Every preset is a rotation of a real scheme (Japanese cubes are made in both handednesses), and tests check this. Save/load follows the scheme. In real-cube mode, Paint → Clear starts from a solved cube in this scheme. In real-cube mode, picking a preset while the cube is solved opens Paint with a solved cube in that scheme, ready to send. Claude still reads your real cube's scheme from its centres
- Drag a sticker to turn its layer; right- or middle-drag to orbit (touch: drag the background)
- Keyboard notation: `R L U D F B M E S x y z`, Shift for counter-clockwise, a number prefix for inner layers (`3` then `R` → `3R`)
- Text input for algorithms (`R U R' U'`, `2Rw`, `r`, `M2`, …)
- Timer and move counter that start after a scramble and stop when the cube is solved
- Undo, and an auto-Solve that plays back the inverse of the scramble plus your moves
- The cube, its move history, move count and timer survive a page reload (saved in localStorage), and so does real-cube mode
- Save / load the sticker state (any size) as text, a `#state=…` link or a JSON file. Stickers are written as colour letters `W Y R O G B` in Kociemba facelet order, so a 3×3 is the same 54 letters the MCP `get_cube`/`set_cube` tools use; other sizes are written `N:letters`. Older exports in face letters `U R F D L B` still load. Solve can't undo an imported cube, because its move history isn't known

## Real-cube mode + MCP server

`server/` is a small Node service that serves the page and also:

- shares one physical 3×3's state between the page (Paint → **Send to Claude**, then a live view over SSE) and Claude, which reaches it through an MCP endpoint
- keeps **many cubes**, each with its own code. The page puts its cube's code in the address (`?cube=k3f9x2m7qa`) and shows it in real-cube mode; it reopens the last cube you used, or makes a new random code. **New cube** starts another one. Give Claude the code: every MCP tool takes an optional `cube` argument (without it, the shared `default` cube, which is the old single cube). Each cube is saved as `cubes/<code>.json` next to `DATA_FILE`. The code is the only key to a cube, so share the link only with people who may change it
- solves it in as few moves as it can find within a time budget:
  1. an IDA* search for an exact **optimal** solution (half-turn metric). It handles cubes up to about 10 moves from solved in milliseconds and stops after `SHORT_SEARCH_MS` (default 300).
  2. If that runs out, Kociemba's two-phase algorithm (vendored [cubejs](https://github.com/ldez/cubejs), MIT, ≤22 moves), asked again for one move fewer each time it succeeds, until `SOLVE_BUDGET_MS` (default 2000) is used up.

  The `solve` tool says either "optimal" or "best found in N ms". Set the budgets in `.env`. A solve blocks the server for at most the budget.

Any colour scheme works (Western, Japanese with white opposite blue, or custom). The state is stored as sticker colours (`W Y R O G B`), and the six centre stickers decide which colour belongs to which face. Validation, the solver and every instruction Claude gets (how to hold the cube, the diagram, move explanations) are worked out from those centres. The page and MCP share one state store.

- **Painting is saved** in the browser as you go, so a reload (or closing Paint) keeps it. It is only dropped by **Clear**, a successful **Send to Claude**, or choosing to discard your edits.
- **Live while painting:** moves Claude applies animate on the painted cube too, so your edits turn with their layers. Only a full replacement (`set_cube`, `reset_cube`) asks before discarding edits.
- **Moves and undo on the page:** in real-cube mode, turns you make on the page (drag, keyboard, Apply moves) are recorded as moves on your real cube, exactly like Claude's `apply_moves`. **Done: R2** records the plan's current step in one tap. **Undo** reverts the last recorded move or batch, yours or Claude's, together with the plan as it was. The plan follows the cube's state, so a half turn done as two quarter turns still counts. Setting a new state (Send, `set_cube`, `reset_cube`) starts a fresh undo history.
- **Next move:** while there is a plan, an arrow on the 3D cube shows the current step. Quarter turns get one head, half turns two heads and a ×2 label. When the turning face is hidden or seen nearly edge-on (more than ~75° from the view, where the curved arrow would flatten into a line that looks like another move), straight arrows are drawn along that layer on the visible neighbouring faces instead, showing which way its stickers move. It is re-chosen every frame as you orbit.
- **Claude's own steps:** `set_plan` stores a custom list of moves as the plan instead of the solver's (an algorithm, one stage of a method, a fix), each with an optional label such as "F2L pair 1". The page shows them exactly like a solve (arrow, hint, Done), with each label before its group of steps, and `apply_moves` advances them the same way. Steps already done are kept; new steps replace the rest, or with `append` are added after them, so a solve can be fed in one stage at a time.
- **Beginner method, one stage at a time:** `solve_stage` plans the next layer-by-layer stage (cross, first-layer corners, middle-layer edges, last-layer cross, orient last layer, permute last layer) as a labelled plan, skipping stages already done. The cross and corners are built with the cross colour on top (corners go in with R' D' R D from below); from the middle layer on it faces down, so the stage starts with a whole-cube rotation when needed.
- **Preview:** `preview_moves` shows the state a move sequence would give, without touching the cube or the plan.
- **Hold:** in real-cube mode the page shows the same "Hold:" line Claude gets. The page draws the cube that way round: top on top, the face you hold towards you at the front, right on the right.
- **Mirrored centres are rejected where no such cube exists:** a mirror image of the Western scheme gets a clear message, e.g. "orange and red look swapped: is the cube mirrored?". Japanese and mirrored Japanese are both real cubes, so both are accepted.
- **Plain-language hints** for every plan move, on the page and in the MCP output, relative to how you hold the cube (e.g. `U` = "top row facing you moves left", `B` = "top of the back layer moves to your left"). Tests check each hint and arrow against the cube model.

MCP tools: `get_cube`, `set_cube`, `solve`, `solve_stage`, `set_plan`, `preview_moves`, `apply_moves`, `reset_cube`. The endpoint is `/mcp` and requires an `Authorization: Bearer <MCP_TOKEN>` header.

```sh
echo "MCP_TOKEN=$(openssl rand -hex 32)" > .env
docker compose up -d --build        # http://localhost:8095 (CUBE_PORT to change)
```

Real-cube mode is only offered when the page is served by this server, or by a web server that proxies `api/` to it (see [Deploy on Apache or nginx](#deploy-on-apache-or-nginx)).

## Test

```sh
(cd server && npm ci) && npm test
```

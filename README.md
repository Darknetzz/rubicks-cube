# Rubik's Cube

A configurable NxN (2×2 to 12×12) cube you can solve in the browser. It uses plain ES modules and Three.js from a CDN, with no build step.

## Dependencies

The page has nothing to install: the root `package.json` has no dependencies and there is no build step. The optional real-cube server (`server/`) has its own dependencies, listed below.

| Dependency | Version | Used for | Loaded from |
|---|---|---|---|
| [Three.js](https://threejs.org/) | 0.187.0 (pinned) | Rendering (`js/cube.js`, `js/main.js`) | jsDelivr CDN via the import map in `index.html` |
| Three.js addon `OrbitControls` | 0.187.0 | Camera orbit (`js/main.js`) | `three/addons/controls/OrbitControls.js` |
| Three.js addon `RoundedBoxGeometry` | 0.187.0 | Rounded cubies (`js/cube.js`) | `three/addons/geometries/RoundedBoxGeometry.js` |

To upgrade Three.js, change the version in both import map entries in `index.html`.

Server (`server/package.json`, pinned, installed with `npm ci` or by the Docker build):

| Dependency | Version | Used for |
|---|---|---|
| [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) | 1.32.2 | MCP Streamable HTTP endpoint |
| [zod](https://www.npmjs.com/package/zod) | 4.6.7 | MCP tool input schemas |
| [cubejs](https://github.com/ldez/cubejs) | 1.3.2, vendored in `server/vendor/cubejs` (MIT) | Kociemba two-phase solver. Vendored because its npm package needlessly depends on `npm@6`, which pulls in about 27 MB of packages with known CVEs. |
| Docker image `node` | 26.13.1-alpine | Container runtime |

Runtime requirements:

- **Browser** with ES modules, import maps and WebGL (any current Chrome, Edge, Firefox or Safari). It needs internet access to reach the CDN.
- **Static file server**, because ES modules don't load over `file://`. Any server works.

Development tools (not installed by the project):

- **Node.js** with the built-in `node:test` runner, for `npm test`. Tested on Node 26.
- **[serve](https://www.npmjs.com/package/serve)**, fetched on demand by `npx` for `npm start`. Python's `http.server` works too.

## Deploy

Static only: copy the files to any static host. `.htaccess` (Apache) returns 404 for dotfiles (`.git`, `.env`), `server/`, `data/` and the build/package files, so a checkout can be served directly.

With real-cube mode: run the Docker container (see below) from a checkout outside the web root, and put HTTPS in front of it.

## Run

ES modules don't load over `file://`, so serve the folder:

```sh
npm start              # npx serve .
# or: python -m http.server
```

## Features

- Cube size, turn speed, scramble length, sticker/body/background colours and key bindings, all saved in localStorage
- Drag a sticker to turn its layer; drag the background to orbit
- Keyboard notation: `R L U D F B M E S x y z`, Shift for counter-clockwise, a number prefix for inner layers (`3` then `R` → `3R`)
- Text input for algorithms (`R U R' U'`, `2Rw`, `r`, `M2`, …)
- Timer and move counter that start after a scramble and stop when the cube is solved
- Undo, and an auto-Solve that plays back the inverse of the scramble plus your moves

## Real-cube mode + MCP server

`server/` is a small Node service that serves the page and also:

- shares one physical 3×3's state between the page (Paint → **Send to Claude**, then a live view over SSE) and Claude, which reaches it through an MCP endpoint
- solves it with Kociemba's two-phase algorithm (≤22 moves; vendored [cubejs](https://github.com/ldez/cubejs), MIT)

MCP tools: `get_cube`, `set_cube`, `solve`, `apply_moves`, `reset_cube`. The endpoint is `/mcp` with an `Authorization: Bearer <MCP_TOKEN>` header, or `/mcp/<MCP_TOKEN>`.

```sh
echo "MCP_TOKEN=$(openssl rand -hex 32)" > .env
docker compose up -d --build        # http://localhost:8095 (CUBE_PORT to change)
```

Real-cube mode is only offered when the page is served by this server.

## Test

```sh
(cd server && npm ci) && npm test
```

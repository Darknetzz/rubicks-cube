import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Cubes, validCube, DEFAULT_CUBE } from './cubes.js';
import { buildMcpServer } from './mcp.js';
import { initSolver } from './cube3.js';

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.MCP_TOKEN || '';
const STATIC_DIR = resolve(process.env.STATIC_DIR || fileURLToPath(new URL('../..', import.meta.url)));
const DATA_FILE = process.env.DATA_FILE || join(STATIC_DIR, 'data', 'state.json');
const MAX_BODY = 64 * 1024;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png' };
const STATIC = /^\/(index\.html|style\.css|js\/[a-z0-9-]+\.js|assets\/[a-z0-9-]+\.(svg|png))$/;

const cubes = new Cubes(DATA_FILE, join(dirname(DATA_FILE), 'cubes'));
const clients = new Map(); // cube id -> Set of SSE responses

cubes.on('change', (id, event) => {
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of clients.get(id) ?? []) res.write(data);
});

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        ok(raw ? JSON.parse(raw) : undefined);
      } catch {
        fail(new Error('invalid JSON'));
      }
    });
    req.on('error', fail);
  });
}

function tokenOk(given) {
  if (!TOKEN || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleMcp(req, res) {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!tokenOk(bearer)) return send(res, 401, { error: 'unauthorized' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }); // stateless: no GET stream / DELETE
  const body = await readBody(req);
  const server = buildMcpServer((id) => cubes.get(id ?? DEFAULT_CUBE));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

function handleEvents(req, res, id, session) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  res.write(`event: state\ndata: ${JSON.stringify({ type: 'state', ...session.snapshot() })}\n\n`);
  if (!clients.has(id)) clients.set(id, new Set());
  clients.get(id).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.get(id)?.delete(res);
    if (clients.get(id)?.size === 0) clients.delete(id);
  });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const { pathname } = url;

  if (pathname === '/mcp' || pathname === '/mcp/') return handleMcp(req, res);

  if (pathname === '/healthz') return send(res, 200, { ok: true });

  // Every /api route works on one cube, picked by ?cube=<code> (the shared default cube without it).
  let id;
  let session;
  if (pathname.startsWith('/api/')) {
    id = url.searchParams.get('cube') || DEFAULT_CUBE;
    if (!validCube(id)) return send(res, 400, { error: 'Invalid cube code.' });
    session = cubes.get(id);
  }
  if (pathname === '/api/events' && req.method === 'GET') return handleEvents(req, res, id, session);
  // Moves done on the real cube, entered on the page (Claude records them with apply_moves), undo/redo, and
  // stepping back and forth along the plan.
  if (['/api/moves', '/api/undo', '/api/redo', '/api/goto'].includes(pathname)) {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    const body = (await readBody(req)) ?? {};
    const origin = typeof body.origin === 'string' ? body.origin.slice(0, 64) : null;
    try {
      if (pathname === '/api/undo') {
        if (!session.undo(origin)) return send(res, 409, { error: 'Nothing to undo.' });
      } else if (pathname === '/api/redo') {
        if (!session.redo(origin)) return send(res, 409, { error: 'Nothing to redo.' });
      } else if (pathname === '/api/goto') {
        session.goto(body.step, origin);
      } else {
        const moves = Array.isArray(body.moves) || typeof body.moves === 'string' ? body.moves : '';
        if (!String(moves).trim()) return send(res, 422, { error: 'No moves given.' });
        session.apply(moves, origin);
      }
      return send(res, 200, session.snapshot());
    } catch (err) {
      return send(res, 422, { error: err.message });
    }
  }

  // An unfinished painting, kept for Claude to see (get_cube) without replacing the cube's state.
  if (pathname === '/api/draft') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    const body = await readBody(req);
    try {
      session.setDraft(body?.state, body?.painted);
      return send(res, 200, session.snapshot());
    } catch (err) {
      return send(res, 422, { error: err.message });
    }
  }

  if (pathname === '/api/state') {
    if (req.method === 'GET') return send(res, 200, session.snapshot());
    if (req.method === 'POST') {
      const body = await readBody(req);
      try {
        session.setState(body?.state);
        return send(res, 200, session.snapshot());
      } catch (err) {
        return send(res, 422, { error: err.message });
      }
    }
    return send(res, 405, { error: 'method not allowed' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
  const path = pathname === '/' ? '/index.html' : pathname;
  if (!STATIC.test(path)) return send(res, 404, 'Not found', 'text/plain');
  try {
    const file = await readFile(join(STATIC_DIR, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)], 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : file);
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

if (!TOKEN) console.warn('MCP_TOKEN is not set: the /mcp endpoint will refuse every request.');
console.log('initialising solver tables…');
initSolver();

http
  .createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, err.message === 'invalid JSON' || err.message === 'body too large' ? 400 : 500, { error: err.message });
      else res.end();
    });
  })
  .listen(PORT, () => console.log(`rubiks cube server on :${PORT}`));

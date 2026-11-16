import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Session } from './session.js';
import { buildMcpServer } from './mcp.js';
import { initSolver } from './cube3.js';

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.MCP_TOKEN || '';
const STATIC_DIR = resolve(process.env.STATIC_DIR || fileURLToPath(new URL('../..', import.meta.url)));
const DATA_FILE = process.env.DATA_FILE || join(STATIC_DIR, 'data', 'state.json');
const MAX_BODY = 64 * 1024;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const STATIC = /^\/(index\.html|style\.css|js\/[a-z0-9-]+\.js)$/;

const session = new Session(DATA_FILE);
const clients = new Set();

session.on('change', (event) => {
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(data);
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

async function handleMcp(req, res, pathToken) {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!tokenOk(pathToken || bearer)) return send(res, 401, { error: 'unauthorized' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }); // stateless: no GET stream / DELETE
  const body = await readBody(req);
  const server = buildMcpServer(session);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

function handleEvents(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  res.write(`event: state\ndata: ${JSON.stringify({ type: 'state', ...session.snapshot() })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

async function route(req, res) {
  const { pathname } = new URL(req.url, 'http://x');

  const mcp = /^\/mcp(?:\/([^/]+))?\/?$/.exec(pathname);
  if (mcp) return handleMcp(req, res, mcp[1]);

  if (pathname === '/healthz') return send(res, 200, { ok: true });
  if (pathname === '/api/events' && req.method === 'GET') return handleEvents(req, res);
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

// Client for the optional cube server (server/), which shares a real cube's state with Claude over MCP.
// Paths are relative so the page also works from a sub-directory; on a static host they simply 404.

// Each real cube on the server has a code. The page keeps it in its address (?cube=...) and remembers the last one, so
// opening the page again goes back to your cube; without either it makes a new random one.
const CUBE_KEY = 'rubiks-cube-code';
const CODE = /^([a-z0-9]{8,32}|default)$/;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}

function remember(code) {
  try {
    localStorage.setItem(CUBE_KEY, code);
  } catch {
    /* storage unavailable */
  }
}

let code = null;

/** This page's cube code; also puts it in the address bar so the link reopens the same cube. */
export function cubeCode() {
  if (code) return code;
  const fromUrl = new URLSearchParams(location.search).get('cube');
  let stored = null;
  try {
    stored = localStorage.getItem(CUBE_KEY);
  } catch {
    /* storage unavailable */
  }
  code = [fromUrl, stored].find((c) => CODE.test(c ?? '')) ?? newCode();
  remember(code);
  const url = new URL(location.href);
  if (url.searchParams.get('cube') !== code) {
    url.searchParams.set('cube', code);
    history.replaceState(history.state, '', url);
  }
  return code;
}

/** Switch this page to a brand-new cube (reloads the page). */
export function newCube() {
  const fresh = newCode();
  remember(fresh);
  const url = new URL(location.href);
  url.searchParams.set('cube', fresh);
  location.href = url.href;
}

const api = (path) => `api/${path}?cube=${encodeURIComponent(cubeCode())}`;

export async function serverAvailable() {
  try {
    const r = await fetch('api/state', { cache: 'no-store' }); // just a probe: the default cube
    return r.ok && (r.headers.get('content-type') || '').includes('application/json');
  } catch {
    return false;
  }
}

/** Subscribe to state / plan / moves events. Returns a function that disconnects. */
export function connect(onEvent, onStatus) {
  const es = new EventSource(api('events'));
  for (const type of ['state', 'plan', 'moves']) es.addEventListener(type, (e) => onEvent(JSON.parse(e.data)));
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false); // EventSource reconnects by itself
  return () => es.close();
}

export async function postState(state) {
  const r = await fetch(api('state'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Server error ${r.status}`);
  return body;
}

/** Send a painting that isn't a valid cube yet (with a '1'/'0' mask of the stickers painted by hand) for Claude to see. */
export const postDraft = (state, painted) => post(api('draft'), { state, painted });

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || `Server error ${r.status}`);
  return json;
}

/** Record moves done on the real cube (array of tokens). The page animates them when the server's event arrives. */
export const postMoves = (moves, origin) => post(api('moves'), { moves, origin });

/** Undo the last recorded batch of moves (the page's or Claude's). */
export const postUndo = (origin) => post(api('undo'), { origin });

/** Redo the last undone batch. */
export const postRedo = (origin) => post(api('redo'), { origin });

/** Move along the plan to step `step` (forwards or backwards), keeping the plan. */
export const postGoto = (step, origin) => post(api('goto'), { step, origin });

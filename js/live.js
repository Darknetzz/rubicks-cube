// Client for the optional cube server (server/), which shares a real cube's state with Claude over MCP.
// Paths are relative so the page also works from a sub-directory; on a static host they simply 404.

export async function serverAvailable() {
  try {
    const r = await fetch('api/state', { cache: 'no-store' });
    return r.ok && (r.headers.get('content-type') || '').includes('application/json');
  } catch {
    return false;
  }
}

/** Subscribe to state / plan / moves events. Returns a function that disconnects. */
export function connect(onEvent, onStatus) {
  const es = new EventSource('api/events');
  for (const type of ['state', 'plan', 'moves']) es.addEventListener(type, (e) => onEvent(JSON.parse(e.data)));
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false); // EventSource reconnects by itself
  return () => es.close();
}

export async function postState(state) {
  const r = await fetch('api/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Server error ${r.status}`);
  return body;
}

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || `Server error ${r.status}`);
  return json;
}

/** Record moves done on the real cube (array of tokens). The page animates them when the server's event arrives. */
export const postMoves = (moves, origin) => post('api/moves', { moves, origin });

/** Undo the last recorded batch of moves (the page's or Claude's). */
export const postUndo = (origin) => post('api/undo', { origin });

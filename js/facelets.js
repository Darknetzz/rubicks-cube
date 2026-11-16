// Facelet numbering shared by the page and the server. An N×N state is 6·N² letters, faces in Kociemba order
// U R F D L B, each face read row by row as seen looking straight at it (U with the back edge on top, D with the
// front edge on top, side faces with U on top). For 3×3 this is exactly the 54-letter string cubejs/Kociemba use.
// Coordinates: x right, y up, z towards the viewer, cubie centres at -(N-1)/2 … (N-1)/2.

import { parseMove } from './notation.js';

export const FACES = 'URFDLB';
export const solvedState = (n = 3) => [...FACES].map((f) => f.repeat(n * n)).join('');
export const SOLVED = solvedState(3);

function geometry(i, n) {
  const o = (n - 1) / 2;
  const face = FACES[Math.floor(i / (n * n))];
  const r = Math.floor((i % (n * n)) / n);
  const c = i % n;
  switch (face) {
    case 'U': return { p: [c - o, o, r - o], n: [0, 1, 0] };
    case 'R': return { p: [o, o - r, o - c], n: [1, 0, 0] };
    case 'F': return { p: [c - o, o - r, o], n: [0, 0, 1] };
    case 'D': return { p: [c - o, -o, o - r], n: [0, -1, 0] };
    case 'L': return { p: [-o, o - r, c - o], n: [-1, 0, 0] };
    case 'B': return { p: [o - c, o - r, -o], n: [0, 0, -1] };
  }
}

// Doubled coordinates keep even sizes (half-integer positions) exact.
const key = (p, n) => `${p.map((v) => Math.round(v * 2))}|${n.map(Math.round)}`;
const tables = new Map();
function table(size) {
  if (!tables.has(size)) {
    const geo = Array.from({ length: 6 * size * size }, (_, i) => geometry(i, size));
    tables.set(size, { geo, index: new Map(geo.map(({ p, n }, i) => [key(p, n), i])) });
  }
  return tables.get(size);
}

/** Position `p` and outward normal `n` of every facelet of an N×N. */
export const geometryOf = (size) => table(size).geo;
export const GEOMETRY = geometryOf(3);

/** Facelet index for a sticker on the cubie at `p` facing `n`, or undefined. */
export const faceletIndex = (p, n, size = 3) => table(size).index.get(key(p, n));

// ---------- 3×3 moves on facelet strings (shared by the page and the server) ----------

/** Quarter turns about an axis, right-handed (same sense as `turns` in notation.js). */
export function rotate([x, y, z], axis, q) {
  let v = [x, y, z];
  for (let k = 0; k < ((q % 4) + 4) % 4; k++) {
    const [a, b, c] = v;
    v = axis === 0 ? [a, -c, b] : axis === 1 ? [c, b, -a] : [-b, a, c];
  }
  return v;
}

const permCache = new Map();
/** For a 3×3 move token: perm[i] = where facelet i ends up. */
export function permutation(token) {
  if (!permCache.has(token)) {
    const { axis, layers, turns } = parseMove(token, 3);
    const perm = GEOMETRY.map(({ p, n }, i) => {
      if (!layers.includes(p[axis] + 1)) return i;
      return faceletIndex(rotate(p, axis, turns), rotate(n, axis, turns));
    });
    permCache.set(token, perm);
  }
  return permCache.get(token);
}

/** Split and check a move sequence (string or array). Throws on bad notation. */
export function splitMoves(moves) {
  const list = Array.isArray(moves) ? moves : String(moves).trim().split(/\s+/).filter(Boolean);
  for (const m of list) parseMove(m, 3);
  return list;
}

/** Apply 3×3 moves to a 54-letter facelet string (any letters). */
export function applyMoves(state, moves) {
  let s = state;
  for (const m of splitMoves(moves)) {
    const perm = permutation(m);
    const next = new Array(54);
    for (let i = 0; i < 54; i++) next[perm[i]] = s[i];
    s = next.join('');
  }
  return s;
}

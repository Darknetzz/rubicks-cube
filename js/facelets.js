// Facelet numbering shared by the page and the server. An N×N state is 6·N² letters, faces in Kociemba order
// U R F D L B, each face read row by row as seen looking straight at it (U with the back edge on top, D with the
// front edge on top, side faces with U on top). For 3×3 this is exactly the 54-letter string cubejs/Kociemba use.
// Coordinates: x right, y up, z towards the viewer, cubie centres at -(N-1)/2 … (N-1)/2.

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

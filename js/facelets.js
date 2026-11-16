// 3×3 facelet numbering shared by the page and the server: 54 stickers in Kociemba order
// U1..U9 R1..R9 F1..F9 D1..D9 L1..L9 B1..B9. Coordinates: x right, y up, z towards the viewer, cubies at -1..1.

export const FACES = 'URFDLB';
export const SOLVED = [...FACES].map((f) => f.repeat(9)).join('');

function geometry(i) {
  const face = FACES[Math.floor(i / 9)];
  const r = Math.floor((i % 9) / 3);
  const c = i % 3;
  switch (face) {
    case 'U': return { p: [c - 1, 1, r - 1], n: [0, 1, 0] };
    case 'R': return { p: [1, 1 - r, 1 - c], n: [1, 0, 0] };
    case 'F': return { p: [c - 1, 1 - r, 1], n: [0, 0, 1] };
    case 'D': return { p: [c - 1, -1, 1 - r], n: [0, -1, 0] };
    case 'L': return { p: [-1, 1 - r, c - 1], n: [-1, 0, 0] };
    case 'B': return { p: [1 - c, 1 - r, -1], n: [0, 0, -1] };
  }
}

/** Position `p` and outward normal `n` of every facelet. */
export const GEOMETRY = Array.from({ length: 54 }, (_, i) => geometry(i));

const key = (p, n) => `${p.map(Math.round)}|${n.map(Math.round)}`;
const INDEX = new Map(GEOMETRY.map(({ p, n }, i) => [key(p, n), i]));

/** Facelet index for a sticker on the cubie at `p` facing `n`, or undefined. */
export const faceletIndex = (p, n) => INDEX.get(key(p, n));

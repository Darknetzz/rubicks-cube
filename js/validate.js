// Checks that a 3×3 facelet string (see facelets.js) is a real, solvable cube. Shared by the page and the server.
import { FACES } from './facelets.js';

export const COLOUR_NAMES = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
export const SIDE_NAMES = { U: 'top', D: 'bottom', F: 'front', B: 'back', L: 'left', R: 'right' };
export const CENTRES = [4, 13, 22, 31, 40, 49];
const OPPOSITE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

// Facelet indices (Kociemba numbering, 0-based).
const f = (face, n) => FACES.indexOf(face) * 9 + n - 1;
const CORNERS = [
  [f('U', 9), f('R', 1), f('F', 3)], [f('U', 7), f('F', 1), f('L', 3)],
  [f('U', 1), f('L', 1), f('B', 3)], [f('U', 3), f('B', 1), f('R', 3)],
  [f('D', 3), f('F', 9), f('R', 7)], [f('D', 1), f('L', 9), f('F', 7)],
  [f('D', 7), f('B', 9), f('L', 7)], [f('D', 9), f('R', 9), f('B', 7)],
];
const CORNER_COLOURS = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
const EDGES = [
  [f('U', 6), f('R', 2)], [f('U', 8), f('F', 2)], [f('U', 4), f('L', 2)], [f('U', 2), f('B', 2)],
  [f('D', 6), f('R', 8)], [f('D', 2), f('F', 8)], [f('D', 4), f('L', 8)], [f('D', 8), f('B', 8)],
  [f('F', 6), f('R', 4)], [f('F', 4), f('L', 6)], [f('B', 6), f('L', 4)], [f('B', 4), f('R', 6)],
];
const EDGE_COLOURS = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];

const slotName = (idx) => idx.map((i) => SIDE_NAMES[FACES[Math.floor(i / 9)]]).join('-');
const colourList = (letters) => [...letters].map((c) => COLOUR_NAMES[c]).join('-');
const HINT = ' This is impossible on a real cube; most likely a sticker was entered wrong.';

/** How many stickers of each colour, e.g. { U: 9, R: 10, ... }. */
export function colourCounts(state) {
  const counts = Object.fromEntries([...FACES].map((c) => [c, 0]));
  for (const c of state) if (c in counts) counts[c]++;
  return counts;
}

// A real cube's centres are fixed relative to each other: opposite colours on opposite sides, never mirrored.
function centreErrors(centres) {
  if (new Set(centres).size !== 6) {
    const dupes = [...new Set(centres.filter((c, i) => centres.indexOf(c) !== i))];
    return dupes.map((c) => {
      const sides = FACES.split('').filter((_, k) => centres[k] === c).map((s) => SIDE_NAMES[s]);
      return `The ${sides.join(' and ')} faces both have a ${COLOUR_NAMES[c]} centre; each centre must be a different colour.`;
    });
  }
  const errors = [];
  for (const [a, b] of [['U', 'D'], ['R', 'L'], ['F', 'B']]) {
    const ca = centres[FACES.indexOf(a)];
    const cb = centres[FACES.indexOf(b)];
    if (OPPOSITE[ca] !== cb) {
      errors.push(`The ${COLOUR_NAMES[ca]} and ${COLOUR_NAMES[cb]} centres are on opposite sides (${SIDE_NAMES[a]} and ${SIDE_NAMES[b]}), but ${COLOUR_NAMES[ca]} is always opposite ${COLOUR_NAMES[OPPOSITE[ca]]}.`);
    }
  }
  if (errors.length) return errors;
  const urf = ['U', 'R', 'F'].map((s) => centres[FACES.indexOf(s)]).join('');
  const real = CORNER_COLOURS.some((c) => [c, c.slice(1) + c[0], c.slice(2) + c.slice(0, 2)].includes(urf));
  return real ? [] : ['The centres are a mirror image of a real cube: two opposite centres (for example left and right) are swapped.'];
}

function parity(perm) {
  let swaps = 0;
  const seen = new Array(perm.length).fill(false);
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = perm[j]) { seen[j] = true; len++; }
    swaps += len - 1;
  }
  return swaps % 2;
}

/** Human-readable problems; empty when the state is a solvable cube. Stops at the first category that fails. */
export function validate(state) {
  if (typeof state !== 'string' || state.length !== 54) return ['State must be 54 characters (U R F D L B faces × 9).'];
  if (!/^[URFDLB]+$/.test(state)) return ['State may only contain the letters U R F D L B.'];

  const counts = colourCounts(state);
  const countErrors = [...FACES]
    .filter((c) => counts[c] !== 9)
    .map((c) => `${counts[c]} ${COLOUR_NAMES[c]} stickers instead of 9.`);
  if (countErrors.length) return countErrors;

  const centres = CENTRES.map((i) => state[i]);
  const cErrors = centreErrors(centres);
  if (cErrors.length) return cErrors;

  // Normalise to "which side's centre has this colour" so the standard tables apply.
  const toSide = Object.fromEntries(centres.map((c, k) => [c, FACES[k]]));
  const s = [...state].map((c) => toSide[c]).join('');
  const side = (letter) => COLOUR_NAMES[centres[FACES.indexOf(letter)]];
  const errors = [];
  const cp = [], co = [], ep = [], eo = [];

  CORNERS.forEach((slot, i) => {
    const ori = slot.findIndex((x) => s[x] === 'U' || s[x] === 'D');
    const piece = ori < 0 ? -1 : CORNER_COLOURS.findIndex((c) => c[0] === s[slot[ori]] && c[1] === s[slot[(ori + 1) % 3]] && c[2] === s[slot[(ori + 2) % 3]]);
    if (piece < 0) {
      errors.push(`The ${slotName(slot)} corner reads ${slot.map((x) => side(s[x])).join('-')}, which isn't a real corner piece.`);
      return;
    }
    cp[i] = piece;
    co[i] = ori;
  });
  EDGES.forEach((slot, i) => {
    const [a, b] = slot.map((x) => s[x]);
    let piece = EDGE_COLOURS.indexOf(a + b);
    let flip = 0;
    if (piece < 0) { piece = EDGE_COLOURS.indexOf(b + a); flip = 1; }
    if (piece < 0) {
      errors.push(`The ${slotName(slot)} edge reads ${side(a)}-${side(b)}, which isn't a real edge piece.`);
      return;
    }
    ep[i] = piece;
    eo[i] = flip;
  });
  if (errors.length) return errors;

  const dup = (arr, names, kind) => {
    const seen = new Set();
    for (const p of arr) {
      if (seen.has(p)) errors.push(`The ${colourList([...names[p]].map((l) => centres[FACES.indexOf(l)]).join(''))} ${kind} appears twice.`);
      seen.add(p);
    }
  };
  dup(cp, CORNER_COLOURS, 'corner');
  dup(ep, EDGE_COLOURS, 'edge');
  if (errors.length) return errors;

  if (co.reduce((a, b) => a + b, 0) % 3) errors.push(`One corner is twisted.${HINT}`);
  if (eo.reduce((a, b) => a + b, 0) % 2) errors.push(`One edge is flipped.${HINT}`);
  if (parity(cp) !== parity(ep)) errors.push(`Two pieces are swapped.${HINT}`);
  return errors;
}

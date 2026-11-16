// Colour-level model of a real 3×3, shared by the page and the server.
//
// A state is 54 colour letters in Kociemba facelet order (see facelets.js):
//   W white, Y yellow, R red, O orange, G green, B blue.
// No colour belongs to a fixed face. The six centre stickers define the scheme: a sticker belongs to the face
// whose centre has its colour. So any scheme works (Western, Japanese, custom); opposite pairs and handedness come
// from the centres. The solver only ever sees face letters (toFaces).
import { FACES } from './facelets.js';

export const COLOURS = 'WYROGB';
export const COLOUR_NAMES = { W: 'white', Y: 'yellow', R: 'red', O: 'orange', G: 'green', B: 'blue' };
export const SIDE_NAMES = { U: 'top', D: 'bottom', F: 'front', B: 'back', L: 'left', R: 'right' };
export const CENTRES = [4, 13, 22, 31, 40, 49];
export const OPPOSITE_FACE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

/** Default (Western) scheme, only used for a fresh solved cube and for migrating old face-letter states. */
export const WESTERN = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };

// Facelet indices (Kociemba numbering, 0-based).
const f = (face, n) => FACES.indexOf(face) * 9 + n - 1;
const CORNERS = [
  [f('U', 9), f('R', 1), f('F', 3)], [f('U', 7), f('F', 1), f('L', 3)],
  [f('U', 1), f('L', 1), f('B', 3)], [f('U', 3), f('B', 1), f('R', 3)],
  [f('D', 3), f('F', 9), f('R', 7)], [f('D', 1), f('L', 9), f('F', 7)],
  [f('D', 7), f('B', 9), f('L', 7)], [f('D', 9), f('R', 9), f('B', 7)],
];
const CORNER_FACES = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
const EDGES = [
  [f('U', 6), f('R', 2)], [f('U', 8), f('F', 2)], [f('U', 4), f('L', 2)], [f('U', 2), f('B', 2)],
  [f('D', 6), f('R', 8)], [f('D', 2), f('F', 8)], [f('D', 4), f('L', 8)], [f('D', 8), f('B', 8)],
  [f('F', 6), f('R', 4)], [f('F', 4), f('L', 6)], [f('B', 6), f('L', 4)], [f('B', 4), f('R', 6)],
];
const EDGE_FACES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];

const slotName = (idx) => idx.map((i) => SIDE_NAMES[FACES[Math.floor(i / 9)]]).join('-');
const names = (letters) => [...letters].map((c) => COLOUR_NAMES[c]).join('-');
const HINT = ' This is impossible on a real cube; most likely a sticker was entered wrong.';

/** Centre colour of each face, e.g. { U: 'W', R: 'R', ... }. */
export const centreColours = (state) => Object.fromEntries([...FACES].map((x, k) => [x, state[CENTRES[k]]]));

/** Opposite colour pairs implied by the centres, e.g. [['W','Y'], ['R','O'], ['G','B']]. */
export function oppositePairs(state) {
  const c = centreColours(state);
  return [['U', 'D'], ['R', 'L'], ['F', 'B']].map(([a, b]) => [c[a], c[b]]);
}

/** "white opposite yellow, red opposite orange, green opposite blue" (pairs sorted so equal schemes read the same). */
export function schemeText(state) {
  return oppositePairs(state)
    .map((p) => p.sort((a, b) => COLOURS.indexOf(a) - COLOURS.indexOf(b)))
    .sort((a, b) => COLOURS.indexOf(a[0]) - COLOURS.indexOf(b[0]))
    .map(([a, b]) => `${COLOUR_NAMES[a]} opposite ${COLOUR_NAMES[b]}`)
    .join(', ');
}

/** Face-letter string for the solver: each sticker becomes the face whose centre has its colour. */
export function toFaces(state) {
  const c = centreColours(state);
  const face = Object.fromEntries(Object.entries(c).map(([x, col]) => [col, x]));
  return [...state].map((col) => face[col]).join('');
}

/** Colour string from face letters, given each face's centre colour (default Western). */
export const fromFaces = (faces, scheme = WESTERN) => [...faces].map((x) => scheme[x]).join('');

/** The solved cube in this state's scheme and current orientation. */
export const solvedLike = (state) => fromFaces(FACES, centreColours(state)).split('').map((c) => c.repeat(9)).join('');

/** How many stickers of each colour, e.g. { W: 9, R: 10, ... }. */
export function colourCounts(state) {
  const counts = Object.fromEntries([...COLOURS].map((c) => [c, 0]));
  for (const c of state) if (c in counts) counts[c]++;
  return counts;
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

// Why a sticker combination can't be a piece in this scheme. `faces` are the face letters its colours map to.
function whyNotPiece(cols, faces) {
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      if (cols[i] === cols[j]) return `two ${COLOUR_NAMES[cols[i]]} stickers`;
      if (OPPOSITE_FACE[faces[i]] === faces[j]) {
        return `${COLOUR_NAMES[cols[i]]} and ${COLOUR_NAMES[cols[j]]}, but the centres put those colours on opposite sides, so no piece has both`;
      }
    }
  }
  return 'its colours in mirror-image order (no real corner has them in that order going round)';
}

/** Human-readable problems; empty when the state is a solvable cube. Stops at the first category that fails. */
export function validate(state) {
  if (typeof state !== 'string' || state.length !== 54) return ['State must be 54 characters (U R F D L B faces × 9).'];
  if (!/^[WYROGB]+$/.test(state)) {
    return ['State may only contain the colour letters W Y R O G B (white, yellow, red, orange, green, blue).'];
  }

  const counts = colourCounts(state);
  const countErrors = [...COLOURS].filter((c) => counts[c] !== 9).map((c) => `${counts[c]} ${COLOUR_NAMES[c]} stickers instead of 9.`);
  if (countErrors.length) return countErrors;

  const centres = CENTRES.map((i) => state[i]);
  if (new Set(centres).size !== 6) {
    return [...new Set(centres.filter((c, i) => centres.indexOf(c) !== i))].map((c) => {
      const sides = [...FACES].filter((_, k) => centres[k] === c).map((s) => SIDE_NAMES[s]);
      return `The ${sides.join(' and ')} faces both have a ${COLOUR_NAMES[c]} centre; each centre must be a different colour.`;
    });
  }

  const s = toFaces(state);
  const errors = [];
  const cp = [], co = [], ep = [], eo = [];

  CORNERS.forEach((slot, i) => {
    const ori = slot.findIndex((x) => s[x] === 'U' || s[x] === 'D');
    const piece = ori < 0 ? -1 : CORNER_FACES.findIndex((c) => c[0] === s[slot[ori]] && c[1] === s[slot[(ori + 1) % 3]] && c[2] === s[slot[(ori + 2) % 3]]);
    if (piece < 0) {
      const cols = slot.map((x) => state[x]).join('');
      errors.push(`The ${slotName(slot)} corner reads ${names(cols)}: ${whyNotPiece(cols, slot.map((x) => s[x]))}.`);
      return;
    }
    cp[i] = piece;
    co[i] = ori;
  });
  EDGES.forEach((slot, i) => {
    const [a, b] = slot.map((x) => s[x]);
    let piece = EDGE_FACES.indexOf(a + b);
    let flip = 0;
    if (piece < 0) { piece = EDGE_FACES.indexOf(b + a); flip = 1; }
    if (piece < 0) {
      const cols = slot.map((x) => state[x]).join('');
      errors.push(`The ${slotName(slot)} edge reads ${names(cols)}: ${whyNotPiece(cols, [a, b])}.`);
      return;
    }
    ep[i] = piece;
    eo[i] = flip;
  });
  if (errors.length >= 4) {
    errors.unshift(`${errors.length} pieces don't fit the colour scheme the centres give (${schemeText(state)}). Check the six centre stickers first.`);
  }
  if (errors.length) return errors;

  const c = centreColours(state);
  const pieceName = (faces) => names([...faces].map((x) => c[x]).join(''));
  const dup = (arr, faceNames, kind) => {
    const seen = new Set();
    for (const p of arr) {
      if (seen.has(p)) errors.push(`The ${pieceName(faceNames[p])} ${kind} appears twice, so another ${kind} is missing.`);
      seen.add(p);
    }
  };
  dup(cp, CORNER_FACES, 'corner');
  dup(ep, EDGE_FACES, 'edge');
  if (errors.length) return errors;

  if (co.reduce((a, b) => a + b, 0) % 3) errors.push(`One corner is twisted (its stickers are rotated in place).${HINT}`);
  if (eo.reduce((a, b) => a + b, 0) % 2) errors.push(`One edge is flipped (its two stickers are the wrong way round).${HINT}`);
  if (parity(cp) !== parity(ep)) errors.push(`Two pieces are swapped (corner and edge permutation parity differ).${HINT}`);
  return errors;
}

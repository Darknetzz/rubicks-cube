// 3×3 facelet model. A state is a 54-char string in Kociemba order (U1..U9 R1..R9 F1..F9 D1..D9 L1..L9 B1..B9).
// Each char is a colour identity: the face letter that colour belongs to in the standard scheme
// (U white, R red, F green, D yellow, L orange, B blue) — independent of how the cube is held.
import { createRequire } from 'node:module';
import { parseMove } from '../../js/notation.js';
import { FACES, SOLVED, GEOMETRY, faceletIndex } from '../../js/facelets.js';

const require = createRequire(import.meta.url);
const Cube = require('../vendor/cubejs/cube.js');
require('../vendor/cubejs/solve.js');

export { FACES, SOLVED, GEOMETRY };
export const COLOUR_NAMES = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
const INITIAL = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };
const SIDE_NAMES = { U: 'top', D: 'bottom', F: 'front', B: 'back', L: 'left', R: 'right' };

// Quarter turn about an axis, right-handed.
function rot([x, y, z], axis, q) {
  let v = [x, y, z];
  for (let k = 0; k < ((q % 4) + 4) % 4; k++) {
    const [a, b, c] = v;
    v = axis === 0 ? [a, -c, b] : axis === 1 ? [c, b, -a] : [-b, a, c];
  }
  return v;
}

const permCache = new Map();
function permutation(token) {
  if (!permCache.has(token)) {
    const { axis, layers, turns } = parseMove(token, 3);
    const perm = GEOMETRY.map(({ p, n }, i) => {
      if (!layers.includes(p[axis] + 1)) return i;
      return faceletIndex(rot(p, axis, turns), rot(n, axis, turns));
    });
    permCache.set(token, perm);
  }
  return permCache.get(token);
}

export function splitMoves(moves) {
  const list = Array.isArray(moves) ? moves : String(moves).trim().split(/\s+/).filter(Boolean);
  for (const m of list) parseMove(m, 3); // throws on bad notation
  return list;
}

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

export const isSolved = (s) => [0, 1, 2, 3, 4, 5].every((f) => /^(.)\1{8}$/.test(s.slice(f * 9, f * 9 + 9)));

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
export const CENTRES = [4, 13, 22, 31, 40, 49];

const slotName = (idx) => idx.map((i) => SIDE_NAMES[FACES[Math.floor(i / 9)]]).join('-');
const colourList = (letters) => [...letters].map((c) => COLOUR_NAMES[c]).join('-');

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

/** Returns a list of human-readable problems; empty when the state is a solvable cube. */
export function validate(state) {
  if (typeof state !== 'string' || state.length !== 54) return ['State must be 54 characters (U R F D L B faces × 9).'];
  if (!/^[URFDLB]+$/.test(state)) return ['State may only contain the letters U R F D L B.'];
  const errors = [];
  for (const c of FACES) {
    const count = state.split(c).length - 1;
    if (count !== 9) errors.push(`${count} ${COLOUR_NAMES[c]} stickers instead of 9.`);
  }
  const centres = CENTRES.map((i) => state[i]);
  if (new Set(centres).size !== 6) errors.push('Two faces have the same centre colour.');
  if (errors.length) return errors;

  // Normalise to "which side's centre has this colour" so the standard tables apply.
  const toSide = Object.fromEntries(centres.map((c, k) => [c, FACES[k]]));
  const s = [...state].map((c) => toSide[c]).join('');
  const side = (letter) => COLOUR_NAMES[centres[FACES.indexOf(letter)]];
  const cp = [], co = [], ep = [], eo = [];

  CORNERS.forEach((slot, i) => {
    const ori = slot.findIndex((x) => s[x] === 'U' || s[x] === 'D');
    const letters = slot.map((x) => s[x]).join('');
    const piece = ori < 0 ? -1 : CORNER_COLOURS.findIndex((c) => c[0] === s[slot[ori]] && c[1] === s[slot[(ori + 1) % 3]] && c[2] === s[slot[(ori + 2) % 3]]);
    if (piece < 0) {
      errors.push(`The ${slotName(slot)} corner reads ${[...letters].map(side).join('-')}, which isn't a real corner piece.`);
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

  const hint = ' This is impossible on a real cube; most likely a sticker was entered wrong.';
  if (co.reduce((a, b) => a + b, 0) % 3) errors.push(`One corner is twisted.${hint}`);
  if (eo.reduce((a, b) => a + b, 0) % 2) errors.push(`One edge is flipped.${hint}`);
  if (parity(cp) !== parity(ep)) errors.push(`Two pieces are swapped.${hint}`);
  return errors;
}

let solverReady = false;
export function initSolver() {
  if (!solverReady) {
    Cube.initSolver();
    solverReady = true;
  }
}

/** Near-optimal (Kociemba two-phase) solution as a list of moves. Throws if the state is invalid. */
export function solve(state) {
  const errors = validate(state);
  if (errors.length) throw new Error(errors.join(' '));
  if (isSolved(state)) return [];
  initSolver();
  const moves = Cube.fromString(state).solve().trim().split(/\s+/).filter(Boolean);
  if (!isSolved(applyMoves(state, moves))) throw new Error('Solver returned a wrong solution (bug).');
  return moves;
}

export const randomState = () => Cube.random().asString();

/** How the user must hold the cube for the moves to make sense. */
export const holding = (state) =>
  `${COLOUR_NAMES[state[4]]} centre on top, ${COLOUR_NAMES[state[22]]} centre facing you`;

export function describeMove(move, state) {
  const { axis, layers, turns } = parseMove(move, 3);
  const letter = move.replace(/[^RLUDFBMESxyz]/gi, '')[0];
  const amount = move.includes('2') ? 'half turn (180°)' : move.includes("'") ? 'counter-clockwise' : 'clockwise';
  const face = letter.toUpperCase();
  if ('RLUDFB'.includes(face) && layers.length === 1) {
    const colour = COLOUR_NAMES[state[CENTRES[FACES.indexOf(face)]]];
    return `${move}: ${SIDE_NAMES[face]} face (${colour} centre) ${amount}, as seen looking straight at that face`;
  }
  return `${move}: ${amount} (axis ${'xyz'[axis]}, ${layers.length} layers, ${turns} quarter turns)`;
}

/** Unfolded cube for chat: W/Y/G/B/R/O initials. */
export function asciiNet(state) {
  const row = (face, r) => [...state.slice(FACES.indexOf(face) * 9 + r * 3, FACES.indexOf(face) * 9 + r * 3 + 3)].map((c) => INITIAL[c]).join(' ');
  const pad = ' '.repeat(8);
  const lines = [];
  for (let r = 0; r < 3; r++) lines.push(pad + row('U', r));
  for (let r = 0; r < 3; r++) lines.push(['L', 'F', 'R', 'B'].map((x) => row(x, r)).join('   '));
  for (let r = 0; r < 3; r++) lines.push(pad + row('D', r));
  return `${lines.join('\n')}\n(top, then left front right back, then bottom; W=white Y=yellow G=green B=blue R=red O=orange)`;
}

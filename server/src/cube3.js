// 3×3 facelet model. A state is a 54-char string in Kociemba order (U1..U9 R1..R9 F1..F9 D1..D9 L1..L9 B1..B9).
// Each char is a colour identity: the face letter that colour belongs to in the standard scheme
// (U white, R red, F green, D yellow, L orange, B blue) — independent of how the cube is held.
import { createRequire } from 'node:module';
import { parseMove } from '../../js/notation.js';
import { FACES, SOLVED, GEOMETRY, faceletIndex } from '../../js/facelets.js';
import { COLOUR_NAMES, SIDE_NAMES, CENTRES, validate } from '../../js/validate.js';

const require = createRequire(import.meta.url);
const Cube = require('../vendor/cubejs/cube.js');
require('../vendor/cubejs/solve.js');

export { FACES, SOLVED, GEOMETRY };
export { COLOUR_NAMES, CENTRES, validate };
const INITIAL = { U: 'W', R: 'R', F: 'G', D: 'Y', L: 'O', B: 'B' };

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

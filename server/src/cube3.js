// 3×3 facelet model. A state is a 54-char string in Kociemba order (U1..U9 R1..R9 F1..F9 D1..D9 L1..L9 B1..B9)
// of colour letters W Y R O G B. The colour scheme comes from the centres (see js/validate.js), so any scheme works.
import { createRequire } from 'node:module';
import { parseMove } from '../../js/notation.js';
import { FACES, GEOMETRY, faceletIndex } from '../../js/facelets.js';
import {
  COLOUR_NAMES, SIDE_NAMES, CENTRES, WESTERN, validate, toFaces, fromFaces, solvedLike, centreColours, schemeText,
} from '../../js/validate.js';

const require = createRequire(import.meta.url);
const Cube = require('../vendor/cubejs/cube.js');
require('../vendor/cubejs/solve.js');

export { FACES, GEOMETRY };
export { COLOUR_NAMES, CENTRES, validate, toFaces, fromFaces, solvedLike, centreColours, schemeText };

/** Solved cube, Western scheme, white top / green front. Only the starting point; any scheme is accepted. */
export const SOLVED = fromFaces([...FACES].map((x) => x.repeat(9)).join(''));

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
  const moves = Cube.fromString(toFaces(state)).solve().trim().split(/\s+/).filter(Boolean);
  if (!isSolved(applyMoves(state, moves))) throw new Error('Solver returned a wrong solution (bug).');
  return moves;
}

/** Random solvable state in the given scheme (face → colour, default Western). */
export const randomState = (scheme = WESTERN) => fromFaces(Cube.random().asString(), scheme);

const centreName = (state, face) => COLOUR_NAMES[state[CENTRES[FACES.indexOf(face)]]];

/** How the user must hold the cube for the moves to make sense, named by this cube's own centre colours. */
export function holding(state) {
  const c = (x) => centreName(state, x);
  return `${c('U')} centre on top, ${c('F')} centre facing you ` +
    `(so ${c('D')} is on the bottom, ${c('R')} on the right, ${c('L')} on the left, ${c('B')} at the back)`;
}

const AMOUNT = (move) => (move.includes('2') ? 'half turn (180°)' : move.includes("'") ? 'counter-clockwise' : 'clockwise');
const SLICES = { M: ['L', 'R', 'L'], E: ['U', 'D', 'D'], S: ['F', 'B', 'F'] }; // between a and b, turns like c
const ROTATIONS = { x: 'R', y: 'U', z: 'F' };

/** Plain-words explanation of one move, using the colours of the centres in `state` (the state before the move). */
export function describeMove(move, state) {
  const { layers } = parseMove(move, 3);
  const amount = AMOUNT(move);
  const raw = move.replace(/^\d+/, '').replace(/['2]/g, '');
  const letter = raw[0];
  const face = letter.toUpperCase();
  const side = (x) => `${SIDE_NAMES[x]} face (${centreName(state, x)} centre)`;
  if ('RLUDFB'.includes(face)) {
    if (layers.length === 1 && !/^\d/.test(move)) return `${move}: ${side(face)} ${amount}, as seen looking straight at that face`;
    if (layers.length === 2) return `${move}: ${side(face)} together with the middle layer behind it, ${amount} as seen looking at that face`;
    return `${move}: middle layer next to the ${side(face)}, ${amount} as seen looking at that face`;
  }
  if (SLICES[letter]) {
    const [a, b, like] = SLICES[letter];
    return `${move}: middle layer between the ${side(a)} and ${side(b)}, ${amount} as seen looking at the ${SIDE_NAMES[like]} face`;
  }
  const after = applyMoves(state, move);
  return `${move}: turn the whole cube ${amount} as seen looking at the ${side(ROTATIONS[letter])}; ` +
    `afterwards hold it ${holding(after)}`;
}

/** Unfolded cube for chat, using colour initials W Y R O G B. */
export function asciiNet(state) {
  const row = (face, r) => [...state.slice(FACES.indexOf(face) * 9 + r * 3, FACES.indexOf(face) * 9 + r * 3 + 3)].join(' ');
  const pad = ' '.repeat(8);
  const lines = [];
  for (let r = 0; r < 3; r++) lines.push(pad + row('U', r));
  for (let r = 0; r < 3; r++) lines.push(['L', 'F', 'R', 'B'].map((x) => row(x, r)).join('   '));
  for (let r = 0; r < 3; r++) lines.push(pad + row('D', r));
  const label = (x) => `${SIDE_NAMES[x]} (${centreName(state, x)} centre)`;
  return `${lines.join('\n')}\n(${label('U')}; then ${['L', 'F', 'R', 'B'].map(label).join(', ')}; then ${label('D')}. ` +
    'W=white Y=yellow R=red O=orange G=green B=blue)';
}

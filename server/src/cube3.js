// 3×3 facelet model. A state is a 54-char string in Kociemba order (U1..U9 R1..R9 F1..F9 D1..D9 L1..L9 B1..B9)
// of colour letters W Y R O G B. The colour scheme comes from the centres (see js/validate.js), so any scheme works.
import { createRequire } from 'node:module';
import { parseMove } from '../../js/notation.js';
import { FACES, GEOMETRY, applyMoves, splitMoves } from '../../js/facelets.js';
import { moveHint } from '../../js/hints.js';
import { initShortSearch, shortSolve } from './shortsearch.js';
import {
  COLOUR_NAMES, SIDE_NAMES, CENTRES, WESTERN, validate, toFaces, fromFaces, solvedLike, centreColours, schemeText,
} from '../../js/validate.js';

const require = createRequire(import.meta.url);
const Cube = require('../vendor/cubejs/cube.js');
require('../vendor/cubejs/solve.js');

export { FACES, GEOMETRY, applyMoves, splitMoves };
export { COLOUR_NAMES, CENTRES, validate, toFaces, fromFaces, solvedLike, centreColours, schemeText };

/** Solved cube, Western scheme, white top / green front. Only the starting point; any scheme is accepted. */
export const SOLVED = fromFaces([...FACES].map((x) => x.repeat(9)).join(''));

export const isSolved = (s) => [0, 1, 2, 3, 4, 5].every((f) => /^(.)\1{8}$/.test(s.slice(f * 9, f * 9 + 9)));

// Time budgets in ms (env: SOLVE_BUDGET_MS for the whole solve, SHORT_SEARCH_MS for the optimal search inside it).
const envMs = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
export const SOLVE_BUDGET_MS = envMs('SOLVE_BUDGET_MS', 2000);
export const SHORT_SEARCH_MS = envMs('SHORT_SEARCH_MS', 300);

let solverReady = false;
export function initSolver() {
  if (!solverReady) {
    Cube.initSolver();
    initShortSearch();
    solverReady = true;
  }
}

const toList = (s) => s.trim().split(/\s+/).filter(Boolean);

/**
 * Shortest solution found within the time budget:
 * 1. IDA* for an exact optimal solution (fine for cubes up to ~10 moves from solved), for up to `shortMs`;
 * 2. otherwise Kociemba two-phase, asked again for one move fewer each time it succeeds, until `budgetMs` is used.
 * Returns { moves, optimal, ms }. `optimal` is true when no shorter solution exists (proven by the search).
 * Throws if the state is invalid.
 */
export function solveDetailed(state, { budgetMs = SOLVE_BUDGET_MS, shortMs = SHORT_SEARCH_MS } = {}) {
  const errors = validate(state);
  if (errors.length) throw new Error(errors.join(' '));
  const t0 = performance.now();
  const done = (moves, optimal) => {
    if (!isSolved(applyMoves(state, moves))) throw new Error('Solver returned a wrong solution (bug).');
    return { moves, optimal, ms: Math.round(performance.now() - t0) };
  };
  if (isSolved(state)) return done([], true);
  initSolver();
  const faces = toFaces(state);

  const short = shortSolve(faces, t0 + Math.min(shortMs, budgetMs));
  if (short.moves) return done(short.moves, true);

  // The first two-phase answer has no deadline: it always comes back fast and something must be returned.
  const cube = Cube.fromString(faces);
  let best = toList(cube.solve());
  const deadline = Date.now() + Math.max(0, budgetMs - (performance.now() - t0));
  while (best.length - 1 > short.provenDepth && Date.now() < deadline) {
    let next;
    try {
      next = cube.solve(best.length - 1, deadline);
    } catch (err) {
      if (err instanceof Cube.SolveTimeout) break;
      throw err;
    }
    if (next === null) break; // two-phase finds nothing shorter
    best = toList(next);
  }
  return done(best, best.length <= short.provenDepth + 1);
}

/** Moves of solveDetailed(state). */
export const solve = (state, options) => solveDetailed(state, options).moves;

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

/**
 * Plain-words explanation of one move, using the colours of the centres in `state` (the state before the move),
 * followed by a direction hint relative to how the user holds the cube (see js/hints.js).
 */
export const describeMove = (move, state) => `${describeLayer(move, state)}. Hint: ${moveHint(move).text}`;

function describeLayer(move, state) {
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

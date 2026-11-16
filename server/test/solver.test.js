import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOLVED, applyMoves, isSolved, randomState, solveDetailed, initSolver, SOLVE_BUDGET_MS } from '../src/cube3.js';

initSolver(); // table setup is a one-off at server start, not part of a solve's time

const FACES = 'URFDLB';
const POWERS = ['', '2', "'"];

/** Random scramble of exactly `n` moves, never the same face twice in a row. */
function scramble(n) {
  const moves = [];
  let last = -1;
  while (moves.length < n) {
    const f = Math.floor(Math.random() * 6);
    if (f === last) continue;
    last = f;
    moves.push(FACES[f] + POWERS[Math.floor(Math.random() * 3)]);
  }
  return moves;
}

function check(state, result, label) {
  assert.ok(isSolved(applyMoves(state, result.moves)), `${label}: ${result.moves.join(' ')} does not solve it`);
}

test('R U F\' is solved in 3 moves, proven optimal', () => {
  const state = applyMoves(SOLVED, "R U F'");
  const r = solveDetailed(state);
  check(state, r, "R U F'");
  assert.equal(r.moves.length, 3);
  assert.equal(r.optimal, true);
});

test('random scrambles of 1–7 moves get a solution no longer than the scramble', () => {
  for (let n = 1; n <= 7; n++) {
    for (let i = 0; i < 15; i++) {
      const moves = scramble(n);
      const state = applyMoves(SOLVED, moves);
      const r = solveDetailed(state);
      check(state, r, moves.join(' '));
      assert.ok(r.moves.length <= n, `${moves.join(' ')} → ${r.moves.length} moves: ${r.moves.join(' ')}`);
      assert.equal(r.optimal, true, moves.join(' '));
    }
  }
});

test('random cubes: correct, at most 22 moves, within the time budget', () => {
  const budgetMs = 600;
  const slack = 150; // the final check and a deadline poll every ~1000 search nodes
  for (let i = 0; i < 4; i++) {
    const state = randomState();
    const r = solveDetailed(state, { budgetMs, shortMs: 150 });
    check(state, r, `random #${i}`);
    assert.ok(r.moves.length <= 22, `${r.moves.length} moves`);
    // cubejs's very first answer can't be cut short (something must be returned); everything after it is budgeted
    assert.ok(r.ms <= Math.max(budgetMs, r.firstMs ?? 0) + slack, `took ${r.ms} ms with a ${budgetMs} ms budget (first answer ${r.firstMs} ms)`);
  }
});

test('the default budget is respected too', () => {
  const state = randomState();
  const r = solveDetailed(state);
  check(state, r, 'random');
  assert.ok(r.ms <= Math.max(SOLVE_BUDGET_MS, r.firstMs ?? 0) + 150, `took ${r.ms} ms with a ${SOLVE_BUDGET_MS} ms budget (first answer ${r.firstMs} ms)`);
  if (!r.optimal) assert.ok(r.moves.length <= 22);
});

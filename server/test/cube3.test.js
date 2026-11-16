import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  SOLVED, applyMoves, isSolved, validate, solve, randomState, asciiNet, describeMove, holding,
} from '../src/cube3.js';

const require = createRequire(import.meta.url);
const Cube = require('../vendor/cubejs/cube.js');

const MOVES = ['R', 'L', 'U', 'D', 'F', 'B'].flatMap((m) => [m, `${m}'`, `${m}2`]);

test('every face move matches cubejs', () => {
  for (const m of MOVES) assert.equal(applyMoves(SOLVED, m), new Cube().move(m).asString(), m);
  const alg = "R U2 F' L D B2 R' U F2 D' L2 B";
  assert.equal(applyMoves(SOLVED, alg), new Cube().move(alg).asString());
});

test('slice and rotation moves are consistent', () => {
  assert.equal(applyMoves(SOLVED, 'M M M M'), SOLVED);
  // x = R M' L'
  const s = applyMoves(SOLVED, "R U F");
  assert.equal(applyMoves(s, 'x'), applyMoves(s, "R M' L'"));
  assert.ok(isSolved(applyMoves(SOLVED, 'x y z')));
});

test('validate accepts real states and catches impossible ones', () => {
  assert.deepEqual(validate(SOLVED), []);
  for (let i = 0; i < 20; i++) assert.deepEqual(validate(randomState()), []);
  // held differently (green on top) is still valid
  assert.deepEqual(validate(applyMoves(SOLVED, "x R U")), []);

  const swap = (s, i, j) => { const a = [...s]; [a[i], a[j]] = [a[j], a[i]]; return a.join(''); };
  // flipped UF edge: U8 (7) and F2 (19)
  assert.match(validate(swap(SOLVED, 7, 19)).join(), /flipped/);
  // twisted URF corner: cycle U9 R1 F3 (8, 9, 20)
  const t = [...SOLVED]; [t[8], t[9], t[20]] = [SOLVED[9], SOLVED[20], SOLVED[8]];
  assert.match(validate(t.join('')).join(), /twisted/);
  // swap two edges' stickers entirely: UF and UR edges
  let s = swap(swap(SOLVED, 7, 5), 19, 10);
  assert.match(validate(s).join(), /swapped/);
  assert.match(validate('U'.repeat(54)).join(), /stickers instead of 9/);
  assert.match(validate(swap(SOLVED, 0, 9)).join(), /isn't a real|appears twice/);
});

test('solve returns short, correct solutions', () => {
  assert.deepEqual(solve(SOLVED), []);
  for (let i = 0; i < 30; i++) {
    const s = randomState();
    const moves = solve(s);
    assert.ok(moves.length <= 22, `${moves.length} moves`);
    assert.ok(isSolved(applyMoves(s, moves)));
  }
  const rotated = applyMoves(SOLVED, "z F R U' B");
  assert.ok(isSolved(applyMoves(rotated, solve(rotated))));
});

test('text helpers', () => {
  assert.match(asciiNet(SOLVED), /W W W/);
  assert.match(describeMove("R'", SOLVED), /right face \(red centre\) counter-clockwise/);
  assert.equal(holding(SOLVED), 'white centre on top, green centre facing you');
});

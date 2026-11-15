import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMove, parseSequence, formatTurn, inverse, pushMerged, randomScramble, normTurns,
} from '../js/notation.js';

test('basic face turns', () => {
  assert.deepEqual(parseMove('R', 3), { axis: 0, layers: [2], turns: -1 });
  assert.deepEqual(parseMove("R'", 3), { axis: 0, layers: [2], turns: 1 });
  assert.deepEqual(parseMove('L', 3), { axis: 0, layers: [0], turns: 1 });
  assert.deepEqual(parseMove('U2', 3), { axis: 1, layers: [2], turns: 2 });
  assert.deepEqual(parseMove('F', 3), { axis: 2, layers: [2], turns: -1 });
});

test('wide, inner-layer and slice moves', () => {
  assert.deepEqual(parseMove('Rw', 5).layers, [3, 4]);
  assert.deepEqual(parseMove('r', 5).layers, [3, 4]);
  assert.deepEqual(parseMove('3Rw', 5).layers, [2, 3, 4]);
  assert.deepEqual(parseMove('2R', 5).layers, [3]);
  assert.deepEqual(parseMove('2L', 5).layers, [1]);
  assert.deepEqual(parseMove('M', 5).layers, [1, 2, 3]);
  assert.deepEqual(parseMove('x', 4).layers, [0, 1, 2, 3]);
  assert.throws(() => parseMove('4R', 3));
  assert.throws(() => parseMove('M', 2));
  assert.throws(() => parseMove('Q', 3));
});

test('format round-trips', () => {
  for (const [n, moves] of [
    [3, ['R', "U'", 'F2', 'M', "E'", 'S', 'x', "y'", 'z2', 'Rw', "Lw'"]],
    [5, ['R', '2R', '3R', '2L', "Rw'", '3Rw', 'M', 'x2']],
    [2, ['R', "L'", 'U2', 'x']],
  ]) {
    for (const m of moves) assert.equal(formatTurn(parseMove(m, n), n), m, `${m} on ${n}x${n}`);
  }
});

test('sequence parsing', () => {
  assert.equal(parseSequence("(R U R' U')", 3).length, 4);
});

test('history merging cancels', () => {
  const h = [];
  for (const m of ['R', 'R', 'R', 'R']) pushMerged(h, parseMove(m, 3));
  assert.equal(h.length, 0);
  pushMerged(h, parseMove('R', 3));
  pushMerged(h, parseMove('U', 3));
  pushMerged(h, inverse(parseMove('U', 3)));
  assert.deepEqual(h, [parseMove('R', 3)]);
});

test('scramble never repeats an axis and skips odd centre slice', () => {
  const s = randomScramble(3, 500);
  for (let i = 1; i < s.length; i++) assert.notEqual(s[i].axis, s[i - 1].axis);
  assert.ok(s.every((t) => t.layers[0] !== 1 && normTurns(t.turns) === t.turns));
});

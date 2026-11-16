import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geometryOf, faceletIndex, solvedState, SOLVED } from '../js/facelets.js';
import { parseState, encodeState, stateToJson, stateLink } from '../js/statefile.js';

test('facelet numbering is a bijection for every size', () => {
  for (let n = 2; n <= 12; n++) {
    const geo = geometryOf(n);
    assert.equal(geo.length, 6 * n * n);
    geo.forEach(({ p, n: normal }, i) => assert.equal(faceletIndex(p, normal, n), i, `${n}x${n} #${i}`));
  }
});

test('round-trips through text, JSON and links', () => {
  const s5 = solvedState(5);
  for (const [size, f] of [[3, SOLVED], [5, s5]]) {
    assert.deepEqual(parseState(encodeState(size, f)), { size, facelets: f });
    assert.deepEqual(parseState(stateToJson(size, f)), { size, facelets: f });
    assert.deepEqual(parseState(stateLink(size, f, 'https://cube.example/x?y=1')), { size, facelets: f });
  }
  assert.equal(encodeState(3, SOLVED), SOLVED);
  assert.ok(encodeState(5, s5).startsWith('5:'));
  assert.deepEqual(parseState(`  ${SOLVED.slice(0, 27)}\n${SOLVED.slice(27)} `).size, 3);
});

test('rejects bad input with readable errors', () => {
  assert.throws(() => parseState('13:' + solvedState(13)), /Size must be 2–12/);
  assert.throws(() => parseState('4:' + SOLVED), /needs 96 letters, got 54/);
  assert.throws(() => parseState(SOLVED.replace('U', 'X')), /Only the letters/);
  assert.throws(() => parseState('4:' + solvedState(4).replace('U', 'R')), /15 white stickers instead of 16/);
  assert.throws(() => parseState(SOLVED.slice(0, 7) + 'F' + SOLVED.slice(8, 19) + 'U' + SOLVED.slice(20)), /flipped/);
  assert.throws(() => parseState('{nope'), /not valid JSON/);
});

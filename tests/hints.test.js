import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveHint } from '../js/hints.js';
import { GEOMETRY, permutation } from '../js/facelets.js';
import { parseMove } from '../js/notation.js';

// Screen directions as the user holds the cube (x right, y up, z towards the user).
const VEC = { left: [-1, 0, 0], right: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };

// The stickers a hint talks about: for turns about x or y, the middle of each moving column/row on the front face;
// for turns about z, the middle sticker of the top face's edge in each moving layer. Each must travel the way the
// hint says (its position changes in that screen direction).
function checkMove(move) {
  const { text } = moveHint(move);
  const word = /(?:moves?|to your|to the) (left|right|up|down)/.exec(text)?.[1];
  assert.ok(word, `${move}: "${text}" names no direction`);
  const isHalf = /2'?$/.test(move);
  const quarter = isHalf ? move.replace(/2(?='?$)/, '') : move;
  const { axis, layers } = parseMove(quarter, 3);
  const perm = permutation(quarter);
  const v = VEC[word];
  let checked = 0;
  GEOMETRY.forEach(({ p, n }, i) => {
    if (!layers.includes(p[axis] + 1)) return;
    const watched = axis === 2
      ? n[1] === 1 && p[0] === 0 // top face, middle column
      : n[2] === 1 && p[1 - axis] === 0; // front face, middle row (axis x) or middle column (axis y)
    if (!watched) return;
    const q = GEOMETRY[perm[i]].p;
    const along = (q[0] - p[0]) * v[0] + (q[1] - p[1]) * v[1];
    assert.ok(along > 0, `${move}: "${text}" but sticker ${i} goes from ${p} to ${q}`);
    checked++;
  });
  assert.equal(checked, layers.length, `${move}: one sticker per moving layer`);
  if (isHalf) {
    assert.match(text, /twice/, `${move}: half turn not marked`);
    assert.deepEqual(permutation(move), perm.map((j) => perm[j]), `${move} is two ${quarter}`);
  } else {
    assert.doesNotMatch(text, /twice/);
  }
}

const BASES = ['R', 'L', 'U', 'D', 'F', 'B', 'M', 'E', 'S', 'x', 'y', 'z', 'Rw', 'Lw', 'Uw', 'Dw', 'Fw', 'Bw', 'r', 'u', 'f', '2R', '2U', '2F', '3R', '3U', '3F'];
const ALL = BASES.flatMap((b) => [b, `${b}'`, `${b}2`]);

test('every hint matches the sticker movement in the cube model', () => {
  for (const m of ALL) checkMove(m);
});

test('hints use the wording people know', () => {
  const h = (m) => moveHint(m).text;
  assert.equal(h('U'), 'top row facing you moves left');
  assert.equal(h("U'"), 'top row facing you moves right');
  assert.equal(h('R'), 'right column facing you moves up');
  assert.equal(h("R'"), 'right column facing you moves down');
  assert.equal(h('L'), 'left column facing you moves down');
  assert.equal(h('D'), 'bottom row facing you moves right');
  assert.equal(h('F'), 'front face turns clockwise, like a steering wheel to the right');
  assert.equal(h("F'"), 'front face turns counter-clockwise, like a steering wheel to the left');
  assert.equal(h('B'), 'top of the back layer moves to your left');
  assert.equal(h('U2'), 'top row facing you moves left, twice (half turn: either way ends the same)');
});

test('hidden faces (back, bottom, left) are described by a strip the user can see', () => {
  for (const m of ['B', "B'", 'B2', 'D', "D'", 'D2', 'L', "L'", 'L2']) assert.match(moveHint(m).text, /facing you|top of/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMES, DEFAULT_SCHEME, presetOf } from '../js/settings.js';
import { SOLVED, applyMoves } from '../js/facelets.js';
import { WESTERN, JAPANESE, compareScheme, validate, fromFaces, holding, centreColours, CENTRES } from '../js/validate.js';
import { moveHint } from '../js/hints.js';

// All 24 ways to hold a cube.
const ROTATIONS = ['', 'y', 'y2', "y'"].flatMap((y) => ['', 'x', 'x2', "x'", 'z', "z'"].map((t) => `${t} ${y}`.trim()));
const solvedIn = (scheme) => fromFaces(SOLVED, scheme);
const centresOf = (state) => CENTRES.map((i) => state[i]).join('');
const isRotationOf = (state, ref) => ROTATIONS.some((r) => centresOf(r ? applyMoves(solvedIn(ref), r) : solvedIn(ref)) === centresOf(state));
const mirror = (scheme) => ({ ...scheme, R: scheme.L, L: scheme.R });

// The site owner's cube, checked by hand: white top, blue bottom; with yellow facing you, orange right, red left,
// green at the back.
const MY_CUBE = { U: 'W', D: 'B', F: 'Y', R: 'O', L: 'R', B: 'G' };

test('the 24 rotations are all different', () => {
  assert.equal(new Set(ROTATIONS.map((r) => centresOf(r ? applyMoves(SOLVED, r) : SOLVED))).size, 24);
});

test('every preset is a rotation (same handedness) of its reference scheme, never a mirror', () => {
  const reference = { 'my-cube': JAPANESE, western: WESTERN, 'western-yellow': WESTERN, japanese: JAPANESE };
  for (const [id, { scheme }] of Object.entries(SCHEMES)) {
    const ref = reference[id];
    assert.ok(ref, `${id} has no reference scheme in this test`);
    assert.ok(isRotationOf(solvedIn(scheme), ref), `${id} is not a rotation of its reference`);
    assert.ok(!isRotationOf(solvedIn(scheme), mirror(ref)), `${id} is a mirror image`);
    assert.equal(compareScheme(scheme).mirrored, false, id);
    assert.deepEqual(validate(solvedIn(scheme)), [], id);
  }
});

test('"My cube" is exactly the hand-checked layout, a rotation of Japanese, and the default', () => {
  assert.deepEqual(SCHEMES['my-cube'].scheme, MY_CUBE);
  assert.equal(DEFAULT_SCHEME, 'my-cube');
  assert.ok(isRotationOf(solvedIn(MY_CUBE), JAPANESE));
  assert.equal(presetOf(MY_CUBE), 'my-cube');
  // the Japanese preset is the same cube turned half way round (green facing you instead of yellow)
  assert.equal(centresOf(applyMoves(solvedIn(MY_CUBE), 'y2')), centresOf(solvedIn(JAPANESE)));
});

test('mirrored centres of a known scheme are rejected with a clear message', () => {
  const msg = validate(solvedIn(mirror(MY_CUBE)));
  assert.equal(msg.length, 1);
  assert.match(msg[0], /^red and orange look swapped: is the cube mirrored\?/);
  assert.match(msg[0], /Japanese cube with white on top and yellow facing you, orange is on the right/);
  assert.match(validate(solvedIn(mirror(WESTERN)))[0], /orange and red look swapped: is the cube mirrored\?/);
  // also when held another way round
  assert.match(validate(applyMoves(solvedIn(mirror(JAPANESE)), 'x y'))[0], /look swapped: is the cube mirrored\?/);
  // an unknown pairing is not judged by handedness
  assert.equal(compareScheme({ U: 'W', D: 'R', F: 'Y', B: 'O', R: 'G', L: 'B' }), null);
});

test('Hold line and move hints describe the same view as the page (top = U, facing you = F, right = R)', () => {
  const state = solvedIn(MY_CUBE);
  assert.equal(holding(state),
    'white centre on top, yellow centre facing you (so blue is on the bottom, orange on the right, red on the left, green at the back)');
  const c = centreColours(state);
  assert.deepEqual([c.U, c.F, c.R], ['W', 'Y', 'O']); // the page draws U on top, F towards the viewer, R on the right
  // hints name strips of the face you hold towards you, so they hold for every scheme alike
  assert.equal(moveHint('R').text, 'right column facing you moves up');
  assert.equal(moveHint('U').text, 'top row facing you moves left');
});

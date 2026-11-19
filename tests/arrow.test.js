import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowSpec } from '../js/arrowspec.js';
import { moveHint } from '../js/hints.js';
import { GEOMETRY, permutation } from '../js/facelets.js';
import { parseMove } from '../js/notation.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const BASES = ['R', 'L', 'U', 'D', 'F', 'B', 'M', 'E', 'S', 'x', 'y', 'z', 'Rw', 'Fw', 'Dw', '2R', '3U'];
const ALL = BASES.flatMap((b) => [b, `${b}'`, `${b}2`]);
const quarterOf = (m) => m.replace(/2(?='?$)/, '');

test('side arrows point the way the stickers of that layer actually travel', () => {
  for (const m of ALL) {
    const spec = arrowSpec(m);
    const { axis, layers } = parseMove(quarterOf(m), 3);
    const perm = permutation(quarterOf(m));
    for (const { normal, dir } of spec.strips) {
      // middle sticker of the strip: on this face, in the moving layer, centred across the strip
      let checked = 0;
      GEOMETRY.forEach(({ p, n }, i) => {
        if (n.join() !== normal.join() || !layers.includes(p[axis] + 1)) return;
        const across = [0, 1, 2].find((k) => k !== axis && normal[k] === 0);
        if (p[across] !== 0) return;
        const q = GEOMETRY[perm[i]].p;
        assert.ok(dot(dir, [q[0] - p[0], q[1] - p[1], q[2] - p[2]]) > 0, `${m}: strip on ${normal} points ${dir}`);
        checked++;
      });
      assert.equal(checked, layers.length, `${m}: strip on ${normal}`);
    }
  }
});

test('the face arrow sits on the turning face and curves the way that face turns', () => {
  for (const m of ALL) {
    const spec = arrowSpec(m);
    const { axis, layers } = parseMove(quarterOf(m), 3);
    if (layers.length === 1 && layers[0] === 1) {
      assert.equal(spec.face, null, `${m}: a middle slice has no outer face`);
      continue;
    }
    assert.ok(spec.face, m);
    const side = spec.face[axis];
    assert.ok(layers.includes(side + 1), `${m}: arrow face ${spec.face} is not part of the move`);
    // a corner sticker on that face moves with the rotation sense: (sense·axis × p) · (q − p) > 0
    const perm = permutation(quarterOf(m));
    const omega = [0, 1, 2].map((k) => (k === axis ? spec.sense : 0));
    GEOMETRY.forEach(({ p, n }, i) => {
      if (n.join() !== spec.face.join() || p.filter((v) => v !== 0).length !== 3) return;
      const q = GEOMETRY[perm[i]].p;
      const v = [omega[1] * p[2] - omega[2] * p[1], omega[2] * p[0] - omega[0] * p[2], omega[0] * p[1] - omega[1] * p[0]];
      assert.ok(dot(v, [q[0] - p[0], q[1] - p[1], q[2] - p[2]]) > 0, `${m}: corner ${i}`);
    });
  }
});

test('half turns are flagged; quarter turns are not', () => {
  for (const m of ALL) assert.equal(arrowSpec(m).half, /2'?$/.test(m), m);
});

test('the front strip agrees with the plain-language hint', () => {
  const VEC = { left: [-1, 0, 0], right: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
  for (const m of ALL) {
    const { axis } = parseMove(quarterOf(m), 3);
    const word = /(?:moves?|to your|to the) (left|right|up|down)/.exec(moveHint(m).text)[1];
    const strip = arrowSpec(m).strips.find((s) => s.normal.join() === (axis === 2 ? '0,1,0' : '0,0,1'));
    assert.ok(dot(strip.dir, VEC[word]) > 0, `${m}: arrow ${strip.dir} vs hint "${word}"`);
  }
});

import { arrowView } from '../js/arrowspec.js';

const deg = (d) => (d * Math.PI) / 180;
// camera at distance 11 in direction (elevation, azimuth from +z towards +x)
const eyeAt = (el, az) => [Math.cos(deg(el)) * Math.sin(deg(az)) * 11, Math.sin(deg(el)) * 11, Math.cos(deg(el)) * Math.cos(deg(az)) * 11];
const shownNormals = (spec, v) => v.strips.map((i) => spec.strips[i].normal.join());

test("L' seen from the front-top: straight arrows on U and F, not a squashed arc", () => {
  for (const m of ["L'", 'L', 'L2', "x'", 'x2']) {
    const spec = arrowSpec(m);
    const v = arrowView(spec, eyeAt(35, -8)); // a little to the left: the L face is ~83° from the view
    assert.equal(v.arc, false, m);
    assert.deepEqual(shownNormals(spec, v).sort(), ['0,0,1', '0,1,0'], m);
  }
});

const DEFAULT_EYE = (() => {
  const l = Math.hypot(0.9, 0.85, 1.35);
  return [0.9, 0.85, 1.35].map((v) => (v / l) * 11.1); // main.js fitCamera for a 3×3
})();

test('the default view keeps the arc for R, U and F (and x, y, z)', () => {
  for (const m of ['R', "R'", 'R2', 'U', "U'", 'U2', 'F', "F'", 'F2', 'x', "y'", 'z2', 'Rw', "Uw'"])
    assert.equal(arrowView(arrowSpec(m), DEFAULT_EYE).arc, true, m);
});

test('arc switch has hysteresis between 72° and 76°', () => {
  const spec = arrowSpec('R');
  const at = (a) => [1.5 + 10 * Math.cos(deg(a)), 0, 10 * Math.sin(deg(a))]; // R face centre + 10 at angle a
  assert.equal(arrowView(spec, at(70), false).arc, true);
  assert.equal(arrowView(spec, at(74), false).arc, false);
  assert.equal(arrowView(spec, at(74), true).arc, true);
  assert.equal(arrowView(spec, at(78), true).arc, false);
});

test('side arrows keep the right direction for prime and double moves', () => {
  for (const b of ['L', 'R', 'U', 'x', 'M']) {
    const q = arrowSpec(b), p = arrowSpec(`${b}'`), d = arrowSpec(`${b}2`);
    q.strips.forEach((s, i) => {
      assert.deepEqual(p.strips[i].dir.map((v) => -v + 0), s.dir.map((v) => v + 0), `${b}' reverses ${b}`);
      assert.deepEqual(d.strips[i].dir.map((v) => v + 0), s.dir.map((v) => v + 0), `${b}2 follows ${b}`);
    });
  }
});

test('something is always shown, and several strips only on faces towards the camera', () => {
  for (const m of ALL)
    for (const el of [-80, -40, 0, 40, 80])
      for (const az of [0, 60, 120, 180, 240, 300]) {
        const spec = arrowSpec(m);
        const eye = eyeAt(el, az);
        const v = arrowView(spec, eye);
        assert.ok(v.arc || v.strips.length, `${m} @${el},${az}: nothing shown`);
        if (v.strips.length > 1) for (const i of v.strips) assert.ok(dot(spec.strips[i].normal, eye) > 0, `${m} @${el},${az}: strip faces away`);
      }
});

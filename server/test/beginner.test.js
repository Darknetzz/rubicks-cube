import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStage, stagesDone, defaultCrossColour, STAGE_IDS } from '../src/beginner.js';
import { randomState, applyMoves, isSolved, SOLVED } from '../src/cube3.js';
import { JAPANESE } from '../../js/validate.js';

const run = (s, steps) => applyMoves(s, steps.map((x) => x.move).join(' '));

test('stage by stage solves random cubes for every cross colour and scheme', () => {
  for (let n = 0; n < 60; n++) {
    let s = randomState(n % 2 ? JAPANESE : undefined);
    const X = 'WYROGB'[n % 6];
    const seen = [];
    for (let k = 0; k < 6; k++) {
      const r = planStage(s, X);
      if (r.alreadyDone) break;
      assert.equal(run(s, r.steps), r.after);
      assert.ok(r.steps.every((x) => x.label && x.label.length <= 80 && !/\s/.test(x.move)));
      seen.push(r.stage.id);
      s = r.after;
      assert.ok(stagesDone(s, X).slice(0, STAGE_IDS.indexOf(r.stage.id) + 1).every(Boolean));
    }
    assert.ok(isSolved(s), `cube ${n} (${seen.join(', ')})`);
  }
});

test('cross and corners are built with the cross colour on top, the rest with it on the bottom', () => {
  const s = randomState();
  const r = planStage(s, 'W');
  assert.equal(r.stage.id, 'cross');
  assert.equal(r.after[4], 'W', 'already on top: no rotation');
  const r2 = planStage(r.after, 'W');
  assert.match(r2.steps.find((x) => /insert/.test(x.label)).label, /insert white-.*corner: \w' D' \w D, repeat 1\/\d/);
  const r3 = planStage(r2.after, 'W');
  assert.equal(r3.stage.id, 'middle-layer-edges');
  assert.equal(r3.steps[0].move, 'z2');
  assert.equal(r3.after[31], 'W', 'white centre at the bottom');
  // the white cross on the bottom is still found by default, though yellow is now on top
  assert.equal(defaultCrossColour(r3.after, null), 'W');
});

test('solved stages are skipped; explicit stages check order', () => {
  const s = applyMoves(SOLVED, "R U R' U'"); // only the last layer and a corner/edge disturbed
  const r = planStage(s, 'Y'); // yellow is on the bottom in the default Western hold
  assert.notEqual(r.stage.id, 'cross');
  assert.equal(planStage(s, 'Y', 'cross').alreadyDone, true);
  assert.throws(() => planStage(randomState(), 'W', 'last-layer-permutation'), /earlier stages/);
  assert.throws(() => planStage(s, 'W', 'nope'), /Unknown stage/);
  assert.equal(planStage(SOLVED, 'W').alreadyDone, true);
});

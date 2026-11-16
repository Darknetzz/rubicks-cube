import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { SOLVED, applyMoves } from '../src/cube3.js';
import { invertMoves } from '../../js/notation.js';

function planned(scramble) {
  const s = new Session(null);
  s.setState(applyMoves(SOLVED, scramble));
  s.solve();
  return s;
}

test('invertMoves undoes any sequence', () => {
  const seq = ['R', "U'", 'F2', "B2'", 'M', 'x'];
  assert.deepEqual(invertMoves(seq), ["x'", "M'", 'B2', 'F2', 'U', "R'"]);
  assert.equal(applyMoves(applyMoves(SOLVED, seq), invertMoves(seq)), SOLVED);
});

test('undo restores state and plan, one batch at a time, and is emitted as inverse moves', () => {
  const s = planned("R U F'");
  const plan = [...s.plan];
  const events = [];
  s.on('change', (e) => events.push(e));
  assert.equal(s.apply(plan[0]), true);
  assert.equal(s.step, 1);
  assert.equal(s.apply('L D'), false); // off plan: plan cleared
  assert.equal(s.plan, null);
  assert.deepEqual(s.undo('tab1'), ['L', 'D']);
  assert.deepEqual(s.plan, plan);
  assert.equal(s.step, 1);
  assert.deepEqual(events.at(-1).moves, ["D'", "L'"]);
  assert.equal(events.at(-1).origin, 'tab1');
  assert.equal(events.at(-1).undo, true);
  s.undo();
  assert.equal(s.step, 0);
  assert.equal(s.undo(), null, 'only moves can be undone, not the state that was set');
  assert.equal(s.snapshot().canUndo, false);
});

test('a half-turn step can be done as two quarter turns, either way, or written with a prime', () => {
  const s = planned('R2 U2');
  assert.deepEqual(s.plan, ['U2', 'R2']);
  assert.equal(s.apply("U'"), true, 'first quarter of U2: plan waits');
  assert.equal(s.step, 0);
  assert.equal(s.apply("U'"), true);
  assert.equal(s.step, 1);
  assert.equal(s.apply("R2'"), true);
  assert.equal(s.step, 2);
  assert.equal(s.snapshot().solved, true);
});

test('a new state clears the undo history', () => {
  const s = new Session(null);
  s.apply('R U');
  assert.ok(s.canUndo);
  s.setState(SOLVED);
  assert.ok(!s.canUndo);
});

test('an unfinished painting is kept as a draft beside the state, turns with moves, and a full cube replaces it', () => {
  const s = new Session(null);
  s.apply('R U');
  const state = s.state;
  const bad = 'Y'.repeat(9) + state.slice(9); // 18 yellow stickers
  const mask = '1'.repeat(27) + '0'.repeat(27);
  s.setDraft(bad, mask);
  assert.equal(s.state, state, 'state untouched');
  assert.ok(s.canUndo, 'undo history kept');
  assert.equal(s.snapshot().hasDraft, true);
  s.apply('F');
  assert.equal(s.draft.state, applyMoves(bad, 'F'));
  assert.equal(s.draft.painted, applyMoves(mask, 'F'));
  s.undo();
  assert.equal(s.draft.state, bad);
  assert.equal(s.draft.painted, mask);
  s.setState(SOLVED);
  assert.equal(s.draft, null);
  assert.throws(() => s.setDraft('X'.repeat(54)), /54 colour letters/);
  s.setDraft(applyMoves(SOLVED, 'R'));
  assert.equal(s.draft, null, 'a valid draft just becomes the state');
  assert.equal(s.state, applyMoves(SOLVED, 'R'));
});

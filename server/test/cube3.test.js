import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SOLVED, applyMoves, isSolved, validate, solve, randomState, asciiNet, describeMove, holding, fromFaces, schemeText,
} from '../src/cube3.js';
import { Session } from '../src/session.js';

const require = createRequire(import.meta.url);
const Cube = require('../vendor/cubejs/cube.js');

const MOVES = ['R', 'L', 'U', 'D', 'F', 'B'].flatMap((m) => [m, `${m}'`, `${m}2`]);

test('every face move matches cubejs', () => {
  for (const m of MOVES) assert.equal(applyMoves(SOLVED, m), fromFaces(new Cube().move(m).asString()), m);
  const alg = "R U2 F' L D B2 R' U F2 D' L2 B";
  assert.equal(applyMoves(SOLVED, alg), fromFaces(new Cube().move(alg).asString()));
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
  assert.match(validate('W'.repeat(54)).join(), /54 white stickers instead of 9/);
  assert.match(validate('U'.repeat(54)).join(), /colour letters W Y R O G B/);
  assert.match(validate(swap(SOLVED, 0, 9)).join(), /top-right-front corner reads white-white-green: two white stickers/);
});

test('centre checks: all 24 real orientations pass, wrong centres get one clear message', () => {
  const seen = new Set();
  for (const a of ['', 'x', 'x2', "x'", 'z', "z'"]) {
    for (const b of ['', 'y', 'y2', "y'"]) {
      const s = applyMoves(SOLVED, `${a} ${b} R U F'`.trim());
      assert.deepEqual(validate(s), [], `${a} ${b}`);
      seen.add([4, 13, 22, 31, 40, 49].map((i) => s[i]).join(''));
    }
  }
  assert.equal(seen.size, 24);

  const swap = (s, i, j) => { const a = [...s]; [a[i], a[j]] = [a[j], a[i]]; return a.join(''); };
  // two centres painted the wrong way round: every piece then disagrees with the scheme they imply
  // left and right centres swapped is a mirror image of the Western scheme, and is named as such
  assert.match(validate(swap(SOLVED, 13, 40))[0], /^orange and red look swapped: is the cube mirrored\?/);
  for (const [i, j] of [[4, 13]]) {
    const errs = validate(swap(SOLVED, i, j));
    assert.match(errs[0], /pieces don't fit the colour scheme .* Check the six centre stickers first/);
  }
  // a centre painted with another face's colour (counts fixed by swapping with an edge sticker)
  assert.match(validate(swap(SOLVED, 4, 10)).join(), /top and right faces both have a red centre/);
});

// Correctness checks on many random cubes: a small time budget keeps them fast (length is tested in solver.test.js).
const quick = (s) => solve(s, { budgetMs: 60, shortMs: 20 });

test('solve returns short, correct solutions', () => {
  assert.deepEqual(solve(SOLVED), []);
  for (let i = 0; i < 30; i++) {
    const s = randomState();
    const moves = quick(s);
    assert.ok(moves.length <= 22, `${moves.length} moves`);
    assert.ok(isSolved(applyMoves(s, moves)));
  }
  const rotated = applyMoves(SOLVED, "z F R U' B");
  assert.ok(isSolved(applyMoves(rotated, quick(rotated))));
});

test('text helpers', () => {
  assert.match(asciiNet(SOLVED), /W W W/);
  assert.match(describeMove("R'", SOLVED), /right face \(red centre\) counter-clockwise/);
  assert.equal(holding(SOLVED), 'white centre on top, green centre facing you (so yellow is on the bottom, red on the right, orange on the left, blue at the back)');
  assert.match(describeMove('M', SOLVED), /between the left face \(orange centre\) and right face \(red centre\)/);
  assert.match(describeMove('x', SOLVED), /afterwards hold it green centre on top/);
});

// ---------- Japanese scheme: white opposite blue, yellow opposite green, red opposite orange ----------
const JAPANESE = { U: 'W', R: 'R', F: 'G', D: 'B', L: 'O', B: 'Y' };
const JP_SOLVED = fromFaces('URFDLB'.split('').map((x) => x.repeat(9)).join(''), JAPANESE);

test('Japanese scheme: solved state validates and solves in zero moves', () => {
  assert.deepEqual(validate(JP_SOLVED), []);
  assert.ok(isSolved(JP_SOLVED));
  assert.deepEqual(solve(JP_SOLVED), []);
  assert.equal(schemeText(JP_SOLVED), 'white opposite blue, yellow opposite green, red opposite orange');
  assert.match(holding(JP_SOLVED), /^white centre on top, green centre facing you \(so blue is on the bottom/);
  assert.match(asciiNet(JP_SOLVED), /bottom \(blue centre\)/);
  assert.match(describeMove('D', JP_SOLVED), /bottom face \(blue centre\) clockwise/);
  // held another way round (yellow on top) is just as valid
  assert.deepEqual(validate(applyMoves(JP_SOLVED, 'x2 y')), []);
});

test('Japanese scheme: scrambled states solve correctly', () => {
  const scrambled = applyMoves(JP_SOLVED, "R U2 F' L D B2 R' U F2 D' L2 B");
  assert.deepEqual(validate(scrambled), []);
  const moves = quick(scrambled);
  assert.ok(moves.length > 0 && moves.length <= 22);
  assert.ok(isSolved(applyMoves(scrambled, moves)));
  for (let i = 0; i < 10; i++) {
    const s = applyMoves(randomState(JAPANESE), ['', 'z', "x'", 'y2'][i % 4]);
    assert.ok(isSolved(applyMoves(s, quick(s))), s);
  }
});

test('a single flipped edge is rejected with a clear message', () => {
  for (const base of [SOLVED, JP_SOLVED]) {
    const a = [...base];
    [a[7], a[19]] = [a[19], a[7]]; // top-front edge: U8 and F2
    const errors = validate(a.join(''));
    assert.deepEqual(errors, ['One edge is flipped (its two stickers are the wrong way round). This is impossible on a real cube; most likely a sticker was entered wrong.']);
    assert.throws(() => solve(a.join('')), /One edge is flipped/);
  }
});

test('an edge with two opposite colours is named precisely', () => {
  const a = [...JP_SOLVED];
  [a[7], a[46]] = [a[46], a[7]]; // swap a white sticker (top-front edge) with a yellow one (top-back edge)
  assert.match(validate(a.join('')).join(' '), /The top-front edge reads yellow-green: .*yellow and green, but the centres put those colours on opposite sides/);
});

test('session: scheme travels with the state; reset keeps it; old face-letter saves migrate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cube-'));
  const session = new Session(join(dir, 'state.json'));
  assert.match(session.setState(JP_SOLVED), /Colour scheme changed from \(white opposite yellow.*\) to \(white opposite blue/);
  assert.equal(session.setState(applyMoves(JP_SOLVED, 'R')), ''); // same scheme, no note
  session.apply("R' x");
  assert.equal(session.snapshot().scheme.opposites, 'white opposite blue, yellow opposite green, red opposite orange');
  assert.equal(session.snapshot().scheme.centres.U, 'G'); // x brought green to the top
  session.reset();
  assert.ok(isSolved(session.state));
  assert.equal(schemeText(session.state), schemeText(JP_SOLVED));
  assert.equal(new Session(join(dir, 'state.json')).state, session.state); // persisted

  const old = join(dir, 'old.json');
  writeFileSync(old, JSON.stringify({ state: 'U'.repeat(9) + 'R'.repeat(9) + 'F'.repeat(9) + 'D'.repeat(9) + 'L'.repeat(9) + 'B'.repeat(9) }));
  assert.equal(new Session(old).state, SOLVED);
});

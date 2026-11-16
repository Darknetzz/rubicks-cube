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
  assert.ok(encodeState(5, s5).startsWith('5:'));
  assert.deepEqual(parseState(`  ${SOLVED.slice(0, 27)}\n${SOLVED.slice(27)} `).size, 3);
});

test('exports colour letters (the MCP set_cube/get_cube format) and imports either alphabet', () => {
  const colours = 'WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYYYYOOOOOOOOOBBBBBBBBB';
  assert.equal(encodeState(3, SOLVED), colours);
  assert.match(stateToJson(3, SOLVED), /"state": "WWWW/);
  assert.deepEqual(parseState(colours), { size: 3, facelets: SOLVED }); // pasted from Claude
  assert.deepEqual(parseState(SOLVED), { size: 3, facelets: SOLVED }); // older face-letter export
  assert.deepEqual(parseState(`{"size":3,"state":"${SOLVED}"}`), { size: 3, facelets: SOLVED }); // v1 JSON file
  // a Japanese-scheme cube (white opposite blue) round-trips too
  const jp = colours.replace(/Y/g, 'x').replace(/B/g, 'Y').replace(/x/g, 'B');
  assert.equal(encodeState(3, parseState(jp).facelets), jp);
  assert.throws(() => parseState(colours.replace('W', 'U')), /Mixes colour letters/);
});

test('rejects bad input with readable errors', () => {
  assert.throws(() => parseState('13:' + solvedState(13)), /Size must be 2–12/);
  assert.throws(() => parseState('4:' + SOLVED), /needs 96 letters, got 54/);
  assert.throws(() => parseState(SOLVED.replace('U', 'X')), /Only the letters U R F D L B/);
  assert.throws(() => parseState('WWWWWWWWWRRRRRRRRRGGGGGGGGGYYYYYYYYYOOOOOOOOOBBBBBBBBX'), /Only the colour letters/);
  assert.throws(() => parseState('4:' + solvedState(4).replace('U', 'R')), /15 white stickers instead of 16/);
  assert.throws(() => parseState(SOLVED.slice(0, 7) + 'F' + SOLVED.slice(8, 19) + 'U' + SOLVED.slice(20)), /flipped/);
  assert.throws(() => parseState('{nope'), /not valid JSON/);
});

test('the page colour scheme decides which key a colour letter becomes', async () => {
  const { SCHEMES, presetOf, faceColors, isScheme } = await import('../js/settings.js');
  const jp = SCHEMES.japanese.scheme;
  const jpSolvedColours = [...'URFDLB'].map((f) => jp[f].repeat(9)).join('');
  // a solved Japanese cube, pasted into a page set to Japanese, is the solved page cube (keys U R F D L B)
  assert.deepEqual(parseState(jpSolvedColours, jp), { size: 3, facelets: SOLVED });
  assert.equal(encodeState(3, SOLVED, jp), jpSolvedColours);
  assert.equal(encodeState(2, solvedState(2), SCHEMES['western-yellow'].scheme), `2:${'Y'.repeat(4)}${'O'.repeat(4)}${'G'.repeat(4)}${'W'.repeat(4)}${'R'.repeat(4)}${'B'.repeat(4)}`);
  assert.equal(presetOf(jp), 'japanese');
  assert.equal(presetOf({ ...jp, U: 'B', D: 'W' }), 'custom');
  assert.equal(faceColors({ scheme: jp, palette: { W: 'w', Y: 'y', R: 'r', O: 'o', G: 'g', B: 'b' } }).D, 'b');
  assert.ok(isScheme(jp));
  assert.ok(!isScheme({ ...jp, U: 'Y' }));
  // every preset is a real cube: its solved state validates
  const { validate, fromFaces } = await import('../js/validate.js');
  for (const { scheme } of Object.values(SCHEMES)) assert.deepEqual(validate(fromFaces(SOLVED, scheme)), []);
});

test('old settings (a hex colour per face) migrate to the per-colour palette and the Western scheme', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { loadSettings, SCHEMES } = await import('../js/settings.js');
  store.set('rubiks-cube-settings-v1', JSON.stringify({ colors: { U: '#eeeeee', D: '#ffff00', F: '#00ff00', B: '#0000ff', R: '#ff0000', L: '#ff8800' } }));
  const s = loadSettings();
  assert.deepEqual(s.scheme, SCHEMES.western.scheme);
  assert.deepEqual(s.palette, { W: '#eeeeee', Y: '#ffff00', G: '#00ff00', B: '#0000ff', R: '#ff0000', O: '#ff8800' });
  assert.equal(s.colors, undefined);
  store.set('rubiks-cube-settings-v1', JSON.stringify({ scheme: { U: 'W', R: 'W', F: 'G', D: 'B', L: 'O', B: 'Y' } }));
  assert.deepEqual(loadSettings().scheme, SCHEMES.western.scheme, 'a broken scheme falls back to the default');
  delete globalThis.localStorage;
});

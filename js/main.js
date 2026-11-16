import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Cube } from './cube.js';
import {
  parseMove, parseSequence, formatTurn, inverse, pushMerged, randomScramble, autoScrambleLength,
} from './notation.js';
import {
  ACTIONS, FACE_KEYS, FACE_NAMES, MIN_SIZE, MAX_SIZE,
  loadSettings, saveSettings, defaultSettings, normalizeKey, keyLabel,
} from './settings.js';
import { serverAvailable, connect, postState } from './live.js';
import { validate, colourCounts, COLOURS, COLOUR_NAMES } from './validate.js';
import { parseState, encodeState, stateToJson, stateLink } from './statefile.js';

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const save = () => saveSettings(settings);

// ---------- scene ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
scene.add(camera, new THREE.HemisphereLight(0xffffff, 0x50505a, 1.8));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(2, 4, 3);
camera.add(keyLight); // light follows the view so every face stays readable

const cube = new Cube(scene, settings);
cube.speed = settings.speed;
cube.onTurnDone = () => {
  onTurnDone();
  if (!cube.busy) saveCube();
};

const state = { history: [], moves: 0, scrambled: false, running: false, t0: 0, t1: 0, prefix: '' };
// Real-cube mode: the page mirrors the server's cube (shared with Claude over MCP).
const live = {
  on: false, disconnect: null, snap: null, painting: false, paintFace: 'U',
  paintBase: null, // server state the current painting started from; edits = page differs from it
  following: false, // painting, unedited, and animating a remote update we accepted
  conflict: false, // a remote update arrived over unsent edits; waiting for the user to choose
};

// The server speaks colour letters (W Y R O G B); the 3D cube paints with settings colour keys. This table only picks
// which colour swatch draws which colour. Faces are never inferred from it: the centres define the scheme.
const KEY_OF_COLOUR = { W: 'U', Y: 'D', G: 'F', B: 'B', R: 'R', O: 'L' };
const COLOUR_OF_KEY = Object.fromEntries(Object.entries(KEY_OF_COLOUR).map(([c, k]) => [k, c]));
const liveFacelets = () => {
  const keys = cube.n === 3 ? cube.getFacelets() : null;
  return keys && [...keys].map((k) => COLOUR_OF_KEY[k]).join('');
};
const showLive = (colours) => cube.setFacelets([...colours].map((c) => KEY_OF_COLOUR[c]).join(''));

// ---------- mouse / touch turning (registered before OrbitControls so it can veto orbiting) ----------
const raycaster = new THREE.Raycaster();
let drag = null;

function ndc(e) {
  const r = canvas.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

function paintAt(e) {
  raycaster.setFromCamera(ndc(e), camera);
  const s = cube.stickerAt(raycaster);
  if (s) {
    cube.paint(s, live.paintFace);
    renderPaintCheck();
  }
  return !!s;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || drag || cube.busy) return;
  if (live.painting) {
    if (!paintAt(e)) return;
    controls.enabled = false;
    drag = { paint: true, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (live.on) return; // the real cube is turned by hand, not here
  raycaster.setFromCamera(ndc(e), camera);
  const hit = cube.pick(raycaster);
  if (!hit) return; // background: let OrbitControls orbit
  controls.enabled = false;
  drag = { ...hit, x: e.clientX, y: e.clientY, id: e.pointerId, done: false };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (drag?.paint && e.pointerId === drag.id) return void paintAt(e);
  if (!drag || drag.done || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (dx * dx + dy * dy < 100) return;
  drag.done = true;
  const turn = dragToTurn(drag, dx, dy);
  if (turn) userTurn(turn);
});

const endDrag = (e) => {
  if (drag && e.pointerId === drag.id) {
    drag = null;
    controls.enabled = true;
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// Pick the face tangent whose on-screen direction best matches the drag; rotate about normal × tangent.
function dragToTurn({ cubie, point, normal }, dx, dy) {
  const r = canvas.getBoundingClientRect();
  const toScreen = (p) => {
    const v = p.clone().project(camera);
    return new THREE.Vector2((v.x * r.width) / 2, (-v.y * r.height) / 2);
  };
  const p0 = toScreen(point);
  const dir = new THREE.Vector2(dx, dy).normalize();
  let best = null;
  for (let a = 0; a < 3; a++) {
    if (normal.getComponent(a) !== 0) continue;
    const t = new THREE.Vector3().setComponent(a, 1);
    const s = toScreen(point.clone().add(t)).sub(p0);
    if (s.lengthSq() < 1e-9) continue;
    const dot = dir.dot(s.normalize());
    if (!best || Math.abs(dot) > Math.abs(best.dot)) best = { t, dot };
  }
  if (!best) return null;
  const w = new THREE.Vector3().crossVectors(normal, best.t.multiplyScalar(Math.sign(best.dot)));
  const axis = [0, 1, 2].find((i) => Math.abs(w.getComponent(i)) > 0.5);
  return {
    axis,
    layers: [Math.round(cubie.position.getComponent(axis) + cube.off)],
    turns: Math.sign(w.getComponent(axis)),
  };
}

const controls = new OrbitControls(camera, canvas);
controls.enablePan = false;
controls.enableDamping = true;

function fitCamera() {
  const n = cube.n;
  camera.position.set(0.9, 0.85, 1.35).normalize().multiplyScalar(3.2 * n + 1.5);
  controls.target.set(0, 0, 0);
  controls.minDistance = n * 1.5;
  controls.maxDistance = n * 8 + 10;
  controls.update();
}

// ---------- game logic ----------
function userTurn(turn) {
  if (live.on) return setMessage('Real-cube mode: moves come from Claude. Use Paint to change colours.');
  pushMerged(state.history, turn);
  if (turn.layers.length !== cube.n) state.moves++; // whole-cube rotations are free
  if (state.scrambled && !state.running) {
    state.running = true;
    state.t0 = performance.now();
  }
  cube.enqueue(turn);
  setMessage('');
  updateHud();
}

function onTurnDone() {
  if (live.on) return syncLive();
  if (cube.busy || !cube.isSolved()) return;
  state.history.length = 0;
  if (state.running) {
    state.running = false;
    state.t1 = performance.now();
    setMessage(`Solved in ${fmtTime(state.t1 - state.t0)} with ${state.moves} moves!`, 'win');
  }
  state.scrambled = false;
  updateHud();
}

function scramble() {
  const seq = randomScramble(cube.n, settings.scrambleLength || autoScrambleLength(cube.n));
  for (const t of seq) pushMerged(state.history, t);
  cube.enqueue(seq, 0.4);
  Object.assign(state, { moves: 0, scrambled: true, running: false, t0: 0, t1: 0 });
  setMessage('Scrambled. The timer starts on your first move.');
  updateHud();
}

function solve() {
  if (!state.history.length) {
    if (!cube.busy && !cube.isSolved()) setMessage("Solve can only undo scrambles and moves made here, not an imported cube.", 'error');
    return;
  }
  const seq = state.history.reverse().map(inverse);
  state.history = [];
  const wasRunning = state.running;
  if (wasRunning) state.t1 = performance.now();
  Object.assign(state, { scrambled: false, running: false });
  cube.enqueue(seq, seq.length > 40 ? 0.35 : 0.6);
  setMessage(wasRunning ? 'Auto-solved, so the timer was stopped.' : 'Auto-solving…');
  updateHud();
}

function undo() {
  const t = state.history.pop();
  if (!t) return;
  cube.enqueue(inverse(t));
  updateHud();
}

function reset() {
  const resized = cube.n !== settings.size;
  cube.build(settings.size);
  Object.assign(state, { history: [], moves: 0, scrambled: false, running: false, t0: 0, t1: 0 });
  if (resized) fitCamera();
  setMessage('');
  updateHud();
  saveCube();
}

const commands = Object.fromEntries(
  Object.entries({ scramble, solve, undo, reset }).map(([k, fn]) => [k, () => (live.on ? null : fn())]),
);

// ---------- real-cube mode ----------
function syncLive() {
  if (!live.snap || cube.busy) return;
  if (live.painting && !live.following) return; // never overwrite the user's painting
  live.following = false;
  if (liveFacelets() !== live.snap.state) showLive(live.snap.state);
  if (live.painting) renderPaintCheck();
}

function onLiveEvent(ev) {
  live.snap = ev;
  renderPlan();
  if (live.painting) {
    // Unedited painting just follows the server; edits are only thrown away if the user says so.
    const page = liveFacelets();
    if (live.conflict || (page !== null && page !== live.paintBase)) return showConflict(true);
    live.paintBase = ev.state;
    live.following = true;
  }
  if (ev.type === 'moves' && cube.n === 3 && !cube.busy) {
    cube.enqueue(parseSequence(ev.moves.join(' '), 3)); // animate, then syncLive() double-checks
  } else {
    showLive(ev.state);
    live.following = false;
    if (live.painting) renderPaintCheck();
  }
  if (ev.solved && ev.type === 'moves') setMessage('Solved!', 'win');
}

function showConflict(on) {
  live.conflict = on;
  $('remote-changed').hidden = !on;
}

function renderPlan() {
  const el = $('plan');
  el.replaceChildren();
  const snap = live.on && live.snap;
  if (!snap?.plan) return;
  snap.plan.forEach((m, i) => {
    const span = document.createElement('span');
    span.textContent = m;
    span.className = i < snap.step ? 'done' : i === snap.step ? 'current' : '';
    el.append(span);
  });
}

function setLive(on) {
  live.on = on;
  document.body.classList.toggle('live', on);
  $('live-toggle').classList.toggle('active', on);
  setPainting(false);
  if (on) {
    live.disconnect = connect(onLiveEvent, (ok) => {
      $('live-status').textContent = ok ? 'Connected' : 'Reconnecting…';
      $('live-status').className = ok ? 'ok' : 'error';
    });
    if (cube.n !== 3) {
      cube.build(3);
      fitCamera();
    }
    setMessage('Real-cube mode: paint your cube, send it, then ask Claude to solve it.');
  } else {
    live.disconnect?.();
    live.snap = null;
    reset();
    fitCamera();
  }
  renderPlan();
  updateHud();
  saveCube();
}

function setPainting(on) {
  live.painting = on;
  live.paintBase = on ? live.snap?.state ?? liveFacelets() : null;
  live.following = false;
  showConflict(false);
  document.body.classList.toggle('painting', on);
  $('paint-toggle').classList.toggle('active', on);
  if (on) setMessage('Paint: pick a colour, tap stickers. Front = the face pointing at you in the default view.');
  else if (live.on) syncLive();
  renderPaintCheck();
}

// Live feedback while painting: sticker counts per colour, the first problem found, Send only when solvable.
function renderPaintCheck() {
  const box = $('paint-check');
  const facelets = liveFacelets();
  if (!live.painting || !facelets) return box.replaceChildren();
  const counts = colourCounts(facelets);
  const errors = validate(facelets);
  const chips = [...COLOURS].map((c) => {
    const chip = document.createElement('span');
    chip.className = counts[c] === 9 ? 'chip' : 'chip bad';
    chip.title = `${COLOUR_NAMES[c]}: ${counts[c]} of 9`;
    const dot = document.createElement('i');
    dot.style.background = settings.colors[KEY_OF_COLOUR[c]];
    chip.append(dot, String(counts[c]));
    return chip;
  });
  const msg = document.createElement('span');
  msg.className = errors.length ? 'problem' : 'ok';
  msg.textContent = errors.length ? errors[0] : 'Looks like a real cube. Ready to send.';
  box.replaceChildren(...chips, msg);
  $('send').disabled = errors.length > 0;
  $('send').title = errors[0] || '';
}

function renderPalette() {
  const box = $('palette');
  box.replaceChildren();
  for (const c of COLOURS) {
    const f = KEY_OF_COLOUR[c];
    const b = document.createElement('button');
    b.type = 'button';
    b.title = COLOUR_NAMES[c];
    b.style.background = settings.colors[f];
    b.classList.toggle('selected', live.paintFace === f);
    b.addEventListener('click', () => {
      live.paintFace = f;
      renderPalette();
    });
    box.append(b);
  }
}

$('live-toggle').addEventListener('click', () => setLive(!live.on));
$('paint-toggle').addEventListener('click', () => setPainting(!live.painting));
$('paint-clear').addEventListener('click', () => {
  cube.build(3);
  setPainting(true);
});
$('remote-discard').addEventListener('click', () => {
  showConflict(false);
  setPainting(false); // shows the server's state
});
$('remote-keep').addEventListener('click', () => showConflict(false));
$('send').addEventListener('click', async () => {
  const facelets = liveFacelets();
  if (!facelets) return;
  try {
    await postState(facelets);
    setPainting(false);
    setMessage('Sent. Now ask Claude to help you solve it.', 'win');
  } catch (err) {
    setMessage(err.message, 'error');
  }
});


// ---------- HUD ----------
function fmtTime(ms) {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

function setMessage(text, kind = '') {
  const el = $('message');
  el.textContent = text;
  el.className = kind;
}

function updateHud() {
  $('moves').textContent = `Moves: ${state.moves}`;
  const h = state.history;
  const tail = h.slice(-16).map((t) => formatTurn(t, cube.n)).join(' ');
  $('history').textContent = h.length > 16 ? `… ${tail}` : tail;
}

function setPrefix(p) {
  state.prefix = p;
  $('prefix').textContent = p ? `Layer ${p}…` : '';
  clearTimeout(setPrefix.timer);
  if (p) setPrefix.timer = setTimeout(() => setPrefix(''), 2000);
}

// ---------- keyboard ----------
let capturing = null; // action id being rebound

addEventListener('keydown', (e) => {
  if (capturing) {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    const k = e.key === 'Escape' ? '' : normalizeKey(e.key);
    if (k) for (const a of ACTIONS) if (settings.keys[a.id] === k) settings.keys[a.id] = '';
    settings.keys[capturing] = k;
    capturing = null;
    save();
    renderKeys();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  const k = normalizeKey(e.key);
  const action = ACTIONS.find((a) => settings.keys[a.id] === k);
  if (!action) {
    if (/^[0-9]$/.test(k) && (state.prefix || k !== '0')) setPrefix(state.prefix + k);
    return;
  }
  e.preventDefault();
  if (action.kind === 'cmd') {
    if (!e.repeat) commands[action.id]();
    return;
  }
  const token = (action.face ? state.prefix : '') + action.id + (e.shiftKey ? "'" : '');
  setPrefix('');
  try {
    userTurn(parseMove(token, cube.n));
  } catch (err) {
    setMessage(err.message, 'error');
  }
});

// ---------- settings panel ----------
const sizeIn = $('size');
const speedIn = $('speed');
const lenIn = $('scramble-length');
sizeIn.min = MIN_SIZE;
sizeIn.max = MAX_SIZE;

const sizeLabel = (n) => `${n}×${n}`;
const speedLabel = (ms) => (ms ? `${ms} ms` : 'instant');

sizeIn.addEventListener('input', () => ($('size-out').textContent = sizeLabel(sizeIn.value)));
sizeIn.addEventListener('change', () => {
  settings.size = Number(sizeIn.value);
  save();
  reset();
  syncInputs();
});
speedIn.addEventListener('input', () => {
  settings.speed = Number(speedIn.value);
  cube.speed = settings.speed;
  $('speed-out').textContent = speedLabel(settings.speed);
  save();
});
lenIn.addEventListener('change', () => {
  settings.scrambleLength = Math.min(1000, Math.max(0, Math.round(Number(lenIn.value) || 0)));
  lenIn.value = settings.scrambleLength;
  save();
});

function applyColors() {
  cube.setColors(settings.colors, settings.body);
  scene.background = new THREE.Color(settings.background);
  document.documentElement.style.setProperty('--bg', settings.background);
  renderPalette();
  renderPaintCheck();
}

function renderColors() {
  const box = $('colors');
  box.replaceChildren();
  const add = (label, value, set) => {
    const l = document.createElement('label');
    l.className = 'swatch';
    const i = document.createElement('input');
    i.type = 'color';
    i.value = value;
    i.addEventListener('input', () => {
      set(i.value);
      applyColors();
      save();
    });
    l.append(i, label);
    box.append(l);
  };
  for (const f of FACE_KEYS) add(`${FACE_NAMES[f]} (${COLOUR_NAMES[COLOUR_OF_KEY[f]]})`, settings.colors[f], (v) => (settings.colors[f] = v));
  add('Body', settings.body, (v) => (settings.body = v));
  add('Background', settings.background, (v) => (settings.background = v));
}

function renderKeys() {
  const box = $('keys');
  box.replaceChildren();
  for (const a of ACTIONS) {
    const row = document.createElement('div');
    row.className = 'keyrow';
    const name = document.createElement('span');
    name.textContent = a.label;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = capturing === a.id ? 'key capturing' : 'key';
    btn.textContent = capturing === a.id ? 'press…' : keyLabel(settings.keys[a.id]);
    btn.addEventListener('click', () => {
      capturing = capturing === a.id ? null : a.id;
      renderKeys();
    });
    row.append(name, btn);
    box.append(row);
  }
}

function syncInputs() {
  sizeIn.value = settings.size;
  $('size-out').textContent = sizeLabel(settings.size);
  speedIn.value = settings.speed;
  $('speed-out').textContent = speedLabel(settings.speed);
  lenIn.value = settings.scrambleLength;
  $('len-hint').textContent = `0 = auto (${autoScrambleLength(settings.size)} for ${sizeLabel(settings.size)})`;
  renderColors();
  renderKeys();
}

$('defaults').addEventListener('click', () => {
  Object.assign(settings, defaultSettings());
  cube.speed = settings.speed;
  save();
  applyColors();
  reset();
  syncInputs();
});

$('alg-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('alg');
  try {
    for (const t of parseSequence(input.value, cube.n)) userTurn(t);
    input.blur();
  } catch (err) {
    setMessage(err.message, 'error');
  }
});

for (const b of document.querySelectorAll('[data-cmd]')) {
  b.addEventListener('click', () => {
    commands[b.dataset.cmd]();
    b.blur();
  });
}
$('toggle-panel').addEventListener('click', () => document.body.classList.toggle('panel-open'));
if (innerWidth > 900) document.body.classList.add('panel-open');

// ---------- loop ----------
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

renderer.setAnimationLoop((now) => {
  cube.update(now);
  controls.update();
  const ms = state.running ? performance.now() - state.t0 : state.t1 - state.t0;
  $('timer').textContent = fmtTime(Math.max(0, ms));
  renderer.render(scene, camera);
});

// ---------- export / import ----------
function currentState() {
  const facelets = cube.getFacelets();
  if (!facelets) setMessage('Wait for the cube to stop turning.', 'error');
  return facelets;
}

async function copy(text, what) {
  $('state-text').value = text;
  try {
    await navigator.clipboard.writeText(text);
    setMessage(`${what} copied to the clipboard.`, 'win');
  } catch {
    $('state-text').select(); // no clipboard (e.g. plain http): leave it selected in the box
    setMessage(`${what} is in the Save / load box; copy it from there.`);
  }
}

function importState(text) {
  let parsed;
  try {
    parsed = parseState(text);
  } catch (err) {
    setMessage(`Can't load that cube: ${err.message}`, 'error');
    return false;
  }
  const { size, facelets } = parsed;
  if (live.on) {
    if (size !== 3) {
      setMessage('Real-cube mode is 3×3 only.', 'error');
      return false;
    }
    cube.setFacelets(facelets, 3);
    setPainting(true);
    setMessage('Loaded. Check it against your cube, then press Send to Claude.');
    return true;
  }
  const resized = cube.n !== size;
  settings.size = size;
  save();
  cube.setFacelets(facelets, size);
  Object.assign(state, { history: [], moves: 0, running: false, t0: 0, t1: 0, scrambled: !cube.isSolved() });
  if (resized) fitCamera();
  syncInputs();
  updateHud();
  saveCube();
  setMessage(`Loaded a ${size}×${size} cube.${state.scrambled ? ' The timer starts on your first move.' : ''}`, 'win');
  return true;
}

$('copy-text').addEventListener('click', () => {
  const f = currentState();
  if (f) copy(encodeState(cube.n, f), 'Cube text');
});
$('copy-link').addEventListener('click', () => {
  const f = currentState();
  if (f) copy(stateLink(cube.n, f), 'Link');
});
$('download').addEventListener('click', () => {
  const f = currentState();
  if (!f) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([stateToJson(cube.n, f)], { type: 'application/json' }));
  a.download = `cube-${cube.n}x${cube.n}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('upload').addEventListener('click', () => $('upload-file').click());
$('upload-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) importState(await file.text());
});
$('state-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (importState($('state-text').value)) $('state-text').blur();
});

// ---------- keep the cube across reloads (per browser; real-cube mode lives on the server) ----------
const CUBE_KEY = 'rubiks-cube-state-v1';

function saveCube() {
  try {
    if (live.on) return localStorage.setItem(CUBE_KEY, JSON.stringify({ live: true }));
    const facelets = cube.getFacelets();
    if (!facelets) return; // mid-turn: saved again when the queue drains
    const elapsed = state.running ? performance.now() - state.t0 : state.t1 - state.t0;
    const { history, moves, scrambled, running } = state;
    localStorage.setItem(CUBE_KEY, JSON.stringify({ size: cube.n, facelets, history, moves, scrambled, running, elapsed, savedAt: Date.now() }));
  } catch {
    /* storage unavailable: nothing persists */
  }
}

function loadSavedCube() {
  try {
    return JSON.parse(localStorage.getItem(CUBE_KEY));
  } catch {
    return null;
  }
}

const validTurn = (t, n) =>
  t && [0, 1, 2].includes(t.axis) && [1, -1, 2].includes(t.turns) && Array.isArray(t.layers) &&
  t.layers.length > 0 && t.layers.every((l) => Number.isInteger(l) && l >= 0 && l < n);

function restoreCube(saved) {
  let parsed;
  try {
    parsed = parseState(`${saved.size}:${saved.facelets}`);
  } catch {
    return; // corrupt or from an incompatible version: start fresh
  }
  const { size, facelets } = parsed;
  settings.size = size;
  save();
  cube.setFacelets(facelets, size);
  const history = Array.isArray(saved.history) && saved.history.every((t) => validTurn(t, size)) ? saved.history : [];
  const elapsed = Math.max(0, Number(saved.elapsed) || 0);
  const now = performance.now();
  Object.assign(state, {
    history,
    moves: Number(saved.moves) || 0,
    scrambled: !!saved.scrambled,
    running: !!saved.running,
    // a running timer keeps counting the time the tab was closed
    t0: saved.running ? now - elapsed - Math.max(0, Date.now() - (Number(saved.savedAt) || Date.now())) : 0,
    t1: saved.running ? 0 : elapsed,
  });
}

addEventListener('pagehide', () => {
  cube.flush();
  saveCube();
});

const saved = loadSavedCube();
if (saved && !saved.live) restoreCube(saved);

applyColors();
fitCamera();
syncInputs();
updateHud();

serverAvailable().then((ok) => {
  document.body.classList.toggle('has-server', ok);
  if (ok && saved?.live && !live.on) setLive(true);
});

// A shared link (#state=…) loads that cube once, then the hash is dropped so a reload doesn't undo progress.
if (location.hash.startsWith('#state=')) {
  importState(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
}

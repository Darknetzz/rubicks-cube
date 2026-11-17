import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { Cube } from './cube.js';
import {
  parseMove, parseSequence, formatTurn, inverse, pushMerged, randomScramble, autoScrambleLength,
} from './notation.js';
import {
  ACTIONS, FACE_KEYS, FACE_NAMES, MIN_SIZE, MAX_SIZE, SCHEMES, presetOf, faceColors, isScheme,
  loadSettings, saveSettings, defaultSettings, normalizeKey, keyLabel,
} from './settings.js';
import { serverAvailable, connect, postState, postDraft, postMoves, postUndo, postRedo, postGoto } from './live.js';
import { validate, colourCounts, holding, COLOURS, COLOUR_NAMES } from './validate.js';
import { parseState, encodeState, stateToJson, stateLink } from './statefile.js';
import { applyMoves } from './facelets.js';
import { hintText } from './hints.js';
import { MoveArrow } from './arrow.js';
import { LayerHighlight } from './highlight.js';

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

const cube = new Cube(scene, { ...settings, colors: faceColors(settings) });
const arrow = new MoveArrow(scene);
const highlight = new LayerHighlight(scene);
cube.speed = settings.speed;
cube.onTurnDone = () => {
  onTurnDone();
  if (!cube.busy) saveCube();
};

const state = { history: [], redo: [], moves: 0, scrambled: false, running: false, t0: 0, t1: 0, prefix: '' };
// Real-cube mode: the page mirrors the server's cube (shared with Claude over MCP).
const live = {
  on: false, disconnect: null, snap: null, painting: false, paintColour: 'W',
  paintBase: null, // server state the current painting corresponds to; edits = page differs from it
  conflict: false, // a remote update arrived over unsent edits; waiting for the user to choose
  draftSent: null, // painting last sent as unfinished; when Claude sets a full cube over it, the page shows that
};

// The server speaks colour letters (W Y R O G B); the 3D cube draws face keys U R F D L B, and the page's colour
// scheme (settings.scheme, face → colour) says which colour each key is. In real-cube mode this only picks how each
// colour is drawn: faces are never inferred from it, the server's centres define the real cube's scheme.
const keyOf = (colour) => Object.keys(settings.scheme).find((k) => settings.scheme[k] === colour);
const colourOf = (key) => settings.scheme[key];
const liveFacelets = () => {
  const keys = cube.n === 3 ? cube.getFacelets() : null;
  return keys && [...keys].map(colourOf).join('');
};
const showLive = (colours) => cube.setFacelets([...colours].map(keyOf).join(''));

// ---------- mouse / touch turning (registered before the camera controls so it can veto them) ----------
const raycaster = new THREE.Raycaster();
let drag = null;
let hoverNdc = null; // mouse position over the canvas (no hover on touch)

function ndc(e) {
  const r = canvas.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

function paintAt(e) {
  raycaster.setFromCamera(ndc(e), camera);
  const s = cube.stickerAt(raycaster);
  if (s) {
    cube.paint(s, keyOf(live.paintColour));
    s.userData.painted = true;
    savePaint();
    renderPaintCheck();
    scheduleDraftSync();
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
  raycaster.setFromCamera(ndc(e), camera);
  const hit = cube.pick(raycaster);
  if (!hit) return; // background: nothing on a mouse; on touch the camera controls rotate the view
  controls.enabled = false;
  drag = { ...hit, x: e.clientX, y: e.clientY, id: e.pointerId, done: false };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  hoverNdc = e.pointerType === 'mouse' ? ndc(e) : null;
  if (drag?.paint && e.pointerId === drag.id) return void paintAt(e);
  if (!drag || drag.done || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (dx * dx + dy * dy < 9) return;
  drag.pred = dragToTurn(drag, dx, dy); // highlight the layer this drag is heading for
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
canvas.addEventListener('pointerleave', () => (hoverNdc = null));

// The two layers a drag on this piece could turn: one per face tangent axis.
const candidateLayers = ({ cubie, normal }) =>
  [0, 1, 2].filter((a) => normal.getComponent(a) === 0)
    .map((axis) => ({ axis, layer: Math.round(cubie.position.getComponent(axis) + cube.off) }));

function updateHighlight() {
  if (cube.busy || live.painting) return highlight.hide();
  if (drag) {
    if (drag.paint || drag.done) return highlight.hide();
    const p = drag.pred;
    return highlight.show(p ? [{ axis: p.axis, layer: p.layers[0] }] : candidateLayers(drag), cube.n);
  }
  if (!hoverNdc) return highlight.hide();
  raycaster.setFromCamera(hoverNdc, camera);
  const hit = cube.pick(raycaster);
  highlight.show(hit && candidateLayers(hit), cube.n);
}

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

// Trackball, not orbit: no pole clamp, so the view can tumble all the way over the top and bottom.
const controls = new TrackballControls(camera, canvas);
controls.noPan = true;
controls.rotateSpeed = 3;
controls.keys = []; // its A/S/D modifier keys would clash with the move shortcuts
// Left mouse only turns layers; the view rotates with the right or middle button (touch: one finger on the background).
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE };
canvas.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault()); // no autoscroll on middle-drag

function fitCamera() {
  const n = cube.n;
  camera.position.set(0.9, 0.85, 1.35).normalize().multiplyScalar(3.2 * n + 1.5);
  camera.up.set(0, 1, 0);
  controls.target.set(0, 0, 0);
  controls.minDistance = n * 1.5;
  controls.maxDistance = n * 8 + 10;
  controls.update();
  arrow.update(camera);
}

// ---------- game logic ----------
function userTurn(turn) {
  if (live.on) return sendLive(() => postMoves([formatTurn(turn, 3)]));
  pushMerged(state.history, turn);
  state.redo = [];
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
  state.redo = [];
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
  state.redo = [];
  const wasRunning = state.running;
  if (wasRunning) state.t1 = performance.now();
  Object.assign(state, { scrambled: false, running: false });
  cube.enqueue(seq, seq.length > 40 ? 0.35 : 0.6);
  setMessage(wasRunning ? 'Auto-solved, so the timer was stopped.' : 'Auto-solving…');
  updateHud();
}

function undo(count = 1) {
  const seq = [];
  for (let i = 0; i < count && state.history.length; i++) {
    const t = state.history.pop();
    state.redo.push(t);
    seq.push(inverse(t));
  }
  if (!seq.length) return;
  cube.enqueue(seq, seq.length > 3 ? 0.5 : 1);
  updateHud();
}

function redo(count = 1) {
  const seq = [];
  for (let i = 0; i < count && state.redo.length; i++) {
    const t = state.redo.pop();
    state.history.push(t);
    seq.push(t);
  }
  if (!seq.length) return;
  cube.enqueue(seq, seq.length > 3 ? 0.5 : 1);
  updateHud();
}

function reset() {
  const resized = cube.n !== settings.size;
  cube.build(settings.size);
  Object.assign(state, { history: [], redo: [], moves: 0, scrambled: false, running: false, t0: 0, t1: 0 });
  if (resized) fitCamera();
  setMessage('');
  updateHud();
  saveCube();
}

const commands = Object.fromEntries(
  Object.entries({ scramble, solve, undo, redo, reset }).map(([k, fn]) => [k, () => (live.on ? liveCommand(k) : fn())]),
);

// In real-cube mode moves done on the page are recorded on the server, in order, like Claude's apply_moves; the
// page animates them when the server's event comes back, so it never shows a move the server didn't accept.
let liveQueue = Promise.resolve();
function sendLive(request) {
  if (live.painting) return setMessage('Close Paint to record moves.', 'error');
  setMessage('');
  liveQueue = liveQueue.then(request).catch((err) => setMessage(err.message, 'error'));
}

function liveCommand(name) {
  if (name === 'undo') sendLive(() => postUndo());
  if (name === 'redo') sendLive(() => postRedo());
}

// ---------- real-cube mode ----------
// The in-progress painting is kept in localStorage until the user presses Clear, sends it, or discards it, so a
// reload (or closing Paint) never loses it. MCP moves turn the painted cube too, so edits move with their layers.
const PAINT_KEY = 'rubiks-paint-v1';

function loadPaint() {
  try {
    const p = JSON.parse(localStorage.getItem(PAINT_KEY));
    if (!(p && /^[WYROGB]{54}$/.test(p.facelets) && (p.paintBase == null || /^[WYROGB]{54}$/.test(p.paintBase)))) return null;
    if (!/^[01]{54}$/.test(p.painted)) p.painted = null;
    return p;
  } catch {
    return null;
  }
}

function writePaint(record) {
  try {
    localStorage.setItem(PAINT_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable */
  }
}

function savePaint() {
  const facelets = live.painting && liveFacelets();
  if (facelets) {
    writePaint({ facelets, painted: cube.paintedMask(), paintBase: live.paintBase, paintColour: live.paintColour, draftSent: live.draftSent });
  }
}

function clearPaint() {
  try {
    localStorage.removeItem(PAINT_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Moves Claude applied while Paint was closed still turn the saved painting. */
function advanceSavedPaint(moves) {
  const rec = loadPaint();
  if (!rec) return;
  rec.facelets = applyMoves(rec.facelets, moves);
  if (rec.painted) rec.painted = applyMoves(rec.painted, moves); // permutes any characters
  if (rec.draftSent) rec.draftSent = applyMoves(rec.draftSent, moves); // the server turns its draft too
  if (rec.paintBase) rec.paintBase = applyMoves(rec.paintBase, moves);
  writePaint(rec);
}

function syncLive() {
  if (cube.busy) return;
  if (live.painting) {
    // never overwrite the user's painting; it has already turned with any moves
    savePaint();
    renderPaintCheck();
  } else if (live.snap && liveFacelets() !== live.snap.state) {
    showLive(live.snap.state);
  }
  updateArrow();
}

function onLiveEvent(ev) {
  live.snap = ev;
  renderPlan();
  if (ev.type === 'moves') {
    // Turn whatever is shown (server state or the painting), queued after any turns still animating.
    if (live.painting) {
      live.paintBase = live.paintBase ? applyMoves(live.paintBase, ev.moves) : ev.state;
      if (live.draftSent) live.draftSent = applyMoves(live.draftSent, ev.moves);
    } else advanceSavedPaint(ev.moves);
    cube.enqueue(parseSequence(ev.moves.join(' '), 3)); // syncLive() double-checks when the queue drains
    if (ev.solved) setMessage('Solved!', 'win');
    return;
  }
  if (live.painting) {
    if (ev.state === live.paintBase) return renderPaintCheck(); // e.g. a reconnect or a plan: nothing to repaint
    const page = liveFacelets();
    if (ev.type === 'state' && live.draftSent && page === live.draftSent && !cube.busy) {
      // Claude completed the unfinished cube we sent, and it hasn't been touched since: show Claude's version.
      live.draftSent = null;
      clearPaint();
      setPainting(false);
      return setMessage('Claude filled in your cube. Check it against your real one.', 'win');
    }
    // Unedited painting just follows the server; edits are only thrown away if the user says so.
    if (live.conflict || page !== live.paintBase) return showConflict(true);
    live.paintBase = ev.state;
  }
  if (!cube.busy) {
    if (liveFacelets() !== ev.state) showLive(ev.state);
    if (live.painting) {
      savePaint();
      renderPaintCheck();
    }
  }
  updateArrow();
}

function showConflict(on) {
  live.conflict = on;
  $('remote-changed').hidden = !on;
}

/** The plan's current move, or null when there is nothing to show. */
function currentMove() {
  const snap = live.on && live.snap;
  return snap?.plan && snap.step < snap.plan.length ? snap.plan[snap.step] : null;
}

function updateArrow() {
  arrow.show(!live.painting && !cube.busy ? currentMove() : null);
}

function renderPlan() {
  const el = $('plan');
  el.replaceChildren();
  const snap = live.on && live.snap;
  const hint = $('plan-hint');
  hint.textContent = '';
  // Same words as the MCP "Hold:" line: the page's front is the face you hold towards you.
  $('hold').textContent = snap?.state ? `Hold: ${holding(snap.state)}` : '';
  updateArrow();
  renderLiveButtons();
  if (!snap?.plan) return;
  snap.plan.forEach((m, i) => {
    const span = document.createElement('span');
    span.textContent = m;
    span.className = i < snap.step ? 'done' : i === snap.step ? 'current' : '';
    // Clicking a step goes to it: a done step becomes the next one again, a later one is jumped to, and the
    // current one is marked done (like the Done button).
    const to = i === snap.step ? i + 1 : i;
    const label = snap.labels?.[i];
    if (label && (i === 0 || snap.labels[i - 1] !== label)) span.dataset.label = label;
    span.title = `${label ? `${label}: ` : ''}${hintText(m)}. Click: ${i < snap.step ? 'go back to this move' : i === snap.step ? 'mark as done' : 'skip ahead to this move'}`;
    span.addEventListener('click', () => sendLive(() => postGoto(to)));
    el.append(span);
  });
  const next = currentMove();
  const label = snap.labels?.[snap.step];
  if (next) hint.textContent = `${label ? `${label} · ` : ''}→ ${next}: ${hintText(next)}`;
}

function renderLiveButtons() {
  const next = currentMove();
  const done = $('plan-next');
  done.hidden = !next || live.painting;
  done.textContent = next ? `Done: ${next}` : '';
  done.title = next ? `Record that you did ${next} on your cube (${hintText(next)})` : '';
  const snap = live.on && live.snap;
  const back = $('plan-prev');
  back.hidden = !snap?.plan || !snap.step || live.painting;
  back.title = back.hidden ? '' : `Go back one step: undo ${snap.plan[snap.step - 1]} on your cube`;
  renderUndoButtons();
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
    setMessage('Real-cube mode: paint your cube, send it, then ask Claude to solve it. Turns you make here are recorded as moves on your real cube.');
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

/** Open or close Paint. Opening restores the saved painting unless `fresh` (Clear, import). */
function setPainting(on, { fresh = false } = {}) {
  live.painting = on;
  live.draftSent = null;
  showConflict(false);
  document.body.classList.toggle('painting', on);
  $('paint-toggle').classList.toggle('active', on);
  if (on) {
    const rec = !fresh && loadPaint();
    const server = live.snap?.state;
    if (rec && server && rec.paintBase !== server && rec.facelets === rec.paintBase) {
      clearPaint(); // an unedited painting of an old state: start from the server's instead
      live.paintBase = server;
      if (!cube.busy) showLive(server);
    } else if (rec) {
      showLive(rec.facelets); // drops any queued turns: the saved painting already includes them
      cube.setPaintedMask(rec.painted);
      live.draftSent = rec.draftSent ?? null;
      live.paintBase = rec.paintBase ?? server ?? null;
      if (COLOURS.includes(rec.paintColour)) live.paintColour = rec.paintColour;
      renderPalette();
      if (server && live.paintBase !== server) showConflict(true); // the server changed while Paint was closed
    } else {
      live.paintBase = server ?? liveFacelets();
    }
    setMessage('Paint: pick a colour, tap stickers. Front = the face pointing at you in the default view.');
  } else {
    live.paintBase = null;
    if (live.on) syncLive();
  }
  renderPaintCheck();
  updateArrow();
  renderLiveButtons();
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
    dot.style.background = settings.palette[c];
    chip.append(dot, String(counts[c]));
    return chip;
  });
  const msg = document.createElement('span');
  msg.className = errors.length ? 'problem' : 'ok';
  msg.textContent = errors.length ? errors[0] : 'Looks like a real cube. Ready to send.';
  box.replaceChildren(...chips, msg);
  // An unfinished cube can still go to Claude as a draft: Claude sees it next to the real state and helps fill it in.
  $('send').textContent = errors.length ? 'Send unfinished to Claude' : 'Send to Claude';
  $('send').title = errors.length
    ? 'Claude sees this painting (and which stickers you painted) and helps you work out the rest. Your cube stays as it is until then.'
    : '';
}

function renderPalette() {
  const box = $('palette');
  box.replaceChildren();
  for (const c of COLOURS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = COLOUR_NAMES[c];
    b.style.background = settings.palette[c];
    b.classList.toggle('selected', live.paintColour === c);
    b.addEventListener('click', () => {
      live.paintColour = c;
      renderPalette();
      savePaint();
    });
    box.append(b);
  }
}

$('live-toggle').addEventListener('click', () => setLive(!live.on));
$('plan-prev').addEventListener('click', () => {
  const snap = live.snap;
  if (snap?.plan && snap.step > 0) sendLive(() => postGoto(snap.step - 1));
});
$('plan-next').addEventListener('click', () => {
  const next = currentMove();
  if (next) sendLive(() => postMoves([next]));
});
$('paint-toggle').addEventListener('click', () => setPainting(!live.painting));
$('paint-clear').addEventListener('click', () => {
  clearPaint();
  cube.build(3);
  setPainting(true, { fresh: true });
});
$('remote-discard').addEventListener('click', () => {
  clearPaint(); // the user chose to throw the edits away
  setPainting(false); // shows the server's state
});
$('remote-keep').addEventListener('click', () => showConflict(false));

// Once an unfinished painting has gone to Claude, later strokes follow it automatically (debounced), so Claude
// always sees what the page shows. A painting that becomes a valid cube is not auto-sent: Send commits it.
const draftSync = { timer: 0, busy: false, again: false, warnedComplete: false };
function scheduleDraftSync() {
  if (!live.draftSent) return;
  clearTimeout(draftSync.timer);
  draftSync.timer = setTimeout(syncDraft, 700);
}
async function syncDraft() {
  if (draftSync.busy) return void (draftSync.again = true);
  const facelets = live.painting && live.draftSent && !live.conflict && liveFacelets();
  if (!facelets || facelets === live.draftSent) return;
  if (!validate(facelets).length) {
    if (!draftSync.warnedComplete) toast('Looks complete. Press Send to Claude to use it.', 'info');
    draftSync.warnedComplete = true;
    return;
  }
  draftSync.warnedComplete = false;
  draftSync.busy = true;
  try {
    await postDraft(facelets, cube.paintedMask());
    if (live.draftSent) live.draftSent = facelets; // still a draft (not closed or replaced meanwhile)
    savePaint();
    toast('In sync with Claude', 'ok');
  } catch (err) {
    toast(`Couldn't sync: ${err.message}`, 'error');
  } finally {
    draftSync.busy = false;
    if (draftSync.again) {
      draftSync.again = false;
      syncDraft();
    }
  }
}

let toastTimer = 0;
function toast(text, kind = 'ok') {
  const el = $('toast');
  el.textContent = kind === 'ok' ? `✓ ${text}` : text;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = kind), 2200);
}
$('send').addEventListener('click', async () => {
  const facelets = liveFacelets();
  const painted = cube.paintedMask();
  if (!facelets) return;
  if (validate(facelets).length) {
    try {
      await postDraft(facelets, painted);
      live.draftSent = facelets;
      savePaint(); // Paint stays open: the painting is still the user's until Claude sends a complete cube
      setMessage('Sent as unfinished. Keep painting: changes sync to Claude automatically. Ask Claude to help fill in the rest.', 'win');
      toast('In sync with Claude', 'ok');
    } catch (err) {
      setMessage(err.message, 'error');
    }
    return;
  }
  const base = live.paintBase;
  live.paintBase = facelets; // the server's echo of this state is not a conflicting change
  try {
    await postState(facelets);
    clearPaint();
    setPainting(false);
    setMessage('Sent. Now ask Claude to help you solve it.', 'win');
  } catch (err) {
    live.paintBase = base;
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
  // Done moves, then undone ones (faded) that Redo would bring back. Clicking one goes back or forward to just after it.
  const el = $('history');
  el.replaceChildren();
  if (live.on) return renderUndoButtons();
  const h = state.history;
  const r = [...state.redo].reverse(); // next to redo first
  const MAX = 16;
  const shownRedo = r.slice(0, Math.min(r.length, 6));
  const shownDone = h.slice(-(MAX - shownRedo.length));
  if (shownDone.length < h.length) el.append('…');
  shownDone.forEach((t, k) => {
    const i = h.length - shownDone.length + k;
    const span = document.createElement('span');
    span.textContent = formatTurn(t, cube.n);
    span.title = i === h.length - 1 ? 'Last move. Click to undo it' : 'Click to go back to just after this move';
    span.addEventListener('click', () => (i === h.length - 1 ? undo() : undo(h.length - 1 - i)));
    el.append(span);
  });
  shownRedo.forEach((t, k) => {
    const span = document.createElement('span');
    span.className = 'redo';
    span.textContent = formatTurn(t, cube.n);
    span.title = 'Undone. Click to redo up to this move';
    span.addEventListener('click', () => redo(k + 1));
    el.append(span);
  });
  if (shownRedo.length < r.length) el.append('…');
  renderUndoButtons();
}

function renderUndoButtons() {
  const undoBtn = document.querySelector('[data-cmd="undo"]');
  const redoBtn = document.querySelector('[data-cmd="redo"]');
  undoBtn.disabled = live.on ? !live.snap?.canUndo : !state.history.length;
  redoBtn.disabled = live.on ? !live.snap?.canRedo : !state.redo.length;
  undoBtn.title = live.on ? "Undo the last recorded move(s), yours or Claude's (Ctrl+Z)" : 'Undo (Ctrl+Z)';
  redoBtn.title = live.on ? 'Redo what was undone (Ctrl+Y)' : 'Redo (Ctrl+Y or Ctrl+Shift+Z)';
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
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = e.key.toLowerCase();
    const cmd = k === 'z' ? (e.shiftKey ? 'redo' : 'undo') : k === 'y' ? 'redo' : null;
    if (cmd) {
      e.preventDefault();
      commands[cmd]();
    }
    return;
  }
  if (e.altKey) return;

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
  cube.setColors(faceColors(settings), settings.body);
  scene.background = new THREE.Color(settings.background);
  document.documentElement.style.setProperty('--bg', settings.background);
  renderPalette();
  renderPaintCheck();
}

const solvedColours = (c) => !!c && [0, 1, 2, 3, 4, 5].every((f) => /^(.)\1{8}$/.test(c.slice(f * 9, f * 9 + 9)));

/**
 * Change which colour is on which face. The virtual cube keeps its pieces, so its colours change.
 * In real-cube mode the stickers shown are the real cube's: when that cube is solved (e.g. you just set up the page
 * for a Japanese cube), Paint opens with a solved cube in the new scheme, ready to send; otherwise the stickers stay
 * and only Paint → Clear starts from the new scheme.
 */
function setScheme(scheme) {
  if (!isScheme(scheme)) return;
  cube.flush();
  const colours = live.on ? liveFacelets() : null;
  settings.scheme = { ...scheme };
  save();
  applyColors();
  renderScheme();
  if (!live.on) return;
  const name = SCHEMES[presetOf(scheme)]?.label ?? 'custom-scheme';
  if (solvedColours(colours)) {
    clearPaint();
    cube.build(3); // solved, drawn in the new scheme
    setPainting(true, { fresh: true });
    savePaint();
    setMessage(`Showing a solved ${name} cube. Press Send to Claude to use it, or close Paint to go back.`);
  } else {
    if (colours) showLive(colours);
    setMessage(`Your cube isn't solved, so its stickers stay as they are. Paint → Clear now starts from a solved ${name} cube.`);
  }
}

function renderScheme() {
  const box = $('scheme');
  box.replaceChildren();
  const preset = document.createElement('select');
  preset.id = 'scheme-preset';
  for (const [id, { label }] of Object.entries(SCHEMES)) preset.append(new Option(label, id));
  preset.append(new Option('Custom', 'custom'));
  preset.value = presetOf(settings.scheme);
  preset.addEventListener('change', () => {
    if (SCHEMES[preset.value]) setScheme(SCHEMES[preset.value].scheme);
  });
  const field = document.createElement('label');
  field.className = 'field';
  const title = document.createElement('span');
  title.textContent = 'Preset';
  field.append(title, preset);

  const faces = document.createElement('div');
  faces.className = 'grid scheme-faces';
  for (const f of FACE_KEYS) {
    const l = document.createElement('label');
    l.className = 'swatch';
    const dot = document.createElement('i');
    dot.style.background = settings.palette[settings.scheme[f]];
    const sel = document.createElement('select');
    for (const c of COLOURS) sel.append(new Option(COLOUR_NAMES[c], c));
    sel.value = settings.scheme[f];
    sel.title = `Colour on the ${FACE_NAMES[f].toLowerCase()} face of the solved cube`;
    sel.addEventListener('change', () => {
      // keep it one colour per face: the face that had this colour takes this face's old one
      const other = keyOf(sel.value);
      setScheme({ ...settings.scheme, [f]: sel.value, [other]: settings.scheme[f] });
    });
    l.append(dot, FACE_NAMES[f], sel);
    faces.append(l);
  }
  const note = document.createElement('small');
  note.textContent = 'Which colour is on which face of the solved cube. In real-cube mode Claude reads your cube\'s scheme from its centres; this sets the colours Paint → Clear starts from.';
  box.append(field, faces, note);
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
      renderScheme();
      save();
    });
    l.append(i, label);
    box.append(l);
  };
  for (const c of COLOURS) {
    const name = COLOUR_NAMES[c];
    add(name[0].toUpperCase() + name.slice(1), settings.palette[c], (v) => (settings.palette[c] = v));
  }
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
  renderScheme();
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
  controls.handleResize();
}
new ResizeObserver(resize).observe(canvas);

renderer.setAnimationLoop((now) => {
  cube.update(now);
  controls.update();
  arrow.update(camera);
  updateHighlight();
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
    parsed = parseState(text, settings.scheme);
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
    setPainting(true, { fresh: true });
    savePaint();
    setMessage('Loaded. Check it against your cube, then press Send to Claude.');
    return true;
  }
  const resized = cube.n !== size;
  settings.size = size;
  save();
  cube.setFacelets(facelets, size);
  Object.assign(state, { history: [], redo: [], moves: 0, running: false, t0: 0, t1: 0, scrambled: !cube.isSolved() });
  if (resized) fitCamera();
  syncInputs();
  updateHud();
  saveCube();
  setMessage(`Loaded a ${size}×${size} cube.${state.scrambled ? ' The timer starts on your first move.' : ''}`, 'win');
  return true;
}

$('copy-text').addEventListener('click', () => {
  const f = currentState();
  if (f) copy(encodeState(cube.n, f, settings.scheme), 'Cube text');
});
$('copy-link').addEventListener('click', () => {
  const f = currentState();
  if (f) copy(stateLink(cube.n, f, location.href, settings.scheme), 'Link');
});
$('download').addEventListener('click', () => {
  const f = currentState();
  if (!f) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([stateToJson(cube.n, f, settings.scheme)], { type: 'application/json' }));
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
    parsed = parseState(`${saved.size}:${saved.facelets}`, settings.scheme);
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
    redo: [],
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
  if (ok && saved?.live && !live.on) {
    setLive(true);
    if (loadPaint()) setPainting(true); // painting in progress before the reload
  }
});

// A shared link (#state=…) loads that cube once, then the hash is dropped so a reload doesn't undo progress.
if (location.hash.startsWith('#state=')) {
  importState(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
}

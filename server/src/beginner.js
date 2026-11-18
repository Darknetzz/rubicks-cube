// Beginner (layer-by-layer) method, one stage at a time, as the user holds the cube.
// The cross and first-layer corners are built with the cross colour on top (corners go in with R' D' R D from
// below); for the middle layer and the last layer the cross colour faces down. When the cube is not held that way,
// the stage starts with a whole-cube rotation, so every move is in the user's own frame.
import { FACES, GEOMETRY, applyMoves, permutation } from '../../js/facelets.js';
import { CENTRES, COLOUR_NAMES, OPPOSITE_FACE } from '../../js/validate.js';

export const STAGES = [
  { id: 'cross', name: 'cross', crossOn: 'U' },
  { id: 'first-layer-corners', name: 'first-layer corners', crossOn: 'U' },
  { id: 'middle-layer-edges', name: 'middle-layer edges', crossOn: 'D' },
  { id: 'last-layer-cross', name: 'last-layer cross', crossOn: 'D' },
  { id: 'last-layer-orientation', name: 'orient last layer', crossOn: 'D' },
  { id: 'last-layer-permutation', name: 'permute last layer', crossOn: 'D' },
];
export const STAGE_IDS = STAGES.map((s) => s.id);

const faceOf = (i) => FACES[Math.floor(i / 9)];
const centre = (s, f) => s[CENTRES[FACES.indexOf(f)]];
const faceWith = (s, c) => [...FACES].find((f) => centre(s, f) === c);
const nm = (cols) => cols.map((c) => COLOUR_NAMES[c]).join('-');

const CUBIES = (() => {
  const m = new Map();
  GEOMETRY.forEach(({ p }, i) => {
    const k = p.join();
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  });
  return [...m.values()].filter((st) => st.length > 1);
})();
const EDGES = CUBIES.filter((c) => c.length === 2);
const CORNERS = CUBIES.filter((c) => c.length === 3);

const locate = (s, cols) =>
  CUBIES.find((c) => c.length === cols.length && cols.every((x) => c.some((i) => s[i] === x)));
const cubieSolved = (s, c) => c.every((i) => s[i] === centre(s, faceOf(i)));
const pieceSolved = (s, cols) => cubieSolved(s, locate(s, cols));
const onFace = (c, f) => c.some((i) => faceOf(i) === f);
const sideFaces = (c) => c.map(faceOf).filter((f) => f !== 'U' && f !== 'D');
const RING = ['F', 'R', 'B', 'L']; // clockwise seen from the top: the right-hand neighbour of each face is next
const rightOf = (f) => RING[(RING.indexOf(f) + 1) % 4];
/** Front and right face of the vertical slot a cubie sits in. */
const slotOf = (c) => {
  const [a, b] = sideFaces(c);
  return rightOf(a) === b ? [a, b] : [b, a];
};
/** An algorithm written for the front face F, re-aimed at `front` (the cube turned about the vertical axis). */
const aim = (alg, front) => {
  const k = RING.indexOf(front);
  return alg.split(' ').map((m) => (RING.includes(m[0]) ? RING[(RING.indexOf(m[0]) + k) % 4] + m.slice(1) : m));
};

/** The pieces of each stage, named by colour (the centres decide which face is which). */
function pieces(s, X) {
  const cf = faceWith(s, X);
  const lf = OPPOSITE_FACE[cf];
  const Y = centre(s, lf);
  const sides = [...FACES].filter((f) => f !== cf && f !== lf);
  const pairs = [];
  sides.forEach((a, i) => sides.slice(i + 1).forEach((b) => OPPOSITE_FACE[a] !== b && pairs.push([a, b])));
  const col = (f) => centre(s, f);
  return {
    cf, lf, Y,
    crossEdges: sides.map((f) => [X, col(f)]),
    corners: pairs.map(([a, b]) => [X, col(a), col(b)]),
    middle: pairs.map(([a, b]) => [col(a), col(b)]),
    llEdges: sides.map((f) => [Y, col(f)]),
  };
}

const CHECKS = [
  (s, p) => p.crossEdges.every((e) => pieceSolved(s, e)),
  (s, p) => p.corners.every((c) => pieceSolved(s, c)),
  (s, p) => p.middle.every((e) => pieceSolved(s, e)),
  (s, p) => p.llEdges.every((e) => locate(s, e).some((i) => s[i] === p.Y && faceOf(i) === p.lf)),
  (s, p) => [...s.slice(FACES.indexOf(p.lf) * 9, FACES.indexOf(p.lf) * 9 + 9)].every((c) => c === p.Y),
  (s) => [0, 1, 2, 3, 4, 5].every((f) => /^(.)\1{8}$/.test(s.slice(f * 9, f * 9 + 9))),
];

/** Which stages are done for cross colour X: array of booleans in STAGES order. */
export function stagesDone(s, X) {
  const p = pieces(s, X);
  return CHECKS.map((ok) => ok(s, p));
}

/** Number of stages done in a row from the start. */
export function progress(s, X) {
  const done = stagesDone(s, X);
  const n = done.indexOf(false);
  return n === -1 ? done.length : n;
}

const ROTATIONS = ['', 'x', "x'", 'z', "z'", 'z2', 'x2'];
const rotationTo = (s, X, face) => ROTATIONS.find((r) => centre(r ? applyMoves(s, r) : s, face) === X);

// ---------- cross: per edge, the shortest sequence that places it and keeps the cross edges already placed ----------

const MOVES = [...FACES].flatMap((f) => [f, `${f}'`, `${f}2`]);
const distCache = new Map();
function distTo(home) {
  if (!distCache.has(home)) {
    const d = new Map([[home, 0]]);
    for (let q = [home]; q.length;) {
      const next = [];
      for (const i of q) for (const m of MOVES) {
        const j = permutation(m)[i];
        if (!d.has(j)) { d.set(j, d.get(i) + 1); next.push(j); }
      }
      q = next;
    }
    distCache.set(home, d);
  }
  return distCache.get(home);
}

/** Moves taking the stickers at `pos` to `homes` (IDA*, each sticker tracked by its facelet index). */
function placeStickers(pos, homes) {
  const tables = homes.map(distTo);
  const h = (p) => Math.max(...p.map((x, k) => tables[k].get(x)));
  const path = [];
  const dfs = (p, g, bound, last) => {
    const hv = h(p);
    if (hv === 0) return true;
    if (g + hv > bound) return false;
    for (const m of MOVES) {
      const f = m[0];
      if (last && (f === last || (OPPOSITE_FACE[f] === last && FACES.indexOf(f) < FACES.indexOf(last)))) continue;
      path.push(m);
      if (dfs(p.map((x) => permutation(m)[x]), g + 1, bound, f)) return true;
      path.pop();
    }
    return false;
  };
  for (let bound = h(pos); bound <= 14; bound++) if (dfs(pos, 0, bound, null)) return path;
  throw new Error('cross search failed (bug)');
}

function crossStage(s, X, out) {
  const edges = pieces(s, X).crossEdges;
  const sticker = (st, e) => locate(st, e).find((i) => st[i] === X);
  const home = (e) => EDGES.flatMap((c) => c).find((i) => {
    const c = EDGES.find((x) => x.includes(i));
    const other = c.find((j) => j !== i);
    return faceOf(i) === 'U' && centre(s, faceOf(other)) === e[1];
  });
  for (;;) {
    const done = edges.filter((e) => pieceSolved(s, e));
    const todo = edges.filter((e) => !done.includes(e));
    if (!todo.length) return s;
    let best = null;
    for (const e of todo) {
      const set = [...done, e];
      const moves = placeStickers(set.map((x) => sticker(s, x)), set.map(home));
      if (!best || moves.length < best.moves.length) best = { e, moves };
    }
    s = out(s, best.moves, `cross: ${nm(best.e)} edge`);
  }
}

// ---------- first-layer corners (cross on top): bring the corner below its slot, repeat R' D' R D ----------

const trigger = (front) => aim("R' D' R D", front);

function cornerStage(s, X, out) {
  const corners = pieces(s, X).corners;
  for (;;) {
    const todo = corners.filter((c) => !pieceSolved(s, c));
    if (!todo.length) return s;
    const cols = todo.find((c) => onFace(locate(s, c), 'D')) ?? todo[0];
    const name = `${nm(cols)} corner`;
    const target = CORNERS.find((c) => onFace(c, 'U') && cols.slice(1).every((x) => c.some((i) => faceOf(i) !== 'U' && centre(s, faceOf(i)) === x)));
    const [tf, tr] = slotOf(target);
    let c = locate(s, cols);
    if (onFace(c, 'U')) {
      const [f, r] = slotOf(c);
      s = out(s, trigger(f), `take the ${name} out: ${r}' D' ${r} D`);
      c = locate(s, cols);
    }
    const d = ['', 'D', 'D2', "D'"].find((m) => {
      const [f] = slotOf(locate(m ? applyMoves(s, m) : s, cols));
      return f === tf;
    });
    if (d) s = out(s, [d], `move the ${name} below its slot`);
    let n = 0;
    for (let t = s; !pieceSolved(t, cols); n++) {
      if (n === 6) throw new Error('corner insertion failed (bug)');
      t = applyMoves(t, trigger(tf).join(' '));
    }
    for (let k = 1; k <= n; k++) s = out(s, trigger(tf), `insert ${name}: ${tr}' D' ${tr} D, repeat ${k}/${n}`);
  }
}

// ---------- middle-layer edges (cross on the bottom) ----------

const RIGHT_ALG = "U R U' R' U' F' U F";
const LEFT_ALG = "U' L' U L U F U' F'";

function middleStage(s, X, out) {
  const edges = pieces(s, X).middle;
  for (;;) {
    const todo = edges.filter((e) => !pieceSolved(s, e));
    if (!todo.length) return s;
    const cols = todo.find((e) => onFace(locate(s, e), 'U')) ?? todo[0];
    const c = locate(s, cols);
    if (!onFace(c, 'U')) {
      const [f] = slotOf(c);
      const alg = aim(RIGHT_ALG, f);
      s = out(s, alg, `take the ${nm(cols)} edge out: ${alg.join(' ')}`);
    }
    let front = null;
    const u = ['', 'U', 'U2', "U'"].find((m) => {
      const t = m ? applyMoves(s, m) : s;
      const side = locate(t, cols).find((i) => faceOf(i) !== 'U');
      front = faceOf(side);
      return t[side] === centre(t, front);
    });
    if (u) s = out(s, [u], `line up the ${nm(cols)} edge with its centre`);
    const c2 = locate(s, cols);
    const top = s[c2.find((i) => faceOf(i) === 'U')];
    const side = s[c2.find((i) => faceOf(i) !== 'U')];
    const right = centre(s, rightOf(front)) === top;
    const alg = aim(right ? RIGHT_ALG : LEFT_ALG, front);
    s = out(s, alg, `insert ${nm([side, top])} edge ${right ? 'right' : 'left'}: ${alg.join(' ')}`);
  }
}

// ---------- last layer (cross on the bottom): algorithms with a top-layer turn before each ----------

const AUF = ['', 'U', 'U2', "U'"];

/**
 * Fewest algorithms (each after an optional U turn), then fewest moves, reaching `goal`; with `finalAuf` a last U
 * turn may follow. Returns [{ pre, alg }] plus { auf }.
 */
function searchAlgs(s, algs, goal, maxAlgs, finalAuf = false) {
  for (let d = 0; d <= maxAlgs; d++) {
    let best = null;
    const walk = (t, seq, len) => {
      if (seq.length === d) {
        for (const a of finalAuf ? AUF : ['']) {
          const end = a ? applyMoves(t, a) : t;
          const total = len + (a ? 1 : 0);
          if (goal(end) && (!best || total < best.total)) best = { seq: [...seq], auf: a, total };
        }
        return;
      }
      for (const pre of AUF) for (const alg of algs) {
        const t2 = applyMoves(t, `${pre} ${alg.moves}`);
        walk(t2, [...seq, { pre, alg }], len + (pre ? 1 : 0) + alg.moves.split(' ').length);
      }
    };
    walk(s, [], 0);
    if (best) return best;
  }
  throw new Error('last-layer search failed (bug)');
}

function runAlgs(s, found, out, setupLabel) {
  for (const { pre, alg } of found.seq) {
    if (pre) s = out(s, [pre], setupLabel(alg));
    s = out(s, alg.moves.split(' '), `${alg.name}: ${alg.moves}`);
  }
  if (found.auf) s = out(s, [found.auf], 'turn the top layer to finish');
  return s;
}

const topEdgesOk = (s, Y) => EDGES.filter((c) => onFace(c, 'U')).filter((c) => c.some((i) => faceOf(i) === 'U' && s[i] === Y)).length;
function crossShape(s, Y) {
  const ok = ['UB', 'UR', 'UF', 'UL'].map((_, k) => s[[1, 5, 7, 3][k]] === Y);
  const n = ok.filter(Boolean).length;
  if (n === 0) return 'dot';
  if (n === 4) return 'cross';
  return ok[0] === ok[2] ? 'line' : 'L shape';
}

function llCrossStage(s, X, out) {
  const { Y } = pieces(s, X);
  const name = COLOUR_NAMES[Y];
  const algs = [{ name: `${name} cross`, moves: "F R U R' U' F'" }];
  const found = searchAlgs(s, algs, (t) => topEdgesOk(t, Y) === 4, 3);
  for (const { pre, alg } of found.seq) {
    const shape = crossShape(s, Y);
    if (pre) s = out(s, [pre], `turn the top: ${shape} into position`);
    s = out(s, alg.moves.split(' '), `${name} cross from ${crossShape(s, Y)}: ${alg.moves}`);
  }
  return s;
}

function orientStage(s, X, out) {
  const { Y } = pieces(s, X);
  const algs = [{ name: 'orient corners (Sune)', moves: "R U R' U R U2 R'" }];
  const found = searchAlgs(s, algs, (t) => [...t.slice(0, 9)].every((c) => c === Y), 3);
  return runAlgs(s, found, out, () => 'turn the top to set up the Sune');
}

const A_PERM = { name: 'swap corners (A-perm)', moves: "R' F R' B2 R F' R' B2 R2" };
const U_PERMS = [
  { name: 'cycle edges (Ua-perm)', moves: "R U' R U R U R U' R' U' R2" },
  { name: 'cycle edges (Ub-perm)', moves: "R2 U R U R' U' R' U' R' U R'" },
];
const TOP_CORNERS = CORNERS.filter((c) => onFace(c, 'U'));
const cornersRelative = (t) => AUF.some((a) => TOP_CORNERS.every((c) => cubieSolved(a ? applyMoves(t, a) : t, c)));

function permuteStage(s, X, out) {
  s = runAlgs(s, searchAlgs(s, [A_PERM], cornersRelative, 2), out, () => 'turn the top to set up the A-perm');
  const solved = CHECKS[5];
  return runAlgs(s, searchAlgs(s, U_PERMS, solved, 3, true), out, () => 'turn the top to set up the U-perm');
}

const SOLVERS = [crossStage, cornerStage, middleStage, llCrossStage, orientStage, permuteStage];

/**
 * Plan one stage. `stage` is a stage id (default: the first one not done), `X` the cross colour letter.
 * Returns { stage, steps: [{ move, label }], after, alreadyDone, next } — when the requested stage is already done,
 * steps is empty and `next` names the first stage not done. Throws when an earlier stage is not done.
 */
export function planStage(state, X, stage = null) {
  if (!faceWith(state, X)) throw new Error(`No face has a ${COLOUR_NAMES[X] ?? X} centre.`);
  const done = stagesDone(state, X);
  const firstOpen = done.indexOf(false);
  const nextId = firstOpen === -1 ? null : STAGES[firstOpen].id;
  const k = stage ? STAGE_IDS.indexOf(stage) : firstOpen;
  if (stage && k === -1) throw new Error(`Unknown stage "${stage}". Stages: ${STAGE_IDS.join(', ')}.`);
  if (k === -1) return { stage: null, steps: [], after: state, alreadyDone: true, next: null };
  if (done[k]) return { stage: STAGES[k], steps: [], after: state, alreadyDone: true, next: nextId };
  if (k > firstOpen) {
    throw new Error(`Stage "${STAGES[k].id}" needs the earlier stages done first; "${nextId}" is not done yet.`);
  }
  const steps = [];
  const out = (s, moves, label) => {
    for (const move of moves) steps.push({ move, label: label.slice(0, 80) });
    return applyMoves(s, moves.join(' '));
  };
  let s = state;
  const rot = rotationTo(s, X, STAGES[k].crossOn);
  if (rot) {
    const where = STAGES[k].crossOn === 'U' ? 'top' : 'bottom';
    s = out(s, rot.split(' '), `turn the whole cube: ${COLOUR_NAMES[X]} centre to the ${where}`);
  }
  s = SOLVERS[k](s, X, out);
  if (!stagesDone(s, X).slice(0, k + 1).every(Boolean)) throw new Error(`Stage "${STAGES[k].id}" failed (bug).`);
  return { stage: STAGES[k], steps, after: s, alreadyDone: false, next: nextId };
}

/**
 * Default cross colour: the colour whose layer-by-layer solve is furthest along (so after turning the cube over for
 * the last layer it is still the cross colour); ties go to `preferred` (the colour used last), then the top centre,
 * then the bottom one.
 */
export function defaultCrossColour(state, preferred = null) {
  const order = [preferred, centre(state, 'U'), centre(state, 'D'), ...[...FACES].map((f) => centre(state, f))]
    .filter((c, i, a) => c && faceWith(state, c) && a.indexOf(c) === i);
  let best = order[0];
  for (const c of order) if (progress(state, c) > progress(state, best)) best = c;
  return best;
}

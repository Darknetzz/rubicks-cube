// Exact shortest solutions (half-turn metric) by IDA*, for cubes a few moves from solved.
// It reuses cubejs's coordinate move tables and phase-1 pruning tables (after Cube.initSolver()), plus a few small
// distance tables built here once. Every heuristic is a lower bound on the full solve, so the first solution IDA*
// finds is optimal. A deadline stops it; the caller then knows no solution shorter than `provenDepth + 1` exists.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Cube = require('../vendor/cubejs/cube.js');
require('../vendor/cubejs/solve.js');

const FACE_NAMES = 'URFDLB';
const POWER = ['', '2', "'"];
const N_SLICE1 = 495;
const N_UBtoDF = 1320;
const TIMEOUT = Symbol('timeout');

let T = null; // tables, built by init()

/** Breadth-first distance from `start` over all 18 moves, for a coordinate with `size` values. */
function bfs(size, start, step) {
  const dist = new Uint8Array(size).fill(255);
  dist[start] = 0;
  let frontier = [start];
  for (let depth = 0; frontier.length; depth++) {
    const next = [];
    for (const i of frontier) {
      for (let m = 0; m < 18; m++) {
        const j = step(i, m);
        if (dist[j] === 255) {
          dist[j] = depth + 1;
          next.push(j);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

// cubejs packs its pruning tables as 4-bit entries, 8 per number.
const nibble = (table, index) => (table[index >> 3] >>> ((index & 7) << 2)) & 0xf;

/** Build the tables (needs cubejs's own tables; calls Cube.initSolver() if needed). Takes well under a second. */
export function initShortSearch() {
  if (T) return;
  Cube.initSolver();
  const mt = Cube.moveTables;
  const solved = new Cube();
  const goal = {
    twist: solved.twist(), flip: solved.flip(), FRtoBR: solved.FRtoBR(), URFtoDLF: solved.URFtoDLF(),
    URtoUL: solved.URtoUL(), UBtoDF: solved.UBtoDF(), parity: solved.cornerParity(),
  };
  T = {
    mt,
    goal,
    sliceTwist: Cube.pruningTables.sliceTwist,
    sliceFlip: Cube.pruningTables.sliceFlip,
    corners: bfs(mt.URFtoDLF.length, goal.URFtoDLF, (i, m) => mt.URFtoDLF[i][m]),
    slice: bfs(mt.FRtoBR.length, goal.FRtoBR, (i, m) => mt.FRtoBR[i][m]),
    // the six U/D-layer edges UR UF UL (URtoUL) and UB DR DF (UBtoDF) together
    edges: bfs(mt.URtoUL.length * N_UBtoDF, goal.URtoUL * N_UBtoDF + goal.UBtoDF,
      (i, m) => mt.URtoUL[(i / N_UBtoDF) | 0][m] * N_UBtoDF + mt.UBtoDF[i % N_UBtoDF][m]),
  };
}

function lowerBound(tw, fl, fr, co, ul, ub) {
  const sl = (fr / 24) | 0;
  let h = nibble(T.sliceTwist, N_SLICE1 * tw + sl);
  const a = nibble(T.sliceFlip, N_SLICE1 * fl + sl);
  if (a > h) h = a;
  const b = T.corners[co];
  if (b > h) h = b;
  const c = T.slice[fr];
  if (c > h) h = c;
  const d = T.edges[ul * N_UBtoDF + ub];
  return d > h ? d : h;
}

/**
 * Shortest solution of a cube given as 54 face letters (Kociemba order, standard centres), or as close as the
 * deadline (a performance.now() time) allows.
 * Returns { moves } (optimal) or { moves: null, provenDepth } where no solution of provenDepth moves or fewer exists.
 */
export function shortSolve(faces, deadline, maxDepth = 20) {
  initShortSearch();
  const { mt, goal } = T;
  const c = Cube.fromString(faces);
  const start = [c.twist(), c.flip(), c.FRtoBR(), c.URFtoDLF(), c.URtoUL(), c.UBtoDF(), c.cornerParity()];
  const path = [];
  let nodes = 0;

  function dfs(tw, fl, fr, co, ul, ub, pa, left, lastFace) {
    if (left === 0) {
      return tw === goal.twist && fl === goal.flip && fr === goal.FRtoBR && co === goal.URFtoDLF &&
        ul === goal.URtoUL && ub === goal.UBtoDF && pa === goal.parity;
    }
    if ((++nodes & 4095) === 0 && performance.now() > deadline) throw TIMEOUT;
    for (let m = 0; m < 18; m++) {
      const face = (m / 3) | 0;
      // never the same face twice in a row; opposite faces only in one order (U before D, R before L, F before B)
      if (face === lastFace || (lastFace >= 0 && face % 3 === lastFace % 3 && face < lastFace)) continue;
      const ntw = mt.twist[tw][m];
      const nfl = mt.flip[fl][m];
      const nfr = mt.FRtoBR[fr][m];
      const nco = mt.URFtoDLF[co][m];
      const nul = mt.URtoUL[ul][m];
      const nub = mt.UBtoDF[ub][m];
      if (lowerBound(ntw, nfl, nfr, nco, nul, nub) > left - 1) continue;
      path.push(m);
      if (dfs(ntw, nfl, nfr, nco, nul, nub, mt.parity[pa][m], left - 1, face)) return true;
      path.pop();
    }
    return false;
  }

  let provenDepth = -1;
  try {
    for (let depth = lowerBound(...start.slice(0, 6)); depth <= maxDepth; depth++) {
      if (dfs(...start, depth, -1)) {
        return { moves: path.map((m) => FACE_NAMES[(m / 3) | 0] + POWER[m % 3]) };
      }
      provenDepth = depth;
    }
  } catch (err) {
    if (err !== TIMEOUT) throw err;
  }
  return { moves: null, provenDepth: Math.max(provenDepth, lowerBound(...start.slice(0, 6)) - 1) };
}

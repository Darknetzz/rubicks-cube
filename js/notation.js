// Pure move logic, no three.js. A turn is { axis: 0|1|2, layers: number[], turns: -1|1|2 }:
// `turns` quarter turns, right-handed about +axis, applied to the given layer indices (0..n-1).

const FACE = {
  R: { axis: 0, high: true, sign: -1 }, L: { axis: 0, high: false, sign: 1 },
  U: { axis: 1, high: true, sign: -1 }, D: { axis: 1, high: false, sign: 1 },
  F: { axis: 2, high: true, sign: -1 }, B: { axis: 2, high: false, sign: 1 },
};
const SLICE = { M: { axis: 0, sign: 1 }, E: { axis: 1, sign: 1 }, S: { axis: 2, sign: -1 } };
const ROT = { x: { axis: 0, sign: -1 }, y: { axis: 1, sign: -1 }, z: { axis: 2, sign: -1 } };

const TOKEN = /^(\d+)?([RLUDFBMESxyzrludfb])(w)?([1-3])?(')?$/;

export const normTurns = (t) => {
  const m = ((t % 4) + 4) % 4;
  return m === 3 ? -1 : m;
};

const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/** Parse one move in standard/SiGN notation: R, U', F2, Rw, r, 3Rw, 2R, M, x', ... */
export function parseMove(token, n) {
  const m = TOKEN.exec(token.replace(/[’`]/g, "'"));
  if (!m) throw new Error(`Unknown move "${token}"`);
  const [, depthStr, rawLetter, w, amountStr, prime] = m;
  let letter = rawLetter;
  let wide = !!w;
  if ('rludfb'.includes(letter)) {
    if (wide) throw new Error(`Unknown move "${token}"`);
    wide = true;
    letter = letter.toUpperCase();
  }
  const amount = (amountStr ? Number(amountStr) : 1) * (prime ? -1 : 1);

  let axis, sign, layers;
  if (FACE[letter]) {
    const f = FACE[letter];
    axis = f.axis;
    sign = f.sign;
    const depth = depthStr ? Number(depthStr) : wide ? 2 : 1;
    if (depth < 1 || depth > n) throw new Error(`"${token}": a ${n}×${n} has no layer ${depth}`);
    layers = (wide ? range(1, depth) : [depth]).map((d) => (f.high ? n - d : d - 1));
  } else {
    if (depthStr || wide) throw new Error(`"${token}": layer prefix / w only work on R L U D F B`);
    if (SLICE[letter]) {
      if (n < 3) throw new Error(`"${token}": a ${n}×${n} has no middle slice`);
      ({ axis, sign } = SLICE[letter]);
      layers = range(1, n - 2);
    } else {
      ({ axis, sign } = ROT[letter]);
      layers = range(0, n - 1);
    }
  }
  return { axis, layers: layers.sort((a, b) => a - b), turns: normTurns(sign * amount) };
}

export function parseSequence(text, n) {
  return text
    .replace(/[()[\],]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => parseMove(t, n));
}

const suffix = (q) => (q === 1 ? '' : q === 2 ? '2' : "'");
const letterFor = (table, axis, pred = () => true) =>
  Object.keys(table).find((l) => table[l].axis === axis && pred(table[l]));

/** Turn back into notation (for the move history display). */
export function formatTurn({ axis, layers, turns }, n) {
  const lo = layers[0];
  const hi = layers[layers.length - 1];
  const k = layers.length;
  const contiguous = hi - lo + 1 === k;
  const amt = (sign) => suffix(normTurns(turns * sign));

  if (contiguous && lo === 0 && hi === n - 1) {
    const l = letterFor(ROT, axis);
    return l + amt(ROT[l].sign);
  }
  if (contiguous && n >= 3 && lo === 1 && hi === n - 2) {
    const l = letterFor(SLICE, axis);
    return l + amt(SLICE[l].sign);
  }
  if (contiguous && (hi === n - 1 || lo === 0)) {
    const high = hi === n - 1;
    const l = letterFor(FACE, axis, (f) => f.high === high);
    if (k === 1) return l + amt(FACE[l].sign);
    return (k === 2 ? '' : k) + l + 'w' + amt(FACE[l].sign);
  }
  if (k === 1) {
    const high = lo >= (n - 1) / 2;
    const l = letterFor(FACE, axis, (f) => f.high === high);
    return (high ? n - lo : lo + 1) + l + amt(FACE[l].sign);
  }
  return `${'xyz'[axis]}[${layers.join(',')}]${suffix(normTurns(turns))}`;
}

export const inverse = (t) => ({ ...t, turns: normTurns(-t.turns) });

const sameLayers = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Append a turn to a history, merging/cancelling with the previous turn on the same layers. */
export function pushMerged(history, turn) {
  const last = history[history.length - 1];
  if (last && last.axis === turn.axis && sameLayers(last.layers, turn.layers)) {
    const t = normTurns(last.turns + turn.turns);
    if (t === 0) history.pop();
    else history[history.length - 1] = { ...last, turns: t };
  } else {
    history.push({ axis: turn.axis, layers: [...turn.layers], turns: turn.turns });
  }
}

export const autoScrambleLength = (n) => (n <= 2 ? 11 : n === 3 ? 25 : 20 * (n - 2));

/** Random single-layer turns; never the same axis twice in a row; skips the fixed centre slice of odd cubes. */
export function randomScramble(n, length, rng = Math.random) {
  const layers = range(0, n - 1).filter((i) => !(n % 2 === 1 && i === (n - 1) / 2));
  const amounts = [1, -1, 2];
  const seq = [];
  let prevAxis = -1;
  for (let i = 0; i < length; i++) {
    let axis;
    do axis = Math.floor(rng() * 3);
    while (axis === prevAxis);
    prevAxis = axis;
    seq.push({
      axis,
      layers: [layers[Math.floor(rng() * layers.length)]],
      turns: amounts[Math.floor(rng() * 3)],
    });
  }
  return seq;
}

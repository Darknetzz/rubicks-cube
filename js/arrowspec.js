// Where and which way to draw the "next move" arrow on a 3×3, as plain numbers (no three.js), so it can be tested.
// Coordinates as in facelets.js: x right, y up, z towards the user, as the user holds the cube (the "Hold:" line).
import { parseMove } from './notation.js';

const unit = (axis, sign = 1) => [0, 1, 2].map((k) => (k === axis ? sign : 0));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * {
 *   axis, sense (+1/-1: right-handed about +axis, as the stickers actually travel), half (bool),
 *   layerCentre (coordinate of the moving layers' middle on `axis`), layerWidth (layers),
 *   face: outward normal of the turning outer face, or null for a middle slice,
 *   strips: for each of the 4 faces around the layer, { normal, dir } where dir is the way that face's stickers
 *           in the moving layer travel (a unit vector along the face),
 * }
 */
export function arrowSpec(move) {
  const { axis, layers, turns } = parseMove(move, 3);
  const half = Math.abs(turns) === 2;
  const sense = half ? Math.sign(parseMove(move.replace(/2(?='?$)/, ''), 3).turns) : Math.sign(turns);
  const whole = layers.length === 3;
  let face = null;
  if (whole || layers.includes(2)) face = unit(axis, 1);
  else if (layers.includes(0)) face = unit(axis, -1);
  const omega = unit(axis, sense);
  const strips = [0, 1, 2]
    .filter((k) => k !== axis)
    .flatMap((k) => [unit(k, 1), unit(k, -1)])
    .map((normal) => ({ normal, dir: cross(omega, normal) }));
  const layerCentre = layers.reduce((a, b) => a + b, 0) / layers.length - 1;
  return { axis, sense, half, face, strips, layerCentre, layerWidth: layers.length };
}

// Angles between a face's normal and the line from that face's centre to the camera. The default view already has
// R, U and F at ~65-68°, where the arc still reads as a ring, so the switch sits a little above 70°.
const ARC_ON = Math.cos((72 * Math.PI) / 180); // the arc returns once the face is within 72° of the view…
const ARC_OFF = Math.cos((76 * Math.PI) / 180); // …and gives way past 76° (hysteresis: no flicker while orbiting)
const STRIP_MIN = Math.cos((80 * Math.PI) / 180); // a side strip needs its face within 80° of the view…
const STRIP_SPAN = 0.35; // …and must not point within ~20° of the line of sight (it would shrink to a dot)

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((v) => v / l);
};

/**
 * Which arrows to draw for `spec` seen from a camera at `eye` (cube centred on the origin, outer faces at ±1.5).
 * The arc lies in the turning face's plane, so when that face is seen nearly edge-on it squashes into a line across
 * the neighbouring faces and reads as a different move. Past ~70° it is replaced by straight arrows along the moving
 * row/column on each visible neighbouring face. `arcBefore` is last frame's choice (for hysteresis).
 * Returns { arc: bool, strips: [index into spec.strips] }.
 */
export function arrowView(spec, eye, arcBefore = false) {
  if (spec.face) {
    const c = dot(spec.face, norm(sub(eye, spec.face.map((v) => v * 1.5))));
    if (c > (arcBefore ? ARC_OFF : ARC_ON)) return { arc: true, strips: [] };
  }
  const scored = spec.strips.map(({ normal, dir }, i) => {
    const at = normal.map((v, k) => v * 1.5 + (k === spec.axis ? spec.layerCentre : 0));
    const view = norm(sub(eye, at));
    const facing = dot(normal, view);
    const along = dot(dir, view);
    return { i, facing, span: Math.sqrt(Math.max(0, 1 - along * along)) };
  });
  const strips = scored.filter((s) => s.facing > STRIP_MIN && s.span > STRIP_SPAN).map((s) => s.i);
  if (strips.length) return { arc: false, strips };
  // Nothing reads well (looking straight down the axis of a middle slice, so every side is edge-on): the arc if
  // there is one, else the least hidden strip.
  if (spec.face) return { arc: true, strips: [] };
  const best = scored.sort((a, b) => b.facing - a.facing)[0];
  return { arc: false, strips: [best.i] };
}

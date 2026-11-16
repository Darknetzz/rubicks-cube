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

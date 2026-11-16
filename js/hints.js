// Plain-language direction hints for 3×3 moves, relative to how the user holds the cube (top = U, facing = F).
// Each hint names a strip of stickers the user can see (on the front face, or the top edge for front/back
// layers) and says which way it moves. tests/hints.test.js checks every hint against the facelet model.
import { parseMove } from './notation.js';

const STRIPS = [
  // axis 0 (x): columns of the front face
  { 0: 'left column', 1: 'middle column', 2: 'right column', '0,1': 'left two columns', '1,2': 'right two columns' },
  // axis 1 (y): rows of the front face
  { 0: 'bottom row', 1: 'middle row', 2: 'top row', '0,1': 'bottom two rows', '1,2': 'top two rows' },
  // axis 2 (z): layers from back (0) to front (2)
  { 0: 'back layer', 1: 'middle layer (between front and back)', 2: 'front face', '0,1': 'back two layers', '1,2': 'front two layers' },
];

// Direction of a sticker on the front face (axes 0, 1) or on the top edge (axis 2) for one turn about +axis.
const POSITIVE = ['down', 'right', 'left'];
const NEGATIVE = ['up', 'left', 'right'];

/**
 * Plain-language hint for one 3×3 move, e.g. U → "top row facing you moves left".
 * Half turns keep the direction of their quarter turn and add "twice".
 */
export function moveHint(move) {
  const { axis, layers, turns } = parseMove(move, 3);
  const half = Math.abs(turns) === 2;
  // For half turns the sense is lost in `turns`; take it from the quarter-turn version of the token.
  const sense = half ? parseMove(move.replace(/2(?='?$)/, ''), 3).turns : turns;
  const dir = (sense > 0 ? POSITIVE : NEGATIVE)[axis];
  const twice = half ? ', twice (half turn: either way ends the same)' : '';

  if (layers.length === 3) {
    const whole = [
      `whole cube rolls: the face towards you moves ${dir}`,
      `whole cube turns: the face towards you moves ${dir}`,
      `whole cube tilts ${dir === 'right' ? 'clockwise' : 'counter-clockwise'}, like a steering wheel to the ${dir}`,
    ][axis];
    return { text: whole + twice };
  }

  const strip = STRIPS[axis][layers.join(',')];
  if (axis === 2) {
    if (layers.includes(2)) {
      const plural = layers.length > 1;
      const cw = dir === 'right' ? 'clockwise' : 'counter-clockwise';
      return { text: `${strip} ${plural ? 'turn' : 'turns'} ${cw}, like a steering wheel to the ${dir}${twice}` };
    }
    return { text: `top of the ${strip} moves to your ${dir}${twice}` };
  }
  const verb = layers.length > 1 ? 'move' : 'moves';
  return { text: `${strip} facing you ${verb} ${dir}${twice}` };
}

export const hintText = (move) => moveHint(move).text;

// Export/import of a cube's sticker state: text ("54 letters" for 3×3, "N:letters" otherwise), JSON files and links.
//
// Exports use the colour letters W Y R O G B, the same alphabet the server and the MCP tools (get_cube / set_cube)
// use, so a 3×3 can be pasted either way. Imports also accept the older face-key letters U R F D L B.
// Inside the page a state is face keys U R F D L B: each sticker's home face on the solved cube. The colour scheme
// (settings.js, face → colour letter, default Western) says which colour each key is, so every function here
// takes the page's scheme.
import { FACES } from './facelets.js';
import { validate, fromFaces, COLOUR_NAMES, WESTERN } from './validate.js';
import { MIN_SIZE, MAX_SIZE } from './settings.js';

const toColours = (keys, scheme) => fromFaces(keys, scheme);
const toKeys = (colours, scheme) => {
  const keyOf = Object.fromEntries(Object.entries(scheme).map(([key, colour]) => [colour, key]));
  return [...colours].map((c) => keyOf[c]).join('');
};

/** Page keys → export text in colour letters. */
export const encodeState = (size, keys, scheme = WESTERN) =>
  (size === 3 ? toColours(keys, scheme) : `${size}:${toColours(keys, scheme)}`);

export const stateToJson = (size, keys, scheme = WESTERN) =>
  `${JSON.stringify({ type: 'rubiks-cube', version: 2, size, state: toColours(keys, scheme) }, null, 2)}\n`;

export const stateLink = (size, keys, base = location.href, scheme = WESTERN) => {
  const url = new URL(base);
  url.hash = `state=${encodeState(size, keys, scheme)}`;
  return url.href;
};

// Colour letters (W Y O G only exist there) or face keys (U F D L only exist there); B and R are in both.
function toPageKeys(letters, scheme) {
  const colours = /[WYOG]/.test(letters);
  const faces = /[UFDL]/.test(letters);
  if (colours && faces) throw new Error('Mixes colour letters (W Y R O G B) with face letters (U R F D L B); use one or the other.');
  if (colours || !faces) {
    if (!/^[WYROGB]+$/.test(letters)) throw new Error('Only the colour letters W Y R O G B are allowed.');
    return toKeys(letters, scheme);
  }
  if (!/^[URFDLB]+$/.test(letters)) throw new Error('Only the letters U R F D L B are allowed.');
  return letters;
}

/**
 * Parse pasted text, a link, or JSON into { size, facelets } with facelets as page keys for `scheme`.
 * Throws a readable Error. Old face-letter exports are page keys already.
 */
export function parseState(input, scheme = WESTERN) {
  let text = String(input).trim();
  let size;
  let letters;
  if (text.startsWith('{')) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      throw new Error('That file is not valid JSON.');
    }
    size = Number(obj.size);
    letters = String(obj.state ?? '');
  } else {
    const hash = text.indexOf('#state=');
    if (hash >= 0) text = decodeURIComponent(text.slice(hash + 7));
    text = text.replace(/\s+/g, '');
    const m = /^(\d+):(.*)$/.exec(text);
    letters = m ? m[2] : text;
    size = m ? Number(m[1]) : Math.round(Math.sqrt(letters.length / 6));
  }

  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new Error(`Size must be ${MIN_SIZE}–${MAX_SIZE} (got ${Number.isNaN(size) ? 'nothing' : size}).`);
  }
  const want = 6 * size * size;
  if (letters.length !== want) throw new Error(`A ${size}×${size} needs ${want} letters, got ${letters.length}.`);
  const facelets = toPageKeys(letters, scheme);
  if (size === 3) {
    const errors = validate(toColours(facelets, scheme));
    if (errors.length) throw new Error(errors.join(' '));
  } else {
    for (const c of FACES) {
      const count = facelets.split(c).length - 1;
      if (count !== size * size) throw new Error(`${count} ${COLOUR_NAMES[scheme[c]]} stickers instead of ${size * size}.`);
    }
  }
  return { size, facelets };
}

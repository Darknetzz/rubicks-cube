// Export/import of a cube's sticker state: text ("54 letters" for 3×3, "N:letters" otherwise), JSON files and links.
import { FACES } from './facelets.js';
import { validate, COLOUR_NAMES } from './validate.js';
import { MIN_SIZE, MAX_SIZE } from './settings.js';

export const encodeState = (size, facelets) => (size === 3 ? facelets : `${size}:${facelets}`);

export const stateToJson = (size, facelets) =>
  `${JSON.stringify({ type: 'rubiks-cube', version: 1, size, state: facelets }, null, 2)}\n`;

export const stateLink = (size, facelets, base = location.href) => {
  const url = new URL(base);
  url.hash = `state=${encodeState(size, facelets)}`;
  return url.href;
};

/** Parse pasted text, a link, or JSON into { size, facelets }. Throws an Error with a readable message. */
export function parseState(input) {
  let text = String(input).trim();
  let size;
  let facelets;
  if (text.startsWith('{')) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      throw new Error('That file is not valid JSON.');
    }
    size = Number(obj.size);
    facelets = String(obj.state ?? '');
  } else {
    const hash = text.indexOf('#state=');
    if (hash >= 0) text = decodeURIComponent(text.slice(hash + 7));
    text = text.replace(/\s+/g, '');
    const m = /^(\d+):(.*)$/.exec(text);
    facelets = m ? m[2] : text;
    size = m ? Number(m[1]) : Math.round(Math.sqrt(facelets.length / 6));
  }

  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new Error(`Size must be ${MIN_SIZE}–${MAX_SIZE} (got ${Number.isNaN(size) ? 'nothing' : size}).`);
  }
  const want = 6 * size * size;
  if (facelets.length !== want) throw new Error(`A ${size}×${size} needs ${want} letters, got ${facelets.length}.`);
  if (!/^[URFDLB]+$/.test(facelets)) throw new Error('Only the letters U R F D L B are allowed.');
  if (size === 3) {
    const errors = validate(facelets);
    if (errors.length) throw new Error(errors.join(' '));
  } else {
    for (const c of FACES) {
      const count = facelets.split(c).length - 1;
      if (count !== size * size) throw new Error(`${count} ${COLOUR_NAMES[c]} stickers instead of ${size * size}.`);
    }
  }
  return { size, facelets };
}

import { WESTERN, JAPANESE } from './validate.js';

// "My cube" before 2026-11-16 had orange on the right; the owner's cube is actually mirrored Japanese.
const OLD_MY_CUBE = { U: 'W', R: 'O', F: 'Y', D: 'B', L: 'R', B: 'G' };

const STORAGE_KEY = 'rubiks-cube-settings-v1';

export const MIN_SIZE = 2;
export const MAX_SIZE = 12;

export const FACE_KEYS = ['U', 'F', 'R', 'D', 'B', 'L'];
export const FACE_NAMES = { U: 'Up', D: 'Down', F: 'Front', B: 'Back', L: 'Left', R: 'Right' };

// Colour scheme: which colour (W Y R O G B) is on which face of the solved cube, as you hold it.
// Presets are the common real-cube schemes; any other one-to-one mapping is a custom scheme.
export const COLOUR_LETTERS = 'WYROGB';
export const DEFAULT_SCHEME = 'my-cube';
export const SCHEMES = {
  // The site owner's cube (mirrored Japanese scheme), held white on top with yellow facing you: red right, orange left.
  'my-cube': { label: 'My cube (mirrored Japanese): white top, yellow front', scheme: { U: 'W', R: 'R', F: 'Y', D: 'B', L: 'O', B: 'G' } },
  western: { label: 'Western / American, white top', scheme: { ...WESTERN } },
  'western-yellow': { label: 'Western / American, yellow top', scheme: { U: 'Y', R: 'O', F: 'G', D: 'W', L: 'R', B: 'B' } },
  japanese: { label: 'Japanese, white top, green front', scheme: { ...JAPANESE } },
};
const WESTERN_SCHEME = WESTERN; // what face-keyed settings from before schemes meant

/** True for a one-to-one mapping of the six faces to the six colours. */
export const isScheme = (x) =>
  !!x && typeof x === 'object' && [...'URFDLB'].map((f) => x[f]).sort().join('') === [...COLOUR_LETTERS].sort().join('');

/** Id of the preset `scheme` matches, or 'custom'. */
export const presetOf = (scheme) =>
  Object.keys(SCHEMES).find((id) => [...'URFDLB'].every((f) => SCHEMES[id].scheme[f] === scheme[f])) ?? 'custom';

/** Hex colour for each face key, from the scheme and the per-colour palette (what the 3D cube is drawn with). */
export const faceColors = ({ scheme, palette }) => Object.fromEntries([...'URFDLB'].map((f) => [f, palette[scheme[f]]]));

const move = (id, face = false) => ({ id, label: id, kind: 'move', face });
export const ACTIONS = [
  ...['R', 'L', 'U', 'D', 'F', 'B'].map((id) => move(id, true)),
  ...['Rw', 'Lw', 'Uw', 'Dw', 'Fw', 'Bw'].map((id) => move(id, true)),
  ...['M', 'E', 'S', 'x', 'y', 'z'].map((id) => move(id)),
  { id: 'undo', label: 'Undo', kind: 'cmd' },
  { id: 'redo', label: 'Redo', kind: 'cmd' },
  { id: 'scramble', label: 'Scramble', kind: 'cmd' },
  { id: 'solve', label: 'Solve', kind: 'cmd' },
  { id: 'reset', label: 'Reset', kind: 'cmd' },
];

const DEFAULT_KEYS = {
  R: 'r', L: 'l', U: 'u', D: 'd', F: 'f', B: 'b',
  M: 'm', E: 'e', S: 's', x: 'x', y: 'y', z: 'z',
  undo: 'backspace',
};

export function defaultSettings() {
  return {
    size: 3,
    speed: 180,
    scrambleLength: 0,
    scheme: { ...SCHEMES[DEFAULT_SCHEME].scheme },
    palette: { W: '#ffffff', Y: '#ffd500', G: '#009b48', B: '#0046ad', R: '#b71234', O: '#ff5800' },
    body: '#151515',
    background: '#1c1f26',
    keys: Object.fromEntries(ACTIONS.map((a) => [a.id, DEFAULT_KEYS[a.id] ?? ''])),
  };
}

const sameScheme = (a, b) => [...'URFDLB'].every((f) => a[f] === b[f]);

export function loadSettings() {
  const d = defaultSettings();
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    // Before schemes, `colors` held a hex per face in the Western scheme.
    const oldPalette = s.colors && Object.fromEntries(Object.entries(s.colors).map(([f, hex]) => [WESTERN_SCHEME[f], hex]));
    const merged = {
      ...d, ...s,
      // settings from before schemes existed were drawn in the Western scheme; keep their cube looking the same
      scheme: isScheme(s.scheme) && !sameScheme(s.scheme, OLD_MY_CUBE) ? { ...s.scheme } : oldPalette ? { ...WESTERN } : d.scheme,
      palette: { ...d.palette, ...oldPalette, ...s.palette },
      keys: { ...d.keys, ...s.keys },
    };
    delete merged.colors;
    merged.size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(merged.size) || 3));
    return merged;
  } catch {
    return d;
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

export const normalizeKey = (key) => key.toLowerCase();

export function keyLabel(key) {
  if (!key) return '—';
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key[0].toUpperCase() + key.slice(1);
}

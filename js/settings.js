const STORAGE_KEY = 'rubiks-cube-settings-v1';

export const MIN_SIZE = 2;
export const MAX_SIZE = 12;

export const FACE_KEYS = ['U', 'F', 'R', 'D', 'B', 'L'];
export const FACE_NAMES = { U: 'Up', D: 'Down', F: 'Front', B: 'Back', L: 'Left', R: 'Right' };

const move = (id, face = false) => ({ id, label: id, kind: 'move', face });
export const ACTIONS = [
  ...['R', 'L', 'U', 'D', 'F', 'B'].map((id) => move(id, true)),
  ...['Rw', 'Lw', 'Uw', 'Dw', 'Fw', 'Bw'].map((id) => move(id, true)),
  ...['M', 'E', 'S', 'x', 'y', 'z'].map((id) => move(id)),
  { id: 'undo', label: 'Undo', kind: 'cmd' },
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
    colors: { U: '#ffffff', D: '#ffd500', F: '#009b48', B: '#0046ad', R: '#b71234', L: '#ff5800' },
    body: '#151515',
    background: '#1c1f26',
    keys: Object.fromEntries(ACTIONS.map((a) => [a.id, DEFAULT_KEYS[a.id] ?? ''])),
  };
}

export function loadSettings() {
  const d = defaultSettings();
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const merged = { ...d, ...s, colors: { ...d.colors, ...s.colors }, keys: { ...d.keys, ...s.keys } };
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

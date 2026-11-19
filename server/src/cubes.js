import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { Session } from './session.js';

/** The cube used when no code is given (the single shared cube from before there were several). */
export const DEFAULT_CUBE = 'default';
/** Cube codes the page makes: random lower-case letters and digits. */
export const CUBE_CODE = /^[a-z0-9]{8,32}$/;

export const validCube = (id) => id === DEFAULT_CUBE || CUBE_CODE.test(id ?? '');

const CACHED = 100; // sessions kept in memory; others are reloaded from their file when used again

/**
 * Many cubes, each its own Session saved in its own file, picked by a code (the page's ?cube=). The default cube
 * keeps the old single state file. Emits 'change' (id, event) for every cube.
 */
export class Cubes extends EventEmitter {
  constructor(defaultFile, dir) {
    super();
    this.defaultFile = defaultFile;
    this.dir = dir;
    this.sessions = new Map(); // id -> Session, least recently used first
  }

  /** The cube with this code (made, unsaved, on first use). Throws on an invalid code. */
  get(id = DEFAULT_CUBE) {
    if (!validCube(id)) throw new Error('Invalid cube code: it is 8-32 lower-case letters and digits, as shown on the page.');
    let s = this.sessions.get(id);
    if (s) {
      this.sessions.delete(id);
    } else {
      const file = id === DEFAULT_CUBE ? this.defaultFile : this.dir && join(this.dir, `${id}.json`);
      s = new Session(file ?? null);
      s.on('change', (event) => this.emit('change', id, event));
    }
    this.sessions.set(id, s);
    if (this.sessions.size > CACHED) {
      const [oldId, old] = this.sessions.entries().next().value;
      old.removeAllListeners('change');
      this.sessions.delete(oldId);
    }
    return s;
  }
}

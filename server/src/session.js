import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { SOLVED, applyMoves, isSolved, validate, solve, splitMoves } from './cube3.js';

/** The single shared cube: state + current solution plan. Emits 'change' with a snapshot. */
export class Session extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.state = SOLVED;
    this.plan = null;
    this.step = 0;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (validate(saved.state).length === 0) Object.assign(this, { state: saved.state, plan: saved.plan ?? null, step: saved.step ?? 0 });
    } catch {
      /* no saved state yet */
    }
  }

  snapshot() {
    return { state: this.state, solved: isSolved(this.state), plan: this.plan, step: this.step };
  }

  #commit(event) {
    if (this.file) {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(`${this.file}.tmp`, JSON.stringify({ state: this.state, plan: this.plan, step: this.step }));
        renameSync(`${this.file}.tmp`, this.file);
      } catch (err) {
        console.error('could not save state:', err.message);
      }
    }
    this.emit('change', { ...event, ...this.snapshot() });
  }

  setState(state) {
    const errors = validate(state);
    if (errors.length) throw new Error(errors.join(' '));
    Object.assign(this, { state, plan: null, step: 0 });
    this.#commit({ type: 'state' });
  }

  reset() {
    this.setState(SOLVED);
  }

  solve() {
    this.plan = solve(this.state);
    this.step = 0;
    this.#commit({ type: 'plan' });
    return this.plan;
  }

  /** Record moves done on the real cube. Returns whether they followed the plan. */
  apply(moves) {
    const list = splitMoves(moves);
    let followed = !!this.plan;
    for (const m of list) {
      if (this.plan && this.plan[this.step] === m) this.step++;
      else followed = false;
    }
    if (!followed) {
      this.plan = null;
      this.step = 0;
    }
    this.state = applyMoves(this.state, list);
    this.#commit({ type: 'moves', moves: list });
    return followed;
  }
}

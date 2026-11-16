import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { SOLVED, applyMoves, isSolved, validate, solveDetailed, splitMoves, fromFaces, solvedLike, centreColours, schemeText } from './cube3.js';

// States saved before colour letters were introduced used face letters in the Western scheme.
const migrate = (state) => (typeof state === 'string' && /[UFDL]/.test(state) && /^[URFDLB]{54}$/.test(state) ? fromFaces(state) : state);

/**
 * The single shared cube: state + current solution plan. Emits 'change' with a snapshot.
 * The colour scheme lives in the state itself (its centre stickers), so set/apply/get can never disagree about it;
 * the snapshot spells it out for clients.
 */
export class Session extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.state = SOLVED;
    this.plan = null;
    this.step = 0;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      saved.state = migrate(saved.state);
      if (validate(saved.state).length === 0) Object.assign(this, { state: saved.state, plan: saved.plan ?? null, step: saved.step ?? 0 });
    } catch {
      /* no saved state yet */
    }
  }

  snapshot() {
    const { state } = this;
    return {
      state,
      solved: isSolved(state),
      plan: this.plan,
      step: this.step,
      scheme: { centres: centreColours(state), opposites: schemeText(state) },
    };
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

  /** Replace the state. Returns a note when the colour scheme (opposite pairs) differs from the previous state's. */
  setState(state) {
    const errors = validate(state);
    if (errors.length) throw new Error(errors.join(' '));
    const before = schemeText(this.state);
    const after = schemeText(state);
    Object.assign(this, { state, plan: null, step: 0 });
    this.#commit({ type: 'state' });
    return before === after ? '' : `Colour scheme changed from (${before}) to (${after}).`;
  }

  /** Solved, keeping this cube's colour scheme and the way it is currently held. */
  reset() {
    this.setState(solvedLike(this.state));
  }

  /** Compute and store a plan. Returns { moves, optimal, ms } (see solveDetailed). */
  solve() {
    const result = solveDetailed(this.state);
    this.plan = result.moves;
    this.step = 0;
    this.#commit({ type: 'plan' });
    return result;
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

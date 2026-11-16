import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { invertMoves } from '../../js/notation.js';
import { SOLVED, applyMoves, isSolved, validate, solveDetailed, splitMoves, fromFaces, solvedLike, centreColours, schemeText } from './cube3.js';

// States saved before colour letters were introduced used face letters in the Western scheme.
const migrate = (state) => (typeof state === 'string' && /[UFDL]/.test(state) && /^[URFDLB]{54}$/.test(state) ? fromFaces(state) : state);

/**
 * The single shared cube: state + current solution plan. Emits 'change' with a snapshot.
 * The colour scheme lives in the state itself (its centre stickers), so set/apply/get can never disagree about it;
 * the snapshot spells it out for clients.
 */
const HISTORY = 200; // undo steps kept

export class Session extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.state = SOLVED;
    this.plan = null;
    this.step = 0;
    this.planBase = null; // the state the plan starts from
    this.history = []; // undo stack: { moves, before: { state, plan, step, planBase } }
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      saved.state = migrate(saved.state);
      if (validate(saved.state).length === 0) {
        Object.assign(this, { state: saved.state, plan: saved.plan ?? null, step: saved.step ?? 0 });
        this.planBase = saved.planBase ?? (this.plan ? applyMoves(this.state, invertMoves(this.plan.slice(0, this.step))) : null);
        if (Array.isArray(saved.history)) this.history = saved.history.slice(-HISTORY);
      }
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
      canUndo: this.history.length > 0,
      scheme: { centres: centreColours(state), opposites: schemeText(state) },
    };
  }

  #commit(event) {
    if (this.file) {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        const { state, plan, step, planBase, history } = this;
        writeFileSync(`${this.file}.tmp`, JSON.stringify({ state, plan, step, planBase, history }));
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
    Object.assign(this, { state, plan: null, step: 0, planBase: null, history: [] }); // no undo across a new state
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
    this.planBase = this.state;
    this.#commit({ type: 'plan' });
    return result;
  }

  /**
   * Record moves done on the real cube (from Claude or the page). Returns whether they followed the plan.
   * The plan is followed by state, not by notation: a half turn done as two quarter turns (either way), or written
   * R2', still counts, and while only the first quarter of a half-turn step is done the plan waits for the second.
   * Anything else clears the plan (undo brings it back).
   */
  apply(moves, origin = null) {
    const list = splitMoves(moves);
    if (!list.length) return !!this.plan;
    const before = { state: this.state, plan: this.plan, step: this.step, planBase: this.planBase };
    let followed = !!this.plan;
    let state = this.state;
    for (const m of list) {
      state = applyMoves(state, m);
      if (!this.plan) continue;
      if (this.step < this.plan.length && state === applyMoves(this.planBase, this.plan.slice(0, this.step + 1))) this.step++;
      else if (!this.#halfwayThroughStep(state)) followed = false;
    }
    if (!followed) Object.assign(this, { plan: null, step: 0, planBase: null });
    this.state = state;
    this.history.push({ moves: list, before });
    if (this.history.length > HISTORY) this.history.shift();
    this.#commit({ type: 'moves', moves: list, origin });
    return followed;
  }

  /** Undo the last recorded batch of moves (with the plan as it was). Returns the moves undone, or null. */
  undo(origin = null) {
    const last = this.history.pop();
    if (!last) return null;
    Object.assign(this, last.before);
    this.#commit({ type: 'moves', moves: invertMoves(last.moves), undo: true, origin });
    return last.moves;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  // One quarter of the current half-turn step done (e.g. R or R' when the step is R2).
  #halfwayThroughStep(state) {
    const m = this.plan[this.step];
    if (!m || !/2'?$/.test(m)) return false;
    const at = applyMoves(this.planBase, this.plan.slice(0, this.step));
    const quarter = m.replace(/2'?$/, '');
    return state === applyMoves(at, quarter) || state === applyMoves(at, `${quarter}'`);
  }
}

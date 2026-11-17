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
const DRAFT = /^[WYROGB]{54}$/;
const MASK = /^[01]{54}$/;

export class Session extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.state = SOLVED;
    this.plan = null;
    this.step = 0;
    this.planBase = null; // the state the plan starts from
    this.history = []; // undo stack: { moves, before: { state, plan, step, planBase } }
    this.future = []; // redo stack: { moves, after: { state, plan, step, planBase } }
    this.draft = null; // { state, painted, at }: an unfinished painting the user sent; not the cube's state
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      saved.state = migrate(saved.state);
      if (validate(saved.state).length === 0) {
        Object.assign(this, { state: saved.state, plan: saved.plan ?? null, step: saved.step ?? 0 });
        this.planBase = saved.planBase ?? (this.plan ? applyMoves(this.state, invertMoves(this.plan.slice(0, this.step))) : null);
        if (Array.isArray(saved.history)) this.history = saved.history.slice(-HISTORY);
        if (Array.isArray(saved.future)) this.future = saved.future.slice(-HISTORY);
        if (saved.draft && DRAFT.test(saved.draft.state)) this.draft = saved.draft;
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
      canRedo: this.future.length > 0,
      hasDraft: !!this.draft,
      scheme: { centres: centreColours(state), opposites: schemeText(state) },
    };
  }

  #commit(event) {
    if (this.file) {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        const { state, plan, step, planBase, history, future, draft } = this;
        writeFileSync(`${this.file}.tmp`, JSON.stringify({ state, plan, step, planBase, history, future, draft }));
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
    // no undo across a new state; a complete cube replaces any unfinished one
    Object.assign(this, { state, plan: null, step: 0, planBase: null, history: [], future: [], draft: null });
    this.#commit({ type: 'state' });
    return before === after ? '' : `Colour scheme changed from (${before}) to (${after}).`;
  }

  /**
   * Keep an unfinished painting (54 colour letters that don't make a valid cube yet) for Claude to look at, with an
   * optional mask of the stickers the user painted by hand ('1') versus left over from before ('0'). The cube's
   * real state and plan are untouched. A valid state is set as the state instead.
   */
  setDraft(state, painted = null) {
    if (!DRAFT.test(state ?? '')) throw new Error('A draft must be 54 colour letters W Y R O G B.');
    if (validate(state).length === 0) return this.setState(state);
    this.draft = { state, painted: MASK.test(painted ?? '') ? painted : null, at: Date.now() };
    this.#commit({ type: 'draft' });
    return '';
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
    this.future = []; // a redo would bring back a stale plan
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
    const before = this.#position();
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
    this.#turnDraft(list); // the painting is of the same physical cube, so it turns too
    this.#record(list, before);
    this.#commit({ type: 'moves', moves: list, origin });
    return followed;
  }

  /**
   * Move along the plan to step `to` (0 = before its first move, plan.length = all done), forwards or backwards,
   * keeping the plan. Recorded as one batch, so undo/redo work on it. Returns the moves made.
   */
  goto(to, origin = null) {
    if (!this.plan) throw new Error('There is no plan to step through.');
    if (!Number.isInteger(to) || to < 0 || to > this.plan.length) throw new Error(`Step must be 0 to ${this.plan.length}.`);
    const at = applyMoves(this.planBase, this.plan.slice(0, this.step));
    const moves = [];
    if (this.state !== at) {
      // halfway through a half-turn step: take the quarter back first
      const m = this.plan[this.step]?.replace(/2'?$/, '');
      if (m && this.state === applyMoves(at, m)) moves.push(...invertMoves([m]));
      else if (m && this.state === applyMoves(at, `${m}'`)) moves.push(m);
      else throw new Error('The cube is not on the plan.');
    }
    if (to > this.step) moves.push(...this.plan.slice(this.step, to));
    else moves.push(...invertMoves(this.plan.slice(to, this.step)));
    if (!moves.length) return [];
    const before = this.#position();
    this.state = applyMoves(this.planBase, this.plan.slice(0, to));
    this.step = to;
    this.#turnDraft(moves);
    this.#record(moves, before);
    this.#commit({ type: 'moves', moves, origin });
    return moves;
  }

  #record(moves, before) {
    this.history.push({ moves, before });
    if (this.history.length > HISTORY) this.history.shift();
    this.future = [];
  }

  /** Undo the last recorded batch of moves (with the plan as it was). Returns the moves undone, or null. */
  undo(origin = null) {
    const last = this.history.pop();
    if (!last) return null;
    this.future.push({ moves: last.moves, after: this.#position() });
    Object.assign(this, last.before);
    this.#turnDraft(invertMoves(last.moves));
    this.#commit({ type: 'moves', moves: invertMoves(last.moves), undo: true, origin });
    return last.moves;
  }

  /** Redo the last undone batch (with the plan as it was after it). Returns the moves redone, or null. */
  redo(origin = null) {
    const next = this.future.pop();
    if (!next) return null;
    this.history.push({ moves: next.moves, before: this.#position() });
    Object.assign(this, next.after);
    this.#turnDraft(next.moves);
    this.#commit({ type: 'moves', moves: next.moves, redo: true, origin });
    return next.moves;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  #position() {
    return { state: this.state, plan: this.plan, step: this.step, planBase: this.planBase };
  }

  #turnDraft(moves) {
    if (!this.draft) return;
    const turn = (s) => s && applyMoves(s, moves.join(' '));
    this.draft = { ...this.draft, state: turn(this.draft.state), painted: turn(this.draft.painted) };
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

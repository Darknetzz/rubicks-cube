import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { asciiNet, describeMove, holding, validate, isSolved, schemeText, applyMoves } from './cube3.js';

const INSTRUCTIONS = `This server tracks the user's REAL, physical 3×3 Rubik's cube and solves it.
Workflow:
1. Ask the user to open the cube web page, use Paint mode to copy their cube's colours, and press "Send to Claude"
   (or have them describe each face and call set_cube yourself). Then call get_cube.
   If they could only paint part of it, they can send it unfinished: get_cube then also shows that draft, which
   stickers they painted by hand, and what is wrong with it. Work out the missing or wrong stickers with them
   (ask about specific stickers; the rules of a real cube often pin down the rest), then call set_cube with all 54.
   Any colour scheme works (Western, Japanese, custom): the six centre stickers define which colour is which face,
   so always name faces by their centre colour as get_cube reports it, never by a colour you assume.
2. Before giving moves, tell the user exactly how to hold the cube (the "hold" line) and to keep it that way.
3. Call solve. Give the moves 2-4 at a time, explaining each in plain words (the descriptions are provided).
   To show your own steps instead (an algorithm, a few hints, a fix), call set_plan: the page shows each as an arrow.
4. After the user confirms they did a batch, call apply_moves with exactly those moves so the web page animates
   and progress is tracked. Ask them to compare their cube with the page if anything looks off.
5. If the user made a mistake, have them describe/paint the cube again and re-solve.`;

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

function draftReport(draft) {
  const { state, painted } = draft;
  const shown = painted ? [...state].map((c, i) => (painted[i] === '1' ? c : c.toLowerCase())).join('') : state;
  const n = painted ? [...painted].filter((x) => x === '1').length : null;
  return [
    'UNFINISHED PAINTING: the user sent this from the page but it is not a valid cube yet, so the state above is ' +
      'unchanged. Help them complete it, then call set_cube with all 54 stickers (that replaces this draft).',
    `Problems: ${validate(state).join(' ')}`,
    painted
      ? `The user painted ${n} of 54 stickers by hand (CAPITALS); lowercase ones were left over from before they started ` +
        'painting and may well be wrong.'
      : 'It is not known which stickers the user painted by hand.',
    '',
    asciiNet(state, shown),
    '',
    `Draft facelets: ${shown}`,
  ].join('\n');
}

function report(session, note = '') {
  const { state, plan, step, labels } = session.snapshot();
  const lines = [
    ...(note ? [note, ''] : []),
    ...(session.draft ? [draftReport(session.draft), '', '--- Current cube state ---', ''] : []),
    `Hold: ${holding(state)}.`,
    `Colour scheme (from the centres): ${schemeText(state)}.`,
    isSolved(state) ? 'The cube is SOLVED.' : 'The cube is not solved.',
    '',
    asciiNet(state),
  ];
  if (plan) {
    lines.push('', `Plan: ${plan.length} moves, ${step} done.`);
    let s = state; // describe each remaining move against the cube as it will be when that move is made
    plan.forEach((m, i) => {
      const label = labels?.[i] ? ` [${labels[i]}]` : '';
      lines.push(`${i < step ? '✓' : i === step ? '→' : ' '} ${i + 1}.${label} ${describeMove(m, i < step ? state : s)}`);
      if (i >= step) s = applyMoves(s, m);
    });
  }
  lines.push('', `Facelets (colour letters; top, right, front, bottom, left, back): ${state}`);
  return lines.join('\n');
}

export function buildMcpServer(session) {
  const server = new McpServer({ name: 'rubiks-cube', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  server.registerTool('get_cube', {
    title: 'Get cube',
    description:
      "Current state of the user's physical cube: how to hold it (named by the cube's own centre colours), its colour " +
      'scheme, a text diagram, and solve progress with each move explained. If the user sent an unfinished painting, ' +
      'it is shown first, with which stickers they painted and what is wrong with it.',
    annotations: { readOnlyHint: true },
  }, async () => text(report(session)));

  server.registerTool('set_cube', {
    title: 'Set cube state',
    description:
      'Replace the cube state. 54 colour letters W Y R O G B (white yellow red orange green blue), faces in order ' +
      'top, right, front, bottom, left, back as the user holds the cube, each face read row by row as seen looking ' +
      'straight at it (top with the back edge at the top, bottom with the front edge at the top, side faces with the ' +
      'top up). Any colour scheme is accepted: the six centres decide which colour belongs to which face, so a ' +
      'Japanese cube (white opposite blue) is fine. Clears the plan and any unfinished painting.',
    inputSchema: { facelets: z.string().length(54).regex(/^[WYROGB]+$/i) },
  }, async ({ facelets }) => {
    const state = facelets.toUpperCase();
    const errors = validate(state);
    if (errors.length) return fail(`Not a valid cube: ${errors.join(' ')}`);
    return text(report(session, session.setState(state)));
  });

  server.registerTool('solve', {
    title: 'Solve',
    description:
      'Compute a short solution for the current state and store it as the plan. Cubes a few moves from solved get ' +
      'an exact optimal solution; otherwise Kociemba two-phase is repeated for shorter and shorter solutions within ' +
      'a time budget (≤22 moves). The output says whether the move count is proven optimal.',
  }, async () => {
    try {
      const { moves, optimal, ms } = session.solve();
      if (!moves.length) return text('Already solved.');
      const quality = optimal ? 'optimal' : `best found in ${ms} ms; a shorter one may exist`;
      return text(`${moves.length} moves (${quality}): ${moves.join(' ')}\n\n${report(session)}`);
    } catch (err) {
      return fail(err.message);
    }
  });

  server.registerTool('set_plan', {
    title: 'Set plan steps',
    description:
      'Store your own sequence of moves as the plan, instead of the solver output: an algorithm, one stage of a method ' +
      '(cross, F2L pair, OLL, PLL), or a fix. The web page shows each step exactly like a solve: an arrow on the 3D ' +
      'cube, a plain-language hint and a Done button, and apply_moves advances it the same way. Each step is one ' +
      'move in standard notation as the user holds the cube (R, U\', F2, slices M E S, wide Rw or r, rotations x y ' +
      'z) with an optional short label shown with it (e.g. "cross: red-blue edge", "F2L pair 1"). Steps already ' +
      'done are kept; the given steps replace the remaining ones, or with append are added after them, so you can ' +
      'feed a solve in one stage at a time. An empty list without append drops the remaining steps. Nothing is ' +
      'turned: the user does the moves, then you record them with apply_moves. Returns the cube as get_cube does.',
    inputSchema: {
      steps: z.array(z.object({
        move: z.string().min(1).describe('One move, e.g. R, U\', F2, M, Rw, x.'),
        label: z.string().max(80).optional().describe('Short label shown with this step, e.g. "F2L pair 1".'),
      })).describe('The steps in order.'),
      append: z.boolean().optional().describe('Add after all existing steps instead of replacing the remaining ones.'),
    },
  }, async ({ steps, append }) => {
    try {
      session.setPlan(steps, { append: !!append });
      return text(report(session));
    } catch (err) {
      return fail(err.message);
    }
  });

  server.registerTool('apply_moves', {
    title: 'Apply moves',
    description:
      'Record moves the user has done on the real cube (standard notation, e.g. "R U2 F\'"). ' +
      'Faces are named by position as the user holds the cube (R = right side, whatever its centre colour). ' +
      'Updates the state, advances the plan and animates the web page.',
    inputSchema: { moves: z.string().min(1) },
  }, async ({ moves }) => {
    const hadPlan = !!session.plan;
    try {
      const followed = session.apply(moves);
      const note = hadPlan && !followed ? 'These moves did not follow the plan, so the plan was cleared. Call solve again.\n\n' : '';
      return text(note + report(session));
    } catch (err) {
      return fail(err.message);
    }
  });

  server.registerTool('reset_cube', {
    title: 'Reset cube',
    description: "Set the cube to solved in its current colour scheme and orientation, and clear the plan.",
    annotations: { destructiveHint: true },
  }, async () => {
    session.reset();
    return text(report(session));
  });

  return server;
}

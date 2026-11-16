import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { asciiNet, describeMove, holding, validate, isSolved } from './cube3.js';

const INSTRUCTIONS = `This server tracks the user's REAL, physical 3×3 Rubik's cube and solves it.
Workflow:
1. Ask the user to open the cube web page, use Paint mode to copy their cube's colours, and press "Send to Claude"
   (or have them describe each face and call set_cube yourself). Then call get_cube.
2. Before giving moves, tell the user exactly how to hold the cube (the "hold" line) and to keep it that way.
3. Call solve. Give the moves 2-4 at a time, explaining each in plain words (the descriptions are provided).
4. After the user confirms they did a batch, call apply_moves with exactly those moves so the web page animates
   and progress is tracked. Ask them to compare their cube with the page if anything looks off.
5. If the user made a mistake, have them describe/paint the cube again and re-solve.`;

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

function report(session) {
  const { state, plan, step } = session.snapshot();
  const lines = [`Hold: ${holding(state)}.`, isSolved(state) ? 'The cube is SOLVED.' : 'The cube is not solved.', '', asciiNet(state)];
  if (plan) {
    lines.push('', `Plan: ${plan.length} moves, ${step} done.`);
    plan.forEach((m, i) => lines.push(`${i < step ? '✓' : i === step ? '→' : ' '} ${i + 1}. ${describeMove(m, state)}`));
  }
  lines.push('', `Facelets (URFDLB order): ${state}`);
  return lines.join('\n');
}

export function buildMcpServer(session) {
  const server = new McpServer({ name: 'rubiks-cube', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  server.registerTool('get_cube', {
    title: 'Get cube',
    description: "Current state of the user's physical cube: how to hold it, a text diagram, and solve progress.",
    annotations: { readOnlyHint: true },
  }, async () => text(report(session)));

  server.registerTool('set_cube', {
    title: 'Set cube state',
    description:
      'Replace the cube state. 54 letters, faces in order U R F D L B (top, right, front, bottom, left, back), ' +
      'each face read row by row as seen looking straight at it (U with back edge at the top, D with front edge at the top, ' +
      'side faces with the top up). Letters name colours: U=white R=red F=green D=yellow L=orange B=blue. Clears the plan.',
    inputSchema: { facelets: z.string().length(54).regex(/^[URFDLB]+$/) },
  }, async ({ facelets }) => {
    const errors = validate(facelets);
    if (errors.length) return fail(`Not a valid cube: ${errors.join(' ')}`);
    session.setState(facelets);
    return text(report(session));
  });

  server.registerTool('solve', {
    title: 'Solve',
    description: 'Compute a near-optimal solution (≤22 moves, Kociemba) for the current state and store it as the plan.',
  }, async () => {
    try {
      const moves = session.solve();
      if (!moves.length) return text('Already solved.');
      return text(`${moves.length} moves: ${moves.join(' ')}\n\n${report(session)}`);
    } catch (err) {
      return fail(err.message);
    }
  });

  server.registerTool('apply_moves', {
    title: 'Apply moves',
    description:
      'Record moves the user has done on the real cube (standard notation, e.g. "R U2 F\'"). ' +
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
    description: 'Set the cube to solved (standard orientation) and clear the plan.',
    annotations: { destructiveHint: true },
  }, async () => {
    session.reset();
    return text(report(session));
  });

  return server;
}

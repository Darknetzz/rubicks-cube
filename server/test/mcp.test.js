import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../src/mcp.js';
import { Session } from '../src/session.js';
import { moveHint } from '../../js/hints.js';

async function connect() {
  const session = new Session(null);
  const server = buildMcpServer(session);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { session, client, close: () => Promise.all([client.close(), server.close()]) };
}

const textOf = (result) => result.content.map((c) => c.text).join('\n');

test('set_cube describes colour letters and centre-detected schemes, not the old face letters', async () => {
  const { client, close } = await connect();
  const { tools } = await client.listTools();
  const setCube = tools.find((t) => t.name === 'set_cube');
  assert.match(setCube.description, /W Y R O G B/);
  assert.match(setCube.description, /centres/);
  assert.doesNotMatch(setCube.description, /U=white|letters are U R F D L B|faces in order U R F D L B/);
  assert.equal(setCube.inputSchema.properties.facelets.pattern, '^[WYROGB]+$');
  await close();
});

test('every plan line in the MCP output carries its direction hint', async () => {
  const { client, session, close } = await connect();
  session.apply("R U F' L2 D B'");
  const out = textOf(await client.callTool({ name: 'solve', arguments: {} }));
  const plan = session.plan;
  assert.ok(plan.length > 0);
  for (const m of plan) assert.ok(out.includes(`Hint: ${moveHint(m).text}`), `missing hint for ${m}`);
  const after = textOf(await client.callTool({ name: 'apply_moves', arguments: { moves: plan.slice(0, 2).join(' ') } }));
  assert.match(after, new RegExp(`→ 3\\. ${plan[2].replace("'", "\\'")}: .*Hint: `));
  await close();
});

test('get_cube shows an unfinished painting with painted stickers in capitals and its problems', async () => {
  const { client, session, close } = await connect();
  const bad = 'Y'.repeat(9) + session.state.slice(9);
  session.setDraft(bad, '1'.repeat(9) + '0'.repeat(45));
  const out = textOf(await client.callTool({ name: 'get_cube', arguments: {} }));
  assert.match(out, /UNFINISHED PAINTING/);
  assert.match(out, /18 yellow stickers instead of 9/);
  assert.match(out, /painted 9 of 54/);
  assert.ok(out.includes(`Draft facelets: ${'Y'.repeat(9)}${bad.slice(9).toLowerCase()}`));
  assert.match(out, /Current cube state/);
  await client.callTool({ name: 'set_cube', arguments: { facelets: session.state } });
  assert.doesNotMatch(textOf(await client.callTool({ name: 'get_cube', arguments: {} })), /UNFINISHED/);
  await close();
});

const steps = (str, label) => str.split(' ').map((move) => (label ? { move, label } : { move }));

test('set_plan stores labelled steps that apply_moves advances like a solve', async () => {
  const { client, session, close } = await connect();
  const solved = session.state;
  let r = await client.callTool({ name: 'set_plan', arguments: { steps: steps("R U R' U'", 'sexy move') } });
  assert.ok(!r.isError);
  assert.deepEqual(session.plan, ['R', 'U', "R'", "U'"]);
  assert.deepEqual(session.labels, Array(4).fill('sexy move'));
  assert.equal(session.state, solved, 'nothing is turned');
  assert.match(textOf(r), /→ 1\. \[sexy move\] R: .*Hint: /);
  r = await client.callTool({ name: 'apply_moves', arguments: { moves: 'R U' } });
  assert.doesNotMatch(textOf(r), /did not follow/);
  assert.equal(session.step, 2);
  await client.callTool({ name: 'set_plan', arguments: { steps: [{ move: 'F2' }] } });
  assert.deepEqual(session.plan, ['R', 'U', 'F2'], 'done steps kept, the rest replaced');
  assert.deepEqual(session.labels, ['sexy move', 'sexy move', null]);
  assert.equal(session.step, 2);
  await client.callTool({ name: 'set_plan', arguments: { steps: steps('M x', 'stage 2'), append: true } });
  assert.deepEqual(session.plan, ['R', 'U', 'F2', 'M', 'x']);
  assert.equal(session.labels[4], 'stage 2');
  await client.callTool({ name: 'set_plan', arguments: { steps: [] } });
  assert.deepEqual(session.plan, ['R', 'U'], 'empty drops the remaining steps');
  session.reset();
  assert.equal(session.labels, null);
  await client.callTool({ name: 'set_plan', arguments: { steps: [] } });
  assert.equal(session.plan, null);
  await close();
});

test('set_plan rejects invalid notation and steps with more than one move, changing nothing', async () => {
  const { client, session, close } = await connect();
  for (const bad of [[{ move: 'Q' }], [{ move: 'R U' }], [{ move: 'R' }, { move: 'K2' }]]) {
    const r = await client.callTool({ name: 'set_plan', arguments: { steps: bad } });
    assert.ok(r.isError, JSON.stringify(bad));
  }
  assert.equal(session.plan, null);
  await close();
});

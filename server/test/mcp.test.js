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

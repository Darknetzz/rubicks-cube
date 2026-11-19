import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Cubes, validCube } from '../src/cubes.js';
import { buildMcpServer } from '../src/mcp.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'cubes-'));

test('cube codes: default or 8-32 lower-case letters and digits', () => {
  for (const ok of ['default', 'abcd2345', 'k3f9x2m7qa']) assert.ok(validCube(ok), ok);
  for (const bad of ['', 'short', 'UPPERCASE1', '../etc/passwd', 'a'.repeat(33), 'abc-defgh', null, undefined]) {
    assert.ok(!validCube(bad), String(bad));
  }
  assert.throws(() => new Cubes(null, null).get('../x'), /Invalid cube code/);
});

test('each code is its own cube, saved in its own file; the default keeps the old file', () => {
  const dir = tmp();
  const cubes = new Cubes(join(dir, 'state.json'), join(dir, 'cubes'));
  const events = [];
  cubes.on('change', (id, ev) => events.push([id, ev.type]));
  cubes.get('aaaaaaaa').apply('R');
  cubes.get('bbbbbbbb').apply('U');
  assert.notEqual(cubes.get('aaaaaaaa').state, cubes.get('bbbbbbbb').state);
  assert.equal(cubes.get().state, cubes.get('default').state);
  assert.deepEqual(events, [['aaaaaaaa', 'moves'], ['bbbbbbbb', 'moves']]);
  assert.ok(existsSync(join(dir, 'cubes', 'aaaaaaaa.json')));
  assert.ok(!existsSync(join(dir, 'state.json'))); // default untouched
  cubes.get().apply('F');
  assert.ok(existsSync(join(dir, 'state.json')));
  // reloads from disk
  const again = new Cubes(join(dir, 'state.json'), join(dir, 'cubes'));
  assert.equal(again.get('aaaaaaaa').state, cubes.get('aaaaaaaa').state);
});

test('MCP tools work on the cube named by "cube", and reject a bad code', async () => {
  const cubes = new Cubes(null, null);
  const server = buildMcpServer((id) => cubes.get(id));
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  for (const t of tools) assert.ok(t.inputSchema.properties.cube, `${t.name} has no cube argument`);
  await client.callTool({ name: 'apply_moves', arguments: { moves: 'R', cube: 'abcdefgh' } });
  assert.notEqual(cubes.get('abcdefgh').state, cubes.get().state);
  const bad = await client.callTool({ name: 'get_cube', arguments: { cube: 'nope' } });
  assert.ok(bad.isError);
  assert.match(bad.content[0].text, /Invalid cube code/);
  await Promise.all([client.close(), server.close()]);
});

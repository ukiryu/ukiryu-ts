import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as api from '../../dist/node.js';
import { yamlReplay } from '../conformance/yaml.mjs';

const engine = await api.load();
const digest = async (text) => createHash('sha256').update(text).digest('hex');
const id = 'yaml.roundtrip.example';
const source = 'name: x\nversion: "1.0"\nprofiles: []\n';
// Literal fixture, independent of the engine under test.
const golden = 'name: x\nversion: "1.0"';
const rule = { id, golden: 'emitter/example.yaml', golden_sha256: await digest(golden) };
const fixture = (overrides = {}) => yamlReplay({
  engine, api, digest,
  readInput: async (file) => { assert.equal(file, 'example.yaml'); return source; },
  loadRule: async (file) => file === 'emitter.json'
    ? JSON.stringify({ rows: [rule, { ...rule, id: 'yaml.roundtrip.other' }] })
    : golden,
  ...overrides,
});
const input = new Map([['file', 'example.yaml'], ['model', 'ToolDefinition']]);
const ok = (emitted, reparsed_equal = true) => new Map([
  ['ok', new Map([['emitted', emitted], ['reparsed_equal', reparsed_equal]])],
]);

test('safe YAML loading retains Integer, Float, Symbol and ordinary $ref keys', async () => {
  const request = fixture({ readInput: async () => 'integer: 9007199254740993\nfloat: 1.0\nsymbol: :name\nref: { $ref: "#/item" }\n' });
  const job = await request('yaml.load', input, 'yaml.load.example');
  const value = job.call();
  assert.equal(value.get('integer'), 9007199254740993n);
  assert.equal(value.get('float').text, '1.0');
  assert.equal(value.get('symbol'), api.RubySymbol.for('name'));
  assert.equal(value.get('ref').get('$ref'), '#/item');
  const expected = new Map([['ok', api.parseJson('{"integer":9007199254740993,"float":{"$float":"1.0"},"symbol":{"$sym":"name"},"ref":{"$ref":"#/item"}}')]]);
  const have = new Map([['ok', api.encode(value)]]);
  assert.equal(job.mismatch(have, expected), null);
  expected.get('ok').set('integer', '9007199254740993');
  assert.match(job.mismatch(have, expected), /value differs/);
});

test('roundtrip compares pinned bytes, canonical scalar types and re-emission', async () => {
  const job = await fixture()('yaml.lutaml_roundtrip', input, id);
  const actual = new Map([['ok', api.encode(job.call())]]);
  assert.equal(job.mismatch(actual, ok('---\nname: x\nversion: "1.0"\n')), null);
  assert.match(job.mismatch(actual, ok('name: x\nversion: 1.0\n')), /frozen Psych value/);
  assert.match(job.mismatch(ok(golden + '\n'), ok(golden)), /pinned Yeptris golden/);
  assert.match(job.mismatch(ok(golden, false), ok(golden)), /not stable/);
  assert.match(job.mismatch(new Map([['error', 'broken']]), ok(golden)), /must succeed/);
  const extra = ok(golden);
  extra.get('ok').set('extra', true);
  assert.match(job.mismatch(extra, ok(golden)), /keys differ/);
});

test('roundtrip refuses corrupted, missing and duplicate emitter rules', async () => {
  const corrupted = fixture({ loadRule: async (file) => file === 'emitter.json'
    ? JSON.stringify({ rows: [rule, { ...rule, id: 'yaml.roundtrip.other' }] }) : golden + '\n' });
  await assert.rejects(corrupted('yaml.lutaml_roundtrip', input, id), /digest differs/);
  await assert.rejects(fixture()('yaml.lutaml_roundtrip', input, 'yaml.roundtrip.absent'), /missing emitter rule/);
  const duplicate = fixture({ loadRule: async () => JSON.stringify({ rows: [rule, rule] }) });
  await assert.rejects(duplicate('yaml.lutaml_roundtrip', input, id), /duplicate emitter rule/);
});

test('unmapped operations stay out of the portable YAML dispatcher', async () => {
  assert.equal(await fixture()('yaml.model_load', input, 'model.example'), null);
  assert.throws(() => engine.request('yaml', { method: 'model_load', model: 'Interface', path: '/virtual/example.yaml' }),
    error => error instanceof api.UkiryuError && error.code === 'UNSUPPORTED_CAPABILITY');
});

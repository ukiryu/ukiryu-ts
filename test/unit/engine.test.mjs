// The Node entry over the vendored engine. These check the runtime's wiring
// and typed replies; the conformance corpus (test/conformance) checks
// behaviour against the Ruby oracle.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ABI_VERSION, load, RubyFloat, RubySymbol, Ukiryu, UkiryuError } from '../../dist/node.js';

const engine = await load();

// A tool definition supplied as text: no register, file or process is used.
const DEFINITION = `---
ukiryu_schema: '1.0'
name: convert
version: '1.0'
profiles:
- name: default
  platforms: [linux, macos, windows]
  shells: [bash, zsh, sh, fish, powershell, cmd]
  option_style: double_dash_equals
  commands:
  - name: run
    arguments:
    - name: inputs
      type: file
      variadic: true
      min: 1
      position: last
    options:
    - name: output
      type: file
      cli: "--output"
      assignment_delimiter: equals
`;
const tool = { source: { kind: 'definition', yaml: DEFINITION }, platform: 'linux', shell: 'bash' };

test('the engine speaks the runtime ABI and is loaded once', async () => {
  assert.equal(ABI_VERSION, 1);
  assert.equal(engine.coreVersion, '0.1.0');
  assert.equal(await load(), engine);
  assert.throws(
    () => Ukiryu.fromBinding({ abi_version: () => 2, core_version: () => 'x', process: () => '' }),
    /wire ABI 2/,
  );
});

test('build plans a command from a supplied definition without executing it', () => {
  const built = engine.build({
    tool,
    command: 'run',
    params: new Map([
      [RubySymbol.for('inputs'), ['in put.txt']],
      [RubySymbol.for('output'), 'out.txt'],
    ]),
  });
  assert.equal(built.command_name, 'run');
  assert.ok(built.args.includes('in put.txt'));
  assert.equal(built.executable, null, 'the portable engine discovers no executables');
  assert.deepEqual(built.env, []);
  assert.equal(built.stdin, null);
});

test('resolve tool reports the identity of a supplied definition', () => {
  const identity = engine.resolve({ method: 'tool', ...tool });
  assert.ok(identity instanceof Map);
  assert.equal(identity.get('name'), 'convert');
  assert.equal(identity.get('profile_name'), 'default');
  assert.deepEqual(identity.get('commands'), ['run']);
});

test('validate definition returns a typed report without reading files', () => {
  const report = engine.validate({ method: 'definition', yaml: DEFINITION });
  assert.equal(typeof report.valid, 'boolean');
  assert.equal(typeof report.error_count, 'bigint');
  assert.ok(Array.isArray(report.errors));
});

test('schema fully_validate takes the schema as text', () => {
  const schema = 'type: object\nrequired: [name]\nproperties:\n  name: {type: string}\n';
  assert.deepEqual(engine.schema({ method: 'fully_validate', profile: 'name: x\n', schema }), []);
  const errors = engine.schema({ method: 'fully_validate', profile: 'other: 1\n', schema });
  assert.equal(errors.length, 1);
});

test('schema validate_profile_text takes the schema as text', () => {
  const schema = 'type: object\nrequired: [name]\nproperties:\n  name: {type: string}\n';
  assert.deepEqual(engine.schema({ method: 'validate_profile_text', profile: 'name: x\n', schema }), []);
  assert.equal(engine.schema({ method: 'validate_profile_text', profile: 'other: 1\n', schema }).length, 1);
  assert.deepEqual(engine.schema({ method: 'validate_profile_text', profile: 'name: x\n', schema: null }), [
    'Failed to load schema',
  ]);
});

test('validate definition_text runs the supplied schema stage', () => {
  const schema = '{"type": "object", "required": ["nonexistent_key"]}';
  const report = engine.validate({ method: 'definition_text', yaml: DEFINITION, schema, schema_format: 'json' });
  assert.equal(report.schema_stage.get('kind'), 'supplied');
  assert.ok(report.errors.some((e) => e.includes('nonexistent_key')), report.errors.join('\n'));
  const skipped = engine.validate({ method: 'definition_text', yaml: DEFINITION });
  assert.equal(skipped.schema_stage.get('kind'), 'supplied_not_loaded');
});

test('CLI snapshots refuse external schema resources on every host', () => {
  const request = (schema) => engine.request('cli.run', {
    argv: ['validate', 'file', '/profile.yaml', '--schema', '/schema.yaml'],
    platform: 'linux', env: {},
    snapshot: {
      files: { '/profile.yaml': DEFINITION, '/schema.yaml': schema },
      executables: {}, probes: [], definitions: [],
    },
  });
  assert.ok(request('type: object\n').has('exit'));
  for (const reference of [
    String.raw`file://D:\a\ukiryu-rs\ukiryu-rs\ukiryu/Cargo.toml`,
    'file:///C:/host/Cargo.toml',
    'file://localhost/C:/host/Cargo.toml',
    String.raw`C:\host\Cargo.toml`,
    String.raw`\\server\share\Cargo.toml`,
    'file:///host/Cargo.toml',
    '../host/Cargo.toml',
    'https://example.invalid/schema.json',
  ]) {
    assert.throws(
      () => request(`$ref: ${reference}\n`),
      (error) => error instanceof UkiryuError && error.code === 'UNSUPPORTED_CAPABILITY',
      reference,
    );
  }
});

test('Hash key order survives the engine reply', () => {
  const value = engine.validate({ method: 'type', value: new Map([['zeta', 1n], ['alpha', 2n], ['mid', 3n]]), type: RubySymbol.for('hash') });
  assert.deepEqual([...value.keys()], ['zeta', 'alpha', 'mid']);
});

test('Integer and Float values cross the engine exactly', () => {
  const big = 2n ** 80n + 7n;
  assert.equal(engine.validate({ method: 'type', value: big, type: RubySymbol.for('integer') }), big);
  const float = engine.validate({ method: 'type', value: new RubyFloat('1.0e+20'), type: RubySymbol.for('float') });
  assert.ok(float instanceof RubyFloat);
  assert.equal(float.text, '1.0e+20');
});

test('the core rejects a Float text that is not Float#to_s', () => {
  assert.throws(
    () => engine.validate({ method: 'type', value: new RubyFloat('1e20'), type: RubySymbol.for('float') }),
    (error) => error instanceof UkiryuError && error.code === 'INVALID_REQUEST',
  );
});

test('core errors carry the code and the Ruby class', () => {
  assert.throws(
    () => engine.escape('nosuch', { method: 'escape', string: 'x' }),
    (error) =>
      error instanceof UkiryuError &&
      error.code === 'UNKNOWN_SHELL' &&
      error.sourceClass === 'Ukiryu::Errors::UnknownShellError' &&
      error.message === 'Unknown shell: nosuch',
  );
});

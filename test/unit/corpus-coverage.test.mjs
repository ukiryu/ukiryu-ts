import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load, UkiryuError } from '../../dist/node.js';
import { portableCliApplicability } from '../conformance/cli-snapshot.mjs';
import { portableShellApplicability } from '../conformance/lint-shell.mjs';
import { DISPATCHED, NOT_DISPATCHED, TOTAL } from '../conformance/corpus.mjs';

test('portable corpus groups have fixed executed counts checked by both CI runners', () => {
  assert.deepEqual(DISPATCHED, {
    'yaml.load': 81, 'yaml.lutaml_roundtrip': 2,
    'cli.run': 21, 'build.args': 485, 'shell.*': 12616, 'resolve.extract_version': 372,
    'resolve.range': 68, 'resolve.version_spec': 130, 'type.validate': 60,
    'resolve.shell_detect': 17, 'lint.string': 70,
    'schema.validate_profile': 135, 'schema.definition_validate': 58,
  });
  const dispatched = Object.values(DISPATCHED).reduce((a, b) => a + b, 0);
  assert.equal(dispatched, 14115);
  assert.equal(dispatched + Object.values(NOT_DISPATCHED).reduce((n, [count]) => n + count, 0), TOTAL);
  assert.deepEqual(Object.keys(NOT_DISPATCHED).sort(), ['yaml.model_load']);
});

test('only the frozen Unix shell-detection group uses an explicit Linux environment', () => {
  const check = (op, kind, platforms, requires) => portableShellApplicability(op, kind, platforms, requires);
  assert.equal(check('resolve.shell_detect', 'resolve', ['linux', 'macos'], []), true);
  assert.equal(check('resolve.range', 'resolve', ['linux', 'macos'], []), false);
  assert.equal(check('resolve.shell_detect', 'process', ['linux', 'macos'], []), false);
  assert.equal(check('resolve.shell_detect', 'resolve', ['linux', 'windows'], []), false);
  assert.equal(check('resolve.shell_detect', 'resolve', ['linux'], []), false);
  assert.equal(check('resolve.shell_detect', 'resolve', ['linux', 'macos'], ['process']), false);
});

test('portable CLI requires an explicit snapshot and retains native capability refusals', async () => {
  const engine = await load();
  assert.throws(() => engine.request('cli.run', { argv: ['version'] }),
    error => error instanceof UkiryuError && error.code === 'INVALID_REQUEST');
  assert.throws(() => engine.request('cli', { argv: ['version'] }),
    error => error instanceof UkiryuError && error.code === 'UNSUPPORTED_CAPABILITY');
});

test('only the deterministic CLI group bypasses host applicability', () => {
  const check = (op,kind,platforms,requires) => portableCliApplicability(op,kind,platforms,requires);
  assert.equal(check('cli.run','cli-output',['linux'],['cli','process','fs']),true);
  assert.equal(check('execute','cli-output',['linux'],['cli','process','fs']),false);
  assert.equal(check('cli.run','process',['linux'],['cli','process','fs']),false);
  assert.equal(check('cli.run','cli-output',['windows'],['cli','process','fs']),false);
  assert.equal(check('cli.run','cli-output',['linux'],['cli','process','fs','network']),false);
});

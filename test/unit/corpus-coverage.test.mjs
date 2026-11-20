import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load, UkiryuError } from '../../dist/node.js';
import { DISPATCHED, NOT_DISPATCHED, TOTAL } from '../conformance/corpus.mjs';

test('portable corpus groups have fixed executed counts checked by both CI runners', () => {
  assert.deepEqual(DISPATCHED, {
    'build.args': 485, 'shell.*': 12616, 'resolve.extract_version': 372,
    'resolve.range': 68, 'resolve.version_spec': 130, 'type.validate': 60,
    'schema.validate_profile': 135, 'schema.definition_validate': 58,
  });
  const dispatched = Object.values(DISPATCHED).reduce((a, b) => a + b, 0);
  assert.equal(dispatched, 13924);
  assert.equal(dispatched + Object.values(NOT_DISPATCHED).reduce((n, [count]) => n + count, 0), TOTAL);
  assert.equal(NOT_DISPATCHED['cli.run'][0], 21);
});

test('CLI corpus blocker is the actual vendored WASM boundary', async () => {
  const engine = await load();
  for (const op of ['cli', 'cli.run']) {
    assert.throws(() => engine.request(op, { argv: ['version'] }),
      (error) => error instanceof UkiryuError && error.code === 'UNSUPPORTED_CAPABILITY');
  }
});

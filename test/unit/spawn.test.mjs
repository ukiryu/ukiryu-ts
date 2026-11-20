import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { load, Ukiryu, UkiryuError, nodeSpawner } from '../../dist/node.js';
import { load as loadWeb } from '../../dist/web.js';

const engine = await load();
const yaml = `ukiryu_schema: '1.0'
name: node
version: '1.0'
profiles:
- name: default
  platforms: [linux, macos, windows]
  shells: [bash, zsh, sh, fish, powershell, cmd]
  commands:
  - name: run
    arguments:
    - name: args
      type: string
      variadic: true
      position: last
`;
const tool = {
  source: { kind: 'definition', yaml },
  platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  shell: process.platform === 'win32' ? 'powershell' : 'bash',
};
const request = (...args) => ({ tool, command: 'run', params: { args } });
const text = (bytes) => new TextDecoder().decode(bytes);

test('execute uses the core argv literally, preserving spaces and shell metacharacters', async () => {
  const literal = 'space ; $HOME $(exit 7) "quoted"';
  const result = await engine.execute(request('-e', 'process.stdout.write(process.argv[1])', literal), {
    executable: process.execPath,
  });
  assert.equal(text(result.stdout), literal);
  assert.equal(text(result.stderr), '');
  assert.equal(result.exitStatus, 0);
  assert.equal(result.signal, null);
  assert.equal(result.timedOut, false);
});

test('execute passes stdin, cwd and environment, preserving raw output bytes', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'ukiryu-spawn-'));
  try {
    const code = `process.stdin.on('data', x => process.stdout.write(x));
      process.stdin.on('end', () => process.stderr.write(JSON.stringify([process.cwd(), process.env.UKIRYU_SPAWN_TEST, process.env.PATH !== undefined])));`;
    const result = await engine.execute(request('-e', code), {
      executable: process.execPath,
      cwd,
      env: { UKIRYU_SPAWN_TEST: 'from adapter' },
      stdin: new Uint8Array([0, 255, 10]),
    });
    assert.deepEqual(result.stdout, new Uint8Array([0, 255, 10]));
    assert.deepEqual(JSON.parse(text(result.stderr)), [cwd, 'from adapter', true]);
    assert.equal(result.exitStatus, 0);
  } finally {
    await rm(cwd, { recursive: true });
  }
});

test('non-zero exit and stderr are returned without native failure-policy emulation', async () => {
  const result = await engine.execute(request('-e', 'process.stderr.write("failed"); process.exitCode = 7'), {
    executable: process.execPath,
  });
  assert.equal(result.exitStatus, 7);
  assert.equal(text(result.stderr), 'failed');
  assert.equal(result.timedOut, false);
});

test('deadline kills the direct child and returns its captured output', { timeout: 5000 }, async () => {
  const result = await engine.execute(request('-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'), {
    executable: process.execPath,
    timeout: 0.3,
  });
  assert.equal(text(result.stdout), 'ready');
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.exitStatus, null);
});

test('missing executable and invalid deadlines fail clearly', async () => {
  await assert.rejects(engine.execute(request('-v')), (error) => error instanceof UkiryuError && error.code === 'EXECUTABLE_REQUIRED');
  await assert.rejects(engine.execute(request('-v'), { executable: '/no/such/ukiryu-test-executable' }),
    (error) => error instanceof UkiryuError && error.code === 'SPAWN_ERROR');
  for (const timeout of [-1, NaN, Infinity, 2147484]) {
    await assert.rejects(engine.execute(request('-v'), { executable: process.execPath, timeout }), RangeError);
  }
});

test('an injected adapter receives the canonical shell and the unchanged core plan', async () => {
  const binding = createRequire(import.meta.url)('../../vendor/ukiryu-wasm/ukiryu.js');
  const expected = { stdout: new Uint8Array(), stderr: new Uint8Array(), exitStatus: 0, signal: null, timedOut: false };
  let seen;
  const custom = Ukiryu.fromBinding(binding, { spawn: async (input) => { seen = input; return expected; } });
  const input = request('literal data');
  input.params.stdin = 'built input\n';
  const built = custom.build(input);
  assert.equal(await custom.execute(input, { executable: process.execPath }), expected);
  assert.deepEqual(seen.argv, [process.execPath, ...built.args]);
  assert.deepEqual(seen.env, Object.fromEntries(built.env));
  assert.deepEqual(seen.stdin, built.stdin);
  assert.equal(seen.shell, process.platform === 'win32' ? 'powershell' : 'bash');
  assert.equal(seen.timeout, 0);
});

test('core validation failures never reach the host adapter', async () => {
  const binding = createRequire(import.meta.url)('../../vendor/ukiryu-wasm/ukiryu.js');
  let calls = 0;
  const custom = Ukiryu.fromBinding(binding, { spawn: async () => { calls++; throw new Error('unexpected spawn'); } });
  await assert.rejects(custom.execute({ ...request('x'), command: 'not-a-command' }, { executable: process.execPath }), UkiryuError);
  assert.equal(calls, 0);
});

test('browser entry has no spawner and refuses execution', async () => {
  const wasm = await readFile(new URL('../../vendor/ukiryu-web/ukiryu_bg.wasm', import.meta.url));
  const web = await loadWeb({ wasm });
  await assert.rejects(web.execute(request('-v'), { executable: process.execPath }),
    (error) => error instanceof UkiryuError && error.code === 'UNSUPPORTED_CAPABILITY' && /Spawner/.test(error.message));
});

test('adapter handles early stdin closure without an unhandled EPIPE', async () => {
  const result = await nodeSpawner.spawn({
    argv: [process.execPath, '-e', 'process.exit(0)'], shell: 'bash', env: {},
    stdin: new Uint8Array(2 * 1024 * 1024), timeout: 2,
  });
  assert.equal(result.exitStatus, 0);
});

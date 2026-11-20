import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as api from '../../dist/node.js';
import { lintShellReplay } from '../conformance/lint-shell.mjs';

const engine = await api.load();
const digest = async text => createHash('sha256').update(text).digest('hex');
// Frozen Ruby /bin/csh observation and its existing core D2 migration.
const frozen = { ok: { detect: { $sym: 'sh' }, shell_class: 'Ukiryu::Shell::Sh' } };
const row = {
  id: 'resolve.shell_detect.shell-env.bin-csh', op: 'resolve.shell_detect', decision: 'D2',
  input: { env: { SHELL: '/bin/csh', UKIRYU_TEST_SHELL: null } }, expect: frozen,
};
const rule = {
  id: row.id, basis: 'D2', trace: 'D2; ukiryu#19, ukiryu#29',
  frozen_expect_sha256: 'f23ea182e2790d9b693a8447ea11434fbf7b28270bc796e0fbfe700ec436e1d1',
  expect: { error: { class: 'Ukiryu::Errors::UnknownShellError', message: 'Unknown shell in SHELL: /bin/csh' } },
  detail: { code: 'UnknownShell', variant: 'Unknown', stage: 'ShellVariable' },
};
const typed = value => api.parseJson(JSON.stringify(value));
const fixture = (rules = [rule], overrides = {}) => lintShellReplay({
  engine, api, digest, readInput: async () => { throw new Error('unexpected file read'); },
  loadRule: async file => { assert.equal(file, 'migrated.json'); return JSON.stringify({ rows: rules }); },
  ...overrides,
});
const outcome = call => {
  try { return { have: new Map([['ok', api.encode(call())]]), detail: null }; }
  catch (error) {
    if (!(error instanceof api.UkiryuError)) throw error;
    return { have: typed({ error: { class: error.sourceClass, message: error.message } }), detail: error.detail.get('detail') };
  }
};

test('lint preserves complete issues, Symbol keys and Integer counts for inline and file text', async () => {
  const request = fixture([], { readInput: async file => { assert.equal(file, 'scalar.yaml'); return 'just a string'; } });
  for (const input of [{ yaml: 'just a string' }, { file: 'scalar.yaml' }]) {
    const job = await request(typed({ op: 'lint.string', input }));
    const report = job.call();
    assert.equal(report.get(api.RubySymbol.for('error_count')), 1n);
    assert.equal(report.get(api.RubySymbol.for('total_count')), 1n);
    const [issue] = report.get(api.RubySymbol.for('issues'));
    assert.equal(issue.get(api.RubySymbol.for('severity')), api.RubySymbol.for('error'));
    assert.equal(issue.get(api.RubySymbol.for('message')), 'Definition must be a hash/object');
  }
  const empty = await request(typed({ op: 'lint.string', input: { yaml: '', file: 'must-not-be-read' } }));
  assert.equal(empty.call().get(api.RubySymbol.for('error_count')), 1n);
});

test('shell detection ignores ambient Node variables and retains exact unmigrated Ruby output', async () => {
  const previous = process.env.UKIRYU_TEST_SHELL;
  try {
    process.env.UKIRYU_TEST_SHELL = 'cmd';
    const plain = typed({ id: 'resolve.shell_detect.shell-env.bin-bash', op: row.op,
      input: { env: { SHELL: '/bin/bash', UKIRYU_TEST_SHELL: null } } });
    const job = await fixture([])(plain);
    const { have } = outcome(job.call);
    const want = typed({ ok: { detect: { $sym: 'bash' }, shell_class: 'Ukiryu::Shell::Bash' } });
    assert.equal(job.mismatch(have, want), null);
    want.get('ok').set('shell_class', 'Ukiryu::Shell::Cmd');
    assert.match(job.mismatch(have, want), /outcome differs/);
  } finally {
    if (previous === undefined) delete process.env.UKIRYU_TEST_SHELL;
    else process.env.UKIRYU_TEST_SHELL = previous;
  }
});

test('D2 migration compares exact error class, message and structured stage', async () => {
  const job = await fixture()(typed(row));
  const { have, detail } = outcome(job.call);
  assert.equal(job.mismatch(have, typed(frozen), detail), null);
  const wrong = new Map(detail).set('stage', 'TestOverride');
  assert.match(job.mismatch(have, typed(frozen), wrong), /detail differs/);
  const altered = typed(rule.expect);
  altered.get('error').set('message', 'another message');
  assert.match(job.mismatch(altered, typed(frozen), detail), /outcome differs/);
  altered.get('error').set('message', rule.expect.error.message);
  altered.get('error').set('class', 'OtherError');
  assert.match(job.mismatch(altered, typed(frozen), detail), /outcome differs/);
});

test('missing migration cannot silently accept a divergent D2 result', async () => {
  const job = await fixture([])(typed(row));
  const { have, detail } = outcome(job.call);
  assert.match(job.mismatch(have, typed(frozen), detail), /outcome differs/);
});

test('changed frozen observations, decisions and untraced migrations fail closed', async () => {
  await assert.rejects(fixture()(typed({ ...row, expect: { ok: null } })), /frozen shell expectation changed/);
  await assert.rejects(fixture()(typed({ ...row, decision: 'D1' })), /untraced shell migration/);
  for (const changed of [{ basis: 'D1' }, { trace: 'no issue reference' }]) {
    await assert.rejects(fixture([{ ...rule, ...changed }])(typed(row)), /untraced shell migration/);
  }
});

test('duplicate migration rules and incomplete diagnostic details fail closed', async () => {
  await assert.rejects(fixture([rule, rule])(typed(row)), /duplicate shell migration/);
  await assert.rejects(fixture([{ ...rule, detail: { code: 'UnknownShell' } }])(typed(row)), /freeze error detail/);
  await assert.rejects(fixture([{ ...rule, expect: {} }])(typed(row)), /invalid shell migration outcome/);
});

test('unmapped operations remain outside this portable dispatcher', async () => {
  assert.equal(await fixture()(typed({ op: 'yaml.model_load', input: {} })), null);
});

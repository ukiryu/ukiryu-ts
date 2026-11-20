// Caller-owned virtual paths never name a host filesystem. Output paths are
// scrubbed with the same substitutions as the native capture runner.
// Every text input is verified against the corpus manifest before rendering.
export async function cliSnapshot(inputPaths, readInput) {
  const files = new Map();
  for (const path of inputPaths) files.set(`/snapshot/inputs/${path}`, await readInput(path));
  return {
    platform: 'linux',
    env: { HOME: '/snapshot/home', SHELL: '/bin/bash', PATH: '', TZ: 'UTC', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TERM: 'dumb', COLUMNS: '100', THOR_COLUMNS: '100', UKIRYU_REGISTER: '/snapshot/inputs/register' },
    snapshot: { files, executables: {}, probes: [], definitions: [] },
  };
}

// `$`-prefixed map keys are Ruby value tags in the runtime codec. Ordinary
// virtual paths avoid that ambiguity; substitutions are a runner concern.
export function renderCli(engine, argv, context) {
  const mapped = argv.map(word => word.replaceAll('${INPUTS}', '/snapshot/inputs').replaceAll('${HOME}', '/snapshot/home'));
  const value = engine.request('cli.run', { argv: mapped, ...context });
  return new Map([...value].map(([key,part]) => [key, typeof part === 'string'
    ? part.replaceAll('/snapshot/inputs','${INPUTS}').replaceAll('/snapshot/home','${HOME}') : part]));
}

// Only the frozen deterministic CLI group can use a captured Linux snapshot.
// Other platform/requirement restrictions retain the runner's normal guard.
export function portableCliApplicability(op, kind, platforms, requires) {
  return op === 'cli.run' && kind === 'cli-output'
    && platforms.length === 1 && platforms[0] === 'linux'
    && requires.length === 3 && requires.join(',') === 'cli,process,fs';
}

/** Focused local check: these 21 unchanged rows only, not the full corpus. */
export async function runCliCorpus({engine, api, load, digest}) {
  const manifest = JSON.parse(await load('manifest.json'));
  if (manifest.oracle.commit !== 'ab6df353c6dc2d7faf7817a86aafcafa82579896') throw new Error('CLI oracle changed');
  const inputs = new Map(manifest.inputs.map(input => [input.path, input.sha256]));
  const readInput = async path => {
    const text = await load(`inputs/${path}`);
    if (!inputs.has(path) || await digest(text) !== inputs.get(path)) throw new Error(`input digest mismatch: ${path}`);
    return text;
  };
  const context = await cliSnapshot(inputs.keys(),readInput);
  const file = 'cases/cli-output.jsonl';
  const text = await load(file);
  if (await digest(text) !== manifest.cases.files[file]) throw new Error('CLI cases digest mismatch');
  const rows = text.trim().split('\n').map(JSON.parse);
  if (rows.length !== 21) throw new Error(`CLI row count ${rows.length}`);
  for (const row of rows) {
    if (!portableCliApplicability(row.op,row.kind,row.applicability.platforms,row.applicability.requires)) throw new Error(`CLI applicability changed: ${row.id}`);
    const actual = renderCli(engine,row.input.argv,context);
    if (!api.jsonEqual(actual,api.parseJson(JSON.stringify(row.expect.ok)))) throw new Error(`${row.id}: ${api.stringifyJson(actual)}`);
  }
  const base = renderCli(engine,['help'],context);
  const changed = renderCli(engine,['help','exec'],context);
  if (api.jsonEqual(base,changed)) throw new Error('help mutation did not change output');
  for (const argv of [['exec','jq','process'],['register','update'],['config','set','shell','sh']]) {
    let refused = false;
    try { renderCli(engine,argv,context); } catch(error) { refused = error instanceof api.UkiryuError && error.code === 'UNSUPPORTED_CAPABILITY'; }
    if (!refused) throw new Error(`side effects not refused: ${argv}`);
  }
  return {cliRows:rows.length,oracle:manifest.oracle.commit};
}

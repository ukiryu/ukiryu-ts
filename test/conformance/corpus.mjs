// The conformance corpus through the package's public API, in Node or a
// browser. This file maps corpus rows to API calls and compares results with
// the rows' expectations; every result comes from the core engine.
//
// Rows are parsed with the package's lossless JSON parser, so an Integer, a
// Float's text, a Symbol or a Time in an expectation is compared exactly and
// never through JSON.parse. Each API result is decoded into typed values and
// encoded again before the comparison, so the comparison also covers the
// codec round trip.
//
// Every row of the corpus is accounted for: it is dispatched, or it belongs
// to an operation listed in NOT_DISPATCHED with its reason. Both counts are
// pinned; a corpus change that alters them fails the run.

/** Rows dispatched through the portable API, per corpus operation. */
export const DISPATCHED = {
  'shell.*': 12616,
  'resolve.extract_version': 372,
  'resolve.range': 68,
  'resolve.version_spec': 130,
  'type.validate': 60,
  'schema.validate_profile': 135,
  'schema.definition_validate': 58,
};

/** Rows that cannot run on the portable surface of the pinned core, and why. */
export const NOT_DISPATCHED = {
  'build.args': [485, 'loads the tool from a register version file; the wire offers that source only natively'],
  'cli.run': [21, 'runs the ukiryu command-line program as a process'],
  'resolve.shell_detect': [17, 'detects the host shell (owner decision D2 is open; the wire has no shell detection)'],
  'lint.string': [70, 'linting belongs to another card'],
  'yaml.load': [81, 'YAML loading belongs to another card'],
  'yaml.model_load': [62, 'YAML loading belongs to another card'],
  'yaml.lutaml_roundtrip': [2, 'YAML loading belongs to another card'],
};

export const ORACLE_COMMIT = 'ab6df353c6dc2d7faf7817a86aafcafa82579896';
export const TOTAL = 14177;

const SHELLS = ['bash', 'zsh', 'fish', 'sh', 'dash', 'tcsh', 'powershell', 'cmd'];

/**
 * @param {object} context
 * @param {import('../../dist/node.js').Ukiryu} context.engine
 * @param {typeof import('../../dist/index.js')} context.api
 * @param {(path: string) => Promise<string>} context.load a file of the corpus directory, as text
 * @param {(text: string) => Promise<string>} context.digest hex SHA-256 of the UTF-8 text
 */
export async function runCorpus({ engine, api, load, digest }) {
  const { parseJson, stringifyJson, jsonEqual, encode, decode, UkiryuError, RubySymbol } = api;
  const problems = [];
  const fail = (message) => {
    throw new Error(`corpus integrity: ${message}`);
  };
  const get = (object, key) => {
    if (!(object instanceof Map) || !object.has(key)) fail(`missing ${key}`);
    return object.get(key);
  };

  // ---------------------------------------------------------------- manifest
  const manifest = parseJson(await load('manifest.json'));
  const oracle = get(get(manifest, 'oracle'), 'commit');
  if (oracle !== ORACLE_COMMIT) fail(`oracle commit ${oracle} is not ${ORACLE_COMMIT}`);
  const cases = get(manifest, 'cases');
  if (get(cases, 'total') !== BigInt(TOTAL)) fail(`manifest total ${get(cases, 'total')} is not ${TOTAL}`);
  const inputDigests = new Map();
  for (const input of get(manifest, 'inputs')) inputDigests.set(get(input, 'path'), get(input, 'sha256'));
  const readInput = async (path) => {
    const text = await load(`inputs/${path}`);
    if (!inputDigests.has(path)) fail(`input ${path} is not in the manifest`);
    if ((await digest(text)) !== inputDigests.get(path)) fail(`input ${path} digest differs from the manifest`);
    return text;
  };

  // -------------------------------------------------------------------- rows
  const rows = [];
  const byKind = new Map();
  for (const [file, sha] of get(cases, 'files')) {
    const text = await load(file);
    if ((await digest(text)) !== sha) fail(`${file} digest differs from the manifest`);
    for (const line of text.split('\n')) {
      if (line === '') continue;
      const row = parseJson(line);
      rows.push(row);
      const kind = get(row, 'kind');
      byKind.set(kind, (byKind.get(kind) ?? 0n) + 1n);
    }
  }
  for (const [kind, count] of get(cases, 'by_kind')) {
    if (byKind.get(kind) !== count) fail(`${kind}: ${byKind.get(kind)} rows, manifest says ${count}`);
  }
  if (rows.length !== TOTAL) fail(`${rows.length} rows, expected ${TOTAL}`);
  const ids = rows.map((row) => get(row, 'id'));
  if (new Set(ids).size !== ids.length) fail('duplicate case IDs');
  if ((await digest([...ids].sort().join('\n'))) !== get(cases, 'ids_sha256')) fail('case-ID list digest differs');

  // ---------------------------------------------------------------- dispatch
  const plain = (map) => Object.fromEntries([...map].map(([key, value]) => [key, decode(value)]));
  const indexes = new Map();
  // A schema the row names, as text. The manifest lists every input file, so
  // a schema it does not list does not exist; like a row without a schema,
  // that is a missing schema file to the original (null).
  const schemaText = async (path) => {
    if (path === null || path === undefined || !inputDigests.has(path)) return null;
    if (!indexes.has(path)) indexes.set(path, await readInput(path));
    return indexes.get(path);
  };
  const request = async (op, input) => {
    if (op.startsWith('shell.')) {
      const fields = plain(input);
      const { shell, ...operation } = fields;
      return { group: 'shell.*', shell, call: () => engine.escape(shell, { method: op.slice(6), ...operation }) };
    }
    switch (op) {
      case 'resolve.extract_version':
      case 'resolve.range':
        return { group: op, call: () => engine.resolve({ method: op.slice(8), ...plain(input) }) };
      case 'resolve.version_spec': {
        const { tool, implementation, version } = plain(input);
        const path = `register/tools/${tool}/index.yaml`;
        if (!indexes.has(path)) indexes.set(path, await readInput(path));
        const index = indexes.get(path);
        return { group: op, call: () => engine.resolve({ method: 'version_spec', index, implementation, version }) };
      }
      case 'type.validate': {
        const { value, type, options } = plain(input);
        return { group: op, call: () => engine.validate({ method: 'type', value, type, options: options ?? new Map() }) };
      }
      case 'schema.validate_profile': {
        const { yaml, file, schema: path } = plain(input);
        const profile = yaml ?? (await readInput(file));
        const schema = await schemaText(path);
        return { group: op, call: () => engine.schema({ method: 'validate_profile_text', profile, schema }) };
      }
      case 'schema.definition_validate': {
        const { yaml, file, schema: path } = plain(input);
        const definition = yaml ?? (await readInput(file));
        const schema = await schemaText(path);
        const schema_format = typeof path === 'string' && path.endsWith('.json') ? 'json' : 'yaml';
        return {
          group: op,
          call: () => {
            const report = engine.validate({ method: 'definition_text', yaml: definition, schema, schema_format });
            // `ValidationResult#to_h`: a Hash with Symbol keys.
            const sym = (name) => RubySymbol.for(name);
            return new Map([
              [sym('valid'), report.valid],
              [sym('errors'), report.errors],
              [sym('warnings'), report.warnings],
              [sym('schema_path'), report.schema_path],
              [sym('error_count'), report.error_count],
              [sym('warning_count'), report.warning_count],
            ]);
          },
        };
      }
      default:
        return null;
    }
  };
  const outcome = (call) => {
    try {
      return new Map([['ok', encode(call())]]);
    } catch (error) {
      if (!(error instanceof UkiryuError)) throw error;
      if (error.sourceClass === null) return new Map([['wire_error', error.detail]]);
      return new Map([
        ['error', new Map([['class', error.sourceClass], ['message', error.message]])],
      ]);
    }
  };

  const dispatched = {};
  const skipped = {};
  const shells = new Map();
  for (const row of rows) {
    const id = get(row, 'id');
    const op = get(row, 'op');
    const applicability = get(row, 'applicability');
    const job = await request(op, get(row, 'input'));
    if (!job) {
      if (!Object.hasOwn(NOT_DISPATCHED, op)) fail(`${id}: operation ${op} is neither dispatched nor listed as not dispatched`);
      skipped[op] = (skipped[op] ?? 0) + 1;
      continue;
    }
    const platforms = get(applicability, 'platforms');
    if (get(applicability, 'requires').length !== 0 || platforms.length !== 3) {
      fail(`${id}: a dispatched row must apply everywhere without requirements`);
    }
    dispatched[job.group] = (dispatched[job.group] ?? 0) + 1;
    if (job.shell !== undefined) shells.set(job.shell, (shells.get(job.shell) ?? 0) + 1);
    const have = outcome(job.call);
    const want = get(row, 'expect');
    if (!jsonEqual(have, want)) problems.push(`${id}:\n  got  ${stringifyJson(have)}\n  want ${stringifyJson(want)}`);
  }

  for (const [op, count] of Object.entries(DISPATCHED)) {
    if (dispatched[op] !== count) fail(`${op}: dispatched ${dispatched[op]} rows, pinned ${count}`);
  }
  for (const [op, [count]] of Object.entries(NOT_DISPATCHED)) {
    if (skipped[op] !== count) fail(`${op}: ${skipped[op]} rows not dispatched, pinned ${count}`);
  }
  if (shells.size !== SHELLS.length || SHELLS.some((shell) => shells.get(shell) !== 1577)) {
    fail(`escape rows do not cover eight shells with 1577 rows each: ${JSON.stringify([...shells])}`);
  }

  // ---------------------------------------------------------------- controls
  const controls = [];
  const control = (name, test) => {
    try {
      const failure = test();
      if (failure) problems.push(`control ${name}: ${failure}`);
    } catch (error) {
      problems.push(`control ${name}: ${error.stack ?? error}`);
    }
    controls.push(name);
  };
  const raises = (call, code) => {
    try {
      call();
    } catch (error) {
      if (!(error instanceof UkiryuError)) return `threw ${error}`;
      return error.code === code ? null : `code ${error.code}, wanted ${code}`;
    }
    return `succeeded, wanted ${code}`;
  };
  // An altered input changes the reply, so a match is not an echo.
  control('altered type.validate input', () => {
    const v = engine.validate({ method: 'type', value: 8n, type: RubySymbol.for('integer'), options: new Map([[RubySymbol.for('max'), 8n]]) });
    return v === 8n ? null : `got ${v}`;
  });
  // Integers beyond 2^53 and Ruby Floats travel exactly.
  control('integer beyond 2^64', () => {
    const big = 2n ** 64n + 1n;
    const v = engine.validate({ method: 'type', value: big, type: RubySymbol.for('integer') });
    return v === big ? null : `got ${v}`;
  });
  // Unknown shells, shell platform groups and malformed operations are core errors.
  for (const shell of ['', 'unix', 'windows', 'mybash', '/bin/mybash', 'BASH', 'bash.exe']) {
    control(`unknown shell ${JSON.stringify(shell)}`, () => raises(() => engine.escape(shell, { method: 'escape', string: 'x' }), 'UNKNOWN_SHELL'));
  }
  for (const operation of [
    { method: 'escape', string: false },
    { method: 'join', executable: 'x', args: [1] },
    { method: 'quote', string: 'x', extra: 1 },
    { method: 'execute', string: 'x' },
    { method: 'escape' },
  ]) {
    control(`malformed ${JSON.stringify(operation)}`, () => raises(() => engine.escape('bash', operation), 'INVALID_REQUEST'));
  }
  // Operations outside the WebAssembly allowlist stay unavailable.
  for (const op of ['execute', 'results']) {
    control(`capability ${op}`, () => raises(() => engine.request(op, {}), 'UNSUPPORTED_CAPABILITY'));
  }
  // A shell given as a path resolves by its basename.
  for (const shell of SHELLS) {
    control(`shell path /tools/${shell}`, () => {
      const a = engine.escape(`/tools/${shell}`, { method: 'quote', string: "it's here" });
      const b = engine.escape(shell, { method: 'quote', string: "it's here" });
      return a === b ? null : `${a} differs from ${b}`;
    });
  }

  const total = Object.values(dispatched).reduce((a, b) => a + b, 0);
  if (problems.length) {
    throw new Error(`${problems.length} conformance failures (of ${total} rows and ${controls.length} controls):\n${problems.slice(0, 40).join('\n')}`);
  }
  return {
    coreVersion: engine.coreVersion,
    total: rows.length,
    dispatched,
    dispatchedTotal: total,
    notDispatched: skipped,
    controls: controls.length,
  };
}

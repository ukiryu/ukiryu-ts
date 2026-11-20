// Portable lint and shell detection over text and a complete environment.
// D2 exceptions come from the pinned core, never from the engine under test.
export function portableShellApplicability(op, kind, platforms, requires) {
  return op === 'resolve.shell_detect' && kind === 'resolve'
    && requires.length === 0 && platforms.length === 2
    && platforms.includes('linux') && platforms.includes('macos');
}

export function lintShellReplay({ engine, api, readInput, loadRule, digest }) {
  const { decode, jsonEqual, parseJson, stringifyJson } = api;
  // Same key-sorted JSON hashed by the core's migration integrity check.
  const sorted = (value) => value instanceof Map
    ? new Map([...value].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, sorted(item)]))
    : Array.isArray(value) ? value.map(sorted) : value;
  let migrations;
  const migrationFor = async (row) => {
    if (!migrations) {
      const entries = parseJson(await loadRule('migrated.json')).get('rows');
      if (!Array.isArray(entries)) throw new Error('migration rules must contain rows');
      migrations = new Map();
      for (const entry of entries) {
        const id = entry.get('id');
        if (typeof id !== 'string' || !id.startsWith('resolve.shell_detect.')) continue;
        if (migrations.has(id)) throw new Error(`duplicate shell migration: ${id}`);
        migrations.set(id, entry);
      }
    }
    const rule = migrations.get(row.get('id'));
    if (!rule) return null;
    const id = row.get('id');
    if (rule.get('basis') !== 'D2' || row.get('decision') !== 'D2'
      || typeof rule.get('trace') !== 'string' || !rule.get('trace').includes('#')) {
      throw new Error(`untraced shell migration: ${id}`);
    }
    if (await digest(stringifyJson(sorted(row.get('expect')))) !== rule.get('frozen_expect_sha256')) {
      throw new Error(`frozen shell expectation changed: ${id}`);
    }
    const want = rule.get('expect');
    if (!(want instanceof Map) || want.size !== 1 || (!want.has('ok') && !want.has('error'))
      || jsonEqual(want, row.get('expect'))) throw new Error(`invalid shell migration outcome: ${id}`);
    if (want.has('error')) {
      const detail = rule.get('detail');
      if (!(detail instanceof Map) || ['code', 'variant', 'stage'].some(key => typeof detail.get(key) !== 'string')) {
        throw new Error(`shell migration must freeze error detail: ${id}`);
      }
    }
    return rule;
  };
  return async (row) => {
    const op = row.get('op');
    const input = row.get('input');
    if (op === 'lint.string') {
      const yaml = input.has('yaml') ? input.get('yaml') : await readInput(input.get('file'));
      return { group: op, call: () => decode(engine.request('lint', { method: 'string', yaml })) };
    }
    if (op !== 'resolve.shell_detect') return null;
    const rule = await migrationFor(row);
    return {
      group: op,
      // Frozen rows describe a Unix sandbox. Never inspect Node's or the
      // browser's environment, and never overlay it onto these inputs.
      call: () => decode(engine.request('resolve', { method: 'shell_detect', platform: 'linux', env: decode(input.get('env')) })),
      mismatch: (have, frozen, detail) => {
        if (!jsonEqual(have, rule?.get('expect') ?? frozen)) return 'shell detection outcome differs';
        if (rule?.has('detail') && !jsonEqual(detail, rule.get('detail'))) return 'shell detection error detail differs';
        return null;
      },
    };
  };
}

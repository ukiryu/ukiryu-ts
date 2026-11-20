// Portable YAML replay over the public wire API. The corpus is frozen; its two
// roundtrip rows use the core's existing R2 emitter rule, as Ruby and Python do.
export function yamlReplay({ engine, api, readInput, loadRule, digest }) {
  const { decode, encode, jsonEqual, parseJson } = api;
  const yaml = (request) => decode(engine.request('yaml', request));
  let emitters;
  const goldenFor = async (id) => {
    if (!emitters) {
      const spec = parseJson(await loadRule('emitter.json'));
      emitters = new Map();
      for (const row of spec.get('rows')) {
        const key = row.get('id');
        if (emitters.has(key)) throw new Error(`duplicate emitter rule: ${key}`);
        emitters.set(key, row);
      }
      if (emitters.size !== 2) throw new Error('expected exactly two pinned emitter rules');
    }
    const rule = emitters.get(id);
    if (!rule) throw new Error(`missing emitter rule: ${id}`);
    const path = rule.get('golden');
    if (typeof path !== 'string' || !/^emitter\/[a-z0-9.-]+\.yaml$/.test(path)) {
      throw new Error(`invalid emitter golden path: ${path}`);
    }
    const golden = await loadRule(path);
    if (await digest(golden) !== rule.get('golden_sha256')) throw new Error(`emitter golden digest differs: ${id}`);
    return golden;
  };
  return async (op, input, id) => {
    if (op !== 'yaml.load' && op !== 'yaml.lutaml_roundtrip') return null;
    const source = await readInput(input.get('file'));
    if (op === 'yaml.load') {
      return {
        group: op,
        call: () => yaml({ method: 'safe_load', yaml: source }),
        mismatch: (have, want) => {
          // The oracle writes ordinary JSON objects for string-keyed Hashes;
          // the wire escapes $-prefixed keys as $map. Compare their typed
          // values, without changing the frozen expectation or scalar tags.
          const canonical = (value) => value.has('ok')
            ? new Map([['ok', encode(decode(value.get('ok')))]]) : value;
          return jsonEqual(canonical(have), canonical(want)) ? null : 'safe-loaded value differs';
        },
      };
    }
    const model = input.get('model');
    const golden = await goldenFor(id);
    const emit = (text) => yaml({ method: 'model_to_yaml', model, yaml: text });
    return {
      group: op,
      call: () => {
        const emitted = emit(source);
        return new Map([['emitted', emitted], ['reparsed_equal', emit(emitted) === emitted]]);
      },
      mismatch: (have, want) => {
        if (have.size !== 1 || !have.has('ok') || want.size !== 1 || !want.has('ok')) return 'roundtrip must succeed';
        const got = have.get('ok');
        const frozen = want.get('ok');
        const shape = (value) => value instanceof Map && value.size === 2 && value.has('emitted') && value.has('reparsed_equal');
        if (!shape(got) || !shape(frozen)) return 'roundtrip outcome keys differ';
        if (got.get('reparsed_equal') !== true || frozen.get('reparsed_equal') !== true) return 'reparse/re-emission is not stable';
        const emitted = got.get('emitted');
        const psych = frozen.get('emitted');
        if (typeof emitted !== 'string' || typeof psych !== 'string') return 'emitted YAML must be a string';
        if (emitted !== golden) return 'emitted bytes differ from the pinned Yeptris golden';
        const canonical = (text) => encode(yaml({ method: 'safe_load', yaml: text }));
        if (!jsonEqual(canonical(emitted), canonical(psych))) return 'emitted YAML differs from the frozen Psych value';
        return null;
      },
    };
  };
}

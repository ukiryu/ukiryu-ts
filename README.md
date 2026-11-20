# ukiryu

The TypeScript runtime for Ukiryu. It runs the Ukiryu core engine, compiled
from Rust to WebAssembly, in Node.js 22 or later and in browsers.

The package is a thin layer. Portable operations are requests to the core
engine: TypeScript encodes the request, the engine does the work, and
TypeScript decodes the reply into typed values. Tool loading, YAML parsing,
shell escaping, version matching and validation all happen in the engine.

The engine has no filesystem, environment, clock or subprocess access. Tool
definitions, version indexes, profiles and schemas are passed in as text.
`build` returns the arguments, environment and standard input that a command
would be run with. In Node, `execute` passes that plan to a subprocess
adapter. Browsers have no adapter and refuse execution.

This package is not published yet.

## Use

```js
import { load, RubySymbol } from 'ukiryu';

const ukiryu = await load();

ukiryu.escape('bash', { method: 'quote', string: 'a b' }); // "'a b'"

const built = ukiryu.build({
  tool: { source: { kind: 'definition', yaml: definitionText }, platform: 'linux', shell: 'bash' },
  command: 'compress',
  params: new Map([[RubySymbol.for('inputs'), ['in put.txt']]]),
});
built.args; // ['in put.txt']
```

In Node.js, `load()` loads the engine from the package once per process. In a
browser, `load()` fetches `vendor/ukiryu-web/ukiryu_bg.wasm` next to the
module; pass `load({ wasm })` with a URL, `Response`, `BufferSource` or
`WebAssembly.Module` to load it from elsewhere.

The operations are:

- `escape(shell, operation)`: `escape`, `quote`, `needs_quoting`,
  `format_path`, `env_var`, `join` and `escape_for_double_quotes` for a shell.
- `resolve(request)`: `extract_version`, `range`, `version_spec` (over a
  supplied version index) and `tool` (the identity of a supplied definition).
- `build(request)`: a command's arguments, environment and standard input.
  The tool's `source` is either a tool definition (`kind: 'definition'`) or
  register documents given as text (`kind: 'register_text'`: the tool's
  `index`, the `interfaces` keyed by the path the index names, and one
  `version` file). A register document left out is a missing file, and the
  core reports `ToolNotFoundError`.
- `execute(request, options)`: builds the same request and passes its argv
  to a `Spawner`. Node's `load()` supplies `nodeSpawner`; the browser entry
  supplies none. Pass `options.executable` with the host executable path:
  the portable core cannot discover it. Optional `env` overlays the built
  environment and the inherited Node environment; `cwd` and `stdin` can
  also be supplied. `timeout` is in seconds, with zero (the default) meaning
  no deadline.
- `validate(request)`: `type` (`Ukiryu::Type.validate`), and `definition`
  and `definition_text` (a tool definition's validation report;
  `definition_text` takes the schema as text, in YAML or JSON).
- `schema(request)`: `fully_validate` of a profile against a supplied schema,
  and `validate_profile_text` (`SchemaValidator.validate_profile` with the
  schema as text; no schema gives `["Failed to load schema"]`).

Errors from the engine are thrown as `UkiryuError`, with the wire error
`code` and, where the Ruby library raises an exception, its `sourceClass`.

Node execution returns raw `Uint8Array` streams (`stdout`, `stderr`),
`exitStatus` (null when terminated by a signal), `signal` and `timedOut`.
Nonzero exits are returned; spawn failures throw `UkiryuError` with code
`SPAWN_ERROR`. The adapter uses `node:child_process` with `shell: false`:
argv is passed unchanged from the core's build for the selected profile and
shell. It does not invoke a shell interpreter or expand shell syntax. A
timeout kills the direct child, not a process tree. Hosts can wrap a core
binding with `Ukiryu.fromBinding(binding, spawner)` to provide another
adapter implementing the exported `Spawner` interface.

This is a host execution hook. The pinned WASM does not expose the native
executor's result parsing, exit-code meanings, or shell invocation planner.
Those behaviours are not emulated in TypeScript.

## Values

Values cross the engine boundary without loss. JSON from the engine is
parsed by the package's own parser, not `JSON.parse`:

- Integers are `bigint`, at any size.
- A Ruby Float is a `RubyFloat` holding the exact `Float#to_s` text.
- Symbols are `RubySymbol`, times are `RubyTime`, regular expressions are
  `RubyRegexp` and binary strings are `Uint8Array`.
- Hashes are `Map`s in the order the engine wrote them. Plain objects are
  accepted as input when all keys are strings.

A `number` input must be a safe integer, and an object key that is an integer
or starts with `$` must be given through a `Map`; anything that would lose
information is rejected rather than converted.

## Engine

`vendor/ukiryu-wasm` (Node.js) and `vendor/ukiryu-web` (browsers) are
wasm-pack builds of the ukiryu-rs commit named in `vendor/core-pin.json`. The
`Core WebAssembly vendor` workflow rebuilds them from that commit and checks
the committed files byte for byte; `scripts/verify-vendor.py` checks each
file against `BUILT_FROM`, the core's lock file, licence and Onigmo notices,
and that the commit is an ancestor of the tracked core branch.

To move to another core commit, change `vendor/core-pin.json`, run the
workflow, and commit the `ukiryu-vendor` artifact it uploads as `vendor/`.

## Development

```sh
npm ci
npm run build        # TypeScript to dist/, which is committed
npm test             # unit tests
UKIRYU_CONFORMANCE_DIR=../ukiryu-rs/corpus/conformance npm run conformance
UKIRYU_CONFORMANCE_DIR=../ukiryu-rs/corpus/conformance npm run conformance:browser
```

The conformance runs read the corpus of the pinned core and compare every
row the portable engine can answer with the Ruby library's recorded result.
Rows that need a file, a process or the host are counted and listed with the
reason in `test/conformance/corpus.mjs`.

Both CI runners enforce 13,945 dispatched rows, including build, escape,
resolve, validate and all 21 deterministic `cli.run` rows, with fixed
per-operation counts. CLI snapshots refuse external schema resources with
`UNSUPPORTED_CAPABILITY`, including Windows file URIs, relative host paths
and HTTP resources. Corpus expectations are unchanged.

CI fails if `dist/` differs from a fresh build.

## Licence

BSD-2-Clause. The engine includes Onigmo; its notices are in
`vendor/*/licenses/onigmo`.

Deterministic CLI output uses `engine.request('cli.run', { argv, platform,
env, snapshot })`. `snapshot.files` maps virtual paths to input text;
`executables`, `probes` and `definitions` explicitly describe discovery facts
(empty means none). The environment is complete, never an overlay on the host.
The same parser and formatters serve the native CLI and WASM. Execution, writes,
register bootstrap/update and unsupported discovery commands refuse with
`UNSUPPORTED_CAPABILITY`; this entrypoint never opens host paths or spawns.
The 21 frozen Linux CLI captures run on both hosts using this explicit snapshot.

For a local vendor refresh, check out the exact clean commit in
`vendor/core-pin.json`, put its pinned Rust/wasm-pack/Emscripten tools on PATH,
then run `bash scripts/refresh-vendor.sh /path/to/ukiryu-rs`. It performs the
same builds, license staging, source-derived BUILT_FROM stamping and verification
as the vendor workflow; it refuses dirty or incorrectly pinned source/toolchains.

To replay just these 21 rows locally, set `UKIRYU_CONFORMANCE_DIR` to the pinned
core's `corpus/conformance` and run `npm run conformance:cli`.

# ukiryu

The TypeScript runtime for Ukiryu. It runs the Ukiryu core engine, compiled
from Rust to WebAssembly, in Node.js 22 or later and in browsers.

The package is a thin layer. Every operation is one request to the core
engine: TypeScript encodes the request, the engine does the work, and
TypeScript decodes the reply into typed values. Tool loading, YAML parsing,
shell escaping, version matching and validation all happen in the engine.

The engine has no filesystem, environment, clock or subprocess access. Tool
definitions, version indexes, profiles and schemas are passed in as text.
The package never runs a command; `build` returns the arguments, environment
and standard input that a command would be run with.

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
- `validate(request)`: `type` (`Ukiryu::Type.validate`) and `definition`
  (a tool definition's validation report).
- `schema(request)`: `fully_validate` of a profile against a supplied schema.

Errors from the engine are thrown as `UkiryuError`, with the wire error
`code` and, where the Ruby library raises an exception, its `sourceClass`.

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

CI fails if `dist/` differs from a fresh build.

## Licence

BSD-2-Clause. The engine includes Onigmo; its notices are in
`vendor/*/licenses/onigmo`.

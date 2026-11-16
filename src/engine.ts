/**
 * The runtime over one core engine.
 *
 * Every operation is one request to the core's `process` export: the request
 * is encoded with the lossless codec, the core does all of the work, and the
 * reply is decoded back into typed values. This module adds no behaviour of
 * its own: no tool loading, YAML, escaping, version matching or validation
 * happens in TypeScript.
 *
 * The engine is portable: it has no filesystem, environment, clock or
 * subprocess. Tool definitions, version indexes, profiles and schemas are
 * passed in as text by the caller.
 */
import { type Json, type JsonObject, parseJson, stringifyJson } from './json.js';
import { decode, encode, type RubyInput, type RubySymbol, type RubyValue } from './value.js';

/** The wire ABI this runtime speaks. */
export const ABI_VERSION = 1;

/** The exports of a core engine built by wasm-pack (`--features wasm`). */
export interface CoreBinding {
  abi_version(): number;
  core_version(): string;
  process(input: string): string;
}

/** A failure reported by the core. */
export class UkiryuError extends Error {
  /** The wire error code, e.g. `INVALID_REQUEST`, `UNKNOWN_SHELL`, `UNSUPPORTED_CAPABILITY`. */
  readonly code: string;
  /** The Ruby exception class the original raises here, when there is one. */
  readonly sourceClass: string | null;
  /** The whole wire error object. */
  readonly detail: JsonObject;
  constructor(detail: JsonObject) {
    const code = detail.get('code');
    const message = detail.get('message');
    const sourceClass = detail.get('source_class');
    super(typeof message === 'string' ? message : 'the core reported an error without a message');
    this.name = 'UkiryuError';
    this.code = typeof code === 'string' ? code : 'UNKNOWN';
    this.sourceClass = typeof sourceClass === 'string' ? sourceClass : null;
    this.detail = detail;
  }
}

// ------------------------------------------------------------------ requests

/** A shell name as the core accepts it (`bash`, `/bin/zsh`, `powershell`, `cmd`, ...). */
export type Shell = string;

export type EscapeOperation =
  | { method: 'escape'; string: string }
  | { method: 'quote'; string: string; for_exe?: boolean }
  | { method: 'needs_quoting'; string: string }
  | { method: 'format_path'; path: string }
  | { method: 'env_var'; name: string }
  | { method: 'join'; executable: string; args: string[] }
  | { method: 'escape_for_double_quotes'; string: string };

/** A tool definition supplied as text. */
export interface DefinitionSource {
  kind: 'definition';
  /** A `ToolDefinition` YAML document. */
  yaml: string;
}

/** `Tool.new(profile, platform:, shell:, version:)` over a supplied definition. */
export interface ToolRequest {
  source: DefinitionSource;
  platform: string;
  shell: Shell;
  version?: string | null;
}

export type ResolveRequest =
  | { method: 'extract_version'; output: string | Uint8Array | null; pattern: string | null }
  | { method: 'range'; scheme: RubyInput; range: string; bounds: RubyInput; version: string }
  | { method: 'version_spec'; index: string; implementation: string; version: string }
  | ({ method: 'tool' } & ToolRequest);

export interface BuildRequest {
  tool: ToolRequest;
  /** A command name, or a routed action path such as `remote:add`. */
  command: string;
  params?: RubyInput;
}

export type ValidateRequest =
  | { method: 'type'; value: RubyInput; type: RubyInput; options?: RubyInput }
  | { method: 'definition'; yaml: string };

export type SchemaRequest = { method: 'fully_validate'; profile: string; schema: string; strict?: boolean };

// ------------------------------------------------------------------- replies

/** A built command, up to the point where it would be executed. */
export interface BuildResult {
  /** The executable, or `null` when it was not discovered (the arguments do not depend on it). */
  executable: string | null;
  args: string[];
  env: [string, string][];
  stdin: string | Uint8Array | null;
  command_name: string;
}

/** `ValidationResult#to_h` plus how the schema stage was resolved. */
export interface DefinitionReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  schema_path: string | null;
  error_count: bigint;
  warning_count: bigint;
  schema_stage: Map<RubyValue, RubyValue> | null;
}

function member(object: Map<RubyValue, RubyValue>, key: string, what: string): RubyValue {
  if (!object.has(key)) throw new TypeError(`the core reply has no ${what}.${key}`);
  return object.get(key) as RubyValue;
}

function record(value: RubyValue, what: string): Map<RubyValue, RubyValue> {
  if (!(value instanceof Map)) throw new TypeError(`the core reply ${what} is not an object`);
  return value;
}

function strings(value: RubyValue, what: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new TypeError(`the core reply ${what} is not a list of strings`);
  }
  return value as string[];
}

function check<T>(ok: boolean, value: T, what: string): T {
  if (!ok) throw new TypeError(`the core reply ${what} has an unexpected type`);
  return value;
}

// -------------------------------------------------------------------- engine

export class Ukiryu {
  readonly #binding: CoreBinding;
  /** The core's crate version. */
  readonly coreVersion: string;

  private constructor(binding: CoreBinding) {
    this.#binding = binding;
    this.coreVersion = binding.core_version();
  }

  /** Wrap an initialized core engine, refusing one that speaks another ABI. */
  static fromBinding(binding: CoreBinding): Ukiryu {
    const abi = binding.abi_version();
    if (abi !== ABI_VERSION) {
      throw new Error(`the core engine speaks wire ABI ${abi}; this runtime speaks ABI ${ABI_VERSION}`);
    }
    return new Ukiryu(binding);
  }

  /**
   * Send one wire request and return the reply's `value`. The request is
   * encoded losslessly; fields set to `undefined` are left out.
   */
  request(op: string, fields: { readonly [key: string]: RubyInput | undefined }): Json {
    const reply = parseJson(this.#binding.process(stringifyJson(encode({ op, ...fields }))));
    if (!(reply instanceof Map)) throw new TypeError('the core reply is not an object');
    if (reply.get('ok') === true) {
      if (!reply.has('value')) throw new TypeError('the core reply has no value');
      return reply.get('value') as Json;
    }
    const error = reply.get('error');
    if (reply.get('ok') !== false || !(error instanceof Map)) throw new TypeError('the core reply is malformed');
    throw new UkiryuError(error);
  }

  /** A shell operation of `Ukiryu::Shell` (`escape`, `quote`, `join`, ...). */
  escape(shell: Shell, operation: EscapeOperation): string | boolean {
    const value = decode(this.request('escape', { shell, operation }));
    return check(typeof value === 'string' || typeof value === 'boolean', value as string | boolean, 'escape value');
  }

  /**
   * Version and tool resolution over supplied data: `extract_version`
   * (string or null), `range` (boolean), `version_spec` (the matching spec
   * file or null) and `tool` (the loaded tool's identity, profile and
   * executable).
   */
  resolve(request: ResolveRequest): RubyValue {
    return decode(this.request('resolve', request as { [key: string]: RubyInput }));
  }

  /** Build a command's argv, environment and stdin without executing it. */
  build(request: BuildRequest): BuildResult {
    const value = record(decode(this.request('build', request as unknown as { [key: string]: RubyInput })), 'build value');
    const executable = member(value, 'executable', 'build');
    const env = member(value, 'env', 'build');
    const stdin = member(value, 'stdin', 'build');
    const commandName = member(value, 'command_name', 'build');
    return {
      executable: check(executable === null || typeof executable === 'string', executable as string | null, 'build.executable'),
      args: strings(member(value, 'args', 'build'), 'build.args'),
      env: check(
        Array.isArray(env) && env.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((s) => typeof s === 'string')),
        env as [string, string][],
        'build.env',
      ),
      stdin: check(
        stdin === null || typeof stdin === 'string' || stdin instanceof Uint8Array,
        stdin as string | Uint8Array | null,
        'build.stdin',
      ),
      command_name: check(typeof commandName === 'string', commandName as string, 'build.command_name'),
    };
  }

  /**
   * `Ukiryu::Type.validate(value, type, options)` (the coerced value), or a
   * tool definition's validation report.
   */
  validate(request: { method: 'type'; value: RubyInput; type: RubyInput; options?: RubyInput }): RubyValue;
  validate(request: { method: 'definition'; yaml: string }): DefinitionReport;
  validate(request: ValidateRequest): RubyValue | DefinitionReport {
    const value = decode(this.request('validate', request as { [key: string]: RubyInput }));
    if (request.method !== 'definition') return value;
    const report = record(value, 'validate value');
    const count = (key: string) => {
      const n = member(report, key, 'validate');
      return check(typeof n === 'bigint', n as bigint, `validate.${key}`);
    };
    const valid = member(report, 'valid', 'validate');
    const schemaPath = member(report, 'schema_path', 'validate');
    const stage = member(report, 'schema_stage', 'validate');
    return {
      valid: check(typeof valid === 'boolean', valid as boolean, 'validate.valid'),
      errors: strings(member(report, 'errors', 'validate'), 'validate.errors'),
      warnings: strings(member(report, 'warnings', 'validate'), 'validate.warnings'),
      schema_path: check(schemaPath === null || typeof schemaPath === 'string', schemaPath as string | null, 'validate.schema_path'),
      error_count: count('error_count'),
      warning_count: count('warning_count'),
      schema_stage: check(stage === null || stage instanceof Map, stage as Map<RubyValue, RubyValue> | null, 'validate.schema_stage'),
    };
  }

  /** `JSON::Validator.fully_validate(schema, profile, strict:)` over supplied YAML documents. */
  schema(request: SchemaRequest): string[] {
    return strings(decode(this.request('schema', request as { [key: string]: RubyInput })), 'schema value');
  }
}

export type { RubySymbol };

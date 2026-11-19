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
import { type Json, type JsonObject } from './json.js';
import { type RubyInput, type RubySymbol, type RubyValue } from './value.js';
/** The wire ABI this runtime speaks. */
export declare const ABI_VERSION = 1;
/** The exports of a core engine built by wasm-pack (`--features wasm`). */
export interface CoreBinding {
    abi_version(): number;
    core_version(): string;
    process(input: string): string;
}
/** A failure reported by the core. */
export declare class UkiryuError extends Error {
    /** The wire error code, e.g. `INVALID_REQUEST`, `UNKNOWN_SHELL`, `UNSUPPORTED_CAPABILITY`. */
    readonly code: string;
    /** The Ruby exception class the original raises here, when there is one. */
    readonly sourceClass: string | null;
    /** The whole wire error object. */
    readonly detail: JsonObject;
    constructor(detail: JsonObject);
}
/** A shell name as the core accepts it (`bash`, `/bin/zsh`, `powershell`, `cmd`, ...). */
export type Shell = string;
export type EscapeOperation = {
    method: 'escape';
    string: string;
} | {
    method: 'quote';
    string: string;
    for_exe?: boolean;
} | {
    method: 'needs_quoting';
    string: string;
} | {
    method: 'format_path';
    path: string;
} | {
    method: 'env_var';
    name: string;
} | {
    method: 'join';
    executable: string;
    args: string[];
} | {
    method: 'escape_for_double_quotes';
    string: string;
};
/** A tool definition supplied as text. */
export interface DefinitionSource {
    kind: 'definition';
    /** A `ToolDefinition` YAML document. */
    yaml: string;
}
/**
 * A tool loaded from register documents supplied as text: the loader chain
 * of `Tool::Loader.load_with_implementation_index` (index, interface,
 * version file, `convert_to_tool_definition`) with the implementation and
 * version file chosen by the caller. A document left out (null or absent)
 * is a file that does not exist, so the core reports `ToolNotFoundError`.
 */
export interface RegisterTextSource {
    kind: 'register_text';
    tool: string;
    implementation: string;
    /** `tools/<tool>/index.yaml`. */
    index?: string | null;
    /**
     * `interfaces/<path>.yaml`, keyed by `<path>` as the index names it,
     * without a leading `/`.
     */
    interfaces?: Map<string, string> | {
        readonly [path: string]: string;
    };
    /** `tools/<tool>/<implementation>/<file>`. */
    version?: string | null;
}
/** Where a tool definition comes from. */
export type ToolSource = DefinitionSource | RegisterTextSource;
/** `Tool.new(profile, platform:, shell:, version:)` over a supplied definition. */
export interface ToolRequest {
    source: ToolSource;
    platform: string;
    shell: Shell;
    version?: string | null;
}
export type ResolveRequest = {
    method: 'extract_version';
    output: string | Uint8Array | null;
    pattern: string | null;
} | {
    method: 'range';
    scheme: RubyInput;
    range: string;
    bounds: RubyInput;
    version: string;
} | {
    method: 'version_spec';
    index: string;
    implementation: string;
    version: string;
} | ({
    method: 'tool';
} & ToolRequest);
export interface BuildRequest {
    tool: ToolRequest;
    /** A command name, or a routed action path such as `remote:add`. */
    command: string;
    params?: RubyInput;
}
/**
 * A tool definition validated against a schema supplied as text, loaded as a
 * schema file of `schema_format` (default `yaml`) would be. A null or absent
 * schema skips the schema stage.
 */
export interface DefinitionTextRequest {
    method: 'definition_text';
    yaml: string;
    schema?: string | null;
    schema_format?: 'yaml' | 'json';
}
export type ValidateRequest = {
    method: 'type';
    value: RubyInput;
    type: RubyInput;
    options?: RubyInput;
} | {
    method: 'definition';
    yaml: string;
} | DefinitionTextRequest;
export type SchemaRequest = {
    method: 'fully_validate';
    profile: string;
    schema: string;
    strict?: boolean;
}
/**
 * `SchemaValidator.validate_profile` with the schema supplied as text. A
 * null or absent schema is a missing schema file (`["Failed to load schema"]`).
 */
 | {
    method: 'validate_profile_text';
    profile: string;
    schema?: string | null;
    strict?: boolean;
};
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
export declare class Ukiryu {
    #private;
    /** The core's crate version. */
    readonly coreVersion: string;
    private constructor();
    /** Wrap an initialized core engine, refusing one that speaks another ABI. */
    static fromBinding(binding: CoreBinding): Ukiryu;
    /**
     * Send one wire request and return the reply's `value`. The request is
     * encoded losslessly; fields set to `undefined` are left out.
     */
    request(op: string, fields: {
        readonly [key: string]: RubyInput | undefined;
    }): Json;
    /** A shell operation of `Ukiryu::Shell` (`escape`, `quote`, `join`, ...). */
    escape(shell: Shell, operation: EscapeOperation): string | boolean;
    /**
     * Version and tool resolution over supplied data: `extract_version`
     * (string or null), `range` (boolean), `version_spec` (the matching spec
     * file or null) and `tool` (the loaded tool's identity, profile and
     * executable).
     */
    resolve(request: ResolveRequest): RubyValue;
    /** Build a command's argv, environment and stdin without executing it. */
    build(request: BuildRequest): BuildResult;
    /**
     * `Ukiryu::Type.validate(value, type, options)` (the coerced value), or a
     * tool definition's validation report.
     */
    validate(request: {
        method: 'type';
        value: RubyInput;
        type: RubyInput;
        options?: RubyInput;
    }): RubyValue;
    validate(request: {
        method: 'definition';
        yaml: string;
    } | DefinitionTextRequest): DefinitionReport;
    /**
     * `JSON::Validator.fully_validate(schema, profile, strict:)`, or
     * `SchemaValidator.validate_profile`, over supplied YAML documents.
     */
    schema(request: SchemaRequest): string[];
}
export type { RubySymbol };

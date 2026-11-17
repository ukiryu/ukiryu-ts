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
import { parseJson, stringifyJson } from './json.js';
import { decode, encode } from './value.js';
/** The wire ABI this runtime speaks. */
export const ABI_VERSION = 1;
/** A failure reported by the core. */
export class UkiryuError extends Error {
    /** The wire error code, e.g. `INVALID_REQUEST`, `UNKNOWN_SHELL`, `UNSUPPORTED_CAPABILITY`. */
    code;
    /** The Ruby exception class the original raises here, when there is one. */
    sourceClass;
    /** The whole wire error object. */
    detail;
    constructor(detail) {
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
function member(object, key, what) {
    if (!object.has(key))
        throw new TypeError(`the core reply has no ${what}.${key}`);
    return object.get(key);
}
function record(value, what) {
    if (!(value instanceof Map))
        throw new TypeError(`the core reply ${what} is not an object`);
    return value;
}
function strings(value, what) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        throw new TypeError(`the core reply ${what} is not a list of strings`);
    }
    return value;
}
function check(ok, value, what) {
    if (!ok)
        throw new TypeError(`the core reply ${what} has an unexpected type`);
    return value;
}
// -------------------------------------------------------------------- engine
export class Ukiryu {
    #binding;
    /** The core's crate version. */
    coreVersion;
    constructor(binding) {
        this.#binding = binding;
        this.coreVersion = binding.core_version();
    }
    /** Wrap an initialized core engine, refusing one that speaks another ABI. */
    static fromBinding(binding) {
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
    request(op, fields) {
        const reply = parseJson(this.#binding.process(stringifyJson(encode({ op, ...fields }))));
        if (!(reply instanceof Map))
            throw new TypeError('the core reply is not an object');
        if (reply.get('ok') === true) {
            if (!reply.has('value'))
                throw new TypeError('the core reply has no value');
            return reply.get('value');
        }
        const error = reply.get('error');
        if (reply.get('ok') !== false || !(error instanceof Map))
            throw new TypeError('the core reply is malformed');
        throw new UkiryuError(error);
    }
    /** A shell operation of `Ukiryu::Shell` (`escape`, `quote`, `join`, ...). */
    escape(shell, operation) {
        const value = decode(this.request('escape', { shell, operation }));
        return check(typeof value === 'string' || typeof value === 'boolean', value, 'escape value');
    }
    /**
     * Version and tool resolution over supplied data: `extract_version`
     * (string or null), `range` (boolean), `version_spec` (the matching spec
     * file or null) and `tool` (the loaded tool's identity, profile and
     * executable).
     */
    resolve(request) {
        return decode(this.request('resolve', request));
    }
    /** Build a command's argv, environment and stdin without executing it. */
    build(request) {
        const value = record(decode(this.request('build', request)), 'build value');
        const executable = member(value, 'executable', 'build');
        const env = member(value, 'env', 'build');
        const stdin = member(value, 'stdin', 'build');
        const commandName = member(value, 'command_name', 'build');
        return {
            executable: check(executable === null || typeof executable === 'string', executable, 'build.executable'),
            args: strings(member(value, 'args', 'build'), 'build.args'),
            env: check(Array.isArray(env) && env.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((s) => typeof s === 'string')), env, 'build.env'),
            stdin: check(stdin === null || typeof stdin === 'string' || stdin instanceof Uint8Array, stdin, 'build.stdin'),
            command_name: check(typeof commandName === 'string', commandName, 'build.command_name'),
        };
    }
    validate(request) {
        const value = decode(this.request('validate', request));
        if (request.method === 'type')
            return value;
        const report = record(value, 'validate value');
        const count = (key) => {
            const n = member(report, key, 'validate');
            return check(typeof n === 'bigint', n, `validate.${key}`);
        };
        const valid = member(report, 'valid', 'validate');
        const schemaPath = member(report, 'schema_path', 'validate');
        const stage = member(report, 'schema_stage', 'validate');
        return {
            valid: check(typeof valid === 'boolean', valid, 'validate.valid'),
            errors: strings(member(report, 'errors', 'validate'), 'validate.errors'),
            warnings: strings(member(report, 'warnings', 'validate'), 'validate.warnings'),
            schema_path: check(schemaPath === null || typeof schemaPath === 'string', schemaPath, 'validate.schema_path'),
            error_count: count('error_count'),
            warning_count: count('warning_count'),
            schema_stage: check(stage === null || stage instanceof Map, stage, 'validate.schema_stage'),
        };
    }
    /**
     * `JSON::Validator.fully_validate(schema, profile, strict:)`, or
     * `SchemaValidator.validate_profile`, over supplied YAML documents.
     */
    schema(request) {
        return strings(decode(this.request('schema', request)), 'schema value');
    }
}

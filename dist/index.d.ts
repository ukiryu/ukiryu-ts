/** The parts of the runtime that do not depend on how the engine is loaded. */
export { ABI_VERSION, type BuildRequest, type BuildResult, type CoreBinding, type DefinitionReport, type DefinitionSource, type EscapeOperation, type ResolveRequest, type SchemaRequest, type Shell, type ToolRequest, Ukiryu, UkiryuError, type ValidateRequest, } from './engine.js';
export { type Json, JsonDecimal, type JsonObject, JsonSyntaxError, jsonEqual, parseJson, stringifyJson } from './json.js';
export { decode, encode, type RubyInput, RubyFloat, RubyRegexp, RubySymbol, RubyTime, type RubyValue } from './value.js';

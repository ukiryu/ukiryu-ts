/* tslint:disable */
/* eslint-disable */
/**
 * Process a JSON wire request, returning a JSON wire response.
 *
 * Keep transport errors structured rather than throwing a JS exception. The
 * allowlist is a capability boundary: future native operations must not become
 * available to browser consumers merely by being added to the shared wire.
 */
export function process(input: string): string;
export function core_version(): string;
export function abi_version(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly abi_version: () => number;
  readonly core_version: () => [number, number];
  readonly process: (a: number, b: number) => [number, number];
  readonly malloc: (a: number) => number;
  readonly free: (a: number) => void;
  readonly realloc: (a: number, b: number) => number;
  readonly calloc: (a: number, b: number) => number;
  readonly __wasi_fd_close: (a: number) => number;
  readonly __wasi_fd_seek: (a: number, b: bigint, c: number, d: number) => number;
  readonly __wasi_fd_write: (a: number, b: number, c: number, d: number) => number;
  readonly emscripten_builtin_malloc: (a: number) => number;
  readonly emscripten_memcpy_js: (a: number, b: number, c: number) => void;
  readonly getenv: (a: number) => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_malloc_command_export: (a: number, b: number) => number;
  readonly __wbindgen_realloc_command_export: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_free_command_export: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

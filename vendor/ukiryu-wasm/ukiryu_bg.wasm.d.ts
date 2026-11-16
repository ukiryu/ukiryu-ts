/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const abi_version: () => number;
export const core_version: () => [number, number];
export const process: (a: number, b: number) => [number, number];
export const malloc: (a: number) => number;
export const free: (a: number) => void;
export const realloc: (a: number, b: number) => number;
export const calloc: (a: number, b: number) => number;
export const __wasi_fd_close: (a: number) => number;
export const __wasi_fd_seek: (a: number, b: bigint, c: number, d: number) => number;
export const __wasi_fd_write: (a: number, b: number, c: number, d: number) => number;
export const emscripten_builtin_malloc: (a: number) => number;
export const emscripten_memcpy_js: (a: number, b: number, c: number) => void;
export const getenv: (a: number) => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_free_command_export: (a: number, b: number, c: number) => void;
export const __wbindgen_malloc_command_export: (a: number, b: number) => number;
export const __wbindgen_realloc_command_export: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_start: () => void;

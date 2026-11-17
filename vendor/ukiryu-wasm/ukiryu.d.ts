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
export function abi_version(): number;
export function core_version(): string;

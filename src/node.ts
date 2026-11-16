/**
 * Node entry: the core engine built by wasm-pack for Node.js
 * (`vendor/ukiryu-wasm`), loaded from this package's own files.
 */
import { createRequire } from 'node:module';
import { type CoreBinding, Ukiryu } from './engine.js';

export * from './index.js';

let engine: Ukiryu | undefined;

/** The engine, loaded once per process. */
export async function load(): Promise<Ukiryu> {
  if (!engine) {
    const require = createRequire(import.meta.url);
    engine = Ukiryu.fromBinding(require('../vendor/ukiryu-wasm/ukiryu.js') as CoreBinding);
  }
  return engine;
}

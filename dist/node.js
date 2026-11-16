/**
 * Node entry: the core engine built by wasm-pack for Node.js
 * (`vendor/ukiryu-wasm`), loaded from this package's own files.
 */
import { createRequire } from 'node:module';
import { Ukiryu } from './engine.js';
export * from './index.js';
let engine;
/** The engine, loaded once per process. */
export async function load() {
    if (!engine) {
        const require = createRequire(import.meta.url);
        engine = Ukiryu.fromBinding(require('../vendor/ukiryu-wasm/ukiryu.js'));
    }
    return engine;
}

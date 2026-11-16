/**
 * Browser entry: the core engine built by wasm-pack for the web
 * (`vendor/ukiryu-web`). By default the engine fetches `ukiryu_bg.wasm` next
 * to its JavaScript; pass `wasm` to load it from elsewhere (a URL, a
 * `Response`, bytes or a compiled `WebAssembly.Module`).
 */
import init, * as binding from '../vendor/ukiryu-web/ukiryu.js';
import { Ukiryu } from './engine.js';
export * from './index.js';
let engine;
/** The engine, initialized once per realm. */
export function load(options = {}) {
    engine ??= (async () => {
        await init(options.wasm === undefined ? undefined : { module_or_path: options.wasm });
        return Ukiryu.fromBinding(binding);
    })();
    return engine;
}

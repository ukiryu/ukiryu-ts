import type { InitInput } from '../vendor/ukiryu-web/ukiryu.js';
import { Ukiryu } from './engine.js';
export * from './index.js';
export interface LoadOptions {
    wasm?: InitInput | Promise<InitInput>;
}
/** The engine, initialized once per realm. */
export declare function load(options?: LoadOptions): Promise<Ukiryu>;

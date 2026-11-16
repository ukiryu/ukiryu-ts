import { Ukiryu } from './engine.js';
export * from './index.js';
/** The engine, loaded once per process. */
export declare function load(): Promise<Ukiryu>;

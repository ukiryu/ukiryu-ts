/**
 * Lossless JSON for the core wire.
 *
 * `JSON.parse` turns every number into an IEEE double, so an Integer above
 * 2^53 changes value, and a plain object reorders integer-like keys. This
 * parser keeps both: an integer is a `bigint`, any other number keeps its
 * source text, and an object is a `Map` in document order. It is a transport
 * codec only; it gives no number, string or key a domain meaning.
 */
/** A JSON number that has a fraction or an exponent, kept as its source text. */
export declare class JsonDecimal {
    readonly text: string;
    constructor(text: string);
    toString(): string;
}
export type Json = null | boolean | string | bigint | JsonDecimal | Json[] | JsonObject;
/** A JSON object in document order. */
export type JsonObject = Map<string, Json>;
export declare class JsonSyntaxError extends SyntaxError {
    readonly position: number;
    constructor(message: string, position: number);
}
/** Parse JSON text. Duplicate object keys are an error. */
export declare function parseJson(text: string): Json;
/** Serialize a {@link Json} tree; objects keep their `Map` order. */
export declare function stringifyJson(value: Json): string;
/**
 * Structural equality of two JSON trees: arrays in order, objects as key
 * sets (the corpus compares objects structurally), integers by value.
 */
export declare function jsonEqual(a: Json, b: Json): boolean;

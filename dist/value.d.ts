/**
 * Ruby values on the core wire.
 *
 * The core speaks Ruby values (Integer, Float, Symbol, Time, Regexp, binary
 * String, Hash with any keys). JavaScript has no exact form for several of
 * them, so each gets a small class that keeps the wire form exactly:
 *
 * | Ruby | TypeScript |
 * |---|---|
 * | nil, true/false, String | `null`, `boolean`, `string` |
 * | Integer | `bigint` (a safe-integer `number` is accepted as input) |
 * | Float | {@link RubyFloat}, the exact `Float#to_s` text |
 * | Symbol | {@link RubySymbol}, interned so it works as a `Map` key |
 * | Time | {@link RubyTime}, whole seconds as `bigint` plus nanoseconds |
 * | Regexp | {@link RubyRegexp} |
 * | binary String | `Uint8Array` |
 * | Array | `RubyValue[]` |
 * | Hash | `Map` in insertion order (a plain object is accepted as input) |
 *
 * Nothing here interprets a value: the core checks every form (for example
 * that a Float's text is exactly what `Float#to_s` prints) and the codec only
 * moves the text between JSON and these classes.
 */
import { type Json } from './json.js';
/** A Ruby Symbol. Instances are interned: `RubySymbol.for('a') === RubySymbol.for('a')`. */
export declare class RubySymbol {
    #private;
    readonly name: string;
    static for(name: string): RubySymbol;
    private constructor();
    toString(): string;
}
/** A Ruby Float as its exact `Float#to_s` text (`"1.0"`, `"1.0e+20"`, `"NaN"`). */
export declare class RubyFloat {
    readonly text: string;
    constructor(text: string);
    /** The nearest double; `Infinity`, `-Infinity` and `NaN` included. */
    valueOf(): number;
    toString(): string;
}
/**
 * A Ruby Time. A UTC time inside years 0 to 9999 travels as its ISO text
 * (`iso`); any other travels as whole seconds since the epoch, nanoseconds,
 * the UTC offset in seconds and the UTC flag. The class keeps whichever form
 * it was given and never converts between them.
 */
export declare class RubyTime {
    readonly iso: string | null;
    readonly seconds: bigint | null;
    readonly nanos: number | null;
    readonly utcOffset: number | null;
    readonly utc: boolean | null;
    private constructor();
    /** A UTC time as `YYYY-MM-DDTHH:MM:SS.fffffffffZ`. */
    static fromIso(iso: string): RubyTime;
    static fromParts(parts: {
        seconds: bigint;
        nanos: number;
        utcOffset: number;
        utc: boolean;
    }): RubyTime;
    toString(): string;
}
/** A Ruby Regexp: its source and its option bits. */
export declare class RubyRegexp {
    readonly source: string;
    readonly options: number;
    constructor(source: string, options?: number);
    toString(): string;
}
/** A Ruby value as the wire carries it. */
export type RubyValue = null | boolean | string | bigint | RubyFloat | RubySymbol | RubyTime | RubyRegexp | Uint8Array | RubyValue[] | Map<RubyValue, RubyValue>;
/** What {@link encode} accepts: a {@link RubyValue}, a safe-integer number or a plain object as a Hash. */
export type RubyInput = RubyValue | number | RubyInput[] | Map<RubyInput, RubyInput> | {
    readonly [key: string]: RubyInput | undefined;
};
/** Encode a value in the wire's JSON form. Fields set to `undefined` are left out. */
export declare function encode(value: RubyInput): Json;
/** Decode a value from the wire's JSON form. */
export declare function decode(json: Json): RubyValue;

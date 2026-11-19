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
import { JsonDecimal } from './json.js';
/** A Ruby Symbol. Instances are interned: `RubySymbol.for('a') === RubySymbol.for('a')`. */
export class RubySymbol {
    name;
    static #table = new Map();
    static for(name) {
        let symbol = RubySymbol.#table.get(name);
        if (!symbol) {
            symbol = new RubySymbol(name);
            RubySymbol.#table.set(name, symbol);
        }
        return symbol;
    }
    constructor(name) {
        this.name = name;
    }
    toString() {
        return `:${this.name}`;
    }
}
/** A Ruby Float as its exact `Float#to_s` text (`"1.0"`, `"1.0e+20"`, `"NaN"`). */
export class RubyFloat {
    text;
    constructor(text) {
        this.text = text;
        if (typeof text !== 'string')
            throw new TypeError('RubyFloat takes the Float#to_s text');
    }
    /** The nearest double; `Infinity`, `-Infinity` and `NaN` included. */
    valueOf() {
        return Number(this.text);
    }
    toString() {
        return this.text;
    }
}
/**
 * A Ruby Time. A UTC time inside years 0 to 9999 travels as its ISO text
 * (`iso`); any other travels as whole seconds since the epoch, nanoseconds,
 * the UTC offset in seconds and the UTC flag. The class keeps whichever form
 * it was given and never converts between them.
 */
export class RubyTime {
    iso;
    seconds;
    nanos;
    utcOffset;
    utc;
    constructor(iso, seconds, nanos, utcOffset, utc) {
        this.iso = iso;
        this.seconds = seconds;
        this.nanos = nanos;
        this.utcOffset = utcOffset;
        this.utc = utc;
    }
    /** A UTC time as `YYYY-MM-DDTHH:MM:SS.fffffffffZ`. */
    static fromIso(iso) {
        if (typeof iso !== 'string')
            throw new TypeError('RubyTime.fromIso takes a string');
        return new RubyTime(iso, null, null, null, null);
    }
    static fromParts(parts) {
        const { seconds, nanos, utcOffset, utc } = parts;
        if (typeof seconds !== 'bigint')
            throw new TypeError('RubyTime seconds must be a bigint');
        if (!Number.isSafeInteger(nanos) || !Number.isSafeInteger(utcOffset) || typeof utc !== 'boolean') {
            throw new TypeError('RubyTime nanos and utcOffset must be integers and utc a boolean');
        }
        return new RubyTime(null, seconds, nanos, utcOffset, utc);
    }
    toString() {
        return this.iso ?? `${this.seconds}s+${this.nanos}ns (offset ${this.utcOffset}, utc ${this.utc})`;
    }
}
/** A Ruby Regexp: its source and its option bits. */
export class RubyRegexp {
    source;
    options;
    constructor(source, options = 0) {
        this.source = source;
        this.options = options;
        if (typeof source !== 'string' || !Number.isSafeInteger(options)) {
            throw new TypeError('RubyRegexp takes a source string and integer options');
        }
    }
    toString() {
        return `/${this.source}/`;
    }
}
const INDEX_KEY = /^(?:0|[1-9][0-9]*)$/;
function hex(bytes) {
    let out = '';
    for (const byte of bytes)
        out += byte.toString(16).padStart(2, '0');
    return out;
}
function unhex(text) {
    if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text))
        throw new TypeError(`$bytes is not hex: ${text}`);
    const bytes = new Uint8Array(text.length / 2);
    for (let i = 0; i < bytes.length; i++)
        bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}
function tagged(tag, inner) {
    return new Map([[tag, inner]]);
}
function encodeHash(entries, depth) {
    const pairs = [...entries];
    // A string-keyed Hash is a JSON object unless a key starts with `$`, which
    // the core would read as a value tag; that Hash travels as `$map`.
    if (pairs.every(([key]) => typeof key === 'string' && !key.startsWith('$'))) {
        const object = new Map();
        for (const [key, value] of pairs)
            object.set(key, encodeAt(value, depth + 1));
        return object;
    }
    return tagged('$map', pairs.map(([key, value]) => [encodeAt(key, depth + 1), encodeAt(value, depth + 1)]));
}
function encodeAt(value, depth) {
    if (depth > 256)
        throw new RangeError('value nesting is too deep');
    if (value === null)
        return null;
    switch (typeof value) {
        case 'boolean':
        case 'string':
        case 'bigint':
            return value;
        case 'number':
            if (!Number.isSafeInteger(value)) {
                throw new TypeError(`${value} is not a safe integer; pass an Integer as a bigint and a Float as a RubyFloat`);
            }
            return BigInt(value);
        case 'undefined':
            throw new TypeError('undefined is not a Ruby value; use null for nil');
    }
    if (value instanceof RubySymbol)
        return tagged('$sym', value.name);
    if (value instanceof RubyFloat)
        return tagged('$float', value.text);
    if (value instanceof RubyRegexp) {
        return tagged('$regexp', value.options === 0
            ? value.source
            : new Map([
                ['source', value.source],
                ['options', BigInt(value.options)],
            ]));
    }
    if (value instanceof RubyTime) {
        if (value.iso !== null)
            return tagged('$time', value.iso);
        return tagged('$time', new Map([
            ['seconds', value.seconds.toString()],
            ['nanos', BigInt(value.nanos)],
            ['utc_offset', BigInt(value.utcOffset)],
            ['utc', value.utc],
        ]));
    }
    if (value instanceof Uint8Array)
        return tagged('$bytes', hex(value));
    if (Array.isArray(value))
        return value.map((item) => encodeAt(item, depth + 1));
    if (value instanceof Map)
        return encodeHash(value, depth);
    if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        const keys = Object.keys(value);
        if (keys.some((key) => INDEX_KEY.test(key))) {
            throw new TypeError('a plain object reorders integer-like keys; pass this Hash as a Map');
        }
        return encodeHash(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]), depth);
    }
    throw new TypeError(`not a Ruby value: ${Object.prototype.toString.call(value)}`);
}
/** Encode a value in the wire's JSON form. Fields set to `undefined` are left out. */
export function encode(value) {
    return encodeAt(value, 0);
}
function only(object, tag) {
    if (object.size !== 1)
        throw new TypeError(`${tag} must be the only key of its object`);
    return object.get(tag);
}
function text(inner, tag) {
    if (typeof inner !== 'string')
        throw new TypeError(`${tag} takes a string`);
    return inner;
}
function int(inner, what) {
    if (typeof inner !== 'bigint' || inner > BigInt(Number.MAX_SAFE_INTEGER) || inner < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new TypeError(`${what} must be an integer`);
    }
    return Number(inner);
}
function fields(inner, allowed, tag) {
    for (const key of inner.keys()) {
        if (!allowed.includes(key))
            throw new TypeError(`${tag} takes only ${allowed.join(', ')}`);
    }
}
const TAGS = ['$sym', '$float', '$int', '$time', '$regexp', '$bytes', '$map'];
function decodeAt(json, depth) {
    if (depth > 256)
        throw new RangeError('value nesting is too deep');
    if (json === null || typeof json === 'boolean' || typeof json === 'string' || typeof json === 'bigint') {
        return json;
    }
    if (json instanceof JsonDecimal) {
        throw new TypeError(`the number ${json.text} is not an integer; a Float travels as $float`);
    }
    if (Array.isArray(json))
        return json.map((item) => decodeAt(item, depth + 1));
    // As in the core (ukiryu-rs wire/value.rs): an object is a tag exactly
    // when it has one key and that key is a tag name. Any other object is a
    // Hash with String keys, even when its keys start with `$` (`$schema` and
    // `$id`, or a lone JSON-schema `$ref`).
    const [first] = json.keys();
    if (first !== undefined && json.size === 1 && TAGS.includes(first)) {
        const inner = only(json, first);
        switch (first) {
            case '$sym':
                return RubySymbol.for(text(inner, first));
            case '$float':
                return new RubyFloat(text(inner, first));
            case '$int': {
                const digits = text(inner, first);
                if (!/^-?(?:0|[1-9][0-9]*)$/.test(digits))
                    throw new TypeError('$int takes a decimal integer');
                return BigInt(digits);
            }
            case '$bytes':
                return unhex(text(inner, first));
            case '$regexp':
                if (typeof inner === 'string')
                    return new RubyRegexp(inner);
                if (inner instanceof Map) {
                    fields(inner, ['source', 'options'], first);
                    return new RubyRegexp(text(inner.get('source') ?? null, '$regexp.source'), int(inner.get('options') ?? 0n, '$regexp.options'));
                }
                throw new TypeError('$regexp takes a string or an object');
            case '$time':
                if (typeof inner === 'string')
                    return RubyTime.fromIso(inner);
                if (inner instanceof Map) {
                    fields(inner, ['seconds', 'nanos', 'utc_offset', 'utc'], first);
                    const seconds = text(inner.get('seconds') ?? null, '$time.seconds');
                    if (!/^-?(?:0|[1-9][0-9]*)$/.test(seconds))
                        throw new TypeError('$time.seconds must be a decimal string');
                    const utc = inner.get('utc');
                    if (typeof utc !== 'boolean')
                        throw new TypeError('$time.utc must be a boolean');
                    return RubyTime.fromParts({
                        seconds: BigInt(seconds),
                        nanos: int(inner.get('nanos') ?? null, '$time.nanos'),
                        utcOffset: int(inner.get('utc_offset') ?? null, '$time.utc_offset'),
                        utc,
                    });
                }
                throw new TypeError('$time takes a string or an object');
            case '$map': {
                if (!Array.isArray(inner))
                    throw new TypeError('$map takes an array of pairs');
                const hash = new Map();
                for (const pair of inner) {
                    if (!Array.isArray(pair) || pair.length !== 2)
                        throw new TypeError('$map takes [key, value] pairs');
                    hash.set(decodeAt(pair[0], depth + 1), decodeAt(pair[1], depth + 1));
                }
                return hash;
            }
            default:
                throw new TypeError(`unknown value tag ${first}`);
        }
    }
    const hash = new Map();
    for (const [key, item] of json)
        hash.set(key, decodeAt(item, depth + 1));
    return hash;
}
/** Decode a value from the wire's JSON form. */
export function decode(json) {
    return decodeAt(json, 0);
}

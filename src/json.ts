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
export class JsonDecimal {
  constructor(readonly text: string) {}
  toString(): string {
    return this.text;
  }
}

export type Json = null | boolean | string | bigint | JsonDecimal | Json[] | JsonObject;
/** A JSON object in document order. */
export type JsonObject = Map<string, Json>;

export class JsonSyntaxError extends SyntaxError {
  constructor(message: string, readonly position: number) {
    super(`${message} at offset ${position}`);
    this.name = 'JsonSyntaxError';
  }
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/** Parse JSON text. Duplicate object keys are an error. */
export function parseJson(text: string): Json {
  let at = 0;
  const fail = (message: string): never => {
    throw new JsonSyntaxError(message, at);
  };
  const space = () => {
    while (at < text.length) {
      const c = text.charCodeAt(at);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) at++;
      else break;
    }
  };
  const string = (): string => {
    at++; // opening quote
    let out = '';
    let start = at;
    for (;;) {
      if (at >= text.length) fail('unterminated string');
      const c = text.charCodeAt(at);
      if (c === 0x22) {
        out += text.slice(start, at);
        at++;
        return out;
      }
      if (c < 0x20) fail('control character in string');
      if (c !== 0x5c) {
        at++;
        continue;
      }
      out += text.slice(start, at);
      const e = text[at + 1];
      if (e === 'u') {
        const hex = text.slice(at + 2, at + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid \\u escape');
        out += String.fromCharCode(parseInt(hex, 16));
        at += 6;
      } else if (e !== undefined && Object.hasOwn(ESCAPES, e)) {
        out += ESCAPES[e];
        at += 2;
      } else {
        fail('invalid escape');
      }
      start = at;
    }
  };
  const value = (depth: number): Json => {
    if (depth > 512) fail('nesting is too deep');
    space();
    const c = text[at];
    if (c === '{') {
      at++;
      const object: JsonObject = new Map();
      space();
      if (text[at] === '}') {
        at++;
        return object;
      }
      for (;;) {
        space();
        if (text[at] !== '"') fail('expected an object key');
        const key = string();
        if (object.has(key)) fail(`duplicate key ${JSON.stringify(key)}`);
        space();
        if (text[at] !== ':') fail('expected ":"');
        at++;
        object.set(key, value(depth + 1));
        space();
        if (text[at] === ',') {
          at++;
          continue;
        }
        if (text[at] === '}') {
          at++;
          return object;
        }
        fail('expected "," or "}"');
      }
    }
    if (c === '[') {
      at++;
      const array: Json[] = [];
      space();
      if (text[at] === ']') {
        at++;
        return array;
      }
      for (;;) {
        array.push(value(depth + 1));
        space();
        if (text[at] === ',') {
          at++;
          continue;
        }
        if (text[at] === ']') {
          at++;
          return array;
        }
        fail('expected "," or "]"');
      }
    }
    if (c === '"') return string();
    if (text.startsWith('true', at)) {
      at += 4;
      return true;
    }
    if (text.startsWith('false', at)) {
      at += 5;
      return false;
    }
    if (text.startsWith('null', at)) {
      at += 4;
      return null;
    }
    NUMBER.lastIndex = at;
    const match = NUMBER.exec(text);
    if (!match) return fail('unexpected token');
    at = NUMBER.lastIndex;
    return match[1] === undefined && match[2] === undefined ? BigInt(match[0]) : new JsonDecimal(match[0]);
  };
  const result = value(0);
  space();
  if (at !== text.length) fail('unexpected text after the document');
  return result;
}

/** Serialize a {@link Json} tree; objects keep their `Map` order. */
export function stringifyJson(value: Json): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      return value.toString();
  }
  if (value instanceof JsonDecimal) {
    if (!/^-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(value.text)) {
      throw new TypeError(`not a JSON number: ${value.text}`);
    }
    return value.text;
  }
  if (Array.isArray(value)) return `[${value.map(stringifyJson).join(',')}]`;
  if (value instanceof Map) {
    const members: string[] = [];
    for (const [key, member] of value) members.push(`${JSON.stringify(key)}:${stringifyJson(member)}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`not a JSON value: ${String(value)}`);
}

/**
 * Structural equality of two JSON trees: arrays in order, objects as key
 * sets (the corpus compares objects structurally), integers by value.
 */
export function jsonEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a instanceof JsonDecimal) return b instanceof JsonDecimal && a.text === b.text;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => jsonEqual(item, b[i] as Json));
  }
  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false;
    for (const [key, item] of a) {
      if (!b.has(key) || !jsonEqual(item, b.get(key) as Json)) return false;
    }
    return true;
  }
  return false;
}

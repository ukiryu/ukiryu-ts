// The lossless JSON parser and the Ruby value codec. No engine is involved.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decode,
  encode,
  JsonDecimal,
  jsonEqual,
  JsonSyntaxError,
  parseJson,
  RubyFloat,
  RubyRegexp,
  RubySymbol,
  RubyTime,
  stringifyJson,
} from '../../dist/index.js';

const wire = (value) => stringifyJson(encode(value));
const back = (text) => decode(parseJson(text));

test('integers keep every digit', () => {
  const text = '[18446744073709551617,-9007199254740993,0]';
  assert.notEqual(JSON.stringify(JSON.parse(text)), text, 'JSON.parse rounds these');
  assert.deepEqual(parseJson(text), [18446744073709551617n, -9007199254740993n, 0n]);
  assert.equal(stringifyJson(parseJson(text)), text);
  assert.equal(back('{"$int":"-123456789012345678901234567890"}'), -123456789012345678901234567890n);
});

test('a non-integer JSON number keeps its text and is not a Ruby value', () => {
  const parsed = parseJson('[1.10,2e3]');
  assert.ok(parsed[0] instanceof JsonDecimal && parsed[0].text === '1.10');
  assert.equal(stringifyJson(parsed), '[1.10,2e3]');
  assert.throws(() => decode(parsed), /not an integer/);
});

test('objects keep document order, including integer-like keys', () => {
  const text = '{"b":1,"2":2,"a":3,"1":4}';
  assert.deepEqual(Object.keys(JSON.parse(text)), ['1', '2', 'b', 'a'], 'a plain object reorders');
  assert.deepEqual([...parseJson(text).keys()], ['b', '2', 'a', '1']);
  assert.equal(stringifyJson(parseJson(text)), text);
});

test('malformed JSON is rejected', () => {
  for (const text of ['{"a":1,"a":2}', '[1,]', '01', '"\\x"', '{"a" 1}', '[1] 2', '"a\nb"', '']) {
    assert.throws(() => parseJson(text), JsonSyntaxError, text);
  }
});

test('strings keep escapes, surrogates and U+2028', () => {
  const text = '"a\\u0000\\ud83d\\ude00 \\"\\\\\\/"';
  assert.equal(parseJson(text), 'a\u0000\u{1F600} "\\/');
});

test('tagged Ruby values round-trip exactly', () => {
  const cases = [
    [RubySymbol.for('name'), '{"$sym":"name"}'],
    [new RubyFloat('1.0e+20'), '{"$float":"1.0e+20"}'],
    [new RubyFloat('NaN'), '{"$float":"NaN"}'],
    [RubyTime.fromIso('2024-01-17T10:20:30.123456789Z'), '{"$time":"2024-01-17T10:20:30.123456789Z"}'],
    [
      RubyTime.fromParts({ seconds: -62135596801n, nanos: 5, utcOffset: 3600, utc: false }),
      '{"$time":{"seconds":"-62135596801","nanos":5,"utc_offset":3600,"utc":false}}',
    ],
    [new RubyRegexp('a+b'), '{"$regexp":"a+b"}'],
    [new RubyRegexp('a', 1), '{"$regexp":{"source":"a","options":1}}'],
    [new Uint8Array([0, 255, 16]), '{"$bytes":"00ff10"}'],
    [
      new Map([[RubySymbol.for('max'), 8n], [1n, 'x']]),
      '{"$map":[[{"$sym":"max"},8],[1,"x"]]}',
    ],
    [new Map([['b', 1n], ['a', [null, true]]]), '{"b":1,"a":[null,true]}'],
  ];
  for (const [value, text] of cases) {
    assert.equal(wire(value), text);
    assert.equal(wire(back(text)), text);
  }
  assert.equal(back('{"$sym":"x"}'), RubySymbol.for('x'), 'symbols are interned');
  assert.equal(back('{"$float":"2.5"}').valueOf(), 2.5);
});

test('a String-keyed Hash whose key looks like a tag travels as $map', () => {
  assert.equal(wire(new Map([['$sym', 'x']])), '{"$map":[["$sym","x"]]}');
  assert.equal(wire({ $sym: 'x' }), '{"$map":[["$sym","x"]]}');
});

test('lossy inputs are refused', () => {
  assert.throws(() => encode(1.5), /not a safe integer/);
  assert.throws(() => encode(2 ** 60), /not a safe integer/);
  assert.throws(() => encode(undefined), /undefined/);
  assert.throws(() => encode({ 10: 'a' }), /pass this Hash as a Map/);
  assert.throws(() => encode(new Date(0)), /not a Ruby value/);
  assert.equal(wire(42), '42');
  assert.equal(wire({ a: 1, b: undefined }), '{"a":1}');
});

test('malformed tags are refused', () => {
  for (const text of [
    '{"$bytes":"abc"}',
    '{"$int":"1.5"}',
    '{"$time":{"seconds":"1","nanos":0,"utc_offset":0}}',
    '{"$map":[[1]]}',
    '{"$regexp":{"source":"a","flags":1}}',
  ]) {
    assert.throws(() => back(text), TypeError, text);
  }
});

test('an object that is not a lone tag name reads as a Hash', () => {
  const hash = (pairs) => new Map(pairs);
  assert.deepEqual(back('{"$unknown":1}'), hash([['$unknown', 1n]]));
  assert.deepEqual(back('{"$ref":"#/x"}'), hash([['$ref', '#/x']]));
  assert.deepEqual(back('{"a":{"$ref":{"$sym":"b"}}}'), hash([['a', hash([['$ref', back('{"$sym":"b"}')]])]]));
  assert.deepEqual(back('{"$sym":"a","b":1}'), hash([['$sym', 'a'], ['b', 1n]]));
  assert.deepEqual(back('{"$schema":"s","$id":"i"}'), hash([['$schema', 's'], ['$id', 'i']]));
  assert.equal(wire(back('{"$ref":"#/x"}')), '{"$map":[["$ref","#/x"]]}');
});

test('jsonEqual compares objects structurally and numbers exactly', () => {
  assert.ok(jsonEqual(parseJson('{"a":1,"b":[2]}'), parseJson('{"b":[2],"a":1}')));
  assert.ok(!jsonEqual(parseJson('{"a":1}'), parseJson('{"a":1.0}')));
  assert.ok(!jsonEqual(parseJson('[9007199254740993]'), parseJson('[9007199254740992]')));
});

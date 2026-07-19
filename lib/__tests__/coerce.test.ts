import { describe, it, expect } from 'vitest';
import { toStringArray, toRecord } from '../coerce';

describe('toStringArray', () => {
  it('returns empty array for null', () => {
    expect(toStringArray(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(toStringArray(undefined)).toEqual([]);
  });

  it('passes through a string array', () => {
    expect(toStringArray(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('coerces a JSON-encoded string array', () => {
    expect(toStringArray('["x","y"]')).toEqual(['x', 'y']);
  });

  it('wraps a plain string in an array', () => {
    expect(toStringArray('single chip')).toEqual(['single chip']);
  });

  it('surfaces object values as strings', () => {
    const result = toStringArray({ a: 'foo', b: 'bar' });
    expect(result).toEqual(expect.arrayContaining(['foo', 'bar']));
  });

  it('coerces a number to string', () => {
    expect(toStringArray(42)).toEqual(['42']);
  });

  it('filters null members from arrays', () => {
    expect(toStringArray([null, 'a', undefined, 'b'])).toEqual(['a', 'b']);
  });

  it('coerces non-string array members to string', () => {
    expect(toStringArray([1, true, 'text'])).toEqual(['1', 'true', 'text']);
  });
});

describe('toRecord', () => {
  it('returns empty object for null', () => {
    expect(toRecord(null)).toEqual({});
  });

  it('passes through a plain object', () => {
    expect(toRecord({ key: 'value' })).toEqual({ key: 'value' });
  });

  it('parses a JSON-encoded object string', () => {
    expect(toRecord('{"k":"v"}')).toEqual({ k: 'v' });
  });

  it('returns empty object for a JSON array string', () => {
    expect(toRecord('["a","b"]')).toEqual({});
  });

  it('returns empty object for an array', () => {
    expect(toRecord(['a', 'b'])).toEqual({});
  });
});

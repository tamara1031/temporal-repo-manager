import { describe, expect, it } from 'vitest';
import { extractJsonObject } from '../src/activities/_internal/json-extract';

describe('extractJsonObject', () => {
  it('parses whole-object JSON', () => {
    expect(extractJsonObject('{"verdict":"retry","rationale":"transient"}')).toEqual({
      verdict: 'retry',
      rationale: 'transient',
    });
  });

  it('parses fenced JSON', () => {
    expect(extractJsonObject('```json\n{"theme":"cleanup","steps":[]}\n```')).toEqual({
      theme: 'cleanup',
      steps: [],
    });
  });

  it('parses embedded JSON', () => {
    expect(extractJsonObject('preamble {"overview":"repo","conventions":[]} trailing prose')).toEqual({
      overview: 'repo',
      conventions: [],
    });
  });

  it('returns undefined for malformed non-JSON inputs', () => {
    expect(extractJsonObject('not json at all')).toBeUndefined();
    expect(extractJsonObject('```json\n{"theme":\n```')).toBeUndefined();
  });
});

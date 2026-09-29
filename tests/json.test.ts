import { describe, expect, it } from 'vitest';
import { parseLastJson } from '../src/json';

describe('parseLastJson', () => {
  it('takes the final object when a draft precedes it', () => {
    expect(parseLastJson('Draft: {"summary": "old"}\nFinal:\n{"summary": "new"}')).toEqual({ summary: 'new' });
  });

  it('handles braces inside strings', () => {
    expect(parseLastJson('{"summary": "uses {braces} and \\"quotes\\""}')).toEqual({
      summary: 'uses {braces} and "quotes"',
    });
  });

  it('returns undefined without a complete object', () => {
    expect(parseLastJson('no json here {"summary": ')).toBeUndefined();
  });
});

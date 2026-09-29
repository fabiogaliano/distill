import { describe, expect, it } from 'vitest';
import { cacheKey } from '../src/pipeline/cache';

const base = {
  prompt: 'Extract.',
  input: 'chapter text',
  spec: { provider: 'claude-sdk', model: 'claude-opus-5-5', effort: 'medium' },
} as const;

describe('cacheKey', () => {
  it('is stable for the same inputs', () => {
    expect(cacheKey(base)).toBe(cacheKey({ ...base, spec: { ...base.spec } }));
  });

  it.each([
    ['chapter text', { input: 'edited chapter text' }],
    ['prompt', { prompt: 'Extract better.' }],
    ['model', { spec: { ...base.spec, model: 'claude-fable-5-1' } }],
    ['effort', { spec: { ...base.spec, effort: 'low' } }],
  ])('changes with the %s', (_, change) => {
    expect(cacheKey({ ...base, ...change })).not.toBe(cacheKey(base));
  });
});

import { describe, expect, it } from 'vitest';
import { completeText, createProvider, type Completion, type Provider } from '../src/providers';
import type { ModelSpec } from '../src/types';

const spec: ModelSpec = { provider: 'claude-sdk', model: 'claude-opus-5-5', effort: 'medium' };

function fake(overrides: Partial<Completion>): Provider {
  return {
    spec,
    complete: async () => ({
      text: '  summary  \n',
      stopReason: 'end_turn',
      isError: false,
      outputTokens: 0,
      thinkingTokens: 0,
      costUsd: 0,
      durationMs: 0,
      ...overrides,
    }),
  };
}

describe('completeText', () => {
  it('returns trimmed text', async () => {
    expect(await completeText(fake({}), 'p', 'i')).toBe('summary');
  });

  it('treats a max_tokens stop as a failure', async () => {
    await expect(completeText(fake({ stopReason: 'max_tokens' }), 'p', 'i')).rejects.toThrow('max_tokens');
  });

  it('throws on error completions', async () => {
    await expect(completeText(fake({ isError: true, text: 'rate limited' }), 'p', 'i')).rejects.toThrow(
      'rate limited'
    );
  });
});

describe('createProvider', () => {
  it('builds the provider named by the spec', () => {
    expect(createProvider(spec).spec).toBe(spec);
    expect(createProvider({ provider: 'agy', model: 'gemini-3.1-pro-low' }).spec.provider).toBe('agy');
  });

  it('rejects unknown providers', () => {
    expect(() => createProvider({ provider: 'claude-cli', model: 'x' } as unknown as ModelSpec)).toThrow(
      'Unknown provider "claude-cli"'
    );
  });
});

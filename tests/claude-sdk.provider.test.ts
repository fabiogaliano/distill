import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query }));

import { ClaudeSdkProvider } from '../src/providers/claude-sdk.provider';

const spec = { provider: 'claude-sdk', model: 'claude-opus-5-5', effort: 'medium' } as const;

function respondWith(...messages: object[]) {
  query.mockImplementation(async function* () {
    yield* messages;
  });
}

const success = {
  type: 'result',
  subtype: 'success',
  result: 'the summary',
  stop_reason: 'end_turn',
  is_error: false,
  usage: { output_tokens: 120, output_tokens_details: { thinking_tokens: 40 } },
  total_cost_usd: 0.21,
  duration_ms: 5000,
};

describe('ClaudeSdkProvider', () => {
  beforeEach(() => query.mockReset());

  it('isolates the call from user settings, tools, and MCP servers', async () => {
    respondWith(success);
    await new ClaudeSdkProvider(spec).complete('Summarize.', 'chapter text');

    const { options } = query.mock.calls[0]![0];
    expect(options).toMatchObject({
      model: 'claude-opus-5-5',
      effort: 'medium',
      settingSources: [],
      mcpServers: {},
      tools: [],
      strictMcpConfig: true,
      extraArgs: { 'strict-mcp-config': null },
    });
    expect(options.systemPrompt).toEqual(expect.any(String));
  });

  it('sends the instructions followed by the input', async () => {
    respondWith(success);
    await new ClaudeSdkProvider(spec).complete('Summarize.', 'chapter text');
    expect(query.mock.calls[0]![0].prompt).toBe('Summarize.\n\nchapter text');
  });

  it('maps the result message to a completion', async () => {
    respondWith({ type: 'system', subtype: 'init' }, success);
    expect(await new ClaudeSdkProvider(spec).complete('p', 'i')).toEqual({
      text: 'the summary',
      stopReason: 'end_turn',
      isError: false,
      outputTokens: 120,
      thinkingTokens: 40,
      costUsd: 0.21,
      durationMs: 5000,
    });
  });

  it('reports error results as errors with their messages', async () => {
    respondWith({
      ...success,
      subtype: 'error_during_execution',
      result: undefined,
      is_error: true,
      errors: ['rate limited'],
    });
    const completion = await new ClaudeSdkProvider(spec).complete('p', 'i');
    expect(completion).toMatchObject({ isError: true, text: 'rate limited' });
  });

  it('throws when the SDK yields no result', async () => {
    respondWith({ type: 'system', subtype: 'init' });
    await expect(new ClaudeSdkProvider(spec).complete('p', 'i')).rejects.toThrow('no result');
  });
});

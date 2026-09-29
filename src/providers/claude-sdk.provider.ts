import { query, type EffortLevel, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ModelSpec } from '../types';
import type { Completion, Provider } from './types';

const SYSTEM_PROMPT = 'You follow the instructions in the user message exactly.';

export class ClaudeSdkProvider implements Provider {
  constructor(readonly spec: ModelSpec) {}

  async complete(prompt: string, input: string): Promise<Completion> {
    let result: SDKResultMessage | undefined;
    const messages = query({
      prompt: input ? `${prompt}\n\n${input}` : prompt,
      // Keeps my CLAUDE.md, tools, and MCP servers out of the call on subscription auth
      // (verified: 0 tools, 0 MCP servers).
      options: {
        model: this.spec.model,
        effort: this.spec.effort as EffortLevel | undefined,
        systemPrompt: SYSTEM_PROMPT,
        settingSources: [],
        mcpServers: {},
        tools: [],
        strictMcpConfig: true,
        extraArgs: { 'strict-mcp-config': null },
      },
    });
    for await (const message of messages) {
      if (message.type === 'result') result = message;
    }
    if (!result) throw new Error(`${this.spec.model}: Agent SDK returned no result`);

    return {
      text: result.subtype === 'success' ? result.result : result.errors.join('\n'),
      stopReason: result.stop_reason,
      isError: result.is_error || result.subtype !== 'success',
      outputTokens: result.usage.output_tokens,
      thinkingTokens: (result.usage as { output_tokens_details?: { thinking_tokens?: number } })
        .output_tokens_details?.thinking_tokens ?? 0,
      costUsd: result.total_cost_usd,
      durationMs: result.duration_ms,
    };
  }
}

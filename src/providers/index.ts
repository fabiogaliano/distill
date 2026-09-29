import type { ModelSpec } from '../types';
import type { Provider } from './types';
import { ClaudeSdkProvider } from './claude-sdk.provider';
import { AgyProvider } from './agy.provider';

export function createProvider(spec: ModelSpec): Provider {
  switch (spec.provider) {
    case 'claude-sdk':
      return new ClaudeSdkProvider(spec);
    case 'agy':
      return new AgyProvider(spec);
    default:
      throw new Error(`Unknown provider "${(spec as ModelSpec).provider}" for model ${spec.model}`);
  }
}

// Errored or truncated output would otherwise be written out as if it were a summary.
export async function completeText(provider: Provider, prompt: string, input: string): Promise<string> {
  const completion = await provider.complete(prompt, input);
  if (completion.isError) {
    throw new Error(`${provider.spec.model} failed: ${completion.text.slice(0, 500)}`);
  }
  if (completion.stopReason === 'max_tokens') {
    throw new Error(`${provider.spec.model} hit max_tokens; output is truncated`);
  }
  return completion.text.trim();
}

export type { Provider, Completion } from './types';

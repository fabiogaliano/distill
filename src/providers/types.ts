import type { ModelSpec } from '../types';

export interface Completion {
  text: string;
  stopReason: string | null;
  isError: boolean;
  outputTokens: number;
  thinkingTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface Provider {
  readonly spec: ModelSpec;
  complete(prompt: string, input: string): Promise<Completion>;
}

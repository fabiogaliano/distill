import type { ProviderType } from '../types';
import type { SummaryProvider } from './types';
import { ClaudeCLIProvider } from './claude-cli.provider';
import { AgyProvider } from './agy.provider';

export function createProvider(type: ProviderType): SummaryProvider {
  switch (type) {
    case 'claude-cli':
      return new ClaudeCLIProvider();
    case 'agy':
      return new AgyProvider();
    case 'anthropic-api':
      throw new Error('anthropic-api provider not yet implemented');
    case 'openai':
      throw new Error('openai provider not yet implemented');
    default:
      throw new Error(`Unknown provider: ${type}`);
  }
}

export type { SummaryProvider } from './types';

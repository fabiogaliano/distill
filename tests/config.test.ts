import { describe, expect, it } from 'vitest';
import { loadConfig, resolveStage } from '../src/config';
import type { AppConfig } from '../src/types';

const config = {
  models: {
    opus: { provider: 'claude-sdk', model: 'claude-opus-5-5', effort: 'medium' },
    'opus-low': { provider: 'claude-sdk', model: 'claude-opus-5-5', effort: 'low' },
  },
  stages: { extract: 'opus', synthesize: 'opus', skill: 'opus' },
} as unknown as AppConfig;

describe('resolveStage', () => {
  it("uses the stage's configured role", () => {
    expect(resolveStage(config, 'extract')).toEqual(config.models.opus);
  });

  it('lets a role override replace the stage default', () => {
    expect(resolveStage(config, 'extract', 'opus-low')).toEqual(config.models['opus-low']);
  });

  it('names the known roles when a role is unknown', () => {
    expect(() => resolveStage(config, 'synthesize', 'haiku')).toThrow(
      'Unknown model role "haiku" for stage synthesize. Roles in config.yaml: opus, opus-low'
    );
  });
});

describe('config.yaml', () => {
  it('maps every stage to a defined role', async () => {
    const real = await loadConfig();
    for (const stage of ['extract', 'synthesize', 'skill'] as const) {
      expect(() => resolveStage(real, stage)).not.toThrow();
    }
  });
});

import { createHash } from 'crypto';
import { join } from 'path';
import type { ModelSpec } from '../types';
import type { Completion } from '../providers';

export interface CacheInput {
  prompt: string;
  input: string;
  spec: ModelSpec;
}

export interface CachedCompletion {
  key: string;
  model: string;
  effort?: string;
  createdAt: string;
  completion: Completion;
}

// Any change to the text, prompt, model, or effort yields a new key, so only the
// affected calls re-run.
export function cacheKey({ prompt, input, spec }: CacheInput): string {
  return createHash('sha256')
    .update(JSON.stringify([spec.provider, spec.model, spec.effort ?? null, prompt, input]))
    .digest('hex');
}

export async function readCache(cacheDir: string, key: string): Promise<CachedCompletion | undefined> {
  const file = Bun.file(join(cacheDir, `${key}.json`));
  return (await file.exists()) ? file.json() : undefined;
}

export async function writeCache(cacheDir: string, key: string, spec: ModelSpec, completion: Completion): Promise<void> {
  const entry: CachedCompletion = {
    key,
    model: spec.model,
    effort: spec.effort,
    createdAt: new Date().toISOString(),
    completion,
  };
  await Bun.write(join(cacheDir, `${key}.json`), JSON.stringify(entry, null, 2) + '\n');
}

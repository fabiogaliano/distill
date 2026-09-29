import { mkdir } from 'fs/promises';
import { join } from 'path';
import { assertComplete, type Provider } from '../providers';
import { cacheKey, readCache, writeCache } from '../pipeline/cache';
import type { SkillTarget } from '../types';
import { skillDir, variantDir, type Recipe } from './recipe';

// Past this, Claude Code's guidance is to split into supporting files.
export const MAX_BODY_LINES = 500;

export interface RenderedVariant {
  target: string;
  path: string;
  lines: number;
  cached: boolean;
  costUsd: number;
}

export function fillRenderPrompt(prompt: string, target: SkillTarget, guide: string): string {
  return prompt.replaceAll('{{READER}}', target.reader).replaceAll('{{GUIDE}}', guide.trim());
}

// Models often wrap a whole-document answer in a fence even when told not to.
export function unwrapFence(text: string): string {
  const match = text.trim().match(/^```(?:markdown|md)?\n([\s\S]*)\n```$/);
  return (match ? match[1]! : text).trim();
}

// Frontmatter comes from the recipe rather than the model, so name and
// description are exactly what was approved.
export function skillMarkdown(recipe: Recipe, body: string): string {
  const description = JSON.stringify(recipe.description.replace(/\s+/g, ' ').trim());
  return `---\nname: ${recipe.name}\ndescription: ${description}\n---\n\n${body.trim()}\n`;
}

export async function renderVariant(options: {
  root: string;
  recipe: Recipe;
  spec: string;
  target: string;
  targetConfig: SkillTarget;
  guide: string;
  prompt: string;
  provider: Provider;
}): Promise<RenderedVariant> {
  const { root, recipe, spec, target, provider } = options;
  const prompt = fillRenderPrompt(options.prompt, options.targetConfig, options.guide);
  const cache = join(skillDir(root, recipe.name), 'cache');
  const key = cacheKey({ prompt, input: spec, spec: provider.spec });

  await mkdir(cache, { recursive: true });
  const cached = await readCache(cache, key);
  const completion = cached?.completion ?? assertComplete(provider, await provider.complete(prompt, spec));
  const body = unwrapFence(completion.text);
  if (!body) throw new Error(`${target} render came back empty`);
  if (!cached) await writeCache(cache, key, provider.spec, completion);

  const path = join(variantDir(root, recipe.name, target), 'SKILL.md');
  await Bun.write(path, skillMarkdown(recipe, body));
  return { target, path, lines: body.split('\n').length, cached: Boolean(cached), costUsd: cached ? 0 : completion.costUsd };
}

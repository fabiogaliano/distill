import { join, dirname } from 'path';
import { parse as parseYaml } from 'yaml';
import type { AppConfig, ModelSpec, Stage } from './types';

// Front matter terms to skip (before book content starts)
export const FRONT_MATTER = [
  'cover',
  'title page',
  'title',
  'copyright',
  'dedication',
  'contents',
  'table of contents',
  'also by',
  'about the author',
  'praise for',
  'endorsements',
  'epigraph',
];

// Terms that indicate book content is starting
export const INTRO_TERMS = [
  'introduction',
  'preface',
  'prologue',
  'foreword',
  'acknowledgments',
  'acknowledgements',
];

// Minimum word count to consider a chapter as content (not front matter)
export const MIN_CONTENT_WORDS = 100;

// Path to epub-chapter-splitter binary
export const EPUB_SPLITTER_PATH = join(
  dirname(import.meta.dirname),
  'epub-chapter-splitter/target/release/epub-chapter-splitter'
);

// Config singleton
let _config: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
  if (_config) return _config;

  const configPath = join(dirname(import.meta.dirname), 'config.yaml');
  const content = await Bun.file(configPath).text();
  _config = parseYaml(content) as AppConfig;
  return _config;
}

export function resolveStage(config: AppConfig, stage: Stage, roleOverride?: string): ModelSpec {
  const role = roleOverride ?? config.stages[stage];
  const spec = config.models[role];
  if (!spec) {
    throw new Error(
      `Unknown model role "${role}" for stage ${stage}. Roles in config.yaml: ${Object.keys(config.models).join(', ')}`
    );
  }
  return spec;
}

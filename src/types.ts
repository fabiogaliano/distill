// Book manifest from epub-splitter
export interface BookManifest {
  title?: string;
  author?: string;
  chapters: ChapterInfo[];
}

export interface ChapterInfo {
  index: number;
  file: string;
  title: string;
  word_count: number;
}

export type ProviderType = 'claude-sdk' | 'agy';

// agy bakes effort into the model name, so effort is optional.
export interface ModelSpec {
  provider: ProviderType;
  model: string;
  effort?: string;
}

export type Stage = 'extract' | 'synthesize' | 'skill';

// App configuration from config.yaml
export interface AppConfig {
  library: string;
  concurrency: number;
  models: Record<string, ModelSpec>;
  stages: Record<Stage, string>;
  prompts: {
    extract: string;
    synthesize: string;
  };
}

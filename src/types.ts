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

export interface Chapter {
  info: ChapterInfo;
  content: string;
}

// Summary modes
export type SummaryMode = 'concise' | 'detailed';

export type ProviderType = 'claude-sdk' | 'agy';

// agy bakes effort into the model name, so effort is optional.
export interface ModelSpec {
  provider: ProviderType;
  model: string;
  effort?: string;
}

export type Stage = 'extract' | 'synthesize' | 'skill';

// CLI options
export interface SummarizeOptions {
  path: string;
  output?: string;
  mode: SummaryMode;
  // Role from config.yaml `models`, applied to every stage of the run.
  modelRole?: string;
  skipExisting: boolean;
  interactive: boolean;
  singleFile: boolean;
  includeOverview: boolean;
}

// App configuration from config.yaml
export interface AppConfig {
  defaults: {
    mode: SummaryMode;
    singleFile: boolean;
    includeOverview: boolean;
  };
  library: string;
  models: Record<string, ModelSpec>;
  stages: Record<Stage, string>;
  prompts: {
    concise: { chapter: string; book: string };
    detailed: { chapter: string; book: string };
  };
}

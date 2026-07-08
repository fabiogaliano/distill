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

// Provider types
export type ProviderType = 'claude-cli' | 'anthropic-api' | 'openai' | 'agy';

export interface ProviderOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

// CLI options
export interface SummarizeOptions {
  path: string;
  output?: string;
  mode: SummaryMode;
  provider: ProviderType;
  model: string;
  skipExisting: boolean;
  interactive: boolean;
  singleFile: boolean;
  includeOverview: boolean;
}

// App configuration from config.yaml
export interface AppConfig {
  defaults: {
    mode: SummaryMode;
    model: string;
    provider: ProviderType;
    singleFile: boolean;
    includeOverview: boolean;
  };
  prompts: {
    concise: { chapter: string; book: string };
    detailed: { chapter: string; book: string };
  };
}

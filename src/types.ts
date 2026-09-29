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
    skill_plan: string;
    skill_spec: string;
    skill_revise: string;
    skill_render: string;
  };
  skills: SkillsConfig;
}

// A skill is rendered once per target; each target has its own reader model,
// prompting guide, and install location.
export interface SkillTarget {
  reader: string;
  guide: string;
  install: string;
}

export interface SkillsConfig {
  targets: Record<string, SkillTarget>;
  eval: {
    // Only this target's variant goes through the eval gate.
    target: string;
    runs: number;
    threshold: number;
    attempts: number;
    judge: string;
  };
}

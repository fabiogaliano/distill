// Shape asked for by the extract prompt in config.yaml.
export interface Extraction {
  skip: boolean;
  summary?: string;
  concepts?: { name: string; definition: string; why_it_matters?: string }[];
  principles?: { statement: string; explanation?: string }[];
  red_flags?: { name: string; symptom?: string; fix?: string }[];
  techniques?: { name: string; steps?: string[]; when_to_use?: string }[];
  contrasts?: { a: string; b: string; difference?: string; when_to_pick?: string }[];
  examples?: { description: string; illustrates?: string }[];
  cards?: { type: string; front: string; back: string }[];
}

export interface ChapterExtraction {
  chapter: { index: number; title: string; file: string };
  // Cache key of the completion this came from; null when the chapter was too short to send.
  key: string | null;
  model: string | null;
  effort?: string;
  extraction: Extraction;
}

export function isExtraction(value: unknown): value is Extraction {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.skip === true || typeof v.summary === 'string';
}

import { join } from 'path';
import { mkdir } from 'fs/promises';
import type { ChapterInfo } from '../types';
import { assertComplete, type Provider } from '../providers';
import { parseLastJson } from '../json';
import { pool } from '../pool';
import { cacheDir, extractDir, readChapterText, type LibraryBook } from '../library/library';
import { cacheKey, readCache, writeCache } from './cache';
import { isExtraction, type ChapterExtraction } from './extraction';

// Shorter chapters are part pages and dividers; sending them costs quota for nothing.
export const MIN_CHAPTER_WORDS = 50;

export type ChapterStatus = 'extracted' | 'cached' | 'current' | 'short' | 'failed';

export interface ChapterResult {
  chapter: ChapterInfo;
  status: ChapterStatus;
  costUsd: number;
  durationMs: number;
  error?: string;
}

export interface ExtractOptions {
  root: string;
  slug: string;
  book: LibraryBook;
  provider: Provider;
  prompt: string;
  concurrency: number;
  onChapter?: (result: ChapterResult, done: number, total: number) => void;
}

export const extractionPath = (root: string, slug: string, chapter: ChapterInfo) =>
  join(extractDir(root, slug), chapter.file.replace(/\.md$/, '.json'));

export function fillPrompt(template: string, book: LibraryBook, chapter: ChapterInfo): string {
  const bookName = book.author ? `${book.title} by ${book.author}` : book.title ?? '';
  return template.replaceAll('{{BOOK}}', bookName).replaceAll('{{CHAPTER}}', chapter.title);
}

export async function extractBook(options: ExtractOptions): Promise<ChapterResult[]> {
  const { root, slug, book, provider, concurrency } = options;
  await mkdir(extractDir(root, slug), { recursive: true });
  await mkdir(cacheDir(root, slug), { recursive: true });

  const chapters = book.chapters.filter(c => book.selected.includes(c.index));
  let done = 0;
  const tasks = chapters.map(chapter => async () => {
    const result = await extractChapter(options, chapter).catch(
      (err): ChapterResult => ({
        chapter,
        status: 'failed',
        costUsd: 0,
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    options.onChapter?.(result, ++done, chapters.length);
    return result;
  });
  return pool(tasks, concurrency);
}

async function extractChapter(options: ExtractOptions, chapter: ChapterInfo): Promise<ChapterResult> {
  const { root, slug, book, provider } = options;
  const outPath = extractionPath(root, slug, chapter);
  const base = { chapter: { index: chapter.index, title: chapter.title, file: chapter.file } };

  if (chapter.word_count < MIN_CHAPTER_WORDS) {
    const record: ChapterExtraction = { ...base, key: null, model: null, extraction: { skip: true } };
    await Bun.write(outPath, JSON.stringify(record, null, 2) + '\n');
    return { chapter, status: 'short', costUsd: 0, durationMs: 0 };
  }

  const prompt = fillPrompt(options.prompt, book, chapter);
  const input = await readChapterText(root, slug, chapter.file);
  const key = cacheKey({ prompt, input, spec: provider.spec });

  const existing = Bun.file(outPath);
  if ((await existing.exists()) && ((await existing.json()) as ChapterExtraction).key === key) {
    return { chapter, status: 'current', costUsd: 0, durationMs: 0 };
  }

  const cached = await readCache(cacheDir(root, slug), key);
  const completion = cached?.completion ?? assertComplete(provider, await provider.complete(prompt, input));
  const extraction = parseLastJson(completion.text);
  if (!isExtraction(extraction)) {
    throw new Error('response has no extraction JSON');
  }
  // Cached only once parsed, so a bad response is retried instead of replayed.
  if (!cached) await writeCache(cacheDir(root, slug), key, provider.spec, completion);

  const record: ChapterExtraction = {
    ...base,
    key,
    model: provider.spec.model,
    effort: provider.spec.effort,
    extraction,
  };
  await Bun.write(outPath, JSON.stringify(record, null, 2) + '\n');
  return cached
    ? { chapter, status: 'cached', costUsd: 0, durationMs: 0 }
    : { chapter, status: 'extracted', costUsd: completion.costUsd, durationMs: completion.durationMs };
}

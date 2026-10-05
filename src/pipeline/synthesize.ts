import { mkdir } from 'fs/promises';
import { assertComplete, type Provider } from '../providers';
import { cacheDir, summaryPath, type LibraryBook } from '../library/library';
import { cacheKey, readCache, writeCache } from './cache';
import { extractionPath } from './extract';
import type { ChapterExtraction, Extraction } from './extraction';

export interface SynthesizeOptions {
  root: string;
  slug: string;
  book: LibraryBook;
  provider: Provider;
  prompt: string;
}

export interface SynthesizeResult {
  path: string;
  cached: boolean;
  chapters: number;
  costUsd: number;
}

export async function synthesizeBook(options: SynthesizeOptions): Promise<SynthesizeResult> {
  const { root, slug, book, provider } = options;
  const extractions = await loadExtractions(root, slug, book);
  const content = extractions.filter(e => !e.extraction.skip);
  if (content.length === 0) {
    throw new Error(`No chapters with content to synthesize for "${slug}"`);
  }

  const prompt = options.prompt
    .replaceAll('{{BOOK}}', book.title ?? slug)
    .replaceAll('{{AUTHOR}}', book.author ?? 'Unknown');
  // Cards are for Anki and examples bulk up the input without helping the overview.
  const input = JSON.stringify(
    content.map(({ chapter, extraction: { cards, examples, ...rest } }) => ({ chapter: chapter.title, ...rest })),
    null,
    1
  );
  const key = cacheKey({ prompt, input, spec: provider.spec });

  await mkdir(cacheDir(root, slug), { recursive: true });
  const cached = await readCache(cacheDir(root, slug), key);
  const completion = cached?.completion ?? assertComplete(provider, await provider.complete(prompt, input));
  if (!cached) await writeCache(cacheDir(root, slug), key, provider.spec, completion);

  const path = summaryPath(root, slug);
  await Bun.write(path, renderSummary(book, completion.text, content));
  return { path, cached: Boolean(cached), chapters: content.length, costUsd: cached ? 0 : completion.costUsd };
}

async function loadExtractions(root: string, slug: string, book: LibraryBook): Promise<ChapterExtraction[]> {
  const selected = book.chapters.filter(c => book.selected.includes(c.index));
  const extractions: ChapterExtraction[] = [];
  const missing: string[] = [];
  for (const chapter of selected) {
    const file = Bun.file(extractionPath(root, slug, chapter));
    if (await file.exists()) extractions.push(await file.json());
    else missing.push(chapter.title);
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} selected chapter(s) have no extraction yet (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}). Run: distill extract ${slug}`
    );
  }
  return extractions;
}

export function renderSummary(book: LibraryBook, overview: string, chapters: ChapterExtraction[]): string {
  const lines = [`# ${book.title}`, ''];
  if (book.author) lines.push(`*${book.author}*`, '');
  lines.push('## Overview', '', overview.trim(), '', '## Chapters', '');
  for (const { chapter, extraction } of chapters) {
    lines.push(`### ${chapter.title}`, '', ...renderChapter(extraction));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderChapter(e: Extraction): string[] {
  const section = (title: string, items: string[] | undefined) =>
    items && items.length > 0 ? [`**${title}**`, '', ...items.map(i => `- ${i}`), ''] : [];
  const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ');

  return [
    e.summary ?? '',
    '',
    ...section('Concepts', e.concepts?.map(c => join(`**${c.name}**:`, c.definition, c.why_it_matters))),
    ...section('Principles', e.principles?.map(p => join(`**${p.statement}**`, p.explanation))),
    ...section('Red flags', e.red_flags?.map(r => join(`**${r.name}**:`, r.symptom, r.fix && `Fix: ${r.fix}`))),
    ...section(
      'Techniques',
      e.techniques?.map(t =>
        join(`**${t.name}**:`, t.when_to_use, t.steps?.length ? `Steps: ${t.steps.join(' → ')}` : undefined)
      )
    ),
    ...section('Contrasts', e.contrasts?.map(c => join(`**${c.a} vs ${c.b}**:`, c.difference, c.when_to_pick))),
  ];
}

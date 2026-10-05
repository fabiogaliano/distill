import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Completion, Provider } from '../src/providers';
import type { LibraryBook } from '../src/library/library';
import type { ModelSpec } from '../src/types';

export const SLUG = 'a-philosophy-of-software-design';

export interface FixtureChapter {
  title: string;
  text: string;
}

export async function makeLibrary(chapters: FixtureChapter[]): Promise<{ root: string; book: LibraryBook; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'distill-lib-'));
  const dir = join(root, 'books', SLUG);
  await mkdir(join(dir, 'chapters'), { recursive: true });

  const infos = chapters.map((c, index) => ({
    index,
    title: c.title,
    file: `${String(index).padStart(2, '0')}_ch${index}.md`,
    word_count: c.text.split(/\s+/).filter(Boolean).length,
  }));
  for (const [i, info] of infos.entries()) await Bun.write(join(dir, 'chapters', info.file), chapters[i]!.text);

  const book: LibraryBook = {
    title: 'A Philosophy of Software Design',
    author: 'John Ousterhout',
    chapters: infos,
    source: '/books/aposd.epub',
    selected: infos.map(c => c.index),
  };
  await Bun.write(join(dir, 'book.json'), JSON.stringify(book));
  return { root, book, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export const words = (n: number, word = 'complexity') => Array.from({ length: n }, () => word).join(' ');

export interface FakeProvider extends Provider {
  calls: { prompt: string; input: string }[];
  maxInFlight: number;
}

// Replies are produced per call so tests can vary them by prompt or input.
export function fakeProvider(
  reply: (prompt: string, input: string) => Partial<Completion> | Promise<Partial<Completion>>,
  spec: ModelSpec = { provider: 'claude-sdk', model: 'claude-opus-5-5', effort: 'medium' }
): FakeProvider {
  let inFlight = 0;
  const provider: FakeProvider = {
    spec,
    calls: [],
    maxInFlight: 0,
    async complete(prompt, input) {
      provider.calls.push({ prompt, input });
      provider.maxInFlight = Math.max(provider.maxInFlight, ++inFlight);
      try {
        await new Promise(resolve => setTimeout(resolve, 5));
        return {
          text: '',
          stopReason: 'end_turn',
          isError: false,
          outputTokens: 100,
          thinkingTokens: 0,
          costUsd: 0.2,
          durationMs: 1000,
          ...(await reply(prompt, input)),
        };
      } finally {
        inFlight--;
      }
    },
  };
  return provider;
}

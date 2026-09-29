import { afterEach, describe, expect, it } from 'vitest';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { extractBook, extractionPath, fillPrompt } from '../src/pipeline/extract';
import type { ChapterExtraction } from '../src/pipeline/extraction';
import type { LibraryBook } from '../src/library/library';
import { fakeProvider, makeLibrary, SLUG, words } from './library-fixture';

const PROMPT = 'Extract from {{CHAPTER}} of {{BOOK}}.';
const reply = (prompt: string) => ({ text: JSON.stringify({ skip: false, summary: `about ${prompt}` }) });

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function setup(chapters = [
  { title: 'The Nature of Complexity', text: words(300) },
  { title: 'Working Code Isn’t Enough', text: words(300, 'tactical') },
  { title: 'Part I', text: words(5) },
]) {
  const lib = await makeLibrary(chapters);
  cleanup = lib.cleanup;
  return lib;
}

const run = (root: string, book: LibraryBook, provider: ReturnType<typeof fakeProvider>, prompt = PROMPT, concurrency = 4) =>
  extractBook({ root, slug: SLUG, book, provider, prompt, concurrency });

const readExtraction = async (root: string, book: LibraryBook, index: number) =>
  (await Bun.file(extractionPath(root, SLUG, book.chapters[index]!)).json()) as ChapterExtraction;

describe('extractBook', () => {
  it('extracts selected chapters and skips too-short ones without a call', async () => {
    const { root, book } = await setup();
    const provider = fakeProvider(reply);

    const results = await run(root, book, provider);

    expect(results.map(r => r.status)).toEqual(['extracted', 'extracted', 'short']);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls.map(c => c.prompt)).toContain(
      'Extract from The Nature of Complexity of A Philosophy of Software Design by John Ousterhout.'
    );
    const first = await readExtraction(root, book, 0);
    expect(first).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium', extraction: { skip: false } });
    expect((await readExtraction(root, book, 2)).extraction).toEqual({ skip: true });
  });

  it('makes no calls when nothing changed', async () => {
    const { root, book } = await setup();
    await run(root, book, fakeProvider(reply));
    const again = fakeProvider(reply);

    const results = await run(root, book, again);

    expect(again.calls).toHaveLength(0);
    expect(results.map(r => r.status)).toEqual(['current', 'current', 'short']);
  });

  it('re-runs only the chapters whose text changed', async () => {
    const { root, book } = await setup();
    await run(root, book, fakeProvider(reply));
    await Bun.write(join(root, 'books', SLUG, 'chapters', book.chapters[1]!.file), words(300, 'strategic'));
    const again = fakeProvider(reply);

    const results = await run(root, book, again);

    expect(results.map(r => r.status)).toEqual(['current', 'extracted', 'short']);
    expect(again.calls).toHaveLength(1);
  });

  it('reuses cached completions when switching back to an earlier model', async () => {
    const { root, book } = await setup();
    const medium = { provider: 'claude-sdk', model: 'claude-opus-5-5', effort: 'medium' } as const;
    await run(root, book, fakeProvider(reply, medium));
    await run(root, book, fakeProvider(reply, { ...medium, effort: 'low' }));
    const back = fakeProvider(reply, medium);

    const results = await run(root, book, back);

    expect(back.calls).toHaveLength(0);
    expect(results.map(r => r.status)).toEqual(['cached', 'cached', 'short']);
    expect((await readExtraction(root, book, 0)).effort).toBe('medium');
  });

  it('records failures without caching them, and retries them on the next run', async () => {
    const { root, book } = await setup();
    const flaky = fakeProvider((prompt, input) =>
      input.startsWith('tactical') ? { text: 'I could not produce JSON' } : reply(prompt)
    );

    const results = await run(root, book, flaky);

    expect(results.map(r => r.status)).toEqual(['extracted', 'failed', 'short']);
    expect(results[1]!.error).toBe('response has no extraction JSON');
    expect(await readdir(join(root, 'books', SLUG, 'cache'))).toHaveLength(1);

    const retry = fakeProvider(reply);
    expect((await run(root, book, retry)).map(r => r.status)).toEqual(['current', 'extracted', 'short']);
    expect(retry.calls).toHaveLength(1);
  });

  it('treats truncated responses as failures', async () => {
    const { root, book } = await setup();
    const truncated = fakeProvider(() => ({ text: '{"skip": false, "summary": "cut', stopReason: 'max_tokens' }));

    const results = await run(root, book, truncated);

    expect(results[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('max_tokens') });
  });

  it('keeps at most `concurrency` calls in flight', async () => {
    const { root, book } = await setup(Array.from({ length: 8 }, (_, i) => ({ title: `Chapter ${i}`, text: words(100, `w${i}`) })));
    const provider = fakeProvider(reply);

    await run(root, book, provider, PROMPT, 3);

    expect(provider.calls).toHaveLength(8);
    expect(provider.maxInFlight).toBe(3);
  });

  it('only processes selected chapters', async () => {
    const { root, book } = await setup();
    const provider = fakeProvider(reply);

    const results = await run(root, { ...book, selected: [1] }, provider);

    expect(results.map(r => r.chapter.index)).toEqual([1]);
  });
});

describe('fillPrompt', () => {
  it('omits the author when unknown', async () => {
    const { book } = await setup();
    expect(fillPrompt('{{BOOK}} / {{CHAPTER}}', { ...book, author: undefined }, book.chapters[0]!)).toBe(
      'A Philosophy of Software Design / The Nature of Complexity'
    );
  });
});

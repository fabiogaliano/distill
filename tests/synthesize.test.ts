import { afterEach, describe, expect, it } from 'vitest';
import { extractBook } from '../src/pipeline/extract';
import { renderSummary, synthesizeBook } from '../src/pipeline/synthesize';
import type { ChapterExtraction } from '../src/pipeline/extraction';
import { fakeProvider, makeLibrary, SLUG, words } from './library-fixture';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const extraction = (summary: string) => ({
  skip: false,
  summary,
  concepts: [{ name: 'Deep module', definition: 'Simple interface, lots of functionality.', why_it_matters: 'Hides complexity.' }],
  red_flags: [{ name: 'Pass-through method', symptom: 'Only forwards its arguments.', fix: 'Merge or redistribute.' }],
  cards: [{ type: 'concept', front: 'What makes a module deep?', back: 'Small interface, big implementation.' }],
  examples: [{ description: 'Unix file I/O', illustrates: 'Deep module' }],
});

async function extractedLibrary() {
  const lib = await makeLibrary([
    { title: 'The Nature of Complexity', text: words(300) },
    { title: 'Acknowledgments', text: words(300, 'thanks') },
  ]);
  cleanup = lib.cleanup;
  const extractor = fakeProvider((_, input) => ({
    text: JSON.stringify(input.startsWith('thanks') ? { skip: true } : extraction('Complexity is incremental.')),
  }));
  await extractBook({ root: lib.root, slug: SLUG, book: lib.book, provider: extractor, prompt: 'x {{CHAPTER}}', concurrency: 2 });
  return lib;
}

describe('synthesizeBook', () => {
  it('writes summary.md with the model overview and the rendered chapters', async () => {
    const { root, book } = await extractedLibrary();
    const provider = fakeProvider(() => ({ text: 'Complexity is the enemy.\n' }));

    const result = await synthesizeBook({ root, slug: SLUG, book, provider, prompt: 'Overview of {{BOOK}} by {{AUTHOR}}.' });

    expect(provider.calls[0]!.prompt).toBe('Overview of A Philosophy of Software Design by John Ousterhout.');
    const input = JSON.parse(provider.calls[0]!.input);
    expect(input).toHaveLength(1);
    expect(input[0]).not.toHaveProperty('cards');
    expect(input[0]).not.toHaveProperty('examples');

    const summary = await Bun.file(result.path).text();
    expect(summary).toContain('## Overview\n\nComplexity is the enemy.\n');
    expect(summary).toContain('### The Nature of Complexity');
    expect(summary).not.toContain('Acknowledgments');
    expect(result).toMatchObject({ cached: false, chapters: 1 });
  });

  it('reuses the cached overview when nothing changed', async () => {
    const { root, book } = await extractedLibrary();
    const opts = { root, slug: SLUG, book, prompt: 'Overview.' };
    await synthesizeBook({ ...opts, provider: fakeProvider(() => ({ text: 'Overview text.' })) });
    const again = fakeProvider(() => ({ text: 'Different.' }));

    const result = await synthesizeBook({ ...opts, provider: again });

    expect(again.calls).toHaveLength(0);
    expect(result.cached).toBe(true);
    expect(await Bun.file(result.path).text()).toContain('Overview text.');
  });

  it('asks for extraction first when chapters are missing', async () => {
    const lib = await makeLibrary([{ title: 'The Nature of Complexity', text: words(300) }]);
    cleanup = lib.cleanup;

    await expect(
      synthesizeBook({ root: lib.root, slug: SLUG, book: lib.book, provider: fakeProvider(() => ({})), prompt: 'x' })
    ).rejects.toThrow(`Run: distill extract ${SLUG}`);
  });
});

describe('renderSummary', () => {
  it('renders each chapter section from its extraction', () => {
    const chapter: ChapterExtraction = {
      chapter: { index: 3, title: 'Modules Should Be Deep', file: '03_deep.md' },
      key: 'k',
      model: 'claude-opus-5-5',
      extraction: extraction('Deep modules hide complexity.'),
    };
    const book = { title: 'A Philosophy of Software Design', author: 'John Ousterhout', chapters: [], source: '', selected: [] };

    expect(renderSummary(book, 'Overview.', [chapter])).toBe(`# A Philosophy of Software Design

*John Ousterhout*

## Overview

Overview.

## Chapters

### Modules Should Be Deep

Deep modules hide complexity.

**Concepts**

- **Deep module**: Simple interface, lots of functionality. Hides complexity.

**Red flags**

- **Pass-through method**: Only forwards its arguments. Fix: Merge or redistribute.
`);
  });
});

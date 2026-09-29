import { afterEach, describe, expect, it } from 'vitest';
import { MAX_STAGE_BATCH, type AnkiBackend, type AnkiNote } from '../src/anki/ember';
import { cardId, cardsFromExtractions, toHtml } from '../src/anki/cards';
import { pushBook } from '../src/anki/push';
import { extractBook } from '../src/pipeline/extract';
import type { ChapterExtraction } from '../src/pipeline/extraction';
import { fakeProvider, makeLibrary, SLUG, words } from './library-fixture';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const card = (front: string, type = 'scenario') => ({ type, front, back: `Answer to ${front}` });

// Mimics ember: stageMany is all-or-nothing, capped at 20, and rejects duplicate first fields per note type.
function fakeEmber(options: { failOn?: string } = {}) {
  const notes: (AnkiNote & { id: number; batchTag: string })[] = [];
  const decks = new Set<string>();
  let batches = 0;
  const backend: AnkiBackend & { notes: typeof notes; decks: typeof decks; stageCalls: number } = {
    notes,
    decks,
    stageCalls: 0,
    async ensureDeck(parent, leaf) {
      decks.add(`${parent}::${leaf}`);
    },
    async stage(batch) {
      backend.stageCalls++;
      if (batch.length > MAX_STAGE_BATCH) throw new Error('batch too large');
      for (const note of batch) {
        if (options.failOn && note.fields.Front!.includes(options.failOn)) throw new Error('collection is not available');
        const clash = (n: AnkiNote) => n.modelName === note.modelName && n.fields.Front === note.fields.Front;
        if (notes.some(clash) || batch.filter(clash).length > 1) throw new Error('cannot create note because it is a duplicate');
      }
      const batchTag = `staged-batch::${++batches}`;
      const ids = batch.map(note => {
        notes.push({ ...note, id: 1000 + notes.length, batchTag });
        return 1000 + notes.length - 1;
      });
      return { batchTag, noteIds: ids };
    },
    async close() {},
  };
  return backend;
}

async function extractedLibrary(cardsByChapter: ReturnType<typeof card>[][]) {
  const lib = await makeLibrary(cardsByChapter.map((_, i) => ({ title: `Chapter ${i + 1}: Deep Modules`, text: words(100, `w${i}`) })));
  cleanup = lib.cleanup;
  const provider = fakeProvider((_, input) => {
    const i = Number(input.slice(1, input.indexOf(' ')));
    return { text: JSON.stringify({ skip: false, summary: 's', cards: cardsByChapter[i] }) };
  });
  await extractBook({ root: lib.root, slug: SLUG, book: lib.book, provider, prompt: '{{CHAPTER}}', concurrency: 2 });
  return lib;
}

describe('pushBook', () => {
  it('stages every card in the book deck with chapter and type tags', async () => {
    const { root, book } = await extractedLibrary([[card('What makes a module deep?', 'concept')], [card('A method only forwards its args. What now?')]]);
    const anki = fakeEmber();

    const result = await pushBook(root, SLUG, book, anki);

    expect(result).toMatchObject({ deck: 'Books::A Philosophy of Software Design', staged: 2, alreadySent: 0, duplicates: 0, failed: [] });
    expect(result.batches).toHaveLength(1);
    expect(anki.decks).toEqual(new Set(['Books::A Philosophy of Software Design']));
    expect(anki.notes.find(n => n.fields.Front === 'What makes a module deep?')).toMatchObject({
      modelName: 'Basic',
      tags: [`glean::${SLUG}::00-chapter-1-deep-modules`, 'glean::type::concept'],
    });
    expect(anki.notes[0]!.fields.Back).toContain('<small>Chapter 1: Deep Modules</small>');
  });

  it('sends at most 20 notes per batch', async () => {
    const { root, book } = await extractedLibrary([Array.from({ length: 45 }, (_, i) => card(`Question ${i}`))]);
    const anki = fakeEmber();

    const result = await pushBook(root, SLUG, book, anki);

    expect(result.staged).toBe(45);
    expect(anki.stageCalls).toBe(3);
  });

  it('only stages cards that are new since the last push', async () => {
    const { root, book } = await extractedLibrary([[card('Q1'), card('Q2')]]);
    const anki = fakeEmber();
    await pushBook(root, SLUG, book, anki);

    const again = await pushBook(root, SLUG, book, anki);

    expect(again).toMatchObject({ staged: 0, alreadySent: 2 });
    expect(anki.notes).toHaveLength(2);
  });

  it('isolates a duplicate that makes the batch fail, and stages the rest', async () => {
    const { root, book } = await extractedLibrary([[card('Q1'), card('Q2'), card('Q3')]]);
    const anki = fakeEmber();
    await anki.stage([{ deckName: 'Elsewhere', modelName: 'Basic', fields: { Front: 'Q2', Back: 'x' }, tags: [] }]);

    const result = await pushBook(root, SLUG, book, anki);

    expect(result).toMatchObject({ staged: 2, duplicates: 1, failed: [] });
    expect((await pushBook(root, SLUG, book, anki)).alreadySent).toBe(3);
  });

  it('treats notes Anki already has as sent when anki.json is lost', async () => {
    const { root, book } = await extractedLibrary([[card('Q1'), card('Q2')]]);
    const anki = fakeEmber();
    await pushBook(root, SLUG, book, anki);
    await Bun.file(`${root}/books/${SLUG}/anki.json`).delete();

    const result = await pushBook(root, SLUG, book, anki);

    expect(result).toMatchObject({ staged: 0, duplicates: 2, failed: [] });
  });

  it('keeps going past a failing card and retries it next time', async () => {
    const { root, book } = await extractedLibrary([[card('Q1'), card('Q2 breaks'), card('Q3')]]);

    const result = await pushBook(root, SLUG, book, fakeEmber({ failOn: 'breaks' }));

    expect(result.staged).toBe(2);
    expect(result.failed.map(f => f.card.front)).toEqual(['Q2 breaks']);
    const retry = await pushBook(root, SLUG, book, fakeEmber());
    expect(retry).toMatchObject({ staged: 1, alreadySent: 2 });
  });

  it('reports selected chapters that have not been extracted', async () => {
    const { root, book } = await extractedLibrary([[card('Q1')]]);
    const withUnextracted = { ...book, chapters: [...book.chapters, { index: 9, title: 'Later', file: '09_later.md', word_count: 500 }], selected: [0, 9] };

    const result = await pushBook(root, SLUG, withUnextracted, fakeEmber());

    expect(result.notExtracted).toEqual(['Later']);
    expect(result.staged).toBe(1);
  });

  it('uses the short title for the deck', async () => {
    const { root, book } = await extractedLibrary([[card('Q1')]]);
    const result = await pushBook(root, SLUG, { ...book, title: 'The Mom Test: how to talk to customers' }, fakeEmber());
    expect(result.deck).toBe('Books::The Mom Test');
  });
});

describe('cardsFromExtractions', () => {
  const chapter = (index: number, cards: ReturnType<typeof card>[], skip = false): ChapterExtraction => ({
    chapter: { index, title: `Chapter ${index}`, file: `${index}.md` },
    key: 'k',
    model: 'm',
    extraction: skip ? { skip: true } : { skip: false, summary: 's', cards },
  });

  it('dedupes questions that differ only in case or spacing', () => {
    const cards = cardsFromExtractions(SLUG, [chapter(1, [card('What is  a deep module?')]), chapter(2, [card('what is a deep module?')])]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.chapter).toBe('Chapter 1');
  });

  it('skips skipped chapters and blank cards', () => {
    const cards = cardsFromExtractions(SLUG, [chapter(1, [card('Q')], true), chapter(2, [{ type: 'concept', front: ' ', back: 'x' }])]);
    expect(cards).toEqual([]);
  });

  it('gives the same question the same ID in every run', () => {
    expect(cardId(SLUG, 'What is a deep module?')).toBe(cardId(SLUG, 'what is a  deep module?'));
    expect(cardId(SLUG, 'Q')).not.toBe(cardId('another-book', 'Q'));
  });
});

describe('toHtml', () => {
  it('escapes HTML and renders code', () => {
    expect(toHtml('Use `Map<K, V>` & friends\nnext')).toBe('Use <code>Map&lt;K, V&gt;</code> &amp; friends<br>next');
    expect(toHtml('Before\n```ts\nconst a = 1 < 2;\n```\nAfter')).toBe(
      'Before<br><pre><code>const a = 1 &lt; 2;</code></pre><br>After'
    );
  });
});

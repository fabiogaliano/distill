import { ankiPath, type LibraryBook } from '../library/library';
import { shortTitle } from '../library/slug';
import { extractionPath } from '../pipeline/extract';
import type { ChapterExtraction } from '../pipeline/extraction';
import { MAX_STAGE_BATCH, type AnkiBackend, type AnkiNote } from './ember';
import { cardsFromExtractions, toHtml, type Card } from './cards';

const PARENT_DECK = 'Books';
const NOTE_TYPE = 'Basic';

// What has been sent, so re-runs only stage new cards.
export interface AnkiRecord {
  deck: string;
  cards: Record<
    string,
    { status: 'staged' | 'duplicate'; noteId: number | null; batchTag: string | null; chapter: string; front: string; at: string }
  >;
}

export interface PushResult {
  deck: string;
  staged: number;
  batches: string[];
  alreadySent: number;
  // Anki already had a note with this question (e.g. anki.json was lost).
  duplicates: number;
  failed: { card: Card; error: string }[];
  notExtracted: string[];
}

export async function pushBook(root: string, slug: string, book: LibraryBook, anki: AnkiBackend): Promise<PushResult> {
  const { extractions, notExtracted } = await loadExtractions(root, slug, book);
  const cards = cardsFromExtractions(slug, extractions);
  const leaf = shortTitle(book.title ?? slug);
  const deck = `${PARENT_DECK}::${leaf}`;

  const recordFile = Bun.file(ankiPath(root, slug));
  const record: AnkiRecord = (await recordFile.exists()) ? await recordFile.json() : { deck, cards: {} };
  const pending = cards.filter(c => !(c.id in record.cards));
  const result: PushResult = {
    deck,
    staged: 0,
    batches: [],
    alreadySent: cards.length - pending.length,
    duplicates: 0,
    failed: [],
    notExtracted,
  };
  if (pending.length === 0) return result;

  await anki.ensureDeck(PARENT_DECK, leaf);
  const save = () => Bun.write(ankiPath(root, slug), JSON.stringify(record, null, 2) + '\n');
  const remember = (card: Card, status: 'staged' | 'duplicate', noteId: number | null, batchTag: string | null) => {
    record.cards[card.id] = { status, noteId, batchTag, chapter: card.chapter, front: card.front, at: new Date().toISOString() };
  };

  for (let i = 0; i < pending.length; i += MAX_STAGE_BATCH) {
    const batch = pending.slice(i, i + MAX_STAGE_BATCH);
    try {
      const { batchTag, noteIds } = await anki.stage(batch.map(c => toNote(deck, c)));
      batch.forEach((card, j) => remember(card, 'staged', noteIds[j]!, batchTag));
      result.staged += batch.length;
      result.batches.push(batchTag);
    } catch {
      // A rejected batch wrote nothing; staging one at a time isolates the bad card.
      for (const card of batch) {
        try {
          const { batchTag, noteIds } = await anki.stage([toNote(deck, card)]);
          remember(card, 'staged', noteIds[0]!, batchTag);
          result.staged++;
          result.batches.push(batchTag);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          if (/duplicate/i.test(error)) {
            remember(card, 'duplicate', null, null);
            result.duplicates++;
          } else {
            result.failed.push({ card, error });
          }
        }
      }
    }
    await save();
  }
  return result;
}

function toNote(deck: string, card: Card): AnkiNote {
  return {
    deckName: deck,
    modelName: NOTE_TYPE,
    fields: { Front: toHtml(card.front), Back: `${toHtml(card.back)}<br><br><small>${toHtml(card.chapter)}</small>` },
    tags: card.tags,
  };
}

async function loadExtractions(root: string, slug: string, book: LibraryBook) {
  const extractions: ChapterExtraction[] = [];
  const notExtracted: string[] = [];
  for (const chapter of book.chapters.filter(c => book.selected.includes(c.index))) {
    const file = Bun.file(extractionPath(root, slug, chapter));
    if (await file.exists()) extractions.push(await file.json());
    else notExtracted.push(chapter.title);
  }
  return { extractions, notExtracted };
}

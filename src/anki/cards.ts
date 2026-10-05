import { createHash } from 'crypto';
import type { ChapterExtraction } from '../pipeline/extraction';
import { kebab } from '../library/slug';

export interface Card {
  // Same slug and question → same ID, whatever model or run produced it.
  id: string;
  chapter: string;
  type: string;
  front: string;
  back: string;
  tags: string[];
}

export function cardId(slug: string, front: string): string {
  const normalized = front.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${slug}\n${normalized}`).digest('hex').slice(0, 16);
}

export function cardsFromExtractions(slug: string, extractions: ChapterExtraction[]): Card[] {
  const cards = new Map<string, Card>();
  for (const { chapter, extraction } of extractions) {
    if (extraction.skip) continue;
    const chapterTag = `distill::${slug}::${String(chapter.index).padStart(2, '0')}-${kebab(chapter.title)}`;
    for (const card of extraction.cards ?? []) {
      if (!card.front?.trim() || !card.back?.trim()) continue;
      const id = cardId(slug, card.front);
      const type = kebab(card.type || 'concept').replaceAll('-', '_');
      if (!cards.has(id)) {
        cards.set(id, { id, chapter: chapter.title, type, front: card.front, back: card.back, tags: [chapterTag, `distill::type::${type}`] });
      }
    }
  }
  return [...cards.values()];
}

// Anki fields are HTML; card text is plain text with Markdown-style code.
export function toHtml(text: string): string {
  const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return text
    .split(/```[^\n]*\n?([\s\S]*?)```/g)
    .map((part, i) =>
      i % 2 === 1
        ? `<pre><code>${escape(part.replace(/\n$/, ''))}</code></pre>`
        : escape(part).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>')
    )
    .join('');
}

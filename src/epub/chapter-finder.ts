import type { ChapterInfo } from '../types';
import { FRONT_MATTER, INTRO_TERMS, MIN_CONTENT_WORDS } from '../config';

/**
 * Find the starting index for book content, skipping front matter.
 *
 * Priority:
 * 1. Find "introduction" → start there
 * 2. Otherwise, find first INTRO_TERMS match → start there
 * 3. Otherwise, find last FRONT_MATTER match → start at next chapter
 * 4. Fallback: skip chapters with <100 words at start
 */
export function findContentStart(chapters: ChapterInfo[]): number {
  const maxIntroIndex = Math.ceil(chapters.length * 0.4);

  // Priority 1: Look for "introduction" specifically in the first 40% of the book
  const introIndex = chapters.findIndex((c, idx) =>
    idx < maxIntroIndex && normalize(c.title).includes('introduction')
  );
  if (introIndex !== -1) {
    return introIndex;
  }

  // Priority 2: Find first intro term match in the first 40% of the book
  const firstIntroIndex = chapters.findIndex((c, idx) =>
    idx < maxIntroIndex && INTRO_TERMS.some(term => normalize(c.title).includes(term))
  );
  if (firstIntroIndex !== -1) {
    return firstIntroIndex;
  }

  // Priority 3: Find last front matter, start after it
  let lastFrontMatterIndex = -1;
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    if (!chapter) continue;
    const title = normalize(chapter.title);
    if (FRONT_MATTER.some(term => title.includes(term))) {
      lastFrontMatterIndex = i;
    } else if (lastFrontMatterIndex !== -1) {
      // We've passed front matter, stop looking
      break;
    }
  }
  if (lastFrontMatterIndex !== -1 && lastFrontMatterIndex < chapters.length - 1) {
    return lastFrontMatterIndex + 1;
  }

  // Priority 4: Skip low word-count chapters at start
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    if (chapter && chapter.word_count >= MIN_CONTENT_WORDS) {
      return i;
    }
  }

  // Fallback: start from beginning
  return 0;
}

/**
 * Find the ending index for book content, skipping back matter.
 * Returns the index of the last content chapter (inclusive).
 */
export function findContentEnd(chapters: ChapterInfo[]): number {
  const backMatterTerms = [
    'notes',
    'endnotes',
    'footnotes',
    'bibliography',
    'index',
    'about the author',
    'about the authors',
    'acknowledgments',
    'acknowledgements',
    'appendix',
    'references',
    'further reading',
    'copyright',
    'colophon',
    'credits',
    'also by',
    'other books',
    'books by',
    'resources',
    'glossary',
  ];

  // Work backwards to find first back matter
  for (let i = chapters.length - 1; i >= 0; i--) {
    const chapter = chapters[i];
    if (!chapter) continue;
    const title = normalize(chapter.title);
    const isBackMatter = backMatterTerms.some(term => title.includes(term));

    if (!isBackMatter && chapter.word_count >= MIN_CONTENT_WORDS) {
      return i;
    }
  }

  return chapters.length - 1;
}

/**
 * Get the content chapters (start to end, inclusive).
 */
export function getContentChapters(chapters: ChapterInfo[]): ChapterInfo[] {
  const start = findContentStart(chapters);
  const end = findContentEnd(chapters);
  return chapters.slice(start, end + 1);
}

function normalize(title: string): string {
  return title.toLowerCase().trim();
}

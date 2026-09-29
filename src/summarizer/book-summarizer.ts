import type { SummaryMode } from '../types';
import { completeText, type Provider } from '../providers';
import type { ChapterSummary } from './chapter-summarizer';
import { getModeConfig } from './modes';

export interface BookSummary {
  title: string;
  author: string;
  summary: string;
  chapterCount: number;
}

export class BookSummarizer {
  private provider: Provider;
  private mode: SummaryMode;

  constructor(provider: Provider, mode: SummaryMode) {
    this.provider = provider;
    this.mode = mode;
  }

  async summarize(
    chapterSummaries: ChapterSummary[],
    bookTitle: string,
    bookAuthor: string
  ): Promise<BookSummary> {
    const config = getModeConfig(this.mode);

    // Combine chapter summaries with headers
    const combinedSummaries = chapterSummaries
      .map(cs => `## ${cs.title}\n\n${cs.summary}`)
      .join('\n\n---\n\n');

    const prompt = config.bookPrompt
      .replace('{{TITLE}}', bookTitle)
      .replace('{{AUTHOR}}', bookAuthor)
      .replace('{{CHAPTER_COUNT}}', String(chapterSummaries.length));

    const summary = await completeText(this.provider, prompt, combinedSummaries);

    return {
      title: bookTitle,
      author: bookAuthor,
      summary,
      chapterCount: chapterSummaries.length,
    };
  }
}

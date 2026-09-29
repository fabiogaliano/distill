import { basename, join, resolve } from 'path';
import { mkdir, rename, rm } from 'fs/promises';
import { randomUUID } from 'crypto';
import type { BookManifest } from '../types';
import { EpubProcessor } from '../epub/processor';
import { getContentChapters } from '../epub/chapter-finder';
import { bookDir, booksDir, listBookSlugs, readBook, type LibraryBook } from './library';
import { bookSlug, kebab, titleFromFilename } from './slug';

// Writes book.json and chapters/ into outputDir.
export type Splitter = (epubPath: string, outputDir: string) => Promise<void>;

export interface IngestResult {
  slug: string;
  dir: string;
  book: LibraryBook;
  alreadyIngested: boolean;
}

const splitWithProcessor: Splitter = async (epubPath, outputDir) => {
  await new EpubProcessor(epubPath, outputDir).ensureSplit();
};

export async function ingest(
  epubPath: string,
  root: string,
  split: Splitter = splitWithProcessor
): Promise<IngestResult> {
  const source = resolve(epubPath);

  for (const slug of await listBookSlugs(root)) {
    const book = await readBook(root, slug);
    if (book?.source === source) {
      return { slug, dir: bookDir(root, slug), book, alreadyIngested: true };
    }
  }

  // The slug comes from the book's own metadata, which only exists after splitting.
  await mkdir(booksDir(root), { recursive: true });
  const staging = join(booksDir(root), `.ingest-${randomUUID()}`);
  try {
    await split(source, staging);
    const manifest = (await Bun.file(join(staging, 'book.json')).json()) as BookManifest;
    const title = manifest.title?.trim() || titleFromFilename(basename(source));
    const slug = await freeSlug(root, bookSlug(title), manifest.author);

    const book: LibraryBook = {
      ...manifest,
      title,
      source,
      selected: getContentChapters(manifest.chapters).map(c => c.index),
    };
    await Bun.write(join(staging, 'book.json'), JSON.stringify(book, null, 2) + '\n');

    const dir = bookDir(root, slug);
    await rename(staging, dir);
    return { slug, dir, book, alreadyIngested: false };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function freeSlug(root: string, slug: string, author?: string): Promise<string> {
  const taken = new Set(await listBookSlugs(root));
  if (!taken.has(slug)) return slug;
  const withAuthor = author ? `${slug}-${kebab(author)}` : undefined;
  if (withAuthor && !taken.has(withAuthor)) return withAuthor;
  throw new Error(`A different book already uses the slug "${withAuthor ?? slug}" in ${booksDir(root)}`);
}

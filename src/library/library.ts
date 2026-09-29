import { homedir } from 'os';
import { join, resolve } from 'path';
import { readdir } from 'fs/promises';
import type { BookManifest } from '../types';

export interface LibraryBook extends BookManifest {
  // Absolute path of the epub this book was ingested from.
  source: string;
  // Indices of the chapters later stages process.
  selected: number[];
}

export function resolveLibraryRoot(path: string): string {
  return resolve(path.replace(/^~(?=$|\/)/, homedir()));
}

export const booksDir = (root: string) => join(root, 'books');
export const bookDir = (root: string, slug: string) => join(booksDir(root), slug);
export const cacheDir = (root: string, slug: string) => join(bookDir(root, slug), 'cache');
export const extractDir = (root: string, slug: string) => join(bookDir(root, slug), 'extract');
export const summaryPath = (root: string, slug: string) => join(bookDir(root, slug), 'summary.md');

export async function readBook(root: string, slug: string): Promise<LibraryBook | undefined> {
  const file = Bun.file(join(bookDir(root, slug), 'book.json'));
  return (await file.exists()) ? file.json() : undefined;
}

export async function requireBook(root: string, slug: string): Promise<LibraryBook> {
  const book = await readBook(root, slug);
  if (!book) {
    const known = await listBookSlugs(root);
    throw new Error(`No book "${slug}" in ${booksDir(root)}${known.length ? `. Books: ${known.join(', ')}` : ''}`);
  }
  return book;
}

export async function writeBook(root: string, slug: string, book: LibraryBook): Promise<void> {
  await Bun.write(join(bookDir(root, slug), 'book.json'), JSON.stringify(book, null, 2) + '\n');
}

export async function readChapterText(root: string, slug: string, file: string): Promise<string> {
  return Bun.file(join(bookDir(root, slug), 'chapters', file)).text();
}

export async function listBookSlugs(root: string): Promise<string[]> {
  const entries = await readdir(booksDir(root), { withFileTypes: true }).catch(() => []);
  return entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort();
}

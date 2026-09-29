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

export async function readBook(root: string, slug: string): Promise<LibraryBook | undefined> {
  const file = Bun.file(join(bookDir(root, slug), 'book.json'));
  return (await file.exists()) ? file.json() : undefined;
}

export async function listBookSlugs(root: string): Promise<string[]> {
  const entries = await readdir(booksDir(root), { withFileTypes: true }).catch(() => []);
  return entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort();
}

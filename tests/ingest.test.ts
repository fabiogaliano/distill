import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ingest, type Splitter } from '../src/library/ingest';
import { readBook, resolveLibraryRoot } from '../src/library/library';
import type { BookManifest } from '../src/types';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'glean-library-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const chapter = (index: number, title: string, word_count: number) => ({
  index,
  title,
  word_count,
  file: `${String(index).padStart(2, '0')}_${title.toLowerCase().replace(/\W+/g, '_')}.md`,
});

const manifest = (overrides: Partial<BookManifest> = {}): BookManifest => ({
  title: 'A Philosophy of Software Design',
  author: 'Ousterhout, John',
  chapters: [
    chapter(0, 'Cover', 5),
    chapter(1, 'Copyright', 200),
    chapter(2, 'Introduction', 1500),
    chapter(3, 'The Nature of Complexity', 4000),
    chapter(4, 'Index', 3000),
  ],
  ...overrides,
});

function fakeSplitter(book: BookManifest): Splitter & { calls: number } {
  const split = async (_epub: string, outputDir: string) => {
    split.calls++;
    await mkdir(join(outputDir, 'chapters'), { recursive: true });
    await Bun.write(join(outputDir, 'book.json'), JSON.stringify(book));
    for (const c of book.chapters) await Bun.write(join(outputDir, 'chapters', c.file), `# ${c.title}`);
  };
  split.calls = 0;
  return split;
}

describe('ingest', () => {
  it('files the book under a slug from its metadata, with source and selected chapters', async () => {
    const result = await ingest('/books/aposd -- Ousterhout -- Anna’s Archive.epub', root, fakeSplitter(manifest()));

    expect(result.slug).toBe('a-philosophy-of-software-design');
    expect(result.alreadyIngested).toBe(false);
    const book = await readBook(root, result.slug);
    expect(book?.source).toBe('/books/aposd -- Ousterhout -- Anna’s Archive.epub');
    expect(book?.selected).toEqual([2, 3]);
    expect(await readdir(join(result.dir, 'chapters'))).toHaveLength(5);
  });

  it('is a no-op for an epub that is already in the library', async () => {
    const split = fakeSplitter(manifest());
    await ingest('/books/aposd.epub', root, split);
    const again = await ingest('/books/aposd.epub', root, split);

    expect(again.alreadyIngested).toBe(true);
    expect(split.calls).toBe(1);
    expect(await readdir(join(root, 'books'))).toEqual(['a-philosophy-of-software-design']);
  });

  it('adds the author when a different epub has the same title', async () => {
    await ingest('/books/aposd.epub', root, fakeSplitter(manifest()));
    const other = await ingest('/books/other.epub', root, fakeSplitter(manifest({ author: 'Someone Else' })));

    expect(other.slug).toBe('a-philosophy-of-software-design-someone-else');
  });

  it('falls back to the filename when the epub has no title', async () => {
    const result = await ingest(
      '/books/Laws of UX_ Using Psychology -- Jon Yablonski -- 2020 -- Anna’s Archive.epub',
      root,
      fakeSplitter(manifest({ title: undefined }))
    );

    expect(result.slug).toBe('laws-of-ux');
    expect(result.book.title).toBe('Laws of UX: Using Psychology');
  });

  it('leaves nothing behind when splitting fails', async () => {
    const failing: Splitter = async () => {
      throw new Error('epub-splitter failed');
    };

    await expect(ingest('/books/broken.epub', root, failing)).rejects.toThrow('epub-splitter failed');
    expect(await readdir(join(root, 'books'))).toEqual([]);
  });
});

describe('resolveLibraryRoot', () => {
  it('expands ~ to the home directory', () => {
    expect(resolveLibraryRoot('~/Core/library')).toBe(join(process.env.HOME!, 'Core/library'));
    expect(resolveLibraryRoot('/abs/library')).toBe('/abs/library');
  });
});

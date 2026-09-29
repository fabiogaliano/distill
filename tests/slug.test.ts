import { describe, expect, it } from 'vitest';
import { bookSlug, kebab, titleFromFilename } from '../src/library/slug';

describe('bookSlug', () => {
  it.each([
    ['A Philosophy of Software Design', 'a-philosophy-of-software-design'],
    ['The Mom Test: how to talk to customers and learn if your business is a good idea', 'the-mom-test'],
    ["React Key Concepts: An In-Depth Guide to React's Core Features", 'react-key-concepts'],
    ['The Product-Minded Engineer (for hio hio)', 'the-product-minded-engineer'],
    ['Laws of UX', 'laws-of-ux'],
    ["Don't Make Me Think", 'dont-make-me-think'],
    ['Pépin à la Maison', 'pepin-a-la-maison'],
  ])('%s → %s', (title, slug) => {
    expect(bookSlug(title)).toBe(slug);
  });

  it('cuts long titles at a word boundary', () => {
    const slug = bookSlug('An Extremely Long Book Title That Keeps Going Well Past Any Reasonable Directory Name');
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).toBe('an-extremely-long-book-title-that-keeps-going-well-past-any');
  });
});

describe('kebab', () => {
  it('folds diacritics and punctuation', () => {
    expect(kebab('Ousterhout, John')).toBe('ousterhout-john');
    expect(kebab('Maximilian Schwarzmüller')).toBe('maximilian-schwarzmuller');
  });
});

describe('titleFromFilename', () => {
  it("recovers the title from an Anna's Archive filename", () => {
    expect(
      titleFromFilename(
        'Copywriting Made Simple_ How to write powerful and -- Tom Albrighton -- PS, 2020 -- ABC -- 9781838054502 -- 50d3 -- Anna’s Archive.epub'
      )
    ).toBe('Copywriting Made Simple: How to write powerful and');
  });

  it('keeps plain filenames', () => {
    expect(titleFromFilename('Laws of UX.epub')).toBe('Laws of UX');
  });
});

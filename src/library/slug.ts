const MAX_SLUG_LENGTH = 60;

export function kebab(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Subtitles and parentheticals ("(for hio hio)") make names long and edition-specific.
export function shortTitle(title: string): string {
  return title.split(':')[0]!.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

export function bookSlug(title: string): string {
  const slug = kebab(shortTitle(title));
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  const cut = slug.slice(0, MAX_SLUG_LENGTH + 1);
  return cut.slice(0, cut.lastIndexOf('-'));
}

// Anna's Archive names files "Title_ Subtitle -- Author -- Year -- …".
export function titleFromFilename(filename: string): string {
  return filename.replace(/\.epub$/i, '').split(' -- ')[0]!.replace(/_ /g, ': ');
}

import { assertComplete, type Provider } from '../providers';
import { listBookSlugs, readBook, summaryPath } from '../library/library';
import { parseLastJson } from '../json';
import { parseRecipe, recipeProblems, stringifyRecipe, type Recipe } from './recipe';

export interface CatalogBook {
  slug: string;
  title: string;
  author?: string;
  overview: string;
  chapters: { index: number; title: string }[];
}

export interface Catalog {
  books: CatalogBook[];
  // Books left out because the skill build reads summary.md.
  notSynthesized: string[];
}

export function overviewOf(summary: string): string {
  const match = summary.match(/## Overview\n([\s\S]*?)(?:\n## Chapters\n|$)/);
  return (match?.[1] ?? '').trim();
}

export async function buildCatalog(root: string, only?: string[]): Promise<Catalog> {
  const slugs = only ?? (await listBookSlugs(root));
  const books: CatalogBook[] = [];
  const notSynthesized: string[] = [];
  for (const slug of slugs) {
    const book = await readBook(root, slug);
    if (!book) throw new Error(`No book "${slug}" in the library`);
    const summary = Bun.file(summaryPath(root, slug));
    if (!(await summary.exists())) {
      notSynthesized.push(slug);
      continue;
    }
    books.push({
      slug,
      title: book.title ?? slug,
      author: book.author,
      overview: overviewOf(await summary.text()),
      chapters: book.chapters.filter(c => book.selected.includes(c.index)).map(c => ({ index: c.index, title: c.title })),
    });
  }
  return { books, notSynthesized };
}

export function catalogText(catalog: Catalog): string {
  return catalog.books
    .map(b =>
      [
        `# ${b.slug}: ${b.title}${b.author ? ` by ${b.author}` : ''}`,
        '',
        b.overview,
        '',
        'Chapters:',
        ...b.chapters.map(c => `${c.index}: ${c.title}`),
      ].join('\n')
    )
    .join('\n\n');
}

export interface Revision {
  previous: Recipe;
  feedback: string;
}

export async function proposeRecipe(options: {
  name: string;
  catalog: Catalog;
  prompt: string;
  provider: Provider;
  revision?: Revision;
}): Promise<{ recipe: Recipe; costUsd: number }> {
  const { name, catalog, provider, revision } = options;
  if (catalog.books.length === 0) throw new Error('No synthesized books to plan from. Run: glean synthesize <book>');

  const prompt = options.prompt.replaceAll('{{NAME}}', name);
  let input = catalogText(catalog);
  if (revision) {
    input += `\n\n# Previous recipe\n\n${stringifyRecipe(revision.previous)}\n# Feedback on it\n\n${revision.feedback}`;
  }
  const completion = assertComplete(provider, await provider.complete(prompt, input));
  const proposed = parseLastJson(completion.text);
  if (!proposed || typeof proposed !== 'object') throw new Error('The plan response has no recipe JSON');

  // The directory is named by the user, so the name isn't the model's to change.
  const { name: _proposedName, ...rest } = proposed as Record<string, unknown>;
  const recipe = { name, ...rest } as unknown as Recipe;
  const known = new Set(catalog.books.map(b => b.slug));
  const problems = [
    ...recipeProblems(recipe),
    ...(recipe.sources ?? []).filter(s => !known.has(s?.book)).map(s => `sources: "${s?.book}" is not in the catalog`),
  ];
  if (problems.length > 0) throw new Error(`The proposed recipe is invalid:\n  ${problems.join('\n  ')}`);
  return { recipe, costUsd: completion.costUsd };
}

export type Decision = 'approve' | 'edit' | 'regenerate' | 'quit';

export interface ReviewUI {
  show(yaml: string): void;
  decide(canApprove: boolean): Promise<Decision>;
  feedback(): Promise<string | undefined>;
  edit(yaml: string): Promise<string>;
  error(message: string): void;
}

// The approval loop: nothing is saved until the recipe is approved as shown.
// A hand edit that doesn't validate stays as the draft so the next edit starts
// from it rather than losing the change.
export async function reviewRecipe(options: {
  initial: Recipe;
  ui: ReviewUI;
  regenerate: (revision: Revision) => Promise<Recipe>;
}): Promise<Recipe | undefined> {
  const { ui } = options;
  let valid: Recipe | undefined = options.initial;
  let draft = stringifyRecipe(options.initial);

  for (;;) {
    ui.show(draft);
    const decision = await ui.decide(valid !== undefined);
    if (decision === 'quit') return undefined;
    if (decision === 'approve' && valid) return valid;

    if (decision === 'edit') {
      draft = await ui.edit(draft);
      try {
        const edited = parseRecipe(draft);
        if (edited.name !== options.initial.name) throw new Error(`name must stay "${options.initial.name}" (it names the skill's folder)`);
        valid = edited;
      } catch (error) {
        valid = undefined;
        ui.error(error instanceof Error ? error.message : String(error));
      }
    }

    if (decision === 'regenerate') {
      const feedback = await ui.feedback();
      if (!feedback) continue;
      const previous = valid ?? options.initial;
      try {
        valid = await options.regenerate({ previous, feedback });
        draft = stringifyRecipe(valid);
      } catch (error) {
        ui.error(error instanceof Error ? error.message : String(error));
      }
    }
  }
}

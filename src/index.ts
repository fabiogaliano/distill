#!/usr/bin/env bun
import type { AppConfig, ModelSpec } from './types';
import { createProvider } from './providers';
import { createUI } from './ui';
import { loadConfig, resolveStage } from './config';
import { ingest } from './library/ingest';
import { extractDir, requireBook, resolveLibraryRoot, writeBook } from './library/library';
import { extractBook, type ChapterResult } from './pipeline/extract';
import { synthesizeBook } from './pipeline/synthesize';
import { connectEmber } from './anki/ember';
import { pushBook } from './anki/push';

interface Args {
  command?: string;
  target?: string;
  modelRole?: string;
  interactive: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { interactive: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--model') args.modelRole = argv[++i];
    else if (arg === '-i' || arg === '--interactive') args.interactive = true;
    else if (arg === '-h' || arg === '--help') positional.unshift('help');
    else positional.push(arg);
  }
  [args.command, args.target] = positional;
  return args;
}

function printHelp(config: AppConfig): void {
  const roles = Object.keys(config.models).join(', ');
  const stageDefaults = Object.entries(config.stages).map(([stage, role]) => `${stage}=${role}`).join(', ');
  console.log(`
glean — books into summaries, Anki cards, and skills

Usage:
  glean ingest <file.epub>          Split a book into the library (${config.library})
  glean extract <book> [-i]         Extract each selected chapter (cached, ${config.concurrency} at a time)
  glean synthesize <book>           Write summary.md from the extractions
  glean anki <book>                 Stage the book's new cards in Anki for review (via ember)
  glean completion zsh              Print the zsh completion script

<book> is the slug that ingest prints.

Options:
  -i, --interactive                 Pick which chapters to extract (saved to book.json)
  --model <role>                    Model role for this run (${roles})
                                    Default per stage: ${stageDefaults}
  -h, --help                        Show this help

Examples:
  glean ingest ~/Downloads/aposd.epub
  glean extract a-philosophy-of-software-design -i
  glean extract a-philosophy-of-software-design --model opus-low
  glean synthesize a-philosophy-of-software-design
  glean anki a-philosophy-of-software-design
`);
}

function printCompletion(shell: string | undefined, config: AppConfig): void {
  if (shell !== 'zsh') {
    console.error(`Unsupported shell: ${shell}. Only 'zsh' is supported.`);
    process.exit(1);
  }
  const roles = Object.keys(config.models).join(' ');
  const books = `${resolveLibraryRoot(config.library)}/books`;

  console.log(`#compdef glean

_glean_books() {
  local -a books
  books=(\${(f)"$(command ls '${books}' 2>/dev/null)"})
  _describe 'book' books
}

_glean() {
  if (( CURRENT == 2 )); then
    local -a commands
    commands=(
      'ingest:Split a book into the library'
      'extract:Extract each selected chapter'
      'synthesize:Write summary.md from the extractions'
      'anki:Stage the book'"'"'s new cards in Anki for review'
      'completion:Print the zsh completion script'
    )
    _describe 'command' commands
    return
  fi

  local command=$words[2]
  shift words
  (( CURRENT-- ))

  case $command in
    ingest)
      _arguments '1:epub file:_files -g "*.epub"'
      ;;
    extract)
      _arguments -s \\
        '(-i --interactive)'{-i,--interactive}'[Pick which chapters to extract]' \\
        '--model[Model role for this run]:role:(${roles})' \\
        '1:book:_glean_books'
      ;;
    synthesize)
      _arguments -s \\
        '--model[Model role for this run]:role:(${roles})' \\
        '1:book:_glean_books'
      ;;
    anki)
      _arguments '1:book:_glean_books'
      ;;
    completion)
      _arguments '1:shell:(zsh)'
      ;;
  esac
}

compdef _glean glean`);
}

const describe = (spec: ModelSpec) => (spec.effort ? `${spec.model}@${spec.effort}` : spec.model);
const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;

async function runIngest(epubPath: string | undefined, config: AppConfig): Promise<void> {
  if (!epubPath?.endsWith('.epub')) throw new Error('Usage: glean ingest <file.epub>');

  const { slug, dir, book, alreadyIngested } = await ingest(epubPath, resolveLibraryRoot(config.library));
  const selected = book.chapters.filter(c => book.selected.includes(c.index));
  const words = selected.reduce((sum, c) => sum + c.word_count, 0);

  console.log(`${alreadyIngested ? 'Already ingested' : 'Ingested'}: ${book.title}${book.author ? ` — ${book.author}` : ''}`);
  console.log(`  ${dir}`);
  console.log(`  slug: ${slug}`);
  console.log(`  ${selected.length} of ${book.chapters.length} chapters selected (${words} words)`);
  if (words === 0) {
    console.warn('  [!] The splitter extracted no text from the selected chapters.');
  }
}

const STATUS_LABEL: Record<ChapterResult['status'], string> = {
  extracted: '✓',
  cached: '✓ cached',
  current: '= up to date',
  short: '– too short, skipped',
  failed: '✗',
};

async function runExtract(args: Args, config: AppConfig): Promise<boolean> {
  if (!args.target) throw new Error('Usage: glean extract <book> [-i] [--model <role>]');
  const root = resolveLibraryRoot(config.library);
  const slug = args.target;
  const spec = resolveStage(config, 'extract', args.modelRole);
  const book = await requireBook(root, slug);

  if (args.interactive) {
    book.selected = await createUI(true).selectChapters(book.chapters, book.selected);
    await writeBook(root, slug, book);
  }

  console.log(`Extracting ${book.selected.length} chapters of ${book.title} with ${describe(spec)}`);
  const results = await extractBook({
    root,
    slug,
    book,
    provider: createProvider(spec),
    prompt: config.prompts.extract,
    concurrency: config.concurrency,
    onChapter: (r, done, total) => {
      const detail =
        r.status === 'extracted' ? ` (${seconds(r.durationMs)}, $${r.costUsd.toFixed(2)})` : r.error ? `: ${r.error}` : '';
      console.log(`  [${done}/${total}] ${STATUS_LABEL[r.status]} ${r.chapter.title}${detail}`);
    },
  });

  const count = (status: ChapterResult['status']) => results.filter(r => r.status === status).length;
  const cost = results.reduce((sum, r) => sum + r.costUsd, 0);
  console.log(
    `\n${count('extracted')} extracted, ${count('cached') + count('current')} reused, ${count('short')} too short, ${count('failed')} failed · $${cost.toFixed(2)} list price`
  );
  console.log(`  ${extractDir(root, slug)}`);
  if (count('failed') > 0) {
    console.log('Re-run the same command to retry the failed chapters; finished ones are reused.');
    return false;
  }
  return true;
}

async function runSynthesize(args: Args, config: AppConfig): Promise<void> {
  if (!args.target) throw new Error('Usage: glean synthesize <book> [--model <role>]');
  const root = resolveLibraryRoot(config.library);
  const slug = args.target;
  const spec = resolveStage(config, 'synthesize', args.modelRole);
  const book = await requireBook(root, slug);

  console.log(`Synthesizing ${book.title} with ${describe(spec)}`);
  const result = await synthesizeBook({
    root,
    slug,
    book,
    provider: createProvider(spec),
    prompt: config.prompts.synthesize,
  });
  const cost = result.cached ? 'overview reused' : `$${result.costUsd.toFixed(2)} list price`;
  console.log(`  ${result.chapters} chapters · ${cost}`);
  console.log(`  ${result.path}`);
}

async function runAnki(args: Args, config: AppConfig): Promise<boolean> {
  if (!args.target) throw new Error('Usage: glean anki <book>');
  const root = resolveLibraryRoot(config.library);
  const book = await requireBook(root, args.target);

  const anki = await connectEmber();
  const result = await pushBook(root, args.target, book, anki).finally(() => anki.close());
  const reused = result.alreadySent + result.duplicates;
  console.log(`${result.deck}: ${result.staged} cards staged, ${reused} already in Anki, ${result.failed.length} failed`);
  if (result.staged > 0) {
    console.log(`  Staged cards are suspended until you approve them in Anki's Inbox (${result.batches.length} batch(es)).`);
  }
  if (result.notExtracted.length > 0) {
    console.log(`  ${result.notExtracted.length} selected chapter(s) not extracted yet; run: glean extract ${args.target}`);
  }
  for (const { card, error } of result.failed) console.log(`  ✗ ${card.front.slice(0, 60)}: ${error}`);
  return result.failed.length === 0;
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const args = parseArgs(Bun.argv.slice(2));

  try {
    switch (args.command) {
      case 'ingest':
        await runIngest(args.target, config);
        break;
      case 'extract':
        if (!(await runExtract(args, config))) process.exit(1);
        break;
      case 'synthesize':
        await runSynthesize(args, config);
        break;
      case 'anki':
        if (!(await runAnki(args, config))) process.exit(1);
        break;
      case 'completion':
        printCompletion(args.target ?? 'zsh', config);
        break;
      case undefined:
      case 'help':
        printHelp(config);
        break;
      default:
        console.error(`Unknown command: ${args.command}`);
        printHelp(config);
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();

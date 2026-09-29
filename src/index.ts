#!/usr/bin/env bun
import { resolve, join, basename } from 'path';
import { readdir, stat, rm, unlink } from 'fs/promises';
import type { SummarizeOptions, Chapter, AppConfig, ModelSpec } from './types';
import { EpubProcessor } from './epub/processor';
import { getContentChapters } from './epub/chapter-finder';
import { createProvider } from './providers';
import { createUI } from './ui';
import { ChapterSummarizer } from './summarizer/chapter-summarizer';
import { BookSummarizer } from './summarizer/book-summarizer';
import { OutputWriter } from './output/writer';
import { loadConfig, resolveStage } from './config';
import { ingest } from './library/ingest';
import { resolveLibraryRoot } from './library/library';

// Output shell completion script
function printCompletion(shell: string, config: AppConfig): void {
  if (shell !== 'zsh') {
    console.error(`Unsupported shell: ${shell}. Only 'zsh' is supported.`);
    process.exit(1);
  }

  console.log(`#compdef glean

_glean() {
  local -a opts
  opts=(
    '-o[Output directory]:directory:_files -/'
    '--output[Output directory]:directory:_files -/'
    '-m[Summary mode]:mode:(concise detailed)'
    '--mode[Summary mode]:mode:(concise detailed)'
    '--model[Model role for every stage]:role:(${Object.keys(config.models).join(' ')})'
    '--single-file[Output to single combined file]'
    '--overview[Include book-level synthesis]'
    '--skip-existing[Skip if summaries exist]'
    '-i[Interactive chapter selection]'
    '--interactive[Interactive chapter selection]'
    '-h[Show help]'
    '--help[Show help]'
  )

  if (( CURRENT == 2 )); then
    _alternative 'commands:command:(ingest)' 'files:epub file:_files -g "*.epub"'
    return
  fi
  if [[ $words[2] == ingest ]]; then
    _files -g '*.epub'
    return
  fi

  _arguments -s $opts '*:epub file:_files -g "*.epub"'
}

compdef _glean glean`);
}

// Parse CLI arguments (config provides defaults)
function parseArgs(config: AppConfig): SummarizeOptions | null {
  const args = Bun.argv.slice(2);

  // Handle completion subcommand before anything else
  if (args[0] === 'completion') {
    printCompletion(args[1] || 'zsh', config);
    process.exit(0);
  }

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    printHelp(config);
    return null;
  }

  // First arg should be 'summarize' command or a path
  let pathArg: string | undefined;
  let restArgs: string[];

  if (args[0] === 'summarize') {
    pathArg = args[1];
    restArgs = args.slice(2);
  } else {
    // Allow omitting 'summarize' command
    pathArg = args[0];
    restArgs = args.slice(1);
  }

  if (!pathArg) {
    console.error('Error: No path provided');
    printHelp(config);
    return null;
  }

  // Start with config defaults
  const options: SummarizeOptions = {
    path: resolve(pathArg),
    mode: config.defaults.mode,
    singleFile: config.defaults.singleFile,
    includeOverview: config.defaults.includeOverview,
    skipExisting: false,
    interactive: false,
  };

  // Parse remaining args (CLI flags override config defaults)
  for (let i = 0; i < restArgs.length; i++) {
    const arg = restArgs[i];
    const next = restArgs[i + 1];

    switch (arg) {
      case '-o':
      case '--output':
        options.output = next ? resolve(next) : undefined;
        i++;
        break;
      case '-m':
      case '--mode':
        if (next === 'concise' || next === 'detailed') {
          options.mode = next;
          i++;
        }
        break;
      case '--model':
        if (next) {
          options.modelRole = next;
          i++;
        }
        break;
      case '--skip-existing':
        options.skipExisting = true;
        break;
      case '-i':
      case '--interactive':
        options.interactive = true;
        break;
      case '--single-file':
        options.singleFile = true;
        break;
      case '--overview':
        options.includeOverview = true;
        break;
    }
  }

  return options;
}

function printHelp(config: AppConfig): void {
  const stageDefaults = Object.entries(config.stages).map(([stage, role]) => `${stage}=${role}`).join(', ');
  console.log(`
glean — AI-powered book summarizer

Usage:
  glean ingest <file.epub>          Split a book into the library (${config.library})
  glean <file.epub>                 Summarize a single book
  glean <dir>                       Summarize all epubs in a directory

Options:
  -m, --mode <concise|detailed>     Summary depth (default: concise)
  -o, --output <dir>                Output directory (default: alongside epub)
  -i, --interactive                 Pick chapters to include
  --single-file                     Combine everything into one file
  --overview                        Add a book-level synthesis
  --skip-existing                   Skip already-summarized books
  --model <role>                    Model role for every stage (${Object.keys(config.models).join(', ')})
                                    Default per stage: ${stageDefaults}
  -h, --help                        Show this help

Examples:
  glean book.epub
  glean book.epub -m detailed --overview
  glean ./library/ --skip-existing
  glean book.epub -i --single-file
  glean book.epub --model opus-low
`);
}

async function findEpubFiles(path: string): Promise<string[]> {
  const pathStat = await stat(path);

  if (pathStat.isFile()) {
    if (path.endsWith('.epub')) {
      return [path];
    }
    throw new Error(`Not an epub file: ${path}`);
  }

  if (pathStat.isDirectory()) {
    const files = await readdir(path);
    return files
      .filter(f => f.endsWith('.epub'))
      .map(f => join(path, f));
  }

  throw new Error(`Invalid path: ${path}`);
}

async function summarizeBook(
  epubPath: string,
  options: SummarizeOptions,
  models: { extract: ModelSpec; synthesize: ModelSpec }
): Promise<void> {
  const bookName = basename(epubPath, '.epub');
  console.log(`\nProcessing: ${bookName}`);

  // Initialize processor
  const processor = new EpubProcessor(epubPath, options.output);
  const outputDir = processor.getOutputDir();

  // Check if already summarized
  if (options.skipExisting) {
    const summaryPath = join(outputDir, `summary-${options.mode}.md`);
    if (await Bun.file(summaryPath).exists()) {
      console.log(`  Skipping (summary exists)`);
      return;
    }
  }

  // Get manifest and find content chapters
  console.log('  Reading book structure...');
  const manifest = await processor.getManifest();
  const autoSelectedChapters = getContentChapters(manifest.chapters);
  const autoSelectedIndices = autoSelectedChapters.map(c => c.index);

  // Let user select chapters if interactive mode
  const ui = createUI(options.interactive);
  const selectedIndices = await ui.selectChapters(manifest.chapters, autoSelectedIndices);

  if (selectedIndices.length === 0) {
    console.log('  No chapters selected, skipping');
    return;
  }

  // Filter to selected chapters
  const selectedChapterInfos = manifest.chapters.filter(c => selectedIndices.includes(c.index));
  const skippedCount = manifest.chapters.length - selectedChapterInfos.length;

  console.log(`  ${selectedChapterInfos.length} chapters to summarize (skipped ${skippedCount})`);

  // Load selected chapters
  const chapters: Chapter[] = [];
  for (const info of selectedChapterInfos) {
    const chapterPath = join(outputDir, 'chapters', info.file);
    const content = await Bun.file(chapterPath).text();
    chapters.push({ info, content });
  }

  // Initialize components
  const chapterSummarizer = new ChapterSummarizer(createProvider(models.extract), options.mode);
  const bookSummarizer = new BookSummarizer(createProvider(models.synthesize), options.mode);
  const writer = new OutputWriter(outputDir, options.mode);

  // Summarize chapters
  console.log('  Summarizing chapters...');
  const chapterSummaries = await chapterSummarizer.summarizeAll(
    chapters,
    (current, total, title) => {
      console.log(`     [${current}/${total}] ${title}`);
    }
  );

  const bookTitle = manifest.title ?? bookName;
  const bookAuthor = manifest.author ?? 'Unknown';

  // Create book overview (optional)
  let bookSummary = null;
  if (options.includeOverview) {
    console.log('  Creating book overview...');
    bookSummary = await bookSummarizer.summarize(
      chapterSummaries,
      bookTitle,
      bookAuthor
    );
  }

  // Write output
  let summaryPath: string;
  if (options.singleFile) {
    summaryPath = await writer.writeCombinedSummary(chapterSummaries, bookTitle, bookAuthor, bookSummary);
  } else {
    await writer.writeChapterSummaries(chapterSummaries);
    if (bookSummary) {
      summaryPath = await writer.writeBookSummary(bookSummary);
    } else {
      summaryPath = join(outputDir, `summaries/${options.mode}`);
    }
  }

  // Cleanup epub-splitter artifacts
  await rm(join(outputDir, 'chapters'), { recursive: true, force: true });
  await unlink(join(outputDir, 'book.json')).catch(() => {});

  console.log(`  Done! Summary: ${summaryPath}`);
}

async function runIngest(epubPath: string | undefined, config: AppConfig): Promise<void> {
  if (!epubPath?.endsWith('.epub')) {
    console.error('Usage: glean ingest <file.epub>');
    process.exit(1);
  }

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

async function main(): Promise<void> {
  // Load config first
  const config = await loadConfig();

  const [command, ...rest] = Bun.argv.slice(2);
  if (command === 'ingest') {
    try {
      await runIngest(rest[0], config);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
    return;
  }

  const options = parseArgs(config);
  if (!options) {
    process.exit(0);
  }

  try {
    // Resolved up front so a bad role fails once instead of once per book.
    const models = {
      extract: resolveStage(config, 'extract', options.modelRole),
      synthesize: resolveStage(config, 'synthesize', options.modelRole),
    };
    const epubFiles = await findEpubFiles(options.path);

    if (epubFiles.length === 0) {
      console.error('No epub files found');
      process.exit(1);
    }

    console.log(`Found ${epubFiles.length} book(s) to summarize`);
    const describe = (spec: ModelSpec) => (spec.effort ? `${spec.model}@${spec.effort}` : spec.model);
    console.log(`Mode: ${options.mode} | Extract: ${describe(models.extract)} | Synthesize: ${describe(models.synthesize)} | Output: ${options.singleFile ? 'single file' : 'folder'}`);

    for (const epubPath of epubFiles) {
      try {
        await summarizeBook(epubPath, options, models);
      } catch (err) {
        console.error(`\n[!] Skipping ${basename(epubPath)} due to error:`, err instanceof Error ? err.message : err);
      }
    }

    console.log('\nAll done!');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();

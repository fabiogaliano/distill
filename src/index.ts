#!/usr/bin/env bun
import type { AppConfig, ModelSpec } from './types';
import { createProvider } from './providers';
import { claudeAgent } from './providers/claude-agent';
import { createUI } from './ui';
import { editText } from './ui/editor';
import { loadConfig, repoPath, resolveStage } from './config';
import { ingest } from './library/ingest';
import { extractDir, requireBook, resolveLibraryRoot, writeBook } from './library/library';
import { extractBook, type ChapterResult } from './pipeline/extract';
import { synthesizeBook } from './pipeline/synthesize';
import { connectEmber } from './anki/ember';
import { pushBook } from './anki/push';
import { assertSkillName, readRecipe, requireRecipe, skillDir, writeRecipe } from './skills/recipe';
import { buildCatalog, proposeRecipe, reviewRecipe, type Decision } from './skills/plan';
import { buildSkill } from './skills/build';
import { claudePluginEval } from './skills/evals';
import { installSkill } from './skills/install';

interface Args {
  command?: string;
  target?: string;
  // `skill <subcommand> <name>` shifts target to the name.
  subcommand?: string;
  modelRole?: string;
  books?: string[];
  interactive: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { interactive: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--model') args.modelRole = argv[++i];
    else if (arg === '--books') args.books = argv[++i]?.split(',').map(b => b.trim()).filter(Boolean);
    else if (arg === '-i' || arg === '--interactive') args.interactive = true;
    else if (arg === '-h' || arg === '--help') positional.unshift('help');
    else positional.push(arg);
  }
  if (positional[0] === 'skill') [args.command, args.subcommand, args.target] = positional;
  else [args.command, args.target] = positional;
  return args;
}

function printHelp(config: AppConfig): void {
  const roles = Object.keys(config.models).join(', ');
  const stageDefaults = Object.entries(config.stages).map(([stage, role]) => `${stage}=${role}`).join(', ');
  console.log(`
distill — books into summaries, Anki cards, and skills

Usage:
  distill ingest <file.epub>          Split a book into the library (${config.library})
  distill extract <book> [-i]         Extract each selected chapter (cached, ${config.concurrency} at a time)
  distill synthesize <book>           Write summary.md from the extractions
  distill anki <book>                 Stage the book's new cards in Anki for review (via ember)
  distill skill plan <name>           Propose a skill recipe from the library for you to approve
  distill skill build <name>          Write the skill, render per model, and run the eval gate
  distill skill install <name>        Symlink the built skill into Claude Code and pi
  distill completion zsh              Print the zsh completion script

<book> is the slug that ingest prints. <name> is the skill's folder name (kebab-case).

Options:
  -i, --interactive                 Pick which chapters to extract (saved to book.json)
  --books <slug,…>                  skill plan: only consider these books
  --model <role>                    Model role for this run (${roles})
                                    Default per stage: ${stageDefaults}
  -h, --help                        Show this help

Examples:
  distill ingest ~/Downloads/aposd.epub
  distill extract a-philosophy-of-software-design -i
  distill extract a-philosophy-of-software-design --model opus-low
  distill synthesize a-philosophy-of-software-design
  distill anki a-philosophy-of-software-design
  distill skill plan deep-modules --books a-philosophy-of-software-design
`);
}

function printCompletion(shell: string | undefined, config: AppConfig): void {
  if (shell !== 'zsh') {
    console.error(`Unsupported shell: ${shell}. Only 'zsh' is supported.`);
    process.exit(1);
  }
  const roles = Object.keys(config.models).join(' ');
  const books = `${resolveLibraryRoot(config.library)}/books`;
  const skills = `${resolveLibraryRoot(config.library)}/skills`;

  console.log(`#compdef distill

_distill_books() {
  local -a books
  books=(\${(f)"$(command ls '${books}' 2>/dev/null)"})
  _describe 'book' books
}

_distill_skills() {
  local -a skills
  skills=(\${(f)"$(command ls '${skills}' 2>/dev/null)"})
  _describe 'skill' skills
}

_distill() {
  if (( CURRENT == 2 )); then
    local -a commands
    commands=(
      'ingest:Split a book into the library'
      'extract:Extract each selected chapter'
      'synthesize:Write summary.md from the extractions'
      'anki:Stage the book'"'"'s new cards in Anki for review'
      'skill:Plan, build, or install a skill'
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
        '1:book:_distill_books'
      ;;
    synthesize)
      _arguments -s \\
        '--model[Model role for this run]:role:(${roles})' \\
        '1:book:_distill_books'
      ;;
    anki)
      _arguments '1:book:_distill_books'
      ;;
    skill)
      _arguments -s \\
        '--model[Model role for this run]:role:(${roles})' \\
        '--books[Only consider these books]:book:_distill_books' \\
        '1:subcommand:(plan build install)' \\
        '2:skill:_distill_skills'
      ;;
    completion)
      _arguments '1:shell:(zsh)'
      ;;
  esac
}

compdef _distill distill`);
}

const describe = (spec: ModelSpec) => (spec.effort ? `${spec.model}@${spec.effort}` : spec.model);
const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;

async function runIngest(epubPath: string | undefined, config: AppConfig): Promise<void> {
  if (!epubPath?.endsWith('.epub')) throw new Error('Usage: distill ingest <file.epub>');

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
  if (!args.target) throw new Error('Usage: distill extract <book> [-i] [--model <role>]');
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
  if (!args.target) throw new Error('Usage: distill synthesize <book> [--model <role>]');
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
  if (!args.target) throw new Error('Usage: distill anki <book>');
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
    console.log(`  ${result.notExtracted.length} selected chapter(s) not extracted yet; run: distill extract ${args.target}`);
  }
  for (const { card, error } of result.failed) console.log(`  ✗ ${card.front.slice(0, 60)}: ${error}`);
  return result.failed.length === 0;
}

function skillName(args: Args, usage: string): string {
  if (!args.target) throw new Error(`Usage: ${usage}`);
  assertSkillName(args.target);
  return args.target;
}

const DECISIONS: { title: string; value: Decision }[] = [
  { title: 'Approve and save recipe.yaml', value: 'approve' },
  { title: 'Edit in $EDITOR', value: 'edit' },
  { title: 'Regenerate with feedback', value: 'regenerate' },
  { title: 'Quit without saving', value: 'quit' },
];

async function runSkillPlan(args: Args, config: AppConfig): Promise<void> {
  const name = skillName(args, 'distill skill plan <name> [--books <slug,…>] [--model <role>]');
  const root = resolveLibraryRoot(config.library);
  const spec = resolveStage(config, 'skill', args.modelRole);
  const provider = createProvider(spec);
  const catalog = await buildCatalog(root, args.books);
  if (catalog.notSynthesized.length > 0) {
    console.log(`Not synthesized, left out: ${catalog.notSynthesized.join(', ')}`);
  }

  const propose = async (revision?: Parameters<typeof proposeRecipe>[0]['revision']) => {
    console.log(`Planning ${name} from ${catalog.books.length} book(s) with ${describe(spec)}…`);
    const { recipe, costUsd } = await proposeRecipe({ name, catalog, prompt: config.prompts.skill_plan, provider, revision });
    console.log(`  $${costUsd.toFixed(2)} list price`);
    return recipe;
  };

  const existing = await readRecipe(root, name);
  if (existing) console.log(`Starting from the saved recipe.yaml`);
  const ui = createUI(true);
  const approved = await reviewRecipe({
    initial: existing ?? (await propose()),
    regenerate: propose,
    ui: {
      show: yaml => console.log(`\n${yaml}`),
      decide: async canApprove => {
        const choices = canApprove ? DECISIONS : DECISIONS.filter(d => d.value !== 'approve');
        return (await ui.selectOne('Recipe', choices)) ?? 'quit';
      },
      feedback: () => ui.text('What should change?'),
      edit: yaml => editText(yaml, `${name}.recipe.yaml`),
      error: message => console.error(`\n${message}`),
    },
  });
  if (!approved) {
    console.log('Nothing saved.');
    return;
  }
  console.log(`Saved ${await writeRecipe(root, approved)}`);
  console.log(`Next: distill skill build ${name}`);
}

async function runSkillBuild(args: Args, config: AppConfig): Promise<boolean> {
  const name = skillName(args, 'distill skill build <name> [--model <role>]');
  const root = resolveLibraryRoot(config.library);
  const spec = resolveStage(config, 'skill', args.modelRole);
  const recipe = await requireRecipe(root, name);
  const guides: Record<string, string> = {};
  for (const [target, { guide }] of Object.entries(config.skills.targets)) {
    guides[target] = await Bun.file(repoPath(guide)).text();
  }

  console.log(`Building ${name} with ${describe(spec)}`);
  const result = await buildSkill({
    root,
    recipe,
    skills: config.skills,
    prompts: { spec: config.prompts.skill_spec, revise: config.prompts.skill_revise, render: config.prompts.skill_render },
    guides,
    agent: claudeAgent(spec),
    provider: createProvider(spec),
    evaluate: claudePluginEval,
    concurrency: config.concurrency,
    log: line => console.log(line),
  });

  const { aggregates, cases, failing, resultsPath, threshold } = result.report;
  const { casesPassed, casesTotal, overallScore, meanDelta } = aggregates;
  const without = cases.reduce((sum, c) => sum + (c.scoreWithout ?? 0), 0) / Math.max(cases.length, 1);
  const delta = meanDelta === undefined ? '' : ` (${without.toFixed(2)} without, Δ ${meanDelta >= 0 ? '+' : ''}${meanDelta.toFixed(2)})`;
  const cost = `$${result.costUsd.toFixed(2)}${result.reusedEval ? ', eval reused' : ''}`;

  if (result.passed) {
    console.log(`\n✓ ${name}: ${casesPassed}/${casesTotal} cases ≥ ${threshold} · score ${overallScore.toFixed(2)}${delta} · ${cost}`);
    if (meanDelta !== undefined && meanDelta <= 0) {
      console.log('  [!] No uplift over the baseline: the eval cases may not test what the skill adds.');
    }
    console.log(`  ${skillDir(root, name)} · install with: distill skill install ${name}`);
    return true;
  }

  console.log(`\n✗ ${name}: still failing after ${result.attempts} attempt(s) · ${casesPassed}/${casesTotal} cases ≥ ${threshold} · ${cost}`);
  for (const c of cases.filter(c => failing.includes(c.name))) console.log(`  ${c.name}: ${c.score.toFixed(2)}`);
  console.log(`  Results: ${resultsPath}`);
  console.log(`  Review spec.md or the recipe's eval cases (distill skill plan ${name}), then re-run the build.`);
  return false;
}

async function runSkillInstall(args: Args, config: AppConfig): Promise<void> {
  const name = skillName(args, 'distill skill install <name>');
  const root = resolveLibraryRoot(config.library);
  for (const r of await installSkill(root, name, config.skills.targets)) {
    console.log(`${r.status === 'installed' ? '✓ linked' : '= already linked'} ${r.link}`);
  }
}

async function runSkill(args: Args, config: AppConfig): Promise<boolean> {
  switch (args.subcommand) {
    case 'plan':
      await runSkillPlan(args, config);
      return true;
    case 'build':
      return runSkillBuild(args, config);
    case 'install':
      await runSkillInstall(args, config);
      return true;
    default:
      throw new Error('Usage: distill skill <plan|build|install> <name>');
  }
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
      case 'skill':
        if (!(await runSkill(args, config))) process.exit(1);
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

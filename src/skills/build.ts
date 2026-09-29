import { createHash } from 'crypto';
import { join } from 'path';
import type { Provider } from '../providers';
import type { Agent, AgentResult } from '../providers/claude-agent';
import { bookDir, readBook, summaryPath } from '../library/library';
import { extractionPath } from '../pipeline/extract';
import type { SkillsConfig } from '../types';
import { evalsDir, skillDir, specPath, stringifyRecipe, variantDir, type Recipe } from './recipe';
import { MAX_BODY_LINES, renderVariant, type RenderedVariant } from './render';
import { describeFailures, suiteFiles, summarize, writeSuite, type Evaluate, type GateSummary } from './evals';

export interface BuildPrompts {
  spec: string;
  revise: string;
  render: string;
}

export interface BuildOptions {
  root: string;
  recipe: Recipe;
  skills: SkillsConfig;
  prompts: BuildPrompts;
  // Guide text per target, read from guides/.
  guides: Record<string, string>;
  agent: Agent;
  provider: Provider;
  evaluate: Evaluate;
  concurrency: number;
  log?: (line: string) => void;
}

export interface BuildResult {
  passed: boolean;
  attempts: number;
  report: GateSummary;
  // True when the same skill and suite already passed, so no eval ran.
  reusedEval: boolean;
  costUsd: number;
}

// What the last build produced from which inputs, so a re-run with nothing
// changed makes no model calls and no eval runs.
interface BuildState {
  specInputs?: string;
  lastEval?: { key: string; report: GateSummary };
}

const sha = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const statePath = (root: string, name: string) => join(skillDir(root, name), 'build.json');

async function readState(root: string, name: string): Promise<BuildState> {
  const file = Bun.file(statePath(root, name));
  return (await file.exists()) ? file.json() : {};
}

const writeState = (root: string, name: string, state: BuildState) =>
  Bun.write(statePath(root, name), JSON.stringify(state, null, 2) + '\n');

// The spec writer gets the recipe without its eval cases so the skill is
// written for the domain, not for the test prompts.
const recipeForSpec = ({ evals, ...rest }: Recipe) => stringifyRecipe(rest as Recipe);

export async function sourceFiles(root: string, recipe: Recipe): Promise<{ readable: string[]; listing: string; files: string[] }> {
  const readable: string[] = [];
  const files: string[] = [];
  const sections: string[] = [];
  for (const source of recipe.sources) {
    const book = await readBook(root, source.book);
    if (!book) throw new Error(`Recipe source "${source.book}" is not in the library`);
    const summary = summaryPath(root, source.book);
    if (!(await Bun.file(summary).exists())) {
      throw new Error(`"${source.book}" has no summary.md yet. Run: glean synthesize ${source.book}`);
    }
    const indices = source.chapters ?? book.selected;
    const chapters = book.chapters.filter(c => indices.includes(c.index));
    const extractions: string[] = [];
    for (const chapter of chapters) {
      const path = extractionPath(root, source.book, chapter);
      if (!(await Bun.file(path).exists())) {
        throw new Error(`"${source.book}" chapter ${chapter.index} (${chapter.title}) is not extracted. Run: glean extract ${source.book}`);
      }
      extractions.push(path);
    }

    const dir = bookDir(root, source.book);
    readable.push(dir);
    files.push(summary, ...extractions);
    sections.push(
      [
        `${book.title}${book.author ? ` by ${book.author}` : ''}`,
        `- Summary: ${summary}`,
        `- Chapter extractions (JSON): ${join(dir, 'extract')}/ — ${chapters.map(c => c.index).join(', ')}`,
        `- Chapter text (markdown): ${join(dir, 'chapters')}/`,
      ].join('\n')
    );
  }
  return { readable, listing: sections.join('\n\n'), files };
}

const fill = (prompt: string, values: Record<string, string>) =>
  Object.entries(values).reduce((p, [k, v]) => p.replaceAll(`{{${k}}}`, v), prompt);

async function runSpecAgent(options: BuildOptions, prompt: string, readable: string[]): Promise<AgentResult> {
  const { root, recipe } = options;
  const path = specPath(root, recipe.name);
  const result = await options.agent({
    prompt,
    cwd: skillDir(root, recipe.name),
    readable,
    writable: [path],
  });
  if (result.isError) throw new Error(`Spec agent failed: ${result.text.slice(0, 500)}`);
  const spec = Bun.file(path);
  if (!(await spec.exists()) || !(await spec.text()).trim()) throw new Error(`Spec agent finished without writing ${path}`);
  return result;
}

export async function buildSkill(options: BuildOptions): Promise<BuildResult> {
  const { root, recipe, skills, prompts, provider } = options;
  const log = options.log ?? (() => {});
  const name = recipe.name;
  const state = await readState(root, name);
  let costUsd = 0;

  const { readable, listing, files } = await sourceFiles(root, recipe);
  const sourceText = await Promise.all(files.map(f => Bun.file(f).text()));
  const specValues = { NAME: name, RECIPE: recipeForSpec(recipe), SOURCES: listing, SPEC_PATH: specPath(root, name) };
  const specInputs = sha(prompts.spec, JSON.stringify(provider.spec), specValues.RECIPE, ...sourceText);

  if (state.specInputs === specInputs && (await Bun.file(specPath(root, name)).exists())) {
    log('spec.md is current');
  } else {
    log('Writing spec.md from the sources…');
    const result = await runSpecAgent(options, fill(prompts.spec, specValues), readable);
    costUsd += result.costUsd;
    log(`  spec.md written (${result.turns} turns, $${result.costUsd.toFixed(2)})`);
    state.specInputs = specInputs;
    delete state.lastEval;
    await writeState(root, name, state);
  }

  const suite = evalsDir(root, name);
  await writeSuite(suite, recipe);
  const evalTarget = skills.eval.target;
  if (!skills.targets[evalTarget]) throw new Error(`skills.eval.target "${evalTarget}" is not in skills.targets`);

  for (let attempt = 1; ; attempt++) {
    const spec = await Bun.file(specPath(root, name)).text();
    const rendered: RenderedVariant[] = [];
    for (const [target, targetConfig] of Object.entries(skills.targets)) {
      const guide = options.guides[target];
      if (guide === undefined) throw new Error(`No guide loaded for target "${target}"`);
      rendered.push(
        await renderVariant({ root, recipe, spec, target, targetConfig, guide, prompt: prompts.render, provider })
      );
    }
    for (const r of rendered) {
      costUsd += r.costUsd;
      log(`  ${r.target}/SKILL.md ${r.cached ? 'reused' : 'rendered'} (${r.lines} lines)`);
      if (r.lines > MAX_BODY_LINES) log(`  [!] ${r.target}/SKILL.md body is over ${MAX_BODY_LINES} lines`);
    }

    const skillText = await Bun.file(join(variantDir(root, name, evalTarget), 'SKILL.md')).text();
    const evalKey = sha(skillText, JSON.stringify(suiteFiles(recipe)), JSON.stringify(skills.eval), provider.spec.model);
    if (state.lastEval?.key === evalKey && state.lastEval.report.passed) {
      return { passed: true, attempts: attempt, report: state.lastEval.report, reusedEval: true, costUsd };
    }

    log(`Eval gate, attempt ${attempt} of ${skills.eval.attempts}…`);
    const report = await options.evaluate({
      skill: name,
      variant: variantDir(root, name, evalTarget),
      suite,
      resultsDir: join(suite, 'results'),
      model: provider.spec.model,
      judge: skills.eval.judge,
      runs: skills.eval.runs,
      threshold: skills.eval.threshold,
      concurrency: options.concurrency,
    });
    costUsd += report.run.costUsd;
    state.lastEval = { key: evalKey, report: summarize(report) };
    await writeState(root, name, state);

    if (report.passed || attempt >= skills.eval.attempts) {
      return { passed: report.passed, attempts: attempt, report: state.lastEval.report, reusedEval: false, costUsd };
    }

    log(`  ${report.failing.length} case(s) below ${report.threshold}; revising spec.md…`);
    const revise = await runSpecAgent(
      options,
      fill(prompts.revise, { ...specValues, FAILURES: describeFailures(report) }),
      readable
    );
    costUsd += revise.costUsd;
  }
}

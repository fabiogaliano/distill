import { cp, mkdir, mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { EvalCase, Recipe } from './recipe';

// Cases run in an empty sandbox; the agent only needs to reason and load the skill.
const CASE_TOOLS = ['Read', 'Glob', 'Grep', 'Skill'];
const CASE_MAX_TURNS = 10;
const CASE_TIMEOUT_SECONDS = 300;

export interface SuiteFile {
  path: string;
  content: string;
}

const frontmatter = (fields: Record<string, string | number>) =>
  `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;

// One `claude plugin eval` case per recipe case: the prompt, one llm grader per
// expectation, and a display-only check on whether the skill loaded.
export function caseFiles(recipe: Recipe, c: EvalCase): SuiteFile[] {
  const dir = c.name;
  const files: SuiteFile[] = [
    {
      path: join(dir, 'prompt.md'),
      content:
        frontmatter({
          max_turns: CASE_MAX_TURNS,
          timeout_seconds: CASE_TIMEOUT_SECONDS,
          allowed_tools: `[${CASE_TOOLS.join(', ')}]`,
        }) + `\n${c.prompt.trim()}\n`,
    },
    ...c.expect.map((criteria, i) => ({
      path: join(dir, 'graders', `expect-${i + 1}.md`),
      content: frontmatter({ type: 'llm' }) + `\n${criteria.trim()}\n`,
    })),
    {
      path: join(dir, 'graders', 'skill-loaded.md'),
      content: frontmatter({
        type: 'tool_used',
        tool: 'Skill',
        input_match: recipe.name,
        ...(c.fire ? { min: 1 } : { max: 0 }),
      }),
    },
  ];
  return files;
}

export function suiteFiles(recipe: Recipe): SuiteFile[] {
  return recipe.evals.flatMap(c => caseFiles(recipe, c));
}

// Replaces the case directories wholesale so cases dropped from the recipe don't
// linger; results/ is kept.
export async function writeSuite(dir: string, recipe: Recipe): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'results') await rm(join(dir, entry.name), { recursive: true });
  }
  for (const file of suiteFiles(recipe)) await Bun.write(join(dir, file.path), file.content);
}

export interface GraderResult {
  name: string;
  passed: boolean;
  scored: boolean;
  withOnly: boolean;
  explanation?: string;
  evidence?: string;
}

export interface ArmRun {
  score: number;
  passed: boolean;
  error: string | null;
  graders: GraderResult[];
}

export interface CaseResult {
  name: string;
  promptMarkdown: string;
  graders: { name: string; type: string; graderMarkdown?: string }[];
  arms: { with: ArmRun[]; without?: ArmRun[] };
  aggregates: { score: number; scoreWithout?: number; delta?: number };
}

export interface EvalRun {
  costUsd: number;
  partial: boolean;
  suite: { plugins: { name: string; path: string; problem?: string }[] };
  cases: CaseResult[];
  aggregates: { casesTotal: number; casesPassed: number; overallScore: number; meanDelta?: number };
}

export interface EvalRequest {
  skill: string;
  variant: string;
  suite: string;
  resultsDir: string;
  model: string;
  judge: string;
  runs: number;
  threshold: number;
  concurrency: number;
}

export interface GateReport {
  passed: boolean;
  threshold: number;
  run: EvalRun;
  failing: CaseResult[];
  resultsPath: string;
}

export type Evaluate = (request: EvalRequest) => Promise<GateReport>;

// What a build keeps of a gate run; the full transcripts stay in resultsPath.
export interface GateSummary {
  passed: boolean;
  threshold: number;
  resultsPath: string;
  costUsd: number;
  aggregates: EvalRun['aggregates'];
  cases: { name: string; score: number; scoreWithout?: number }[];
  failing: string[];
}

export function summarize(report: GateReport): GateSummary {
  return {
    passed: report.passed,
    threshold: report.threshold,
    resultsPath: report.resultsPath,
    costUsd: report.run.costUsd,
    aggregates: report.run.aggregates,
    cases: report.run.cases.map(c => ({ name: c.name, score: c.aggregates.score, scoreWithout: c.aggregates.scoreWithout })),
    failing: report.failing.map(c => c.name),
  };
}

// These mean the with-skill arm ran without the skill, so scores say nothing.
const LOAD_PROBLEMS = new Set(['manifest_invalid', 'disabled_by_default', 'will_not_load']);

export function judgeRun(run: EvalRun, threshold: number, resultsPath: string): GateReport {
  const broken = run.suite.plugins.find(p => p.problem && LOAD_PROBLEMS.has(p.problem));
  if (broken) throw new Error(`claude plugin eval could not load the skill (${broken.problem}); see ${resultsPath}`);
  if (run.suite.plugins.length === 0) throw new Error(`claude plugin eval loaded no skill; see ${resultsPath}`);
  if (run.partial) throw new Error(`claude plugin eval stopped early (partial results); see ${resultsPath}`);

  const failing = run.cases.filter(c => c.aggregates.score < threshold);
  return { passed: failing.length === 0, threshold, run, failing, resultsPath };
}

const clip = (text: string | undefined, max: number) =>
  !text ? '' : text.length > max ? `${text.slice(0, max)}…` : text;

// What the reviser sees: each failing case's prompt and the scored checks the
// with-skill runs missed, with the judge's reasons and what the agent said.
export function describeFailures(report: GateReport): string {
  return report.failing
    .map(c => {
      const criteria = new Map(c.graders.map(g => [g.name, g.graderMarkdown ?? g.name]));
      const misses = c.arms.with.flatMap((run, i) =>
        run.error
          ? [`- run ${i + 1} errored: ${clip(run.error, 300)}`]
          : run.graders
              .filter(g => g.scored && !g.withOnly && !g.passed)
              .map(g => `- run ${i + 1} missed: ${criteria.get(g.name)}\n  judge: ${clip(g.explanation, 300)}\n  response: ${clip(g.evidence, 800)}`)
      );
      const without = c.aggregates.scoreWithout === undefined ? '' : `, ${c.aggregates.scoreWithout.toFixed(2)} without the skill`;
      return `## Case ${c.name}: scored ${c.aggregates.score.toFixed(2)} with the skill${without} (needs ${report.threshold})\n\nPrompt:\n${c.promptMarkdown.trim()}\n\n${misses.join('\n')}`;
    })
    .join('\n\n');
}

// `claude plugin eval` takes a skill folder whose evals/ holds the cases, so the
// variant and suite are staged together in a temp dir named after the skill.
export const claudePluginEval: Evaluate = async request => {
  const stage = await mkdtemp(join(tmpdir(), 'glean-eval-'));
  const target = join(stage, request.skill);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(request.resultsDir, stamp);
  const jsonPath = join(outDir, 'result.json');
  try {
    await cp(request.variant, target, { recursive: true });
    await cp(request.suite, join(target, 'evals'), {
      recursive: true,
      filter: src => !src.startsWith(join(request.suite, 'results')),
    });
    await mkdir(outDir, { recursive: true });

    const proc = Bun.spawn(
      [
        'claude', 'plugin', 'eval', target,
        '--json', jsonPath,
        '--output-dir', outDir,
        '--trust-plugin',
        '--no-publish',
        '--ablation', 'with-without',
        '--model', request.model,
        '--judge-model', request.judge,
        '--runs', String(request.runs),
        '--threshold', String(request.threshold),
        '-j', String(request.concurrency),
      ],
      { stdout: 'inherit', stderr: 'inherit' }
    );
    const code = await proc.exited;
    const json = Bun.file(jsonPath);
    // Exit 1 is "below threshold", which the gate reads from the JSON itself.
    if ((code !== 0 && code !== 1) || !(await json.exists())) {
      throw new Error(`claude plugin eval exited with ${code}; see ${outDir}`);
    }
    return judgeRun((await json.json()) as EvalRun, request.threshold, outDir);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
};

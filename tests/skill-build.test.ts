import { afterEach, describe, expect, it } from 'vitest';
import { readdir, rm } from 'fs/promises';
import { buildSkill, type BuildOptions } from '../src/skills/build';
import type { AgentTask } from '../src/providers/claude-agent';
import type { EvalRequest, GateReport } from '../src/skills/evals';
import type { SkillsConfig } from '../src/types';
import { summaryPath } from '../src/library/library';
import { fakeProvider, SLUG } from './library-fixture';
import { caseResult, gate, makeSkillLibrary, recipe, skillPath } from './skill-fixture';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const SKILLS: SkillsConfig = {
  targets: {
    claude: { reader: 'Claude Opus 5.5', guide: 'guides/claude.md', install: '~/.claude/skills' },
    gpt: { reader: 'GPT-6 Astra', guide: 'guides/gpt.md', install: '~/.pi/agent/skills' },
  },
  eval: { target: 'claude', runs: 3, threshold: 0.8, attempts: 3, judge: 'sonnet' },
};

const PROMPTS = {
  spec: 'Spec {{NAME}} into {{SPEC_PATH}}\n{{RECIPE}}\n{{SOURCES}}',
  revise: 'Revise {{SPEC_PATH}}\n{{FAILURES}}',
  render: 'Render for {{READER}}\n{{GUIDE}}',
};

async function setup(results: GateReport[]) {
  const lib = await makeSkillLibrary();
  cleanup = lib.cleanup;
  const tasks: AgentTask[] = [];
  const evals: EvalRequest[] = [];
  let version = 0;
  const provider = fakeProvider((prompt, input) => ({ text: `# Deep modules\n\n${prompt.split('\n')[0]} from ${input}` }));

  const options = (overrides: Partial<BuildOptions> = {}): BuildOptions => ({
    root: lib.root,
    recipe: recipe(),
    skills: SKILLS,
    prompts: PROMPTS,
    guides: { claude: 'Claude guide', gpt: 'GPT guide' },
    agent: async task => {
      tasks.push(task);
      await Bun.write(task.writable[0]!, `spec v${++version}`);
      return { text: 'Wrote spec.md', isError: false, turns: 5, costUsd: 0.5, durationMs: 1000 };
    },
    provider,
    evaluate: async request => {
      evals.push(request);
      const next = results.shift();
      if (!next) throw new Error('unexpected eval');
      return next;
    },
    concurrency: 4,
    ...overrides,
  });
  return { ...lib, tasks, evals, provider, options };
}

const passing = () => gate([caseResult('review-shallow-class', 1), caseResult('sql-question', 1)]);
const failing = () => gate([caseResult('review-shallow-class', 0.33, ['expect-1']), caseResult('sql-question', 1)]);

describe('buildSkill', () => {
  it('writes the spec, renders both variants, and passes the gate', async () => {
    const { root, tasks, evals, options } = await setup([passing()]);

    const result = await buildSkill(options());

    expect(result).toMatchObject({ passed: true, attempts: 1, reusedEval: false });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.readable).toEqual([expect.stringContaining(`books/${SLUG}`)]);
    expect(tasks[0]!.writable).toEqual([skillPath(root, 'spec.md')]);
    // The spec writer doesn't see the test prompts.
    expect(tasks[0]!.prompt).not.toContain('review-shallow-class');
    expect(tasks[0]!.prompt).toContain(summaryPath(root, SLUG));

    const claude = await Bun.file(skillPath(root, 'claude', 'SKILL.md')).text();
    const gpt = await Bun.file(skillPath(root, 'gpt', 'SKILL.md')).text();
    expect(claude.startsWith('---\nname: deep-modules\ndescription: "Reviews module')).toBe(true);
    expect(claude).toContain('Render for Claude Opus 5.5 from spec v1');
    expect(gpt).toContain('Render for GPT-6 Astra from spec v1');

    expect(evals).toEqual([
      expect.objectContaining({
        skill: 'deep-modules',
        variant: skillPath(root, 'claude'),
        suite: skillPath(root, 'evals'),
        model: 'claude-opus-5-5',
        judge: 'sonnet',
        runs: 3,
        threshold: 0.8,
      }),
    ]);
    expect((await readdir(skillPath(root, 'evals'))).sort()).toEqual(['review-shallow-class', 'sql-question']);
  });

  it('makes no calls and runs no eval when nothing changed since a pass', async () => {
    const { root, tasks, evals, provider, options } = await setup([passing()]);
    await buildSkill(options());
    const callsAfterFirst = provider.calls.length;

    const result = await buildSkill(options());

    expect(result).toMatchObject({ passed: true, reusedEval: true, costUsd: 0 });
    // Transcripts stay in the results dir, not in the build state.
    expect(await Bun.file(skillPath(root, 'build.json')).text()).not.toContain('arms');
    expect(tasks).toHaveLength(1);
    expect(evals).toHaveLength(1);
    expect(provider.calls).toHaveLength(callsAfterFirst);
  });

  it('revises the spec from the failures, re-renders, and re-evaluates', async () => {
    const { root, tasks, evals, options } = await setup([failing(), passing()]);

    const result = await buildSkill(options());

    expect(result).toMatchObject({ passed: true, attempts: 2 });
    expect(evals).toHaveLength(2);
    expect(tasks[1]!.prompt).toContain('## Case review-shallow-class: scored 0.33');
    expect(tasks[1]!.prompt).toContain('missed: Names the class shallow');
    expect(await Bun.file(skillPath(root, 'claude', 'SKILL.md')).text()).toContain('from spec v2');
  });

  it('gives up after the configured attempts and reports the last failure', async () => {
    const { tasks, evals, options } = await setup([failing(), failing(), failing()]);

    const result = await buildSkill(options());

    expect(result.passed).toBe(false);
    expect(result.attempts).toBe(3);
    expect(evals).toHaveLength(3);
    // One spec write plus a revision between each pair of attempts.
    expect(tasks).toHaveLength(3);
    expect(result.report.failing).toEqual(['review-shallow-class']);
  });

  it('rewrites the spec when a source changes', async () => {
    const { root, tasks, options } = await setup([passing(), passing()]);
    await buildSkill(options());
    await Bun.write(summaryPath(root, SLUG), '# Changed\n\n## Overview\n\nNew.\n');

    await buildSkill(options());

    expect(tasks).toHaveLength(2);
  });

  it('asks for the missing pipeline step when a source is not ready', async () => {
    const { root, options } = await setup([]);
    await rm(summaryPath(root, SLUG));
    await expect(buildSkill(options())).rejects.toThrow(`Run: glean synthesize ${SLUG}`);
  });
});

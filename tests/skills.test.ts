import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readdir, readlink, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { parseRecipe, recipeProblems, stringifyRecipe, writeRecipe } from '../src/skills/recipe';
import { caseFiles, describeFailures, judgeRun, writeSuite } from '../src/skills/evals';
import { pathGuard } from '../src/providers/claude-agent';
import { buildCatalog, overviewOf, proposeRecipe, reviewRecipe, type Decision } from '../src/skills/plan';
import { skillMarkdown, unwrapFence } from '../src/skills/render';
import { installSkill } from '../src/skills/install';
import { fakeProvider, SLUG } from './library-fixture';
import { caseResult, evalRun, makeSkillLibrary, recipe, skillPath } from './skill-fixture';

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.map(c => c()));
  cleanup = [];
});

async function library() {
  const lib = await makeSkillLibrary();
  cleanup.push(lib.cleanup);
  return lib;
}

describe('recipe', () => {
  it('accepts a complete recipe and round-trips through YAML', () => {
    expect(recipeProblems(recipe())).toEqual([]);
    expect(parseRecipe(stringifyRecipe(recipe()))).toEqual(recipe());
  });

  it('lists every problem at once', () => {
    const problems = recipeProblems({
      ...recipe(),
      name: 'Deep Modules',
      description: 'x'.repeat(1100),
      evals: [{ name: 'a', fire: true, prompt: 'p', expect: [] }],
    });
    expect(problems).toEqual([
      'name: lowercase letters, digits, and hyphens',
      'description: 1100 characters, max 1024',
      'evals[0].expect: at least one statement',
      'evals: needs a case where it should not fire',
    ]);
  });
});

describe('eval suite', () => {
  it('writes a prompt, one llm grader per expectation, and a skill-loaded indicator', () => {
    const c = { name: 'review', fire: true, prompt: 'Review this.', expect: ['Names it shallow', 'Suggests merging'] };
    const files = Object.fromEntries(caseFiles(recipe(), c).map(f => [f.path, f.content]));

    expect(Object.keys(files)).toEqual([
      'review/prompt.md',
      'review/graders/expect-1.md',
      'review/graders/expect-2.md',
      'review/graders/skill-loaded.md',
    ]);
    expect(files['review/prompt.md']).toBe(
      '---\nmax_turns: 10\ntimeout_seconds: 300\nallowed_tools: [Read, Glob, Grep, Skill]\n---\n\nReview this.\n'
    );
    expect(files['review/graders/expect-2.md']).toBe('---\ntype: llm\n---\n\nSuggests merging\n');
    expect(parseYaml(files['review/graders/skill-loaded.md']!.split('---')[1]!)).toEqual({
      type: 'tool_used',
      tool: 'Skill',
      input_match: 'deep-modules',
      min: 1,
    });
  });

  it('expects no skill load for no-fire cases', () => {
    const files = caseFiles(recipe(), { name: 'sql', fire: false, prompt: 'p', expect: ['x'] });
    expect(files.at(-1)!.content).toContain('max: 0');
  });

  it('replaces stale cases but keeps results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'distill-suite-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    await mkdir(join(dir, 'dropped-case'), { recursive: true });
    await Bun.write(join(dir, 'results', 'old.json'), '{}');

    await writeSuite(dir, recipe());

    expect((await readdir(dir)).sort()).toEqual(['results', 'review-shallow-class', 'sql-question']);
  });

  it('fails the gate on cases below threshold and refuses runs where the skill never loaded', () => {
    const report = judgeRun(evalRun([caseResult('a', 1), caseResult('b', 0.5, ['expect-1'])]), 0.8, '/r');
    expect(report.passed).toBe(false);
    expect(report.failing.map(c => c.name)).toEqual(['b']);

    const broken = evalRun([caseResult('a', 1)]);
    broken.suite.plugins[0]!.problem = 'will_not_load';
    expect(() => judgeRun(broken, 0.8, '/r')).toThrow('could not load the skill (will_not_load)');
  });

  it('describes failures with the missed criteria, not the display-only indicator', () => {
    const report = judgeRun(evalRun([caseResult('b', 0.5, ['expect-1'])]), 0.8, '/r');
    const text = describeFailures(report);

    expect(text).toContain('## Case b: scored 0.50 with the skill, 0.20 without the skill (needs 0.8)');
    expect(text).toContain('- run 1 missed: Names the class shallow');
    expect(text).toContain('response: The class looks fine.');
    expect(text).not.toContain('skill-loaded');
  });
});

describe('pathGuard', () => {
  const guard = pathGuard({ cwd: '/lib/skills/s', readable: ['/lib/books/a'], writable: ['/lib/skills/s/spec.md'] });
  const decide = async (tool: string, input: Record<string, unknown>) =>
    (await guard(tool, input, { signal: new AbortController().signal } as never))?.behavior;

  it('allows reads of sources and writes of the spec only', async () => {
    expect(await decide('Read', { file_path: '/lib/books/a/summary.md' })).toBe('allow');
    expect(await decide('Read', { file_path: '/lib/books/b/summary.md' })).toBe('deny');
    expect(await decide('Read', { file_path: '/lib/books/a/../b/summary.md' })).toBe('deny');
    expect(await decide('Write', { file_path: 'spec.md' })).toBe('allow');
    expect(await decide('Edit', { file_path: '/lib/skills/s/claude/SKILL.md' })).toBe('deny');
    expect(await decide('Write', { file_path: '/lib/books/a/summary.md' })).toBe('deny');
    expect(await decide('Bash', { command: 'ls' })).toBe('deny');
  });

  it('checks Glob and Grep paths, including absolute glob patterns', async () => {
    expect(await decide('Grep', { pattern: 'x', path: '/lib/books/a' })).toBe('allow');
    expect(await decide('Glob', { pattern: '/lib/books/a/extract/*.json' })).toBe('allow');
    expect(await decide('Glob', { pattern: '/etc/**' })).toBe('deny');
    expect(await decide('Grep', { pattern: 'x', path: '/lib' })).toBe('deny');
  });
});

describe('plan', () => {
  it('catalogs synthesized books and leaves out the rest', async () => {
    const { root } = await library();
    await mkdir(join(root, 'books', 'unsynthesized'), { recursive: true });
    await Bun.write(join(root, 'books', 'unsynthesized', 'book.json'), JSON.stringify({ chapters: [], selected: [] }));

    const catalog = await buildCatalog(root);

    expect(catalog.notSynthesized).toEqual(['unsynthesized']);
    expect(catalog.books).toEqual([
      expect.objectContaining({ slug: SLUG, overview: 'Complexity is the enemy.', chapters: [
        { index: 0, title: 'The Nature of Complexity' },
        { index: 1, title: 'Deep Modules' },
      ] }),
    ]);
  });

  it('reads the overview up to the chapter notes', () => {
    expect(overviewOf('# T\n\n## Overview\n\nOne.\n\n### Idea\n\nTwo.\n\n## Chapters\n\n### A\n')).toBe('One.\n\n### Idea\n\nTwo.');
  });

  it('keeps the user-given name and rejects books outside the catalog', async () => {
    const { root } = await library();
    const catalog = await buildCatalog(root);
    const { name, ...proposed } = recipe();
    const reply = (value: object) => fakeProvider(() => ({ text: `Here:\n${JSON.stringify(value)}` }));

    const ok = await proposeRecipe({ name: 'deep-modules', catalog, prompt: 'Plan {{NAME}}', provider: reply({ ...proposed, name: 'other' }) });
    expect(ok.recipe.name).toBe('deep-modules');

    const bad = reply({ ...proposed, sources: [{ book: 'made-up' }] });
    await expect(proposeRecipe({ name: 'deep-modules', catalog, prompt: 'p', provider: bad })).rejects.toThrow(
      'sources: "made-up" is not in the catalog'
    );
  });

  it('sends the previous recipe and feedback when regenerating', async () => {
    const { root } = await library();
    const provider = fakeProvider(() => ({ text: JSON.stringify(recipe()) }));
    await proposeRecipe({
      name: 'deep-modules',
      catalog: await buildCatalog(root),
      prompt: 'p',
      provider,
      revision: { previous: recipe(), feedback: 'Add a design case' },
    });
    expect(provider.calls[0]!.input).toContain('# Feedback on it\n\nAdd a design case');
    expect(provider.calls[0]!.input).toContain('review-shallow-class');
  });
});

describe('reviewRecipe', () => {
  function scriptedUI(decisions: Decision[], edits: string[] = [], feedback: string[] = []) {
    const shown: string[] = [];
    const errors: string[] = [];
    const approvable: boolean[] = [];
    return {
      shown,
      errors,
      approvable,
      ui: {
        show: (yaml: string) => shown.push(yaml),
        decide: async (canApprove: boolean) => (approvable.push(canApprove), decisions.shift() ?? 'quit'),
        edit: async () => edits.shift()!,
        feedback: async () => feedback.shift(),
        error: (m: string) => errors.push(m),
      },
    };
  }

  it('returns the approved recipe as initially proposed', async () => {
    const { ui } = scriptedUI(['approve']);
    expect(await reviewRecipe({ initial: recipe(), ui, regenerate: async () => recipe() })).toEqual(recipe());
  });

  it('keeps an invalid edit as the draft and blocks approval until it is fixed', async () => {
    const edited = stringifyRecipe(recipe({ focus: 'Edited focus.' }));
    const s = scriptedUI(['edit', 'edit', 'approve'], ['name: deep-modules\nfocus: [broken', edited]);

    const result = await reviewRecipe({ initial: recipe(), ui: s.ui, regenerate: async () => recipe() });

    expect(s.errors).toHaveLength(1);
    expect(s.approvable).toEqual([true, false, true]);
    expect(s.shown[1]).toBe('name: deep-modules\nfocus: [broken');
    expect(result?.focus).toBe('Edited focus.');
  });

  it('refuses an edit that renames the skill', async () => {
    const s = scriptedUI(['edit', 'quit'], [stringifyRecipe(recipe({ name: 'renamed' }))]);
    await reviewRecipe({ initial: recipe(), ui: s.ui, regenerate: async () => recipe() });
    expect(s.errors[0]).toContain('name must stay "deep-modules"');
  });

  it('regenerates from feedback, and quitting returns nothing', async () => {
    const s = scriptedUI(['regenerate', 'quit'], [], ['More cases']);
    const seen: string[] = [];
    const result = await reviewRecipe({
      initial: recipe(),
      ui: s.ui,
      regenerate: async ({ feedback }) => (seen.push(feedback), recipe({ focus: 'New focus.' })),
    });
    expect(seen).toEqual(['More cases']);
    expect(s.shown[1]).toContain('New focus.');
    expect(result).toBeUndefined();
  });
});

describe('render', () => {
  it('takes frontmatter from the recipe and strips a wrapping fence', () => {
    const body = unwrapFence('```markdown\n# Deep modules\n\nBody.\n```');
    expect(skillMarkdown(recipe({ description: 'Reviews designs.\nUse when: "reviewing".' }), body)).toBe(
      '---\nname: deep-modules\ndescription: "Reviews designs. Use when: \\"reviewing\\"."\n---\n\n# Deep modules\n\nBody.\n'
    );
  });
});

describe('installSkill', () => {
  async function setup() {
    const { root } = await library();
    const home = await mkdtemp(join(tmpdir(), 'distill-home-'));
    cleanup.push(() => rm(home, { recursive: true, force: true }));
    const targets = {
      claude: { reader: 'Claude', guide: 'g', install: join(home, '.claude', 'skills') },
      gpt: { reader: 'GPT', guide: 'g', install: join(home, '.pi', 'agent', 'skills') },
    };
    await writeRecipe(root, recipe());
    for (const t of Object.keys(targets)) await Bun.write(skillPath(root, t, 'SKILL.md'), '---\nname: deep-modules\n---\n');
    return { root, home, targets };
  }

  it('links each variant into its tool, and is idempotent', async () => {
    const { root, home, targets } = await setup();

    const first = await installSkill(root, 'deep-modules', targets);
    const again = await installSkill(root, 'deep-modules', targets);

    expect(first.map(r => r.status)).toEqual(['installed', 'installed']);
    expect(again.map(r => r.status)).toEqual(['already', 'already']);
    expect(await readlink(join(home, '.pi', 'agent', 'skills', 'deep-modules'))).toBe(skillPath(root, 'gpt'));
  });

  it('refuses to replace an existing skill and links nothing', async () => {
    const { root, home, targets } = await setup();
    await mkdir(join(home, '.pi', 'agent', 'skills', 'deep-modules'), { recursive: true });

    await expect(installSkill(root, 'deep-modules', targets)).rejects.toThrow("isn't this skill's link");
    await expect(lstat(join(home, '.claude', 'skills', 'deep-modules'))).rejects.toThrow();
  });

  it('requires a build first', async () => {
    const { root, targets } = await setup();
    await rm(skillPath(root, 'gpt'), { recursive: true });
    await expect(installSkill(root, 'deep-modules', targets)).rejects.toThrow('Run: distill skill build deep-modules');
  });
});

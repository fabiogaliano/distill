import { join } from 'path';
import { extractionPath } from '../src/pipeline/extract';
import { summaryPath } from '../src/library/library';
import type { Recipe } from '../src/skills/recipe';
import type { CaseResult, EvalRun, GateReport } from '../src/skills/evals';
import { makeLibrary, SLUG, words } from './library-fixture';

export const recipe = (overrides: Partial<Recipe> = {}): Recipe => ({
  name: 'deep-modules',
  description: 'Reviews module and interface design using Ousterhout. Use when reviewing a class or API design.',
  focus: 'Apply deep modules and information hiding when reviewing designs.',
  sources: [{ book: SLUG }],
  scope: { include: ['module depth'], exclude: ['testing'] },
  evals: [
    { name: 'review-shallow-class', fire: true, prompt: 'Review this class: ...', expect: ['Names the class shallow'] },
    { name: 'sql-question', fire: false, prompt: 'How do I write a left join?', expect: ['Answers the join question'] },
  ],
  ...overrides,
});

// A library with one synthesized, extracted book, ready to build skills from.
export async function makeSkillLibrary() {
  const lib = await makeLibrary([
    { title: 'The Nature of Complexity', text: words(300) },
    { title: 'Deep Modules', text: words(300, 'depth') },
  ]);
  await Bun.write(
    summaryPath(lib.root, SLUG),
    '# A Philosophy of Software Design\n\n## Overview\n\nComplexity is the enemy.\n\n## Chapters\n\n### The Nature of Complexity\n'
  );
  for (const chapter of lib.book.chapters) {
    await Bun.write(
      extractionPath(lib.root, SLUG, chapter),
      JSON.stringify({ chapter, key: null, model: null, extraction: { skip: false, summary: chapter.title } })
    );
  }
  return lib;
}

export const skillPath = (root: string, ...parts: string[]) => join(root, 'skills', 'deep-modules', ...parts);

export function caseResult(name: string, score: number, missed: string[] = []): CaseResult {
  return {
    name,
    promptMarkdown: `Prompt for ${name}`,
    graders: [
      { name: 'expect-1', type: 'llm', graderMarkdown: 'Names the class shallow' },
      { name: 'skill-loaded', type: 'tool_used' },
    ],
    arms: {
      with: [
        {
          score,
          passed: score === 1,
          error: null,
          graders: [
            {
              name: 'expect-1',
              passed: !missed.includes('expect-1'),
              scored: true,
              withOnly: false,
              explanation: 'judge votes: FAIL FAIL FAIL',
              evidence: 'The class looks fine.',
            },
            { name: 'skill-loaded', passed: false, scored: false, withOnly: true },
          ],
        },
      ],
    },
    aggregates: { score, scoreWithout: 0.2, delta: score - 0.2 },
  };
}

export function evalRun(cases: CaseResult[]): EvalRun {
  const passed = cases.filter(c => c.aggregates.score >= 0.8).length;
  return {
    costUsd: 1.5,
    partial: false,
    suite: { plugins: [{ name: 'deep-modules', path: '/tmp/x/deep-modules' }] },
    cases,
    aggregates: { casesTotal: cases.length, casesPassed: passed, overallScore: 0.9, meanDelta: 0.5 },
  };
}

export const gate = (cases: CaseResult[], threshold = 0.8): GateReport => {
  const failing = cases.filter(c => c.aggregates.score < threshold);
  return { passed: failing.length === 0, threshold, run: evalRun(cases), failing, resultsPath: '/results' };
};

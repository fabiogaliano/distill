#!/usr/bin/env bun
// Compares models/effort levels on chapter extraction: quality vs quota cost.
// Each set in evals/model-pick/sets/ names a split book (evals/model-pick/books/<id>/) and
// chapters; chapters with gold items also get graded against the author's key ideas.
// Usage:
//   bun run scripts/eval-models.ts [--sets id,id] [--only model@effort,...] [--runs N] [--concurrency N] [--rank]
import { join, dirname } from 'path';
import { mkdir, readdir } from 'fs/promises';
import { ClaudeSdkProvider } from '../src/providers/claude-sdk.provider';
import type { Completion } from '../src/providers';
import { parseLastJson } from '../src/json';
import { pool } from '../src/pool';

const EVAL_DIR = join(dirname(import.meta.dir), 'evals/model-pick');
const RESULTS_DIR = join(EVAL_DIR, 'results');

// agy bakes effort into the model name, so effort is optional.
interface ModelSpec { provider: 'claude-sdk' | 'pi' | 'agy'; model: string; effort?: string }
interface SetChapter { file: string; title: string; items?: string[] }
interface EvalSet { id: string; book: string; chapters: SetChapter[] }
interface Grade {
  gold: { item: string; score: number; note?: string }[];
  unsupported: { claim: string; why: string }[];
  cards: number;
  usefulness: number;
}
interface Row {
  candidate: string;
  set: string;
  chapter: string;
  run: number;
  call?: Completion;
  parsed: boolean;
  grade?: Grade;
}

const specId = (s: ModelSpec) => (s.effort ? `${s.model}@${s.effort}` : s.model);
const specDir = (s: ModelSpec) => specId(s).replace(/[\/ ()]+/g, '_').replace(/_+$/, '');

function parseArgs() {
  const args = Bun.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  return {
    sets: flag('--sets')?.split(','),
    only: flag('--only')?.split(','),
    runs: Number(flag('--runs') ?? 1),
    concurrency: Number(flag('--concurrency') ?? 3),
    rank: args.includes('--rank'),
  };
}

async function callModel(spec: ModelSpec, prompt: string, stdin: string): Promise<Completion> {
  if (spec.provider === 'claude-sdk') {
    return new ClaudeSdkProvider({ provider: 'claude-sdk', model: spec.model, effort: spec.effort }).complete(prompt, stdin);
  }

  // pi and agy are used only as rankers, so text is all we need from them; neither
  // reports usage in print mode. -nt / no --dangerously-skip-permissions keep them tool-free.
  const argv = spec.provider === 'pi'
    ? ['pi', '--no-skills', '-nt', '-p', '--model', spec.model, '--thinking', spec.effort ?? 'high', prompt]
    // agy has no stdin input, so the payload rides in the prompt (well under ARG_MAX).
    : ['agy', '--model', spec.model, '--prompt', `${prompt}\n\n${stdin}`];
  const started = Date.now();
  const proc = Bun.spawn(argv, {
    stdin: spec.provider === 'pi' ? new Response(stdin) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: '/tmp',
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${spec.provider} exited ${code}: ${err || out.slice(0, 500)}`);
  return {
    text: out,
    stopReason: null,
    isError: false,
    outputTokens: 0,
    thinkingTokens: 0,
    costUsd: 0,
    durationMs: Date.now() - started,
  };
}

async function cached<T>(path: string, produce: () => Promise<T>): Promise<T> {
  const file = Bun.file(path);
  if (await file.exists()) return file.json();
  const value = await produce();
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(value, null, 2));
  return value;
}

const fill = (template: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v), template);

const chapterKey = (set: EvalSet, ch: SetChapter) => `${set.id}/${ch.file.replace('.md', '')}`;

async function loadSets(only?: string[]): Promise<EvalSet[]> {
  const files = (await readdir(join(EVAL_DIR, 'sets'))).filter(f => f.endsWith('.json')).sort();
  const sets = await Promise.all(files.map(f => Bun.file(join(EVAL_DIR, 'sets', f)).json() as Promise<EvalSet>));
  return sets.filter(s => !only || only.includes(s.id));
}

async function main() {
  const opts = parseArgs();
  const config = await Bun.file(join(EVAL_DIR, 'candidates.json')).json() as { judge: ModelSpec; rankers: ModelSpec[]; candidates: ModelSpec[] };
  const sets = await loadSets(opts.sets);
  const extractPrompt = await Bun.file(join(EVAL_DIR, 'extract-prompt.md')).text();
  const judgePrompt = await Bun.file(join(EVAL_DIR, 'judge-prompt.md')).text();

  const candidates = config.candidates.filter(c => !opts.only || opts.only.includes(specId(c)));
  const chapterText = new Map<string, string>();
  for (const set of sets) {
    for (const ch of set.chapters) {
      chapterText.set(chapterKey(set, ch), await Bun.file(join(EVAL_DIR, 'books', set.id, 'chapters', ch.file)).text());
    }
  }

  const tasks: (() => Promise<Row>)[] = [];
  for (const cand of candidates) {
    for (const set of sets) {
      for (const ch of set.chapters) {
        for (let run = 1; run <= opts.runs; run++) {
          tasks.push(async () => {
            const id = specId(cand);
            const key = chapterKey(set, ch);
            const base = join(RESULTS_DIR, id, `${key}.run${run}`);
            const label = `${id} · ${set.id} · ${ch.title} · run ${run}`;
            const row: Row = { candidate: id, set: set.id, chapter: key, run, parsed: false };
            try {
              row.call = await cached(`${base}.extract.json`, () =>
                callModel(cand, fill(extractPrompt, { BOOK: set.book, CHAPTER: ch.title }), chapterText.get(key)!)
              );
              const extraction = parseLastJson(row.call.text);
              row.parsed = extraction !== undefined && row.call.stopReason !== 'max_tokens' && !row.call.isError;
              if (!row.parsed) {
                console.log(`✗ ${label}: unparseable output`);
                return row;
              }
              if (ch.items) {
                const judgeInput = [
                  '===== CHAPTER TEXT', chapterText.get(key),
                  '===== GOLD ITEMS', ch.items.map(i => `- ${i}`).join('\n'),
                  '===== EXTRACTION', JSON.stringify(extraction, null, 2),
                ].join('\n\n');
                const judgeCall = await cached(`${base}.judge.json`, () =>
                  callModel(config.judge, fill(judgePrompt, { BOOK: set.book, CHAPTER: ch.title }), judgeInput)
                );
                const grade = parseLastJson(judgeCall.text) as Grade | undefined;
                if (!grade?.gold) throw new Error('judge output unparseable');
                row.grade = grade;
              }
              console.log(`✓ ${label}`);
            } catch (err) {
              console.log(`✗ ${label}: ${err instanceof Error ? err.message : String(err)}`);
            }
            return row;
          });
        }
      }
    }
  }

  console.log(`${tasks.length} extractions across ${sets.length} books, concurrency ${opts.concurrency}`);
  const rows = await pool(tasks, opts.concurrency);
  let report = buildReport(rows, candidates.map(specId), config.judge);
  if (opts.rank) {
    const rankPrompt = await Bun.file(join(EVAL_DIR, 'rank-prompt.md')).text();
    report += await rankCandidates(rows, sets, chapterText, rankPrompt, config.rankers, opts.concurrency);
  }
  await Bun.write(join(EVAL_DIR, 'report.md'), report);
  console.log('\n' + report);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (n: number, digits = 1) => (Number.isNaN(n) ? '—' : n.toFixed(digits));

function buildReport(rows: Row[], ids: string[], judge: ModelSpec): string {
  const lines = [
    '# Model pick — chapter extraction',
    '',
    `Judge: ${specId(judge)}. Gold columns cover only chapters with gold items. Cost is list-price USD reported by the Agent SDK, used as a relative quota measure.`,
    '',
    '| candidate | chapters | gold recall | unsupported / ch | cards (1-5) | usefulness (1-5) | parse fails | out tok / ch | $ / ch | sec / ch |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const id of ids) {
    const mine = rows.filter(r => r.candidate === id);
    const graded = mine.filter(r => r.grade);
    const called = mine.filter(r => r.call);
    const recall = avg(graded.map(r => avg(r.grade!.gold.map(g => g.score)))) * 100;
    lines.push(`| ${id} | ${mine.length} | ${fmt(recall, 0)}% | ${fmt(avg(graded.map(r => r.grade!.unsupported.length)))} | ${fmt(avg(graded.map(r => r.grade!.cards)))} | ${fmt(avg(graded.map(r => r.grade!.usefulness)))} | ${mine.filter(r => !r.parsed).length} | ${fmt(avg(called.map(r => r.call!.outputTokens)), 0)} | ${fmt(avg(called.map(r => r.call!.costUsd)), 3)} | ${fmt(avg(called.map(r => r.call!.durationMs)) / 1000, 0)} |`);
  }
  return lines.join('\n') + '\n';
}

// Absolute scores saturate when every model covers the chapter, so a blind side-by-side
// ranking separates them. Two orderings per chapter (forward and reversed) cancel position
// bias, and rankers from other model families check the Claude ranker's self-preference.
async function rankCandidates(
  rows: Row[],
  sets: EvalSet[],
  chapterText: Map<string, string>,
  rankPrompt: string,
  rankers: ModelSpec[],
  concurrency: number,
): Promise<string> {
  const labels = 'ABCDEFGHIJ';
  type Ranking = { ranker: string; set: string; ranking: string[] };
  const tasks: (() => Promise<Ranking | undefined>)[] = [];

  for (const ranker of rankers) {
    for (const set of sets) {
      for (const ch of set.chapters) {
        const key = chapterKey(set, ch);
        const entries = rows.filter(r => r.chapter === key && r.run === 1 && r.parsed);
        if (entries.length < 2) continue;
        for (const direction of ['fwd', 'rev'] as const) {
          const order = entries.map(e => e.candidate).sort();
          if (direction === 'rev') order.reverse();
          tasks.push(async () => {
            const label = `rank · ${specId(ranker)} · ${set.id} · ${ch.title} · ${direction}`;
            const input = [
              '===== CHAPTER TEXT', chapterText.get(key)!,
              ...order.map((id, i) => {
                const row = entries.find(e => e.candidate === id)!;
                return `===== EXTRACTION ${labels[i]}\n\n${JSON.stringify(parseLastJson(row.call!.text), null, 2)}`;
              }),
            ].join('\n\n');
            const path = join(RESULTS_DIR, 'rank', specDir(ranker), `${key}.${direction}.${order.join('_')}.json`);
            try {
              const call = await cached(path, () =>
                callModel(ranker, fill(rankPrompt, { BOOK: set.book, CHAPTER: ch.title }), input)
              );
              const parsed = parseLastJson(call.text) as { ranking: string[] } | undefined;
              // Rankers sometimes echo the section header ("EXTRACTION A") instead of the bare label.
              const ranking = parsed?.ranking?.map(l => order[labels.indexOf(l.trim().replace(/^EXTRACTION\s+/i, ''))]);
              if (!ranking || ranking.length !== order.length || ranking.some(id => !id)) {
                throw new Error('rank output unparseable or incomplete');
              }
              console.log(`✓ ${label}`);
              return { ranker: specId(ranker), set: set.id, ranking: ranking as string[] };
            } catch (err) {
              console.log(`✗ ${label}: ${err instanceof Error ? err.message : String(err)}`);
              return undefined;
            }
          });
        }
      }
    }
  }

  const results = (await pool(tasks, concurrency)).filter(r => r !== undefined);
  const lines = ['', '## Blind ranking', '', 'Each chapter ranked twice per ranker (order reversed). Lower avg rank is better; 1 = best.', ''];

  const table = (title: string, subset: Ranking[]) => {
    const positions = new Map<string, number[]>();
    const wins = new Map<string, number>();
    const bySet = new Map<string, Map<string, number[]>>();
    for (const r of subset) {
      r.ranking.forEach((id, pos) => {
        positions.set(id, [...(positions.get(id) ?? []), pos + 1]);
        if (pos === 0) wins.set(id, (wins.get(id) ?? 0) + 1);
        const setMap = bySet.get(r.set) ?? new Map<string, number[]>();
        setMap.set(id, [...(setMap.get(id) ?? []), pos + 1]);
        bySet.set(r.set, setMap);
      });
    }
    const ids = [...positions.keys()].sort((a, b) => avg(positions.get(a)!) - avg(positions.get(b)!));
    const setIds = [...bySet.keys()].sort();
    lines.push(
      `### ${title} (${subset.length} rankings)`, '',
      `| candidate | avg rank | ranked #1 | ${setIds.join(' | ')} |`,
      `|---|---|---|${setIds.map(() => '---').join('|')}|`,
      ...ids.map(id => `| ${id} | ${fmt(avg(positions.get(id)!), 2)} | ${wins.get(id) ?? 0}/${subset.length} | ${setIds.map(s => fmt(avg(bySet.get(s)!.get(id) ?? []), 1)).join(' | ')} |`),
      '',
    );
  };

  table('All rankers combined', results);
  for (const ranker of rankers) table(specId(ranker), results.filter(r => r.ranker === specId(ranker)));
  return lines.join('\n');
}

main();

# glean — plan & decisions

Decided 2026-09-29. Single user (me). Books in → readable summaries, Anki cards, and Claude/GPT skills out.

## Product

- **Primary output: skills.** Summaries are both an input to skill building and something I read.
- **Mostly technical books.** Extraction optimizes for retainable concepts, not narrative recap.
- **Anki cards** are a first-class output.
- **Input: EPUB only.** No PDF/MOBI/LIT support; drop `scripts/split_pdf.ts` and `pdf-parse`.
- **No GUI.** CLI with interactive chapter selection (`-i`) stays the interface.

## Project

- Evolve glean in place (keep repo + history, name, Bun + TS).
- Move repo to `~/Core/dev/projects/glean`.
- Rust `epub-chapter-splitter` stays as glean's submodule — the only splitter.
- Cleanup in `book-summary/`: delete the Zig port and the duplicate top-level Rust splitter. Books and existing summaries untouched.
- Existing outputs (`skills_to_create/`, Covert/Rosenfeld summaries): leave alone. New pipeline applies to new work only.

## Library

- Root: `~/Core/library/` (path configurable).
- `books/<clean-slug>/` — source epub ref, `book.json`, `chapters/`, `cache/`, `extract/`, `summary.md`, `anki.json`.
- `skills/<name>/` — `recipe.yaml`, `spec.md`, `claude/`, `gpt/`, `evals/`.
- Slugs derived from `book.json` title/author, not the Anna's Archive filename.

## Models

- **No hardcoded model names in code.** A `models:` map in `config.yaml` names roles → `{provider, model, effort}`; providers pass the model through. Help text and zsh completion read the map.
- Access: **subscriptions, no API keys.** Claude goes through the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) on OAuth subscription auth — the only Claude provider, replacing `claude -p` subprocess calls. GPT/Gemini go through the `pi` and `agy` CLIs.
- **Extraction: `claude-opus-5-5@medium`**, from the model-pick eval (`scripts/eval-models.ts`, 11 chapters across 5 books: A Philosophy of Software Design, React Key Concepts, The Product-Minded Engineer, Laws of UX, The Mom Test; see `evals/model-pick/report.md`):
  - On Ousterhout's answer key, every candidate hit 100% of the author's key ideas, so absolute scores don't separate them.
  - Blind ranking (grader sees all five side by side, each chapter twice with order reversed; 22 rankings), avg rank of 5:
    - `claude-opus-5-5@medium` 2.18 (best on 3 of 5 books)
    - `claude-opus-5-5@high` 2.36 (most #1 picks, 9/22; best on Ousterhout)
    - `claude-opus-5-5@low` 2.77
    - `claude-sonnet-5-5@high` 3.27
    - `claude-sonnet-5-5@medium` 4.41 (never ranked #1; last on 4 of 5 books)
  - Cost per chapter (list price): opus low $0.199, medium $0.218, high $0.237; sonnet medium $0.095, high $0.110. Time: opus medium 56s, high 64s.
  - Opus medium and high are effectively tied on quality; medium is ~9% cheaper and faster, and it's the model's default.
  - Cross-checked with graders from other model families (same 22 blind comparisons each). Avg rank of `claude-opus-5-5@medium` per grader: `claude-opus-5-5@high` 2.18 (1st), `openai-codex/gpt-6-astra@high` 2.64 (1st), `Gemini 3.8 Flash (High)` 2.09 (tied 1st with opus@high). Combined over 66 rankings: opus@medium 2.30, opus@high 2.50, opus@low 3.12, sonnet@high 3.23, sonnet@medium 3.85. Claude self-preference isn't driving the result.
- Quota fallback: `claude-opus-5-5@low`. With quota to spare: `claude-opus-5-5@high` (tied with medium on quality, most #1 picks).
- No Sonnet 5.5 for extraction: consistently ranked below every Opus level, at medium and at high.
- **Every stage uses `claude-opus-5-5@medium`** (extraction, synthesis, skill building). Final.
- Parse the **last JSON value** in the response; treat `max_tokens` stops as failures.
- Remove the `agy` alias mapping (`flash`/`pro`) from `agy.provider.ts` into config.
- Agent SDK isolation — keeps my CLAUDE.md, tools, and MCP servers out of calls. Verified on subscription auth: 0 tools, 0 MCP, cost on par with the CLI:
  ```ts
  { model, effort, systemPrompt, settingSources: [], mcpServers: {}, tools: [], strictMcpConfig: true, extraArgs: { 'strict-mcp-config': null } }
  ```
  - Extraction / synthesis: plain calls with these options.
  - Skill build: same isolation, but agentic with the tools it needs (read sources, write the skill folder).
- The model-pick eval (`scripts/eval-models.ts`) calls Claude through the same SDK provider.

```yaml
models:
  opus:        { provider: claude-sdk, model: claude-opus-5-5,   effort: medium }
  opus-low:    { provider: claude-sdk, model: claude-opus-5-5,   effort: low }
  opus-high:   { provider: claude-sdk, model: claude-opus-5-5,   effort: high }
stages:
  extract: opus      # opus-low if quota bites, opus-high if quota is plentiful
  synthesize: opus
  skill: opus
```

## Pipeline

Each stage idempotent, reads/writes the library on disk.

```
glean ingest <epub>             split → books/<slug>/, pick content chapters
glean extract <slug> [-i]       per-chapter structured pass (concurrent, cached)
glean synthesize <slug>         book-level summary.md from extractions
glean anki <slug>               push card candidates to Anki (deduped)
glean skill plan <name>         model proposes recipe; I approve/edit
glean skill build <name>        spec → claude/ + gpt/ variants → eval gate
glean skill install <name>      symlink into ~/.claude/skills and ~/.pi/agent/skills
```

### Extraction (replaces concise/detailed modes)

One structured pass per chapter, JSON or fenced sections:

- core concepts (named vocabulary + definition)
- frameworks / procedures (steps)
- contrasts (X vs Y, when to use which)
- red flags / anti-patterns → fix
- notable examples
- short prose summary (for reading)
- card candidates

Cache key: hash(chapter text + prompt + model + effort). Changing any re-runs only affected chapters; a crash resumes where it stopped. Concurrency limited (config, default ~4) to respect subscription rate limits.

### Anki

- Cards come out of the extraction pass; pushed on demand via AnkiConnect / Anki MCP, deduped by stable ID.
- Deck per book (`Books::<Title>`), tags per chapter.
- Formats, chosen per item by the extractor:
  1. **Concept Q/A** — "What makes a module deep?"
  2. **Contrast** — "Strategic vs tactical programming: difference and long-term cost?"
  3. **Red-flag recognition** — "A method only forwards its args. Which red flag, and the fix?"
  4. **Scenario → principle** — short design situation, which principle applies.
  - Code cards only for code-heavy books. Cloze rarely (trains wording, not understanding).
- Reference case: *A Philosophy of Software Design* (Ousterhout) — the named vocabulary and red flags are what's worth retaining.

### Skills

Replaces "open a Claude Code session, point at summary, run skill-creator" and `build_skills.sh`.

- **Consumers:** Claude Opus 5.5 / Fable 5.1 (Claude Code) and GPT via pi. Both use the SKILL.md folder format; only wording differs.
- **One source, rendered per model:** a model-neutral `spec.md` (procedure, checklists, examples, pitfalls) rendered into `claude/SKILL.md` and `gpt/SKILL.md`.
- **Per-model guides:** `guides/<model>.md` holds the official prompting guidance used by the renderer, e.g. [Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5). Rules taken from it for Claude skills:
  - Name specific patterns to avoid; vague "don't be generic" swaps one default for another.
  - No "think carefully" instructions — effort controls thinking.
  - Don't ask the model to write out its reasoning in output.
- **Steering flow:**
  1. `skill plan` — model proposes name, focus, source books, scope, and eval cases. **I approve/edit.**
  2. Approved plan saved as `recipe.yaml` → rebuilds need no input.
  3. `skill build` — automated generation (skill-creator approach) → render variants.
  4. **Eval gate** with `claude plugin eval` (with-skill vs no-skill ablation). Fail → loop back with failures; still failing → escalate to me. Pass → one-line report.
- **Evals: Claude only.** GPT variant is not evaluated.
- Output lives in the library; `skill install` symlinks on demand.

## Order of work

1. Move repo, cleanup, drop PDF bits, commit current WIP (chapter-finder 40% fix, per-book error skip).
2. `models:` map + stage config; remove hardcoded aliases/completion lists; isolated Agent SDK provider (also used by the eval).
3. Library layout + `ingest` with clean slugs.
4. `extract` with per-chapter cache + concurrency; `synthesize`.
5. `anki` push.
6. `skill plan/build/install` + guides + eval gate.

## Open questions

- ~~`claude -p` isolation flags~~ — superseded by the Agent SDK; isolation options verified (see Models).
- ~~Installed Claude Code (2.1.283) doesn't recognize `claude-sonnet-5-5`~~ — moot: no Sonnet in any stage.
- ~~Extraction output: JSON schema vs markdown sections~~ — JSON: the model-pick eval's prompt (0 parse failures in 55 extractions, full recall of Ousterhout's key ideas) is the extraction prompt in `config.yaml`.
- ~~Whether skill building should be agentic or plain calls~~ — agentic, via the Agent SDK with tools.

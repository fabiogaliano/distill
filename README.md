# distill

Turns books (EPUB) into readable summaries, Anki cards, and Claude/GPT skills. Built for technical books: extraction keeps the author's named concepts, principles, red flags, and techniques rather than retelling chapters.

## Installation

```bash
git clone --recursive git@github.com:fabiogaliano/distill.git
cd distill
make install
```

## Usage

```bash
# Split a book into the library; prints its slug
distill ingest ./book.epub

# Extract every selected chapter (cached, concurrent)
distill extract a-philosophy-of-software-design

# Pick the chapters yourself first (saved for later runs)
distill extract a-philosophy-of-software-design -i

# Write summary.md: a model-written overview plus the chapter notes
distill synthesize a-philosophy-of-software-design

# Stage new cards in Anki for review (deck Books::<Title>, via the ember MCP server)
distill anki a-philosophy-of-software-design

# Skills: propose a recipe from the library, approve or edit it, then build and install
distill skill plan deep-modules --books a-philosophy-of-software-design
distill skill build deep-modules
distill skill install deep-modules

# Use another model role for one run, e.g. when quota is tight
distill extract a-philosophy-of-software-design --model opus-low

# zsh completion (commands, book slugs, model roles)
distill completion zsh > "${fpath[1]}/_distill"
```

Each stage reads and writes the library on disk and is safe to re-run. `extract` caches every model response by chapter text, prompt, model, and effort, so a re-run only calls the model for chapters where one of those changed, and an interrupted run picks up where it stopped.

## Library

The root is `library:` in `config.yaml` (default `~/Core/library`).

```
books/<slug>/
├── book.json      # title, author, chapters, source epub path, selected chapters
├── chapters/      # markdown per chapter, from epub-chapter-splitter
├── cache/         # model responses keyed by input hash
├── extract/       # one JSON extraction per chapter
├── summary.md     # overview + chapter notes
└── anki.json      # cards already pushed to Anki, by stable ID
skills/<name>/
├── recipe.yaml    # approved plan: description, focus, sources, scope, eval cases
├── spec.md        # model-neutral skill content, written from the sources
├── claude/        # SKILL.md for Claude Code
├── gpt/           # SKILL.md for GPT in pi
├── evals/         # claude plugin eval cases (from the recipe) and results/
└── build.json     # what the last build used, so unchanged re-runs are free
```

Slugs come from the book's own title (subtitle dropped), not the file name.

Anki cards come from the extraction (concept, contrast, red flag, scenario, and code cards) and go to the built-in Basic note type, tagged by chapter (`distill::<slug>::<nn>-<chapter>`) and card type (`distill::type::<type>`). They're sent to the ember Anki MCP server with `stageMany`, so they arrive suspended in your Anki Inbox and only reach reviews once you approve them there. A card's ID is its book plus normalized question, so re-running `distill anki` only stages questions it hasn't sent before.

Skills are built in three steps:

- `skill plan` shows the model the synthesized books (overviews and chapter lists) and gets back a recipe, including 5–7 eval cases where the skill should or shouldn't fire, each with checkable expectations. You approve it, edit it in `$EDITOR`, or regenerate it with feedback. Nothing is saved until you approve. Re-running it starts from the saved recipe.
- `skill build` has an agent (Agent SDK, file tools limited to the source books and `spec.md`) write `spec.md` from the summaries, extractions, and chapter text. It then renders `claude/SKILL.md` and `gpt/SKILL.md` using each model's prompting guide in `guides/`, and runs the eval gate: `claude plugin eval` on the Claude variant, each case with and without the skill. If a case scores below the threshold, the failures go back to the agent to revise `spec.md`, up to `attempts` rounds. If it's still failing after that, the build stops and points you at the results. The GPT variant isn't evaluated.
- `skill install` symlinks `claude/` into `~/.claude/skills/<name>` and `gpt/` into `~/.pi/agent/skills/<name>`. It refuses to replace anything that isn't its own link.

`distill anki` needs two environment variables: `DISTILL_ANKI_MCP_URL` (ember's MCP endpoint) and `DISTILL_ANKI_MCP_TOKEN` (its bearer token, without the `Bearer ` prefix).

## Configuration

`config.yaml` holds everything tunable:

- `models`: named roles → `{ provider, model, effort }`. Claude runs through the Claude Agent SDK on your subscription, isolated from your Claude Code settings, tools, and MCP servers.
- `stages`: which role `extract`, `synthesize`, and `skill` use.
- `concurrency`: parallel model calls per book.
- `prompts`: the extraction, synthesis, and skill prompts. The extraction prompt is the one the model was picked with (`evals/model-pick/`).
- `skills.targets`: per-model reader, prompting guide, and install folder. `skills.eval`: runs per case, pass threshold, revise attempts, and the judge model. A full gate is cases × runs × 2 agent runs (about $2 per run per 7 cases, at list price).

## Development

```bash
bun run test                           # Vitest
cd epub-chapter-splitter && cargo test # splitter
bun run scripts/eval-models.ts --rank  # model-pick eval (cached results reused)
```

## Requirements

- [Bun](https://bun.sh) runtime
- [Rust](https://rustup.rs) toolchain (to build epub-chapter-splitter)
- A Claude subscription signed in through [Claude Code](https://docs.anthropic.com/en/docs/claude-code); the Agent SDK reuses that login, no API key

## Uninstall

```bash
make uninstall
```

# glean

Turns books (EPUB) into readable summaries, Anki cards, and Claude/GPT skills. Built for technical books: extraction keeps the author's named concepts, principles, red flags, and techniques rather than retelling chapters.

## Installation

```bash
git clone --recursive git@github.com:fabiogaliano/docs-summarizer.git glean
cd glean
make install
```

## Usage

```bash
# Split a book into the library; prints its slug
glean ingest ./book.epub

# Extract every selected chapter (cached, concurrent)
glean extract a-philosophy-of-software-design

# Pick the chapters yourself first (saved for later runs)
glean extract a-philosophy-of-software-design -i

# Write summary.md: a model-written overview plus the chapter notes
glean synthesize a-philosophy-of-software-design

# Stage new cards in Anki for review (deck Books::<Title>, via the ember MCP server)
glean anki a-philosophy-of-software-design

# Use another model role for one run, e.g. when quota is tight
glean extract a-philosophy-of-software-design --model opus-low

# zsh completion (commands, book slugs, model roles)
glean completion zsh > "${fpath[1]}/_glean"
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
```

Slugs come from the book's own title (subtitle dropped), not the file name.

Anki cards come from the extraction (concept, contrast, red flag, scenario, and code cards) and go to the built-in Basic note type, tagged by chapter (`glean::<slug>::<nn>-<chapter>`) and card type (`glean::type::<type>`). They're sent to the ember Anki MCP server with `stageMany`, so they arrive suspended in your Anki Inbox and only reach reviews once you approve them there. A card's ID is its book plus normalized question, so re-running `glean anki` only stages questions it hasn't sent before.

`glean anki` needs two environment variables: `GLEAN_ANKI_MCP_URL` (ember's MCP endpoint) and `GLEAN_ANKI_MCP_TOKEN` (its bearer token, without the `Bearer ` prefix).

## Configuration

`config.yaml` holds everything tunable:

- `models`: named roles → `{ provider, model, effort }`. Claude runs through the Claude Agent SDK on your subscription, isolated from your Claude Code settings, tools, and MCP servers.
- `stages`: which role `extract`, `synthesize`, and `skill` use.
- `concurrency`: parallel model calls per book.
- `prompts`: the extraction and synthesis prompts. The extraction prompt is the one the model was picked with (`evals/model-pick/`).

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

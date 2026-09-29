# glean

CLI tool to summarize documents and books with AI.

## Features

- Auto-detect and skip front/back matter (covers, dedications, etc.)
- Two summary modes: concise (quick overview) or detailed (with examples)
- Interactive chapter selection with `-i` flag
- Model roles in `config.yaml`: each stage names a role (provider, model, effort); Claude runs through the Agent SDK
- Progress tracking with chapter-by-chapter logging
- Outputs both individual chapter summaries and complete book summaries

## Installation

```bash
git clone --recursive git@github.com:fabiogaliano/docs-summarizer.git
cd docs-summarizer
make install
```

## Usage

```bash
# Summarize a single EPUB
glean ./book.epub

# Summarize all EPUBs in a folder
glean ./books/

# Interactive mode - select chapters manually
glean ./book.epub -i

# Specify output directory
glean ./book.epub -o ./output/

# Detailed mode with examples
glean ./book.epub -m detailed

# Use a different model role for every stage
glean ./book.epub --model opus-low

# Skip if already summarized
glean ./books/ --skip-existing
```

## Options

```
-o, --output <dir>     Output directory (default: same as epub)
-m, --mode <mode>      Summary mode: concise (default) or detailed
--model <role>         Model role from config.yaml for every stage (default: per stage)
--skip-existing        Skip if summaries already exist
-i, --interactive      Interactively select chapters to summarize
-h, --help             Show this help
```

## Output Structure

```
{book-name}/
├── book.json                 # Manifest from epub-splitter
├── chapters/                 # Raw markdown chapters
├── summaries/
│   ├── concise/
│   │   ├── 01_introduction.md
│   │   ├── 02_chapter_1.md
│   │   └── ...
│   └── detailed/
│       ├── 01_introduction.md
│       └── ...
├── summary-concise.md        # Quick book overview
└── summary-detailed.md       # Rich book summary
```

## Architecture

### Layers

- **EPUB Processing**: Handles file splitting and chapter detection
- **Providers**: Claude Agent SDK (isolated from user settings, tools, and MCP servers) and the `agy` CLI
- **Summarizers**: Chapter and book-level summarization logic
- **UI**: Interactive chapter selection with `prompts` library
- **Output**: File writing and formatting

### Smart Chapter Detection

Automatically skips:
- Front matter (covers, dedications, tables of contents)
- Back matter (indexes, bibliography, acknowledgments)

Prefers starting from:
1. "Introduction" chapter
2. First preface/prologue/foreword
3. After last front matter section

### Summary Modes

**Concise** (~200-300 words per chapter):
- Key points only
- Quick overview suitable for rapid reading

**Detailed** (~500-800 words per chapter):
- Includes notable examples and case studies
- Practical takeaways for non-fiction
- Better context preservation

## Requirements

- [Bun](https://bun.sh) runtime
- [Rust](https://rustup.rs) toolchain (to build epub-chapter-splitter)
- A Claude subscription signed in through [Claude Code](https://docs.anthropic.com/en/docs/claude-code); the Agent SDK reuses that login, no API key

## Uninstall

```bash
make uninstall
```

## Future

- Batch processing with progress reporting
- Custom prompt templates
- Highlight extraction

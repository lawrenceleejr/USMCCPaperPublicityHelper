# USMCC Paper Publicity Helper

A macOS desktop app (Tauri 2 + React + Rust) that turns one row pasted from the USMCC paper submission Google Sheet into ready-to-post publicity content for Twitter/X, Bluesky, LinkedIn, and a plain-language summary.

## Features

- Paste a tab-separated row (with or without header) from Google Sheets
- Auto-detects and strips header line
- Supports two generation modes:
  - **Claude mode** (optional):
    - Twitter/X post (≤ 280 chars, optional thread)
    - Bluesky post (≤ 300 chars)
    - LinkedIn post (professional tone, 100–200 words)
    - Plain-language summary (120–180 words, general public)
  - **Input-only mode**:
    - Builds outputs directly from the original submission text (no API calls)
- In Claude mode, generates via Anthropic Claude:
  - Twitter/X post (≤ 280 chars, optional thread)
  - Bluesky post (≤ 300 chars)
  - LinkedIn post (professional tone, 100–200 words)
  - Plain-language summary (120–180 words, general public)
- One-click copy for each output
- One-click Hugo/Blowfish markdown export (`index.md`) for website press items
- Interactive Instagram design preview editor with fixed placement, live typography controls, guidelines, and PNG/JPEG export
- USMCC logo branding integrated in the app UI
- API key stored securely in macOS Keychain
- Model choice: `claude-sonnet-4-5` or `claude-opus-4-5`

## Setup

1. **Install prerequisites**:
   - [Rust](https://rustup.rs/) (stable)
   - [Node.js](https://nodejs.org/) 20+
   - [Tauri prerequisites](https://tauri.app/start/prerequisites/)

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run in development**:
   ```bash
   npm run tauri dev
   ```

4. **Build for release**:
   ```bash
   npm run tauri build
   ```

5. **Set your Anthropic API key** in the app's Settings panel.

### macOS unsigned build note

If macOS blocks launch (or the app appears to close immediately), remove quarantine from the installed app:

```bash
xattr -dr com.apple.quarantine "/Applications/USMCC Publicity Helper.app"
```

The distributed DMG includes `README.txt` with the same command.

## Transcript Scraper

`scripts/scrape-transcripts.mjs` downloads the talk transcripts from the USMCC
meeting recordings page (the talks are Panopto videos; the script pulls the same
SRT captions the viewer's "Download transcript" button serves).

```bash
npm run scrape:transcripts
# or point it at a different Indico page / output dir:
node scripts/scrape-transcripts.mjs <eventUrl> <outDir>
```

Requires Node 18+ (uses built-in `fetch`, no extra dependencies). For each
recording it writes a raw `.srt` and a cleaned plain-text `.txt` into
`transcripts/` (gitignored), plus an `index.json` manifest. The `.txt` files are
handy as source material for the publicity generator.

## Testing

Run Rust unit tests (covers TSV parsing logic):

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Run frontend type-check and build:

```bash
npm run build
```

## Input Format

Paste one row copied from the USMCC paper submission Google Sheet. The app accepts:
- A bare data row (tab-separated)
- A header row + data row (two lines)

Column order: Timestamp, Email, Paper Title, Plain Title, Authors, Date, Category, Abstract, Link, Figures OK?, Comments.

## Project Structure

```
├── src/                   # React TypeScript frontend
│   ├── App.tsx
│   ├── api.ts             # Tauri invoke() wrappers
│   ├── types.ts           # Shared TypeScript types
│   └── components/        # UI components
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── parse_row.rs   # TSV parser (with unit tests)
│   │   ├── anthropic.rs   # Claude API client
│   │   ├── prompts.rs     # Prompt templates
│   │   ├── settings.rs    # Keychain wrapper
│   │   └── commands.rs    # Tauri commands
│   └── Cargo.toml
└── tests/fixtures/        # Test fixtures
```

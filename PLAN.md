# USMCC Paper Publicity Helper — Implementation Plan

## 1. Goal

A double-clickable macOS app that turns one row pasted from the USMCC paper
submission Google Sheet into ready-to-post publicity content:

- A Twitter/X post (and optional thread)
- A Bluesky post
- A LinkedIn post
- A plain-language summary (~150 words, general-public audience)

The user pastes the row, picks a tone/length if desired, clicks **Generate**,
then copies each output with a single click. No server to start, no terminal,
no browser tab — opening the `.app` from Finder or Spotlight is the whole
workflow.

## 2. Input format

The input is a single row copied out of a Google Sheet. When a row is copied
from Google Sheets, the clipboard contains **tab-separated values** with the
cells in the order shown below. The app accepts either:

1. A pasted row (tab-separated, single line — `\t` between fields, no header).
2. A pasted row **with** the header line above it (two lines, both
   tab-separated). The app detects this by counting `\t` and looking for the
   word `Timestamp` in the first cell.

### Columns (in order)

| # | Header | Notes |
|---|--------|-------|
| 1 | `Timestamp` | Google Form submission time. Display-only. |
| 2 | `Email Address` | Submitter. Display-only, not sent to Claude. |
| 3 | `Paper Title` | Required. |
| 4 | `Optional less technical title` | May be empty. Used as a hint for the plain-language summary. |
| 5 | `Author list / Collaboration` | E.g. `C. Anderson, S. Neddermeyer` or `USMCC Collaboration`. |
| 6 | `Date of publication or posting` | Free-form date string. |
| 7 | `Category` | E.g. accelerator, detector, physics, theory. Used to steer tone. |
| 8 | `Public abstract/description` | Two-sentence colloquium-level blurb written by the author. **This is the most important input.** |
| 9 | `Link to paper` | arXiv / INSPIRE-HEP / JACoW URL. Included verbatim in outputs that have room for it. |
| 10 | `Figures/materials OK to repost?` | `Yes` / `No`. If `No`, outputs must not suggest "see attached figure" etc. |
| 11 | `Additional comments?` | Free text from author; passed to Claude as extra context. |

Parsing rules:

- Split on `\t`. Trim each field.
- If a field contains embedded newlines (Google Sheets wraps multi-line cells
  in `"..."` with `""` for embedded quotes), unwrap them: strip the outer
  quotes and replace `""` with `"`.
- Missing trailing columns are allowed — pad with empty strings.
- If column 3 (title) or column 8 (abstract) is empty, show an inline error
  and disable the Generate button.

Provide a small `parseRow(text: string): PaperRow` function with unit tests
(see §9).

## 3. Outputs

Each output appears in its own card with a **Copy** button and a small
character/word counter.

| Output | Constraints |
|--------|-------------|
| Twitter/X post | ≤ 280 chars including the link. One emoji max. No hashtag soup — at most 2 relevant hashtags (e.g. `#MuonCollider`, `#HEP`). |
| Twitter/X thread (optional, toggle) | 2–5 tweets, each ≤ 280 chars. First tweet is the hook; last tweet has the link + author credit. |
| Bluesky post | ≤ 300 chars. Same style as the Twitter single post. No hashtags by default (Bluesky norm); link at the end. |
| LinkedIn post | 100–200 words. Professional tone, no emoji, paragraphs separated by blank lines. End with the link and author/collaboration credit. |
| Plain-language summary | 120–180 words. Aimed at a curious non-physicist (think science journalist or interested undergrad). Defines jargon on first use. No formulas. |

Style rules common to all outputs:

- Credit the author list / collaboration exactly as given. If the field
  contains a collaboration name (matches `/Collaboration$/i`), use that;
  otherwise use the first author + `et al.` when the list has > 1 name.
- Never invent results, numbers, or claims not present in the abstract or
  comments. Stick to what the inputs say.
- Use the *less technical title* (col 4) if present and the channel benefits
  from it (LinkedIn, plain-language summary). Use the formal title for
  Twitter/Bluesky unless the formal title is > 120 chars.
- If `Figures OK?` is `No`, do not write "see figure" / "image attached" /
  "swipe for". If `Yes`, the LinkedIn output may end with a one-line
  "Figures available on request." note.

## 4. Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Shell | **Electron** (via `electron-forge`) | Produces a real `.app` bundle the user can double-click. Mature tooling on macOS. User explicitly said Electron is fine. |
| Language | **TypeScript** everywhere | Same language in main and renderer; better refactors. |
| UI | **React 18** + **Vite** | Standard; `electron-forge` has a Vite + TS + React template. |
| Styling | Plain CSS modules or Tailwind (pick Tailwind if it's already comfortable; otherwise CSS modules are fine). No component library needed — this is a 3-screen app. |
| AI | `@anthropic-ai/sdk` from the **main process** (never the renderer — keeps the API key off the DOM and avoids CORS). |
| Model | `claude-sonnet-4-6` by default; expose a dropdown to pick `claude-opus-4-7` for higher-quality runs. |
| Secret storage | **`keytar`** to store the Anthropic API key in the macOS Keychain. Fall back to `electron-store` only if `keytar` fails to load. |
| State persistence | `electron-store` for non-secret prefs (last-used model, last tone setting, window size). |
| IPC | Electron `contextBridge` + `ipcRenderer.invoke` for the few calls (`generate`, `getSettings`, `setSettings`, `getApiKey`, `setApiKey`). |
| Packaging | `electron-forge make --platform=darwin` produces a `.app` inside a `.zip` or `.dmg`. No code signing required for personal use; document the Gatekeeper bypass (`xattr -d com.apple.quarantine`) in README. |

Do **not** add: a backend server, a database, auth, telemetry, or any
non-essential dependency. This is a single-user local tool.

## 5. Project structure

```
USMCCPaperPublicityHelper/
├── PLAN.md                       (this file)
├── README.md                     (short user-facing intro; points at PLAN.md)
├── package.json
├── forge.config.ts               (electron-forge config; macOS target)
├── tsconfig.json
├── vite.main.config.ts
├── vite.preload.config.ts
├── vite.renderer.config.ts
├── src/
│   ├── main/
│   │   ├── index.ts              (app lifecycle, window creation, IPC handlers)
│   │   ├── anthropic.ts          (Claude SDK wrapper: one function per output channel)
│   │   ├── prompts.ts            (prompt templates — see §7)
│   │   ├── settings.ts           (keytar + electron-store wrappers)
│   │   └── parseRow.ts           (TSV parser + types)
│   ├── preload/
│   │   └── index.ts              (contextBridge exposes a typed `window.api`)
│   ├── renderer/
│   │   ├── main.tsx              (React entry)
│   │   ├── App.tsx               (top-level layout, tab switcher)
│   │   ├── components/
│   │   │   ├── InputPanel.tsx    (paste box + parsed-fields preview + Generate button)
│   │   │   ├── OutputCard.tsx    (one per channel; copy button, char counter)
│   │   │   ├── Settings.tsx      (API key, model selector, default tone)
│   │   │   └── ErrorBanner.tsx
│   │   ├── styles.css
│   │   └── types.ts              (shared types mirrored from main)
│   └── shared/
│       └── types.ts              (PaperRow, GenerateRequest, GenerateResponse — imported by both sides)
└── test/
    └── parseRow.test.ts          (vitest unit tests for §2 parsing rules)
```

## 6. Implementation steps (in order)

Do these in sequence; each step should leave the app runnable.

1. **Scaffold.** `npm init electron-app@latest USMCCPaperPublicityHelper -- --template=vite-typescript` into a temp dir, then move the generated files into the repo root (preserving `PLAN.md` and `README.md`). Verify `npm start` opens a blank Electron window.
2. **Type definitions.** Create `src/shared/types.ts` with `PaperRow`, `Channel` (`'twitter' | 'twitterThread' | 'bluesky' | 'linkedin' | 'plainLanguage'`), `GenerateRequest`, `GenerateResponse`.
3. **Parser.** Implement `parseRow` in `src/main/parseRow.ts` per §2. Add `test/parseRow.test.ts` with cases: bare row, row + header, quoted multi-line abstract, missing trailing cells, missing required cells.
4. **Settings + Keychain.** Implement `src/main/settings.ts`: `getApiKey()`, `setApiKey()`, `getPrefs()`, `setPrefs()`. Use `keytar` with service name `usmcc-publicity-helper`, account `anthropic-api-key`. Wrap in try/catch — if `keytar` throws, surface a clear error message in the UI.
5. **Anthropic client.** In `src/main/anthropic.ts`, expose `generate(row: PaperRow, opts: { model: string; channels: Channel[]; tone?: string }): Promise<Record<Channel, string>>`. Call the SDK **once per channel in parallel** with `Promise.all`. Use the prompts in §7. Use `max_tokens: 800` for Twitter/Bluesky, `1200` for LinkedIn/plain-language, `1500` for the thread. Set `temperature: 0.7`.
6. **IPC.** Wire `ipcMain.handle('generate', ...)`, `'getApiKey'`, `'setApiKey'`, `'getPrefs'`, `'setPrefs'`. Expose them through `contextBridge` in `src/preload/index.ts` as `window.api.generate(...)` etc.
7. **InputPanel.** Big textarea ("Paste row from Google Sheet here"). On every change, run `parseRow` and render a small read-only preview of the parsed title, authors, category, and abstract so the user can confirm it parsed correctly. Show inline validation for missing title/abstract. Generate button is disabled until parsing succeeds and an API key is set.
8. **OutputCards.** One `OutputCard` per channel showing: channel name, generated text in a `<textarea readOnly>`, character count vs. the channel's limit (red if over), and a Copy button (uses `navigator.clipboard.writeText`). While generating, show a skeleton/spinner per card. If one channel fails, show its error in just that card — don't kill the others.
9. **Settings screen.** Modal or separate route. Fields: Anthropic API key (password input, masked, with a "Test" button that calls `messages.create` with a tiny prompt), default model (`claude-sonnet-4-6` / `claude-opus-4-7`), default tone (`Neutral` / `Enthusiastic` / `Formal`). Persist via the IPC handlers from step 4.
10. **Window chrome.** `titleBarStyle: 'hiddenInset'`, sensible default size (1100×750), `app.setName('USMCC Publicity Helper')`. Set a macOS app icon (`build/icon.icns`) — a simple muon-symbol placeholder is fine.
11. **Packaging.** `npm run make`. Confirm a `.app` appears in `out/`. Document the first-run Gatekeeper bypass in README. Optional: produce a `.dmg` via `@electron-forge/maker-dmg`.
12. **Smoke test.** Open the packaged `.app` from Finder. Paste a sample row (provide one in `test/fixtures/sample-row.txt`). Generate. Verify all five channels return text and Copy buttons work.

## 7. Prompt templates

Keep all prompts in `src/main/prompts.ts` as plain template functions —
**do not** build prompts in the renderer. All prompts share a `systemPrompt`
that pins context once so prompt caching works.

### System prompt (shared, cacheable)

```
You are a science communicator for the US Muon Collider Collaboration
(USMCC). You translate physics papers into accurate, engaging publicity
copy for non-expert audiences.

Rules you NEVER break:
- Use only facts present in the inputs. Do not invent results, numbers,
  collaborators, or affiliations.
- Credit the author list or collaboration exactly as provided.
- No hype words ("revolutionary", "groundbreaking", "game-changing").
- No formulas, no LaTeX, no jargon left undefined for general audiences.
- Output only the requested text — no preamble, no explanation, no
  markdown fences.
```

### Per-channel user prompts

Each takes the parsed `PaperRow` and the user-selected tone. Example for
Twitter/X single post:

```
Write a single Twitter/X post publicizing this physics paper.

Constraints:
- ≤ 280 characters TOTAL including the link.
- End with the link: {link}
- At most one emoji, at most two hashtags (prefer #MuonCollider, #HEP).
- Tone: {tone}.
- Audience: science-curious general public.

Paper:
- Title: {title}
- Less technical title (optional): {plainTitle}
- Authors / Collaboration: {authors}
- Category: {category}
- Public abstract: {abstract}
- Author's additional notes: {comments}
```

Write analogous user prompts for `bluesky`, `linkedin`, `plainLanguage`,
and `twitterThread`. The thread prompt should ask for output as `1/`, `2/`,
… on separate lines, each ≤ 280 chars.

Use Claude's `system` parameter for the system prompt and put it in a
cacheable block (`cache_control: { type: "ephemeral" }`) so multi-channel
runs reuse the cache.

## 8. Settings, secrets, and first-run UX

- On first launch, if `keytar.getPassword('usmcc-publicity-helper', 'anthropic-api-key')` returns null, show the Settings modal immediately with a friendly "Add your Anthropic API key to get started" message and a link to `https://console.anthropic.com/`.
- The key never leaves the main process. The renderer only ever sees a boolean `hasApiKey`.
- "Test" button in settings sends a 5-token `messages.create` request and reports success/failure.

## 9. Testing

- **Unit:** `vitest` on `parseRow` (see §6 step 3). Aim for ~8 cases.
- **Manual smoke test fixture:** commit `test/fixtures/sample-row.txt` with a realistic synthetic row (made-up authors/abstract — do NOT use real submissions). Document in README how to use it.
- No e2e/Playwright setup — overkill for this app.

## 10. Out of scope (do not build)

- Bulk processing of multiple rows.
- Direct posting to Twitter/Bluesky/LinkedIn APIs (user copy-pastes).
- Image generation / figure handling.
- Multi-user accounts, cloud sync, analytics.
- Auto-update.
- Windows/Linux builds. macOS only.

## 11. Definition of done

- `npm start` opens the dev app and a paste → generate → copy round-trip works against the live Claude API.
- `npm run make` produces `out/USMCC Publicity Helper-darwin-arm64/USMCC Publicity Helper.app` (and x64 if built on Intel) that runs from Finder.
- `npm test` passes.
- README explains: install, add API key, paste row, generate, copy. Includes the Gatekeeper bypass note.
- All five channels produce output that respects the constraints in §3 for the sample fixture.

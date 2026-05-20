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
| Shell | **Tauri 2** | Produces a small, real `.app` bundle (~10 MB vs. Electron's ~100 MB). Uses the system WebView (WKWebView on macOS) so it feels native. Rust backend keeps secrets and HTTP off the WebView. |
| Frontend language | **TypeScript** + **React 18** + **Vite** | Standard frontend; Tauri's `create-tauri-app` ships a `react-ts` template. |
| Backend language | **Rust** | Required by Tauri. Used only for a handful of `#[tauri::command]` functions — no business logic of consequence lives here. |
| Styling | Plain CSS modules or Tailwind. No component library needed — this is a 3-screen app. |
| HTTP / AI | **`reqwest`** (async, JSON) from Rust commands. There is no official Anthropic Rust SDK; calling `POST https://api.anthropic.com/v1/messages` directly is straightforward and keeps the API key out of the WebView. Do NOT enable Tauri's HTTP allowlist for the renderer. |
| Model | `claude-sonnet-4-6` by default; expose a dropdown to pick `claude-opus-4-7` for higher-quality runs. |
| Secret storage | **`keyring`** crate (Rust) — stores the Anthropic API key in the macOS Keychain. Service `com.usmcc.publicity-helper`, account `anthropic-api-key`. |
| Non-secret prefs | **`tauri-plugin-store`** — JSON store for last-used model, last tone, window size. Lives under `~/Library/Application Support/com.usmcc.publicity-helper/`. |
| IPC | Tauri `invoke()` from the renderer → `#[tauri::command]` in Rust. Commands: `parse_row`, `generate`, `get_api_key_status`, `set_api_key`, `test_api_key`, `get_prefs`, `set_prefs`. |
| Packaging | `npm run tauri build` produces `src-tauri/target/release/bundle/macos/USMCC Publicity Helper.app` and a `.dmg`. No code signing required for personal use; document the Gatekeeper bypass (`xattr -d com.apple.quarantine`) in README. For universal binary, build on Apple Silicon with `--target universal-apple-darwin` after `rustup target add x86_64-apple-darwin aarch64-apple-darwin`. |

Do **not** add: a backend server, a database, auth, telemetry, or any
non-essential dependency. This is a single-user local tool. Do **not**
enable Tauri's HTTP, shell, or fs plugins for the renderer — the renderer
should only be able to call the explicit commands listed above.

## 5. Project structure

```
USMCCPaperPublicityHelper/
├── PLAN.md                       (this file)
├── README.md                     (short user-facing intro; points at PLAN.md)
├── package.json                  (frontend deps + tauri CLI)
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/                          (React frontend)
│   ├── main.tsx                  (React entry)
│   ├── App.tsx                   (top-level layout)
│   ├── api.ts                    (thin wrappers around tauri `invoke(...)`)
│   ├── components/
│   │   ├── InputPanel.tsx        (paste box + parsed-fields preview + Generate button)
│   │   ├── OutputCard.tsx        (one per channel; copy button, char counter)
│   │   ├── Settings.tsx          (API key, model selector, default tone)
│   │   └── ErrorBanner.tsx
│   ├── types.ts                  (PaperRow, Channel, GenerateRequest, GenerateResponse — must match Rust serde shapes)
│   └── styles.css
├── src-tauri/                    (Rust backend)
│   ├── Cargo.toml
│   ├── tauri.conf.json           (bundle identifier, window size, allowlist)
│   ├── build.rs
│   ├── icons/                    (icon.icns + smaller PNGs, generated by `tauri icon`)
│   └── src/
│       ├── main.rs               (entry — registers commands and plugins)
│       ├── commands.rs           (#[tauri::command] fns: parse_row, generate, get_api_key_status, set_api_key, test_api_key, get_prefs, set_prefs)
│       ├── parse_row.rs          (TSV parser + PaperRow struct with serde)
│       ├── anthropic.rs          (reqwest client; one fn per channel; parallel via tokio::join!)
│       ├── prompts.rs            (prompt templates — see §7)
│       └── settings.rs           (keyring wrapper for the API key)
└── tests/                        (Rust integration tests)
    ├── parse_row.rs              (cargo test — covers §2 parsing rules)
    └── fixtures/
        └── sample_row.txt
```

Type sharing: define `PaperRow` in Rust with `#[derive(Serialize, Deserialize)]`
and mirror it manually in `src/types.ts`. Add a comment in both files pointing
at the other. (Optional: `ts-rs` crate to autogenerate the TS types, but only
add it if it pays for itself.)

## 6. Implementation steps (in order)

Do these in sequence; each step should leave the app runnable.

Prerequisites (one-time): `rustup` installed and `rustc` ≥ 1.77, Node ≥ 20,
Xcode Command Line Tools. Verify with `rustc --version && node --version`.

1. **Scaffold.** `npm create tauri-app@latest -- --template react-ts --identifier com.usmcc.publicity-helper --manager npm` into a temp dir, then move the generated files into the repo root (preserving `PLAN.md` and `README.md`). Verify `npm run tauri dev` opens a blank window.
2. **Configure bundle.** In `src-tauri/tauri.conf.json`: set `productName: "USMCC Publicity Helper"`, `identifier: "com.usmcc.publicity-helper"`, window `width: 1100`, `height: 750`, `titleBarStyle: "Overlay"` (or `"Transparent"` for the hidden-inset look), `minWidth: 900`, `minHeight: 600`. Set bundle `category: "public.app-category.productivity"`. Add macOS `entitlements` and `minimumSystemVersion: "11.0"`.
3. **Type definitions.** Create `src/types.ts` with `PaperRow`, `Channel` (`'twitter' | 'twitterThread' | 'bluesky' | 'linkedin' | 'plainLanguage'`), `GenerateRequest`, `GenerateResponse`. Mirror in `src-tauri/src/parse_row.rs` with `#[derive(Serialize, Deserialize)]` and `#[serde(rename_all = "camelCase")]` so JSON keys match the TS side.
4. **Parser.** Implement `parse_row(text: &str) -> Result<PaperRow, ParseError>` in `src-tauri/src/parse_row.rs` per §2. Add `tests/parse_row.rs` with cases: bare row, row + header, quoted multi-line abstract, missing trailing cells, missing required cells. Expose as `#[tauri::command] fn parse_row(text: String) -> Result<PaperRow, String>` so the renderer can preview the parse live.
5. **Settings + Keychain.** Add `keyring = "3"` to `Cargo.toml`. In `src-tauri/src/settings.rs`, implement `get_api_key`, `set_api_key`, `delete_api_key` using `keyring::Entry::new("com.usmcc.publicity-helper", "anthropic-api-key")`. Expose `get_api_key_status() -> bool`, `set_api_key(key: String) -> Result<(), String>`, `test_api_key() -> Result<(), String>`. The renderer must NEVER receive the raw key — only the status boolean.
6. **Prefs store.** Add `tauri-plugin-store` to `Cargo.toml` and register it in `main.rs`. Add `get_prefs` / `set_prefs` commands that read/write a `prefs.json` (keys: `model`, `tone`, `channelsEnabled`).
7. **Anthropic client.** Add `reqwest = { version = "0.12", features = ["json", "rustls-tls"] }`, `serde_json`, `tokio = { features = ["macros", "rt-multi-thread"] }`. In `src-tauri/src/anthropic.rs`, implement one async fn per channel taking `(&PaperRow, &str /*tone*/, &str /*model*/, &str /*api_key*/)` and returning `Result<String, AnthropicError>`. Each posts to `https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`. Use `tokio::join!` to fan out the selected channels in parallel. Max tokens: 800 for Twitter/Bluesky, 1200 for LinkedIn/plain-language, 1500 for the thread. Temperature 0.7. Use a prompt-caching block on the shared system prompt: `{"type": "text", "text": "...", "cache_control": {"type": "ephemeral"}}`.
8. **Generate command.** `#[tauri::command] async fn generate(row: PaperRow, channels: Vec<Channel>, model: String, tone: String) -> GenerateResponse`. Return per-channel `Result<String, String>` so one failure doesn't kill the others. Read the API key from keyring inside this command — never accept it from the renderer.
9. **InputPanel.** Big textarea ("Paste row from Google Sheet here"). On every change, call `invoke('parse_row', { text })` and render a small read-only preview of the parsed title, authors, category, and abstract so the user can confirm it parsed correctly. Show inline validation for missing title/abstract. Generate button is disabled until parsing succeeds and `get_api_key_status` returns true.
10. **OutputCards.** One `OutputCard` per channel showing: channel name, generated text in a `<textarea readOnly>`, character count vs. the channel's limit (red if over), and a Copy button (use the Tauri clipboard plugin: `@tauri-apps/plugin-clipboard-manager`, or `navigator.clipboard.writeText` since macOS WKWebView supports it). While generating, show a skeleton/spinner per card. If one channel fails, show its error in just that card.
11. **Settings screen.** Modal route. Fields: Anthropic API key (password input, masked, with a "Test" button that calls `test_api_key`), default model (`claude-sonnet-4-6` / `claude-opus-4-7`), default tone (`Neutral` / `Enthusiastic` / `Formal`), channels enabled. Persist via `set_prefs` and `set_api_key`.
12. **Icon.** Drop a 1024×1024 PNG at `src-tauri/icons/icon.png` (a muon-symbol placeholder is fine), then run `npm run tauri icon src-tauri/icons/icon.png` to generate the full icon set including `.icns`.
13. **Packaging.** `npm run tauri build`. Confirm `src-tauri/target/release/bundle/macos/USMCC Publicity Helper.app` and `src-tauri/target/release/bundle/dmg/*.dmg` exist. Document the first-run Gatekeeper bypass in README.
14. **Smoke test.** Open the packaged `.app` from Finder. Paste a sample row (provide one in `tests/fixtures/sample_row.txt`). Generate. Verify all five channels return text and Copy buttons work.

## 7. Prompt templates

Keep all prompts in `src-tauri/src/prompts.rs` as plain functions returning
`String` — **do not** build prompts in the renderer. All prompts share a
`SYSTEM_PROMPT` constant that pins context once so prompt caching works
across the parallel per-channel requests.

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

- On first launch, if `get_api_key_status()` returns `false`, show the Settings modal immediately with a friendly "Add your Anthropic API key to get started" message and a link to `https://console.anthropic.com/`.
- The key is stored in the macOS Keychain via the `keyring` crate. The renderer only ever sees a boolean (`hasApiKey`) — there is no `get_api_key` command exposed to the renderer.
- "Test" button in settings invokes `test_api_key`, which sends a 5-token request to `/v1/messages` and reports success/failure.

## 9. Testing

- **Unit (Rust):** `cargo test` covers `parse_row` (see §6 step 4). Aim for ~8 cases. Run from `src-tauri/` or with `cargo test --manifest-path src-tauri/Cargo.toml`.
- **Manual smoke test fixture:** commit `tests/fixtures/sample_row.txt` with a realistic synthetic row (made-up authors/abstract — do NOT use real submissions). Document in README how to use it.
- No e2e setup (no Playwright, no WebDriver) — overkill for this app.

## 10. Out of scope (do not build)

- Bulk processing of multiple rows.
- Direct posting to Twitter/Bluesky/LinkedIn APIs (user copy-pastes).
- Image generation / figure handling.
- Multi-user accounts, cloud sync, analytics.
- Auto-update.
- Windows/Linux builds. macOS only.

## 11. Definition of done

- `npm run tauri dev` opens the dev app and a paste → generate → copy round-trip works against the live Claude API.
- `npm run tauri build` produces `src-tauri/target/release/bundle/macos/USMCC Publicity Helper.app` and a `.dmg`, and the `.app` runs from Finder.
- `cargo test --manifest-path src-tauri/Cargo.toml` passes.
- README explains: install Rust + Node, run dev, add API key, paste row, generate, copy. Includes the Gatekeeper bypass note (`xattr -d com.apple.quarantine "/Applications/USMCC Publicity Helper.app"`).
- All five channels produce output that respects the constraints in §3 for the sample fixture.

# USMCC Publicity Helper — notes for working on this repo

Turns a USMCC paper into an image carousel and social posts. Built on
Brackit's structure: a Rust server (`src-tauri/`) serves a plain HTML/CSS/JS
UI (`web/`, embedded into the binary), wrapped in a Tauri window. See
README.md.

## Build and test

```bash
cargo test --no-default-features --manifest-path src-tauri/Cargo.toml   # paper.rs unit tests
npm run build:cli      # terminal-only binary used by the tests
npm test               # server tests (black-box)
npm run test:ui        # editor + Lite in headless Chromium (see below)
```

`npm run samples` renders carousels from real muon collider papers
(`tests/fixtures/papers.tsv`) in every theme onto one contact sheet
(`build/samples/contact.png`): look at it after any change to themes,
layout or type.

`npm start` serves the UI in a browser. `npm run app` runs the Tauri app.
`npm run lite` builds Lite into build/lite and serves it. Locally,
`CHROMIUM_PATH=/path/to/chrome` makes the UI tests use an installed Chromium.

## Key presses must paint within 50 ms

Flipping slides and moving a layer with the arrows must change the screen
within **50 ms**. `test/ui/editor.test.js` enforces it with the Event Timing
API. If it fails, fix the regression rather than raising the budget.

- Renders are coalesced to one per animation frame (`requestRender`).
- Image adjustments (brightness etc., quarter turns, mirroring) are baked
  off the input path at preview size (`Render.picture`); only exports bake
  full size synchronously (`{ full: true }`).
- Slide thumbnails redraw after a pause (`dirtyThumbs`), never in the key path.

## Layout

- `src-tauri/src/`: `server.rs` (HTTP API, storage in `~/.usmcc` or
  `$USMCC_HOME`, exports, arXiv, Claude), `paper.rs` (sheet rows, arXiv ids,
  figures from a paper's source, post drafts, prompts; **no I/O**, shared with
  WASM), `gui.rs` (Tauri window + Mac menu bar), `main.rs` (`--serve`).
- `web/`: `render.js` (themes and the one slide renderer used for the stage,
  thumbnails, theme previews and exports), `app.js` (state, undo, stage,
  gestures, inspector, slide strip, imports, keys and `MENU`), `sheets.js`
  (paper, PDF pages, figures, posts, export, carousels, theme, menu, keys),
  `lite.js` (Lite only), `vendor/` (pdf.js legacy build, qrcode.js),
  `img/` (logos), `fonts/` (Google Fonts, OFL, fetched by
  `scripts/fetch-fonts.mjs`; never link fonts.googleapis.com: the app must
  work offline and the canvas needs fonts loaded before it measures).
- **Lite** (the web version, `/lite/` on the website): the same `web/` page
  plus `web/lite.js`, which answers every `/api` request in the browser
  (IndexedDB, direct arXiv fetches) and `paper.rs` compiled to WebAssembly
  (`lite/wasm`). Built by `scripts/build-lite.mjs`. Code in `web/` must keep
  working there: talk to the server only through `/api` with `fetch`.
  Desktop-only features check `LITE` / `S.info` and hide with `.full-only`.
- `site/`: the Hugo website (deployed by `.github/workflows/pages.yml`).
- `test/`: server tests; `test/ui/` editor and Lite tests.

## Rules the code relies on

- **The API only accepts changes from the app's own page.** Every non-GET
  request sends `X-USMCC: 1` (the `api()` helper does); a foreign `Origin`
  or `Host` is refused. Keep it that way for any new endpoint.
- **Assets are named by a hash of their bytes**; carousels reference them by
  id. Deleting a carousel garbage-collects unreferenced assets (older than
  ten minutes).
- **Exports write `.name.partial` and rename**; same name and size = skipped.
- **The Claude API key never reaches the page.** It lives in the keychain
  (or `ANTHROPIC_API_KEY`); the server makes the request. Lite has no Claude.
- **Slides are 1080 px wide**; every coordinate is in slide pixels. Body text
  is ≥ 40 px (it shows at a third of that on a phone).
- **Text drawn on a canvas needs its font loaded**: `Render.fontsReady` /
  `slideReady` before exporting; layout is re-measured on `loadingdone`.
- **Carousels flow across slides.** The theme backdrop (`drawBackdrop`) and
  `doc.bg` (background pictures, in carousel coordinates: x runs over all
  slides) are drawn per slide as that slide's window, so slides meet without
  a seam. Never add per-slide gradients or vignettes; `test/ui` checks the
  edges match. `shade` layers are legacy and not drawn.
- **Auto-placed text has `flow`** (`reflow` in app.js stacks it per theme and
  fits titles); moving it by hand drops `flow` for its group.

## Conventions

- The slides are the content: minimal chrome, one accent colour (a cool blue
  = selected / primary action; no amber, cream or purple: it must not look
  like an AI product), Tufte-style data displays (the contrast scale
  and the post-length gauges: hairline axes, direct labels, no chart junk).
- Every tool needs a key and an entry in `MENU` (`web/app.js`) and in the Mac
  menu bar (`src-tauri/src/gui.rs`); a UI test checks this.
- Touch matters as much as keys: anything new must work on a phone (Lite).

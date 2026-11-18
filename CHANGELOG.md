# Changelog

## Unreleased

**A visual overhaul, tested on real muon collider papers**
- Google Fonts, kept in the app (works offline): each theme has its own
  pairing (Fraunces, Bricolage Grotesque, Anton, Manrope, Newsreader, IBM
  Plex), and a font picker in the text panel. The interface uses Inter.
- Type sized for phones; long titles shrink to fit; a bigger logo.
- Figure slides: a "Figure n" label, the picture on a card, the caption
  from the paper's own TeX source, the logo. Figures come in reading order.
- A QR code to the paper on the closing slide.
- Paste an arXiv link and the desktop app fills in the title, authors, date
  and abstract. LaTeX in titles and abstracts becomes readable text.
- Summaries no longer break at "U.S." or "e.g.".
- A new interface look: icons, quieter controls, a start screen with three
  ways in; on phones the properties panel stays out of the way.
- `npm run samples`: carousels from six real papers on one contact sheet.

## 0.2.0

**A carousel editor, on a computer and a phone**
- Rebuilt on Brackit's structure: a small Rust program serving a plain
  HTML/JS page in a Tauri window, with downloads for macOS (Apple silicon and
  Intel), Windows and Linux.
- **Lite**, the same app in the browser at
  lawrenceleejr.github.io/USMCCPaperPublicityHelper/lite/: nothing to
  install, works on phones, offline from the home screen; nothing uploaded.
- Slides of photos, plots, PDF pages and arXiv figures, with text, the USMCC
  logo and six themes in three sizes (4:5, square, 9:16).
- Move, resize, turn, crop and zoom, adjust brightness, contrast, saturation
  and warmth, spread a photo across slides; by mouse, keys or touch.
- "Make slides" builds a cover, summary and closing slide from the paper's row.
- Export JPEG or PNG slides, or one PDF for LinkedIn; on phones straight to
  Photos through the share sheet.
- A contrast check for text over photos.
- Every carousel is kept, with undo.

**Posts**
- Drafts for X (and a thread), Bluesky, LinkedIn, a plain-language summary
  and the website's `index.md`, with length gauges. Drafts from the paper now
  keep the link whole.
- Writing them with Claude (desktop): one request, Claude Opus 5.5 by default.

**Replaced**
- The React/Vite app and its Instagram designer. The themes carry over.

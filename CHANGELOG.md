# Changelog

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

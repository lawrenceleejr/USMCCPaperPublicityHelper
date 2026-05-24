import { useEffect, useRef, useState } from "react";
import type { PaperRow, GeneratedContent, Preferences } from "./types";
import { generate, getPrefs, openExternal, setPrefs } from "./api";
import InputPanel from "./components/InputPanel";
import OutputCard from "./components/OutputCard";
import ErrorBanner from "./components/ErrorBanner";
import Settings from "./components/Settings";
import InstagramDesigner from "./components/InstagramDesigner";
import type { InstagramDesignerHandle } from "./components/InstagramDesigner";
import usmccLogo from "./assets/LogoUSMCC_circles.png";

type DraftPlatform = "twitter" | "bluesky" | "linkedin";

async function copyImageDataUrlToClipboard(dataUrl: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob();
  // Clipboard.write requires a user gesture, which a button click satisfies.
  // WKWebView on macOS supports image/png ClipboardItems.
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

const DEFAULT_PREFS: Preferences = {
  model: "claude-sonnet-4-5",
  includeThread: false,
  useClaude: false,
};

function safeYamlString(value: string): string {
  return value.replace(/'/g, "''").replace(/\r?\n/g, " ").trim();
}

function guessDate(row: PaperRow): string {
  const publication = row.publicationDate.trim();
  const timestamp = row.timestamp.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(publication)) return publication.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(timestamp)) return timestamp.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function buildHugoMarkdown(row: PaperRow, bodyText: string): string {
  const title = row.plainTitle.trim() || row.paperTitle.trim();
  const date = guessDate(row);
  const sourceLabel = row.category.trim() ? `${row.category}, ${date}` : `USMCC, ${date}`;
  const externalUrl = row.paperLink.trim();
  const body = bodyText.trim() || row.publicAbstract.trim();
  return `---
title: '${safeYamlString(title)}'
description: '${safeYamlString(sourceLabel)}'
externalUrl: '${safeYamlString(externalUrl)}'
date: '${date}'
showDate: true
cascade:
  showReadingTime: false
---

${body}
`;
}

export default function App() {
  const [prefs, setPrefsState] = useState<Preferences>(DEFAULT_PREFS);
  const [parsedRow, setParsedRow] = useState<PaperRow | null>(null);
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [model, setModel] = useState(DEFAULT_PREFS.model);
  const [includeThread, setIncludeThread] = useState(DEFAULT_PREFS.includeThread);
  const [useClaude, setUseClaude] = useState(DEFAULT_PREFS.useClaude);
  const designerRef = useRef<InstagramDesignerHandle | null>(null);

  useEffect(() => {
    getPrefs()
      .then((p) => {
        setPrefsState(p);
        setModel(p.model);
        setIncludeThread(p.includeThread);
        setUseClaude(p.useClaude);
      })
      .catch(() => {});
  }, []);

  async function handleGenerate() {
    if (!parsedRow) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await generate(parsedRow, model, includeThread, useClaude);
      setContent(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function handlePrefsChange(p: Preferences) {
    setPrefsState(p);
    setModel(p.model);
    setIncludeThread(p.includeThread);
    setUseClaude(p.useClaude);
    await setPrefs(p).catch(() => {});
  }

  async function handleOpenDraft(platform: DraftPlatform, text: string): Promise<string | null> {
    // Render pane 1 of the Instagram carousel and put it on the system
    // clipboard so the user can ⌘V the image into the compose window.
    let imageOnClipboard = false;
    try {
      const png = await designerRef.current?.renderFirstPanePng();
      if (png) {
        await copyImageDataUrlToClipboard(png);
        imageOnClipboard = true;
      }
    } catch {
      // Continue without image — the post URL still gets opened.
    }

    let url: string;
    let textOnClipboard = false;
    switch (platform) {
      case "twitter":
        url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
        break;
      case "bluesky":
        url = `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`;
        break;
      case "linkedin":
        // LinkedIn has no reliable text-prefill URL, so put the text on the
        // clipboard (overriding the image, since clipboard holds one item)
        // and open the feed where the user starts a new post.
        try {
          await navigator.clipboard.writeText(text);
          textOnClipboard = true;
          imageOnClipboard = false;
        } catch {
          // ignore — user still has the Copy button
        }
        url = "https://www.linkedin.com/feed/";
        break;
    }
    try {
      await openExternal(url);
    } catch (e) {
      return `Could not open browser: ${e}`;
    }

    if (platform === "linkedin") {
      return textOnClipboard
        ? "Text copied to clipboard. After LinkedIn opens, click “Start a post”, paste the text, then come back and click Copy here again — this time it will hold the carousel image to paste."
        : "LinkedIn opened. Use the Copy button to grab the text, then paste it in the compose dialog.";
    }
    return imageOnClipboard
      ? "Image on clipboard — paste it with ⌘V in the compose window."
      : "Browser opened. Render the carousel first to get the image on the clipboard.";
  }

  function handleExportMarkdown() {
    if (!parsedRow) return;
    const summary = content?.plainSummary || parsedRow.publicAbstract;
    const markdown = buildHugoMarkdown(parsedRow, summary);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "index.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app">
      <header data-tauri-drag-region>
        <div className="header-actions" data-tauri-drag-region>
          <div className="header-brand" data-tauri-drag-region>
            <img src={usmccLogo} alt="USMCC logo" className="app-logo" data-tauri-drag-region />
            <div data-tauri-drag-region>
              <h1 data-tauri-drag-region>USMCC Publicity Helper</h1>
              <p data-tauri-drag-region>Generate social media content from paper submissions</p>
            </div>
          </div>
          <button className="btn-secondary" onClick={() => setShowSettings(true)}>
            ⚙ Settings
          </button>
        </div>
      </header>

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      <InputPanel
        onParsed={setParsedRow}
        onError={setError}
        model={model}
        includeThread={includeThread}
        useClaude={useClaude}
        onModelChange={setModel}
        onIncludeThreadChange={setIncludeThread}
        onUseClaudeChange={setUseClaude}
        onGenerate={handleGenerate}
        generating={generating}
      />

      {parsedRow && (
        <div className="export-toolbar">
          <button className="btn-secondary" onClick={handleExportMarkdown}>
            Export Hugo Markdown (index.md)
          </button>
        </div>
      )}

      {content && (
        <div className="output-section">
          {parsedRow && (
            <InstagramDesigner
              ref={designerRef}
              eyebrowText="USMCC Featured Paper"
              titleText={parsedRow.plainTitle || parsedRow.paperTitle}
              descriptionText={content.plainSummary || parsedRow.publicAbstract}
              authorsText={parsedRow.authors}
              paperLink={parsedRow.paperLink}
            />
          )}
          <OutputCard
            title="Twitter / X Post"
            content={content.twitter}
            maxChars={280}
            logoSrc={usmccLogo}
            draftAction={{
              label: "X",
              handler: () => handleOpenDraft("twitter", content.twitter),
            }}
          />
          {content.twitterThread && (
            <OutputCard
              title="Twitter / X Thread"
              content={content.twitterThread}
              maxChars={280}
              logoSrc={usmccLogo}
              draftAction={{
                label: "X",
                handler: () =>
                  handleOpenDraft("twitter", content.twitterThread?.[0] ?? content.twitter),
              }}
            />
          )}
          <OutputCard
            title="Bluesky Post"
            content={content.bluesky}
            maxChars={300}
            logoSrc={usmccLogo}
            draftAction={{
              label: "Bluesky",
              handler: () => handleOpenDraft("bluesky", content.bluesky),
            }}
          />
          <OutputCard
            title="LinkedIn Post"
            content={content.linkedin}
            logoSrc={usmccLogo}
            draftAction={{
              label: "LinkedIn",
              handler: () => handleOpenDraft("linkedin", content.linkedin),
            }}
          />
          <OutputCard title="Plain-Language Summary" content={content.plainSummary} logoSrc={usmccLogo} />
        </div>
      )}

      {showSettings && (
        <Settings
          prefs={prefs}
          onPrefsChange={handlePrefsChange}
          onClose={() => setShowSettings(false)}
          onError={setError}
        />
      )}
    </div>
  );
}

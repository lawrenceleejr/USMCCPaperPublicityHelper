import { useState, useEffect } from "react";
import type { PaperRow, GeneratedContent, Preferences } from "./types";
import { generate, getPrefs, setPrefs } from "./api";
import InputPanel from "./components/InputPanel";
import OutputCard from "./components/OutputCard";
import ErrorBanner from "./components/ErrorBanner";
import Settings from "./components/Settings";
import InstagramDesigner from "./components/InstagramDesigner";
import usmccLogo from "./assets/LogoUSMCC_circles.png";

const DEFAULT_PREFS: Preferences = {
  model: "claude-sonnet-4-5",
  includeThread: false,
  useClaude: false,
};

function safeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ").trim();
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
title: "${safeYamlString(title)}"
description: "${safeYamlString(sourceLabel)}"
externalUrl: ${externalUrl}
date: "${date}"
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
      <header>
        <div className="header-actions">
          <div className="header-brand">
            <img src={usmccLogo} alt="USMCC logo" className="app-logo" />
            <div>
            <h1>USMCC Publicity Helper</h1>
            <p>Generate social media content from paper submissions</p>
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
          <OutputCard
            title="Twitter / X Post"
            content={content.twitter}
            maxChars={280}
            logoSrc={usmccLogo}
          />
          {content.twitterThread && (
            <OutputCard
              title="Twitter / X Thread"
              content={content.twitterThread}
              maxChars={280}
              logoSrc={usmccLogo}
            />
          )}
          <OutputCard
            title="Bluesky Post"
            content={content.bluesky}
            maxChars={300}
            logoSrc={usmccLogo}
          />
          <OutputCard title="LinkedIn Post" content={content.linkedin} logoSrc={usmccLogo} />
          <OutputCard title="Plain-Language Summary" content={content.plainSummary} logoSrc={usmccLogo} />

          {parsedRow && (
            <InstagramDesigner
              titleText={parsedRow.plainTitle || parsedRow.paperTitle}
              subtitleText={content.plainSummary}
              footerText={`${parsedRow.authors}${parsedRow.publicationDate ? ` · ${parsedRow.publicationDate}` : ""}`}
            />
          )}
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

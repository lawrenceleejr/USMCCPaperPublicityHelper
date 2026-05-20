import { useState, useEffect } from "react";
import type { PaperRow, GeneratedContent, Preferences } from "./types";
import { generate, getPrefs, setPrefs } from "./api";
import InputPanel from "./components/InputPanel";
import OutputCard from "./components/OutputCard";
import ErrorBanner from "./components/ErrorBanner";
import Settings from "./components/Settings";
import InstagramDesigner from "./components/InstagramDesigner";

const DEFAULT_PREFS: Preferences = {
  model: "claude-sonnet-4-5",
  includeThread: false,
};

export default function App() {
  const [prefs, setPrefsState] = useState<Preferences>(DEFAULT_PREFS);
  const [parsedRow, setParsedRow] = useState<PaperRow | null>(null);
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [model, setModel] = useState(DEFAULT_PREFS.model);
  const [includeThread, setIncludeThread] = useState(DEFAULT_PREFS.includeThread);

  useEffect(() => {
    getPrefs()
      .then((p) => {
        setPrefsState(p);
        setModel(p.model);
        setIncludeThread(p.includeThread);
      })
      .catch(() => {});
  }, []);

  async function handleGenerate() {
    if (!parsedRow) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await generate(parsedRow, model, includeThread);
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
    await setPrefs(p).catch(() => {});
  }

  return (
    <div className="app">
      <header>
        <div className="header-actions">
          <div>
            <h1>USMCC Publicity Helper</h1>
            <p>Generate social media content from paper submissions</p>
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
        onModelChange={setModel}
        onIncludeThreadChange={setIncludeThread}
        onGenerate={handleGenerate}
        generating={generating}
      />

      {content && (
        <div className="output-section">
          <OutputCard
            title="Twitter / X Post"
            content={content.twitter}
            maxChars={280}
          />
          {content.twitterThread && (
            <OutputCard
              title="Twitter / X Thread"
              content={content.twitterThread}
              maxChars={280}
            />
          )}
          <OutputCard
            title="Bluesky Post"
            content={content.bluesky}
            maxChars={300}
          />
          <OutputCard title="LinkedIn Post" content={content.linkedin} />
          <OutputCard title="Plain-Language Summary" content={content.plainSummary} />

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

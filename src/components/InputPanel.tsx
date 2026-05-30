import { useState } from "react";
import type { PaperRow } from "../types";
import { parseRow } from "../api";

interface Props {
  onParsed: (row: PaperRow) => void;
  onError: (msg: string) => void;
  model: string;
  includeThread: boolean;
  useClaude: boolean;
  onModelChange: (m: string) => void;
  onIncludeThreadChange: (v: boolean) => void;
  onUseClaudeChange: (v: boolean) => void;
  onGenerate: () => void;
  generating: boolean;
}

type Mode = "paste" | "manual";

const BLANK_ROW: PaperRow = {
  timestamp: "",
  email: "",
  paperTitle: "",
  plainTitle: "",
  authors: "",
  publicationDate: "",
  category: "",
  publicAbstract: "",
  paperLink: "",
  figuresOk: true,
  additionalComments: "",
};

export default function InputPanel({
  onParsed,
  onError,
  model,
  includeThread,
  useClaude,
  onModelChange,
  onIncludeThreadChange,
  onUseClaudeChange,
  onGenerate,
  generating,
}: Props) {
  const [mode, setMode] = useState<Mode>("paste");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<PaperRow | null>(null);
  const [parsing, setParsing] = useState(false);

  async function handleParse() {
    if (!text.trim()) return;
    setParsing(true);
    try {
      const row = await parseRow(text);
      setParsed(row);
      onParsed(row);
    } catch (e) {
      onError(String(e));
      setParsed(null);
    } finally {
      setParsing(false);
    }
  }

  function handleSwitchToManual() {
    setMode("manual");
    // Fire a blank row immediately so the Instagram designer appears
    // and the user can edit everything directly in the per-pane editor.
    const blank = { ...BLANK_ROW };
    setParsed(blank);
    onParsed(blank);
  }

  return (
    <div className="input-panel">
      <div className="input-mode-tabs">
        <button
          className={`input-mode-tab ${mode === "paste" ? "active" : ""}`}
          onClick={() => setMode("paste")}
          type="button"
        >
          Paste row
        </button>
        <button
          className={`input-mode-tab ${mode === "manual" ? "active" : ""}`}
          onClick={handleSwitchToManual}
          type="button"
        >
          Manual entry
        </button>
      </div>

      {mode === "paste" ? (
        <>
          <h2>Paste row from Google Sheet</h2>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste one tab-separated row (with or without header line)…"
            onPaste={() => setTimeout(handleParse, 50)}
          />
          <div className="input-controls">
            <button
              className="btn-secondary"
              onClick={handleParse}
              disabled={!text.trim() || parsing}
            >
              {parsing ? "Parsing…" : "Parse Row"}
            </button>
          </div>
        </>
      ) : (
        <p className="manual-hint">
          Manual mode — every field starts blank. Edit titles, text, authors and images directly
          in the Instagram designer below.
        </p>
      )}

      <div className="input-controls">
        <label>
          <input
            type="checkbox"
            checked={useClaude}
            onChange={(e) => onUseClaudeChange(e.target.checked)}
          />
          Use Claude for post/summary generation
        </label>

        <label>
          Model:
          <select value={model} onChange={(e) => onModelChange(e.target.value)} disabled={!useClaude}>
            <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
            <option value="claude-opus-4-5">claude-opus-4-5</option>
          </select>
        </label>

        <label>
          <input
            type="checkbox"
            checked={includeThread}
            onChange={(e) => onIncludeThreadChange(e.target.checked)}
          />
          Include X/Twitter thread
        </label>

        <button
          className="btn-primary"
          onClick={onGenerate}
          disabled={!parsed || generating}
          style={{ marginLeft: "auto" }}
        >
          {generating ? (
            <>
              <span className="spinner" />
              Generating…
            </>
          ) : (
            "Generate"
          )}
        </button>
      </div>

      {parsed && (parsed.plainTitle || parsed.paperTitle || parsed.authors) && (
        <div className="parsed-meta">
          <strong>{parsed.plainTitle || parsed.paperTitle}</strong>
          <span>
            {parsed.authors}
            {parsed.publicationDate ? ` · ${parsed.publicationDate}` : ""}
            {parsed.category ? ` · ${parsed.category}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

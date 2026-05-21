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

  return (
    <div className="input-panel">
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

      {parsed && (
        <div className="parsed-meta">
          <strong>{parsed.paperTitle}</strong>
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

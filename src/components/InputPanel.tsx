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

// Manual-entry form fields. We keep this struct flat so the form is trivially
// serialisable into a PaperRow when the user clicks "Use these values".
interface ManualForm {
  plainTitle: string;
  paperTitle: string;
  authors: string;
  publicAbstract: string;
  category: string;
  publicationDate: string;
  paperLink: string;
  additionalComments: string;
}

const EMPTY_MANUAL: ManualForm = {
  plainTitle: "",
  paperTitle: "",
  authors: "",
  publicAbstract: "",
  category: "",
  publicationDate: "",
  paperLink: "",
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
  const [manual, setManual] = useState<ManualForm>(EMPTY_MANUAL);
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

  function handleUseManual() {
    const row: PaperRow = {
      timestamp: "",
      email: "",
      paperTitle: manual.paperTitle.trim(),
      plainTitle: manual.plainTitle.trim(),
      authors: manual.authors.trim(),
      publicationDate: manual.publicationDate.trim(),
      category: manual.category.trim(),
      publicAbstract: manual.publicAbstract.trim(),
      paperLink: manual.paperLink.trim(),
      figuresOk: true,
      additionalComments: manual.additionalComments.trim(),
    };
    if (!row.plainTitle && !row.paperTitle) {
      onError("Enter at least a title (plain-language or paper title).");
      return;
    }
    setParsed(row);
    onParsed(row);
  }

  function updateManual<K extends keyof ManualForm>(key: K, value: ManualForm[K]) {
    setManual((prev) => ({ ...prev, [key]: value }));
  }

  const canUseManual =
    manual.plainTitle.trim() !== "" || manual.paperTitle.trim() !== "";

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
          onClick={() => setMode("manual")}
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
        <>
          <h2>Manual entry</h2>
          <p className="manual-hint">
            Fill in whatever you have. Plain-language title and abstract drive the Instagram
            graphic; the other fields feed Claude / Hugo export when present.
          </p>
          <div className="manual-form">
            <label className="manual-field">
              <span>Plain-language title</span>
              <input
                type="text"
                value={manual.plainTitle}
                onChange={(e) => updateManual("plainTitle", e.target.value)}
                placeholder="Short, public-friendly title shown on the graphic"
              />
            </label>
            <label className="manual-field">
              <span>Paper title</span>
              <input
                type="text"
                value={manual.paperTitle}
                onChange={(e) => updateManual("paperTitle", e.target.value)}
                placeholder="Formal / technical paper title"
              />
            </label>
            <label className="manual-field">
              <span>Authors</span>
              <input
                type="text"
                value={manual.authors}
                onChange={(e) => updateManual("authors", e.target.value)}
                placeholder="Comma-separated list"
              />
            </label>
            <label className="manual-field manual-field-wide">
              <span>Abstract / plain summary</span>
              <textarea
                rows={5}
                value={manual.publicAbstract}
                onChange={(e) => updateManual("publicAbstract", e.target.value)}
                placeholder="The blurb that drives the generated posts and the graphic description."
              />
            </label>
            <label className="manual-field">
              <span>Category</span>
              <input
                type="text"
                value={manual.category}
                onChange={(e) => updateManual("category", e.target.value)}
                placeholder="e.g. Detector, Accelerator"
              />
            </label>
            <label className="manual-field">
              <span>Date</span>
              <input
                type="text"
                value={manual.publicationDate}
                onChange={(e) => updateManual("publicationDate", e.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="manual-field manual-field-wide">
              <span>Paper link</span>
              <input
                type="text"
                value={manual.paperLink}
                onChange={(e) => updateManual("paperLink", e.target.value)}
                placeholder="https://arxiv.org/abs/…"
              />
            </label>
            <label className="manual-field manual-field-wide">
              <span>Comments</span>
              <input
                type="text"
                value={manual.additionalComments}
                onChange={(e) => updateManual("additionalComments", e.target.value)}
                placeholder="Optional notes from the submitter"
              />
            </label>
          </div>
          <div className="input-controls">
            <button
              className="btn-secondary"
              onClick={handleUseManual}
              disabled={!canUseManual}
              type="button"
            >
              Use these values
            </button>
          </div>
        </>
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

      {parsed && (
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

import { useState } from "react";

interface DraftAction {
  label: string;
  handler: () => Promise<string | null>;
}

interface Props {
  title: string;
  content: string | string[];
  maxChars?: number;
  logoSrc?: string;
  draftAction?: DraftAction;
}

function countChars(s: string): number {
  return [...s].length;
}

export default function OutputCard({ title, content, maxChars, logoSrc, draftAction }: Props) {
  const [copied, setCopied] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);

  const fullText = Array.isArray(content) ? content.join("\n\n") : content;

  async function handleCopy() {
    await navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleDraft() {
    if (!draftAction) return;
    setDraftBusy(true);
    setDraftStatus(null);
    try {
      const status = await draftAction.handler();
      if (status) setDraftStatus(status);
    } catch (e) {
      setDraftStatus(`Error: ${e}`);
    } finally {
      setDraftBusy(false);
      window.setTimeout(() => setDraftStatus(null), 6000);
    }
  }

  const charCount = countChars(fullText);
  const isOver = maxChars !== undefined && charCount > maxChars;

  return (
    <div className="output-card">
      <div className="output-card-header">
        <h3>
          {logoSrc && <img src={logoSrc} alt="" className="output-card-logo" aria-hidden="true" />}
          {title}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {maxChars !== undefined && (
            <span className={`char-count ${isOver ? "over" : ""}`}>
              {charCount}/{maxChars}
            </span>
          )}
          {draftAction && (
            <button
              className="btn-icon"
              onClick={handleDraft}
              disabled={draftBusy}
              title={`Open ${draftAction.label} with this text and the first carousel pane on the clipboard.`}
            >
              {draftBusy ? "Opening…" : `↗ Open in ${draftAction.label}`}
            </button>
          )}
          <button className="btn-icon" onClick={handleCopy}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>

      {draftStatus && <div className="output-card-status">{draftStatus}</div>}

      {Array.isArray(content) ? (
        <div>
          {content.map((tweet, i) => (
            <div key={i} className="thread-tweet">
              <div className="thread-index">
                {i + 1}/{content.length}
              </div>
              <pre>{tweet}</pre>
            </div>
          ))}
        </div>
      ) : (
        <pre>{content}</pre>
      )}
    </div>
  );
}

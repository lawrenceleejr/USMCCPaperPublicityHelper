import { useState } from "react";

interface Props {
  title: string;
  content: string | string[];
  maxChars?: number;
}

function countChars(s: string): number {
  return [...s].length;
}

export default function OutputCard({ title, content, maxChars }: Props) {
  const [copied, setCopied] = useState(false);

  const fullText = Array.isArray(content) ? content.join("\n\n") : content;

  async function handleCopy() {
    await navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const charCount = countChars(fullText);
  const isOver = maxChars !== undefined && charCount > maxChars;

  return (
    <div className="output-card">
      <div className="output-card-header">
        <h3>{title}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {maxChars !== undefined && (
            <span className={`char-count ${isOver ? "over" : ""}`}>
              {charCount}/{maxChars}
            </span>
          )}
          <button className="btn-icon" onClick={handleCopy}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>

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

import { useState, useEffect } from "react";
import type { Preferences, ApiKeyStatus } from "../types";
import { getApiKeyStatus, setApiKey, testApiKey, setPrefs } from "../api";

interface Props {
  prefs: Preferences;
  onPrefsChange: (p: Preferences) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}

export default function Settings({ prefs, onPrefsChange, onClose, onError }: Props) {
  const [apiKey, setApiKeyValue] = useState("");
  const [status, setStatus] = useState<ApiKeyStatus>("not_set");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getApiKeyStatus().then(setStatus).catch(() => {});
  }, []);

  async function handleSaveKey() {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await setApiKey(apiKey.trim());
      setStatus("set");
      setApiKeyValue("");
    } catch (e) {
      onError(`Failed to save API key: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const ok = await testApiKey();
      setTestResult(ok ? "✓ API key is valid" : "✗ API key is invalid");
    } catch (e) {
      setTestResult(`Error: ${e}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleSavePrefs() {
    try {
      await setPrefs(prefs);
      onClose();
    } catch (e) {
      onError(`Failed to save preferences: ${e}`);
    }
  }

  return (
    <div className="settings-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-panel">
        <h2>Settings</h2>

        <div className="settings-field">
          <label>Anthropic API Key</label>
          <input
            type="password"
            placeholder={status === "set" ? "••••••••••••••••" : "sk-ant-…"}
            value={apiKey}
            onChange={(e) => setApiKeyValue(e.target.value)}
          />
          <div className={`settings-status ${status === "set" ? "ok" : "missing"}`}>
            {status === "set" ? "✓ API key is stored" : "⚠ No API key stored"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button className="btn-secondary" onClick={handleSaveKey} disabled={!apiKey.trim() || saving}>
            {saving ? "Saving…" : "Save Key"}
          </button>
          <button className="btn-secondary" onClick={handleTest} disabled={status !== "set" || testing}>
            {testing ? "Testing…" : "Test Key"}
          </button>
          {testResult && (
            <span style={{ fontSize: 13, alignSelf: "center" }}>{testResult}</span>
          )}
        </div>

        <div className="settings-field">
          <label>Default Model</label>
          <select
            value={prefs.model}
            onChange={(e) => onPrefsChange({ ...prefs, model: e.target.value })}
          >
            <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
            <option value="claude-opus-4-5">claude-opus-4-5</option>
          </select>
        </div>

        <div className="settings-field">
          <label style={{ flexDirection: "row", gap: 8, display: "flex", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={prefs.includeThread}
              onChange={(e) => onPrefsChange({ ...prefs, includeThread: e.target.checked })}
            />
            Include X/Twitter thread by default
          </label>
        </div>

        <div className="settings-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSavePrefs}>Save & Close</button>
        </div>
      </div>
    </div>
  );
}

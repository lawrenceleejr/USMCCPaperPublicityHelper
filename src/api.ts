import { invoke } from "@tauri-apps/api/core";
import type {
  PaperRow,
  GeneratedContent,
  Preferences,
  ApiKeyStatus,
} from "./types";

export async function parseRow(text: string): Promise<PaperRow> {
  return invoke<PaperRow>("parse_row", { text });
}

export async function generate(
  row: PaperRow,
  model: string,
  includeThread: boolean
): Promise<GeneratedContent> {
  return invoke<GeneratedContent>("generate", { row, model, includeThread });
}

export async function getApiKeyStatus(): Promise<ApiKeyStatus> {
  return invoke<ApiKeyStatus>("get_api_key_status");
}

export async function setApiKey(key: string): Promise<void> {
  return invoke<void>("set_api_key", { key });
}

export async function testApiKey(): Promise<boolean> {
  return invoke<boolean>("test_api_key");
}

export async function getPrefs(): Promise<Preferences> {
  return invoke<Preferences>("get_prefs");
}

export async function setPrefs(prefs: Preferences): Promise<void> {
  return invoke<void>("set_prefs", { prefs });
}

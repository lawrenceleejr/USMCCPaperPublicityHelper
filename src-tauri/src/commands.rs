use serde::{Deserialize, Serialize};

use crate::anthropic;
use crate::parse_row::{self, PaperRow};
use crate::prompts;
use crate::settings;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedContent {
    pub twitter: String,
    pub twitter_thread: Option<Vec<String>>,
    pub bluesky: String,
    pub linkedin: String,
    pub plain_summary: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub model: String,
    pub include_thread: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            model: "claude-sonnet-4-5".to_string(),
            include_thread: false,
        }
    }
}

#[tauri::command]
pub fn parse_row(text: String) -> Result<PaperRow, String> {
    parse_row::parse_row(&text)
}

#[tauri::command]
pub async fn generate(
    row: PaperRow,
    model: String,
    include_thread: bool,
) -> Result<GeneratedContent, String> {
    let api_key = settings::get_api_key()
        .ok_or_else(|| "No API key set. Please add your Anthropic API key in Settings.".to_string())?;

    let title = &row.paper_title;
    let display_title = if row.plain_title.is_empty() {
        title.as_str()
    } else {
        row.plain_title.as_str()
    };
    let authors = &row.authors;
    let abstract_ = &row.public_abstract;
    let link = &row.paper_link;
    let system = prompts::SYSTEM_PROMPT;

    let twitter = anthropic::call_claude(
        &api_key,
        &model,
        system,
        &prompts::twitter_prompt(display_title, authors, abstract_, link),
        300,
    )
    .await?;

    let twitter_thread = if include_thread {
        let raw = anthropic::call_claude(
            &api_key,
            &model,
            system,
            &prompts::twitter_thread_prompt(display_title, authors, abstract_, link),
            1000,
        )
        .await?;
        Some(parse_thread(&raw))
    } else {
        None
    };

    let bluesky = anthropic::call_claude(
        &api_key,
        &model,
        system,
        &prompts::bluesky_prompt(display_title, authors, abstract_, link),
        350,
    )
    .await?;

    let linkedin = anthropic::call_claude(
        &api_key,
        &model,
        system,
        &prompts::linkedin_prompt(display_title, authors, abstract_, link),
        600,
    )
    .await?;

    let plain_summary = anthropic::call_claude(
        &api_key,
        &model,
        system,
        &prompts::plain_summary_prompt(display_title, authors, abstract_),
        500,
    )
    .await?;

    Ok(GeneratedContent {
        twitter,
        twitter_thread,
        bluesky,
        linkedin,
        plain_summary,
    })
}

fn parse_thread(raw: &str) -> Vec<String> {
    // Split on blank lines; each non-empty block is a tweet
    let tweets: Vec<String> = raw
        .split("\n\n")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if tweets.is_empty() {
        vec![raw.trim().to_string()]
    } else {
        tweets
    }
}

#[tauri::command]
pub fn get_api_key_status() -> String {
    if settings::has_api_key() {
        "set".to_string()
    } else {
        "not_set".to_string()
    }
}

#[tauri::command]
pub fn set_api_key(key: String) -> Result<(), String> {
    settings::set_api_key(&key)
}

#[tauri::command]
pub async fn test_api_key() -> bool {
    if let Some(key) = settings::get_api_key() {
        anthropic::test_connection(&key).await
    } else {
        false
    }
}

#[tauri::command]
pub fn get_prefs(app: tauri::AppHandle) -> Preferences {
    use tauri_plugin_store::StoreExt;
    let store = app.store("prefs.json");
    match store {
        Ok(s) => {
            let model = s
                .get("model")
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_else(|| "claude-sonnet-4-5".to_string());
            let include_thread = s
                .get("includeThread")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            Preferences {
                model,
                include_thread,
            }
        }
        Err(_) => Preferences::default(),
    }
}

#[tauri::command]
pub fn set_prefs(app: tauri::AppHandle, prefs: Preferences) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store("prefs.json")
        .map_err(|e| e.to_string())?;
    store.set("model", serde_json::json!(prefs.model));
    store.set("includeThread", serde_json::json!(prefs.include_thread));
    store.save().map_err(|e| e.to_string())
}

// Unused import suppression
#[allow(dead_code)]
fn _placeholder() {}

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
    pub use_claude: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            model: "claude-sonnet-4-5".to_string(),
            include_thread: false,
            use_claude: false,
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
    use_claude: bool,
) -> Result<GeneratedContent, String> {
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

    if use_claude {
        let api_key = settings::get_api_key()
            .ok_or_else(|| "No API key set. Please add your Anthropic API key in Settings.".to_string())?;

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
    } else {
        let plain_summary = normalize_whitespace(abstract_);
        let twitter = trim_to_chars(
            &normalize_whitespace(&format!("{display_title}: {abstract_} {link}")),
            280,
        );
        let bluesky = trim_to_chars(
            &normalize_whitespace(&format!("{display_title}: {abstract_} {link}")),
            300,
        );

        let linkedin = normalize_whitespace(&format!(
            "{display_title}. Authors: {authors}. {abstract_} {}",
            if link.trim().is_empty() {
                String::new()
            } else {
                format!("Link: {link}")
            }
        ));

        let twitter_thread = if include_thread {
            let mut parts = Vec::new();
            let part1 = trim_to_chars(
                &normalize_whitespace(&format!(
                    "{display_title}{}",
                    if authors.trim().is_empty() {
                        String::new()
                    } else {
                        format!(" — {authors}")
                    }
                )),
                280,
            );
            if !part1.is_empty() {
                parts.push(part1);
            }
            let part2 = trim_to_chars(
                &normalize_whitespace(&format!(
                    "{abstract_} {}",
                    if link.trim().is_empty() {
                        String::new()
                    } else {
                        link.to_string()
                    }
                )),
                280,
            );
            if !part2.is_empty() {
                parts.push(part2);
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts)
            }
        } else {
            None
        };

        Ok(GeneratedContent {
            twitter,
            twitter_thread,
            bluesky,
            linkedin,
            plain_summary,
        })
    }
}

fn normalize_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn trim_to_chars(text: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let text_len = text.chars().count();
    if text_len <= max_chars {
        return text.to_string();
    }
    if max_chars == 1 {
        return "…".to_string();
    }
    let mut out = String::new();
    for (index, ch) in text.chars().enumerate() {
        if index < max_chars {
            out.push(ch);
            continue;
        }
        out.pop();
        out.push('…');
        return out;
    }
    out
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
            let use_claude = s
                .get("useClaude")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            Preferences {
                model,
                include_thread,
                use_claude,
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
    store.set("useClaude", serde_json::json!(prefs.use_claude));
    store.save().map_err(|e| e.to_string())
}

// Unused import suppression
#[allow(dead_code)]
fn _placeholder() {}

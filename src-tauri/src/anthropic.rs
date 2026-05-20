use reqwest::Client;
use serde::{Deserialize, Serialize};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";

#[derive(Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct RequestBody {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<Message>,
}

#[derive(Deserialize)]
struct ContentBlock {
    text: String,
}

#[derive(Deserialize)]
struct ResponseBody {
    content: Vec<ContentBlock>,
}

pub async fn call_claude(
    api_key: &str,
    model: &str,
    system: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let client = Client::new();

    let body = RequestBody {
        model: model.to_string(),
        max_tokens,
        system: system.to_string(),
        messages: vec![Message {
            role: "user".to_string(),
            content: user_prompt.to_string(),
        }],
    };

    let response = client
        .post(API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {status}: {body}"));
    }

    let resp: ResponseBody = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    resp.content
        .into_iter()
        .next()
        .map(|b| b.text)
        .ok_or_else(|| "Empty response from API".to_string())
}

pub async fn test_connection(api_key: &str) -> bool {
    call_claude(
        api_key,
        "claude-sonnet-4-5",
        "You are a helpful assistant.",
        "Reply with only the word: ok",
        10,
    )
    .await
    .is_ok()
}

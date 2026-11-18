//! Local HTTP server: serves the UI and a small JSON API. Shared by the app
//! window (Tauri) and the terminal/browser mode (`usmcc --serve`).
//!
//! Lite (the web version) has no server: `web/lite.js` answers the same
//! requests in the browser. Keep the two in step.

use crate::paper::{self, PaperRow};
use include_dir::{include_dir, Dir};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tiny_http::{Header, Method, Request, Response};

static WEB: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../web");

pub type Picker = Box<dyn Fn(&str, Option<&str>) -> Option<String> + Send + Sync>;
pub type WindowCtl = Box<dyn Fn(&str, &Value) -> Value + Send + Sync>;

const KEY_SERVICE: &str = "com.usmcc.publicity-helper";
const KEY_ACCOUNT: &str = "anthropic-api-key";
const MODELS: [&str; 3] = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const DEFAULT_MODEL: &str = "claude-opus-5-5";
const USER_AGENT: &str = "USMCCPublicityHelper/0.2 (+https://github.com/lawrenceleejr/USMCCPaperPublicityHelper)";
const MAX_DOC: usize = 20 * 1024 * 1024;
const MAX_ASSET: usize = 80 * 1024 * 1024;
const MAX_ARCHIVE: usize = 100 * 1024 * 1024;

pub struct App {
    pub shell: &'static str,
    pub picker: OnceLock<Picker>,
    pub window: OnceLock<WindowCtl>,
    dir: PathBuf,
    settings: Mutex<Value>,
    /// the API key once looked up (the keychain can prompt; ask it once)
    key: Mutex<Option<Option<String>>>,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn today() -> String {
    paper::date_from_days((now_ms() / 86_400_000) as i64)
}

/// Write via a temporary file and rename, so a crash never leaves half a file.
fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    if let Some(p) = path.parent() {
        fs::create_dir_all(p)?;
    }
    let tmp = path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0)
    ));
    fs::write(&tmp, data)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

impl App {
    pub fn new(shell: &'static str) -> Arc<App> {
        let dir = std::env::var_os("USMCC_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".usmcc"));
        let settings = fs::read(dir.join("settings.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}));
        Arc::new(App {
            shell,
            picker: OnceLock::new(),
            window: OnceLock::new(),
            dir,
            settings: Mutex::new(settings),
            key: Mutex::new(None),
        })
    }

    fn docs(&self) -> PathBuf {
        self.dir.join("docs")
    }
    fn assets(&self) -> PathBuf {
        self.dir.join("assets")
    }

    fn export_dir(&self) -> PathBuf {
        let s = self.settings.lock().unwrap();
        match s.get("exportDir").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            Some(d) => PathBuf::from(d),
            None => home().join("Pictures").join("USMCC Publicity"),
        }
    }

    fn save_settings(&self, v: Value) -> io::Result<()> {
        write_atomic(&self.dir.join("settings.json"), &serde_json::to_vec_pretty(&v).unwrap_or_default())?;
        *self.settings.lock().unwrap() = v;
        Ok(())
    }

    fn api_key(&self) -> Option<String> {
        let mut k = self.key.lock().unwrap();
        if k.is_none() {
            *k = Some(keychain_get().or_else(|| std::env::var("ANTHROPIC_API_KEY").ok()).filter(|s| !s.trim().is_empty()));
        }
        k.clone().flatten()
    }
}

/* ------------------------------------------------------------ the keychain */

#[cfg(feature = "gui")]
fn keychain_get() -> Option<String> {
    keyring::Entry::new(KEY_SERVICE, KEY_ACCOUNT).ok()?.get_password().ok()
}
#[cfg(not(feature = "gui"))]
fn keychain_get() -> Option<String> {
    let _ = (KEY_SERVICE, KEY_ACCOUNT);
    None
}
#[cfg(feature = "gui")]
fn keychain_set(key: &str) -> Result<(), String> {
    let e = keyring::Entry::new(KEY_SERVICE, KEY_ACCOUNT).map_err(|e| e.to_string())?;
    if key.is_empty() {
        match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        }
    } else {
        e.set_password(key).map_err(|e| e.to_string())
    }
}
#[cfg(not(feature = "gui"))]
fn keychain_set(_: &str) -> Result<(), String> {
    Err("This version can't use the keychain: set ANTHROPIC_API_KEY in the environment before starting usmcc".into())
}
const KEYCHAIN: bool = cfg!(feature = "gui");

/* ------------------------------------------------------------ http plumbing */

fn header(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

fn send_json(req: Request, code: u16, body: Value) {
    let data = serde_json::to_vec(&body).unwrap_or_default();
    let resp = Response::from_data(data)
        .with_status_code(code)
        .with_header(header("Content-Type", "application/json"))
        .with_header(header("Cache-Control", "no-store"));
    let _ = req.respond(resp);
}

fn send_bytes(req: Request, data: Vec<u8>, mime: &str, cache: &str) {
    let resp = Response::from_data(data).with_header(header("Content-Type", mime)).with_header(header("Cache-Control", cache));
    let _ = req.respond(resp);
}

fn err(req: Request, code: u16, msg: &str) {
    send_json(req, code, json!({ "error": msg }));
}

fn read_body(req: &mut Request, limit: usize) -> io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    req.as_reader().take(limit as u64 + 1).read_to_end(&mut buf)?;
    if buf.len() > limit {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "too large"));
    }
    Ok(buf)
}

fn read_json(req: &mut Request) -> Value {
    read_body(req, 5_000_000).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null)
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => match u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or(""), 16) {
                Ok(v) => {
                    out.push(v);
                    i += 2;
                }
                Err(_) => out.push(b'%'),
            },
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn split_url(url: &str) -> (String, HashMap<String, String>) {
    let (path, q) = url.split_once('?').unwrap_or((url, ""));
    let mut params = HashMap::new();
    for kv in q.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        params.insert(pct_decode(k), pct_decode(v));
    }
    (pct_decode(path), params)
}

fn get_header<'a>(req: &'a Request, name: &str) -> Option<&'a str> {
    req.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
}

fn mime_for(name: &str) -> &'static str {
    match Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/* ------------------------------------------------------------ server */

pub fn start(app: Arc<App>, port: u16) -> io::Result<u16> {
    let server = tiny_http::Server::http(("127.0.0.1", port))
        .or_else(|_| tiny_http::Server::http(("127.0.0.1", 0)))
        .map_err(|e| io::Error::other(e.to_string()))?;
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let app = app.clone();
            std::thread::spawn(move || handle(app, req));
        }
    });
    Ok(port)
}

fn handle(app: Arc<App>, req: Request) {
    // Only accept requests addressed to this machine (blocks DNS rebinding).
    let host = get_header(&req, "Host").unwrap_or("").split(':').next().unwrap_or("").to_string();
    if host != "127.0.0.1" && host != "localhost" {
        return err(req, 403, "forbidden host");
    }
    let (path, params) = split_url(req.url());
    if path.starts_with("/api/") {
        // Only the app's own page may use the API: a web page elsewhere can't
        // send this header without a CORS preflight, which we never grant,
        // and a foreign Origin is refused outright.
        let port = get_header(&req, "Host").and_then(|h| h.rsplit_once(':')).map(|(_, p)| p.to_string()).unwrap_or_default();
        if let Some(origin) = get_header(&req, "Origin") {
            let own = [format!("http://127.0.0.1:{}", port), format!("http://localhost:{}", port)];
            if !own.iter().any(|o| o == origin) {
                return err(req, 403, "forbidden origin");
            }
        }
        if *req.method() != Method::Get && get_header(&req, "X-USMCC") != Some("1") {
            return err(req, 403, "missing X-USMCC header");
        }
        api(&app, req, &path, &params);
    } else {
        serve_static(req, &path);
    }
}

fn serve_static(req: Request, path: &str) {
    let rel = if path == "/" { "index.html" } else { path.trim_start_matches('/') };
    if rel.contains("..") {
        return err(req, 403, "forbidden");
    }
    match WEB.get_file(rel) {
        Some(f) => send_bytes(req, f.contents().to_vec(), mime_for(rel), "no-cache"),
        None => err(req, 404, "not found"),
    }
}

fn valid_doc_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// `[a-z0-9]{8,64}` with an optional `.ext` of 1–5 `[a-z0-9]`.
fn valid_asset_id(id: &str) -> bool {
    let (base, ext) = match id.split_once('.') {
        Some((b, e)) => (b, Some(e)),
        None => (id, None),
    };
    let lc = |s: &str| s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    (8..=64).contains(&base.len()) && lc(base) && ext.is_none_or(|e| (1..=5).contains(&e.len()) && lc(e))
}

/// A file or folder name from the page: no paths, no control characters.
fn clean_name(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() || s.contains('/') || s.contains('\\') || s.contains("..") || s.chars().any(char::is_control) || s.starts_with('.') || s.chars().count() > 120 {
        return None;
    }
    Some(s.chars().map(|c| if "<>:\"|?*".contains(c) { '-' } else { c }).collect())
}

fn agent(timeout: u64) -> ureq::Agent {
    // the system's certificates and HTTPS_PROXY: works behind a university or
    // company proxy that inspects TLS
    ureq::AgentBuilder::new().user_agent(USER_AGENT).timeout(Duration::from_secs(timeout)).redirects(10).try_proxy_from_env(true).build()
}

/// GET a URL into memory, up to `cap` bytes.
fn fetch(url: &str, cap: usize) -> Result<Vec<u8>, String> {
    let resp = agent(180).get(url).call().map_err(|e| match e {
        ureq::Error::Status(code, _) => format!("arXiv answered HTTP {code} for {url}"),
        e => format!("Couldn't reach arXiv: {e}"),
    })?;
    let mut buf = Vec::new();
    resp.into_reader().take(cap as u64 + 1).read_to_end(&mut buf).map_err(|e| format!("Download from arXiv failed: {e}"))?;
    if buf.len() > cap {
        return Err(format!("The download is over {} MB", cap / 1024 / 1024));
    }
    Ok(buf)
}

fn arxiv_from(params: &HashMap<String, String>) -> Result<String, String> {
    let url = params.get("url").map(String::as_str).unwrap_or("");
    paper::arxiv_id(url).ok_or_else(|| "That isn't an arXiv link or id (like 2401.12345)".to_string())
}

/// One request to the Claude API (raw HTTP: there is no official Rust SDK).
fn claude(key: &str, model: &str, body: Value) -> Result<Value, String> {
    let mut req = agent(300)
        .post("https://api.anthropic.com/v1/messages")
        .set("x-api-key", key)
        .set("anthropic-version", "2023-06-01")
        .set("content-type", "application/json");
    let mut body = body;
    if model != "claude-haiku-5-5" {
        // if Claude declines, the API re-runs the request on its recommended fallback
        req = req.set("anthropic-beta", "server-side-fallback-2026-07-01");
        body["fallbacks"] = json!("default");
    }
    let resp = match req.send_string(&body.to_string()) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let text = r.into_string().unwrap_or_default();
            let msg = serde_json::from_str::<Value>(&text).ok().and_then(|v| v["error"]["message"].as_str().map(str::to_string)).unwrap_or(text);
            return Err(match code {
                401 => "Claude didn't accept the API key".to_string(),
                429 => format!("Claude is busy or the account is out of credit ({msg})"),
                _ => format!("Claude API error {code}: {msg}"),
            });
        }
        Err(e) => return Err(format!("Couldn't reach Claude: {e}")),
    };
    let v: Value = serde_json::from_str(&resp.into_string().map_err(|e| e.to_string())?).map_err(|_| "Claude's reply wasn't JSON".to_string())?;
    if v["stop_reason"] == "refusal" {
        return Err("Claude declined to write these posts; try the posts from the submission instead".into());
    }
    Ok(v)
}

fn claude_posts(app: &App, row: &PaperRow, model: &str, thread: bool) -> Result<paper::Posts, String> {
    let key = app.api_key().ok_or("Add your Anthropic API key first (Posts → Claude key)")?;
    let (system, user) = paper::posts_prompt(row, thread);
    let v = claude(
        &key,
        model,
        json!({
            "model": model,
            "max_tokens": 16000,
            "system": system,
            "messages": [{ "role": "user", "content": user }],
            "output_config": { "effort": "medium", "format": { "type": "json_schema", "schema": paper::posts_schema() } },
        }),
    )?;
    let text = v["content"].as_array().and_then(|a| a.iter().find(|b| b["type"] == "text")).and_then(|b| b["text"].as_str()).ok_or("Claude's reply had no text")?;
    paper::posts_from_claude(row, text, thread, &today())
}

fn reveal(p: &Path) {
    let _ = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg("-R").arg(p).spawn()
    } else if cfg!(windows) {
        std::process::Command::new("explorer").arg(format!("/select,{}", p.to_string_lossy())).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(if p.is_dir() { p } else { p.parent().unwrap_or(p) }).spawn()
    };
}

pub fn open_path(p: &str) {
    let cmd = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    };
    let _ = std::process::Command::new(cmd).arg(p).spawn();
}

fn modified_ms(p: &Path) -> u64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Remove assets no carousel refers to any more. Recent uploads are kept: the
/// carousel that uses them may not have been saved yet.
fn collect_garbage(app: &App) {
    let docs: Vec<String> = fs::read_dir(app.docs())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| fs::read_to_string(e.path()).ok())
        .collect();
    let cutoff = now_ms().saturating_sub(10 * 60 * 1000);
    for e in fs::read_dir(app.assets()).into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !valid_asset_id(&name) || modified_ms(&e.path()) > cutoff {
            continue;
        }
        if !docs.iter().any(|d| d.contains(&name)) {
            let _ = fs::remove_file(e.path());
        }
    }
}

fn list_docs(app: &App) -> Value {
    let mut out: Vec<(u64, Value)> = Vec::new();
    for e in fs::read_dir(app.docs()).into_iter().flatten().flatten() {
        let p = e.path();
        let Some(id) = p.file_stem().and_then(|s| s.to_str()).filter(|s| valid_doc_id(s)).map(str::to_string) else { continue };
        if p.extension().is_none_or(|x| x != "json") {
            continue;
        }
        let Some(v) = fs::read(&p).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else { continue };
        let updated = v["updated"].as_u64().or_else(|| v["updated"].as_f64().map(|f| f as u64)).unwrap_or_else(|| modified_ms(&p));
        let count = v["slides"].as_array().map(|a| a.len()).unwrap_or(0);
        let name = v["name"].as_str().unwrap_or("").to_string();
        out.push((updated, json!({ "id": id, "name": name, "updated": updated, "count": count })));
    }
    out.sort_by_key(|o| std::cmp::Reverse(o.0));
    Value::Array(out.into_iter().map(|(_, v)| v).collect())
}

fn api(app: &Arc<App>, mut req: Request, path: &str, params: &HashMap<String, String>) {
    let method = req.method().clone();

    if let Some(id) = path.strip_prefix("/api/doc/") {
        if !valid_doc_id(id) {
            return err(req, 400, "bad carousel id");
        }
        let file = app.docs().join(format!("{id}.json"));
        return match method {
            Method::Get => match fs::read(&file) {
                Ok(b) => send_bytes(req, b, "application/json", "no-store"),
                Err(_) => err(req, 404, "no such carousel"),
            },
            Method::Put => {
                let Ok(body) = read_body(&mut req, MAX_DOC) else { return err(req, 413, "the carousel is too large") };
                if serde_json::from_slice::<Value>(&body).map(|v| !v.is_object()).unwrap_or(true) {
                    return err(req, 400, "not a carousel (JSON object expected)");
                }
                match write_atomic(&file, &body) {
                    Ok(()) => send_json(req, 200, json!({ "ok": true })),
                    Err(e) => err(req, 500, &format!("couldn't save: {e}")),
                }
            }
            Method::Delete => {
                let _ = fs::remove_file(&file);
                collect_garbage(app);
                send_json(req, 200, json!({ "ok": true }))
            }
            _ => err(req, 405, "method not allowed"),
        };
    }

    if let Some(id) = path.strip_prefix("/api/asset/") {
        if !valid_asset_id(id) {
            return err(req, 400, "bad asset id");
        }
        let file = app.assets().join(id);
        return match method {
            Method::Get => match fs::read(&file) {
                Ok(b) => send_bytes(req, b, mime_for(id), "max-age=31536000, immutable"),
                Err(_) => err(req, 404, "no such asset"),
            },
            Method::Put => {
                let Ok(body) = read_body(&mut req, MAX_ASSET) else { return err(req, 413, "the file is over 80 MB") };
                let size = body.len();
                if !file.exists() {
                    if let Err(e) = write_atomic(&file, &body) {
                        return err(req, 500, &format!("couldn't save: {e}"));
                    }
                }
                send_json(req, 200, json!({ "ok": true, "size": size }))
            }
            _ => err(req, 405, "method not allowed"),
        };
    }

    let get = method == Method::Get;
    let post = method == Method::Post;
    let put = method == Method::Put;
    match (path, get, post, put) {
        ("/api/info", true, _, _) => {
            let has_key = app.api_key().is_some();
            send_json(
                req,
                200,
                json!({
                    "shell": app.shell,
                    "version": env!("CARGO_PKG_VERSION"),
                    "keychain": KEYCHAIN,
                    "hasKey": has_key,
                    "exportDir": app.export_dir().to_string_lossy(),
                    "canChooseDir": app.picker.get().is_some(),
                }),
            )
        }
        ("/api/settings", true, _, _) => {
            let s = app.settings.lock().unwrap().clone();
            send_json(req, 200, s)
        }
        ("/api/settings", _, _, true) => {
            let v = read_json(&mut req);
            if !v.is_object() {
                return err(req, 400, "settings must be an object");
            }
            match app.save_settings(v) {
                Ok(()) => send_json(req, 200, json!({ "ok": true })),
                Err(e) => err(req, 500, &e.to_string()),
            }
        }
        ("/api/docs", true, _, _) => send_json(req, 200, list_docs(app)),
        ("/api/parse-row", _, true, _) => {
            let v = read_json(&mut req);
            match paper::parse_row(v["text"].as_str().unwrap_or("")) {
                Ok(row) => send_json(req, 200, serde_json::to_value(row).unwrap()),
                Err(e) => err(req, 400, &e),
            }
        }
        ("/api/arxiv", true, _, _) => match arxiv_from(params) {
            Ok(id) => send_json(req, 200, paper::arxiv_links(&id)),
            Err(e) => err(req, 400, &e),
        },
        ("/api/arxiv/pdf", true, _, _) => {
            let id = match arxiv_from(params) {
                Ok(id) => id,
                Err(e) => return err(req, 400, &e),
            };
            match fetch(&format!("https://arxiv.org/pdf/{id}"), MAX_ARCHIVE) {
                Ok(b) if b.starts_with(b"%PDF") => send_bytes(req, b, "application/pdf", "no-store"),
                Ok(_) => err(req, 502, "arXiv didn't send a PDF for this paper"),
                Err(e) => err(req, 502, &e),
            }
        }
        ("/api/arxiv/figures", true, _, _) => {
            let id = match arxiv_from(params) {
                Ok(id) => id,
                Err(e) => return err(req, 400, &e),
            };
            match fetch(&format!("https://arxiv.org/src/{id}"), MAX_ARCHIVE).and_then(|b| paper::figures_from_archive(&b)) {
                Ok(f) => send_json(req, 200, paper::figures_json(&f)),
                Err(e) => err(req, 502, &e),
            }
        }
        ("/api/figures", _, true, _) => {
            let Ok(body) = read_body(&mut req, MAX_ARCHIVE) else { return err(req, 413, "the archive is over 100 MB") };
            match paper::figures_from_archive(&body) {
                Ok(f) => send_json(req, 200, paper::figures_json(&f)),
                Err(e) => err(req, 400, &e),
            }
        }
        ("/api/posts", _, true, _) => {
            let v = read_json(&mut req);
            let row: PaperRow = match serde_json::from_value(v["row"].clone()) {
                Ok(r) => r,
                Err(_) => return err(req, 400, "no paper to write about"),
            };
            if row.paper_title.trim().is_empty() && row.plain_title.trim().is_empty() {
                return err(req, 400, "the paper needs a title");
            }
            let thread = v["thread"].as_bool().unwrap_or(false);
            if v["mode"] == "claude" {
                let model = v["model"].as_str().filter(|m| MODELS.contains(m)).unwrap_or(DEFAULT_MODEL);
                if app.api_key().is_none() {
                    return err(req, 400, "Add your Anthropic API key first (Posts → Claude key)");
                }
                match claude_posts(app, &row, model, thread) {
                    Ok(p) => send_json(req, 200, serde_json::to_value(p).unwrap()),
                    Err(e) => err(req, 502, &e),
                }
            } else {
                send_json(req, 200, serde_json::to_value(paper::offline_posts(&row, thread, &today())).unwrap())
            }
        }
        ("/api/key", true, _, _) => {
            let set = app.api_key().is_some();
            send_json(req, 200, json!({ "set": set, "keychain": KEYCHAIN }))
        }
        ("/api/key", _, true, _) => {
            let v = read_json(&mut req);
            let key = v["key"].as_str().unwrap_or("").trim().to_string();
            match keychain_set(&key) {
                Ok(()) => {
                    *app.key.lock().unwrap() = None; // look it up afresh
                    let set = app.api_key().is_some();
                    send_json(req, 200, json!({ "set": set, "keychain": KEYCHAIN }))
                }
                Err(e) => err(req, 400, &e),
            }
        }
        ("/api/key/test", _, true, _) => {
            let Some(key) = app.api_key() else { return send_json(req, 200, json!({ "ok": false, "error": "No API key" })) };
            let r = claude(
                &key,
                DEFAULT_MODEL,
                json!({
                    "model": DEFAULT_MODEL,
                    "max_tokens": 256,
                    "output_config": { "effort": "low" },
                    "messages": [{ "role": "user", "content": "Reply with only the word: ok" }],
                }),
            );
            match r {
                Ok(_) => send_json(req, 200, json!({ "ok": true })),
                Err(e) => send_json(req, 200, json!({ "ok": false, "error": e })),
            }
        }
        ("/api/export", _, true, _) => {
            let folder = params.get("folder").and_then(|f| clean_name(f));
            let file = params.get("file").and_then(|f| clean_name(f));
            let (Some(folder), Some(file)) = (folder, file) else { return err(req, 400, "bad folder or file name") };
            let Ok(body) = read_body(&mut req, MAX_ASSET) else { return err(req, 413, "the file is over 80 MB") };
            let dir = app.export_dir().join(&folder);
            let dest = dir.join(&file);
            if fs::metadata(&dest).map(|m| m.len() == body.len() as u64).unwrap_or(false) {
                return send_json(req, 200, json!({ "skipped": true, "path": dest.to_string_lossy() }));
            }
            let partial = dir.join(format!(".{file}.partial"));
            let r = fs::create_dir_all(&dir).and_then(|_| fs::write(&partial, &body)).and_then(|_| fs::rename(&partial, &dest));
            match r {
                Ok(()) => send_json(req, 200, json!({ "skipped": false, "path": dest.to_string_lossy() })),
                Err(e) => {
                    let _ = fs::remove_file(&partial);
                    err(req, 500, &format!("couldn't write {}: {e}", dest.display()))
                }
            }
        }
        ("/api/choose-export-dir", _, true, _) => {
            let Some(pick) = app.picker.get() else {
                return send_json(req, 200, json!({ "dir": null, "error": "Choosing a folder needs the app window; set exportDir in settings instead" }));
            };
            let current = app.export_dir().to_string_lossy().to_string();
            match pick("Export slides to…", Some(&current)) {
                Some(dir) => {
                    let mut s = app.settings.lock().unwrap().clone();
                    s["exportDir"] = json!(dir);
                    let _ = app.save_settings(s);
                    send_json(req, 200, json!({ "dir": dir }))
                }
                None => send_json(req, 200, json!({ "dir": null })),
            }
        }
        ("/api/reveal", _, true, _) => {
            let v = read_json(&mut req);
            let p = PathBuf::from(v["path"].as_str().unwrap_or(""));
            let base = fs::canonicalize(app.export_dir()).ok();
            let target = fs::canonicalize(&p).ok();
            match (base, target) {
                (Some(b), Some(t)) if t.starts_with(&b) => {
                    reveal(&t);
                    send_json(req, 200, json!({ "ok": true }))
                }
                _ => err(req, 400, "only files in the export folder can be shown"),
            }
        }
        ("/api/open", _, true, _) => {
            let v = read_json(&mut req);
            let url = v["url"].as_str().unwrap_or("");
            if !(url.starts_with("https://") || url.starts_with("http://")) || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
                return err(req, 400, "only web links can be opened");
            }
            open_path(url);
            send_json(req, 200, json!({ "ok": true }))
        }
        ("/api/window", _, true, _) => {
            let v = read_json(&mut req);
            let out = match app.window.get() {
                Some(w) => w(if v.get("fullscreen").is_some() { "fullscreen" } else { "state" }, &json!({ "on": v["fullscreen"] })),
                None => json!({ "fullscreen": false }),
            };
            send_json(req, 200, out)
        }
        _ => err(req, 404, "not found"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_names() {
        assert!(valid_doc_id("c_1700000000-ab"));
        assert!(!valid_doc_id("../x"));
        assert!(!valid_doc_id(""));
        assert!(valid_asset_id("0123456789abcdef.png"));
        assert!(valid_asset_id("0123456789abcdef"));
        assert!(!valid_asset_id("0123.png"));
        assert!(!valid_asset_id("0123456789ABCDEF.png"));
        assert!(!valid_asset_id("0123456789abcdef.toolong"));
        assert_eq!(clean_name(" my carousel: 1 ").as_deref(), Some("my carousel- 1"));
        assert!(clean_name("../x").is_none());
        assert!(clean_name("a/b").is_none());
        assert!(clean_name(".hidden").is_none());
        assert!(clean_name("").is_none());
        assert!(clean_name(&"x".repeat(121)).is_none());
    }
}

//! Lite's paper code: the desktop app's own `paper.rs`, compiled to
//! WebAssembly so the web version reads rows, arXiv links and source
//! archives, and writes the posts, exactly as the desktop app does.
//!
//! No bindings generator: JS copies bytes in with `alloc`, calls a function,
//! and gets back a pointer/length pair (packed into a u64) to UTF-8 JSON,
//! which it frees with `dealloc`.

#[allow(dead_code)]
#[path = "../../src-tauri/src/paper.rs"]
mod paper;

use serde_json::{json, Value};

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}

/// Free a buffer from `alloc` or a result, given its length.
/// # Safety
/// `ptr`/`len` must come from `alloc` or a returned result, freed once.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

unsafe fn input<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    std::slice::from_raw_parts(ptr, len)
}

/// Hand bytes to JS as (pointer << 32 | length); JS frees them with `dealloc`.
fn output(v: Value) -> u64 {
    let b = v.to_string().into_bytes().into_boxed_slice();
    let n = b.len() as u64;
    let p = Box::into_raw(b) as *mut u8 as u64;
    (p << 32) | n
}

fn error(e: impl Into<String>) -> Value {
    json!({ "error": e.into() })
}

/// The pasted sheet row (UTF-8 text) → the paper's fields, or `{error}`.
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn parse_row(ptr: *const u8, len: usize) -> u64 {
    let text = String::from_utf8_lossy(input(ptr, len));
    output(match paper::parse_row(&text) {
        Ok(r) => serde_json::to_value(r).unwrap(),
        Err(e) => error(e),
    })
}

/// An arXiv link or id (UTF-8) → `{id, abs, pdf, src}`, or `{error}`.
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn arxiv(ptr: *const u8, len: usize) -> u64 {
    let text = String::from_utf8_lossy(input(ptr, len));
    output(match paper::arxiv_id(&text) {
        Some(id) => paper::arxiv_links(&id),
        None => error("That isn't an arXiv link or id (like 2401.12345)"),
    })
}

/// The export.arxiv.org Atom feed for one id (UTF-8 XML) → the paper's
/// fields, or `{error}`. (Lite fetches the feed itself where the browser
/// allows it.)
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn arxiv_meta(ptr: *const u8, len: usize) -> u64 {
    let text = String::from_utf8_lossy(input(ptr, len));
    output(match paper::arxiv_meta(&text) {
        Ok(r) => serde_json::to_value(r).unwrap(),
        Err(e) => error(e),
    })
}

/// LaTeX (UTF-8) → `{text}`: readable Unicode, as titles and abstracts get.
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn detex(ptr: *const u8, len: usize) -> u64 {
    let text = String::from_utf8_lossy(input(ptr, len));
    output(json!({ "text": paper::detex(&text) }))
}

/// A source archive (.tar.gz / .tar) → `{figures: [{name, mime, caption, data}]}`
/// with base64 data, or `{error}`.
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn figures(ptr: *const u8, len: usize) -> u64 {
    output(match paper::figures_from_archive(input(ptr, len)) {
        Ok(f) => paper::figures_json(&f),
        Err(e) => error(e),
    })
}

/// `{row, thread, today}` (JSON) → the posts written from the submission's
/// own words, with the website markdown; or `{error}`.
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn posts(ptr: *const u8, len: usize) -> u64 {
    let v: Value = serde_json::from_slice(input(ptr, len)).unwrap_or(Value::Null);
    let row: paper::PaperRow = match serde_json::from_value(v["row"].clone()) {
        Ok(r) => r,
        Err(_) => return output(error("no paper to write about")),
    };
    let today = v["today"].as_str().unwrap_or("");
    output(serde_json::to_value(paper::offline_posts(&row, v["thread"].as_bool().unwrap_or(false), today)).unwrap())
}

/// `{row, thread}` (JSON) → `{system, user, schema}`: the one request that
/// writes every post with Claude, built exactly as the desktop app builds it.
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn prompt(ptr: *const u8, len: usize) -> u64 {
    let v: Value = serde_json::from_slice(input(ptr, len)).unwrap_or(Value::Null);
    let row: paper::PaperRow = serde_json::from_value(v["row"].clone()).unwrap_or_default();
    let (system, user) = paper::posts_prompt(&row, v["thread"].as_bool().unwrap_or(false));
    output(json!({ "system": system, "user": user, "schema": paper::posts_schema() }))
}

/// `{row, answer, thread, today}` → posts from Claude's JSON answer (with the
/// website markdown built from its summary), or `{error}`.
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn claude_posts(ptr: *const u8, len: usize) -> u64 {
    let v: Value = serde_json::from_slice(input(ptr, len)).unwrap_or(Value::Null);
    let row: paper::PaperRow = serde_json::from_value(v["row"].clone()).unwrap_or_default();
    output(match paper::posts_from_claude(&row, v["answer"].as_str().unwrap_or(""), v["thread"].as_bool().unwrap_or(false), v["today"].as_str().unwrap_or("")) {
        Ok(p) => serde_json::to_value(p).unwrap(),
        Err(e) => error(e),
    })
}

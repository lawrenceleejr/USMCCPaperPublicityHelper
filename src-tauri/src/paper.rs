//! Everything about a paper that both versions of the app share: reading a
//! row pasted from the submission sheet, recognising arXiv links, pulling the
//! figures out of an arXiv source archive, and writing the posts.
//!
//! The desktop server uses this directly; Lite (the web version) uses the
//! same file compiled to WebAssembly (`lite/wasm`). So it must stay free of
//! files, network and clocks: bytes and strings in, bytes and strings out.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/* ------------------------------------------------------------ the row */

/// One row of the USMCC paper submission sheet.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct PaperRow {
    pub timestamp: String,
    pub email: String,
    pub paper_title: String,
    pub plain_title: String,
    pub authors: String,
    pub publication_date: String,
    pub category: String,
    pub public_abstract: String,
    pub paper_link: String,
    pub figures_ok: bool,
    pub additional_comments: String,
}

/// Columns, in order: Timestamp, Email, Paper Title, Plain Title, Authors,
/// Date, Category, Abstract, Link, Figures OK?, Comments. A header line above
/// the row (starting "Timestamp") is skipped. Cells Google Sheets quoted
/// (because they hold newlines or quotes) are unwrapped.
pub fn parse_row(text: &str) -> Result<PaperRow, String> {
    let text = text.trim_matches(|c: char| c == '\n' || c == '\r' || c == ' ');
    if text.trim().is_empty() {
        return Err("Paste a row from the submission sheet".into());
    }
    let text = match text.split_once('\n') {
        Some((first, rest)) if first.trim_start().starts_with("Timestamp") => {
            if rest.trim().is_empty() {
                return Err("That's only the header line; paste the paper's row too".into());
            }
            rest
        }
        _ => text,
    };
    let mut cols = split_tsv(text);
    while cols.len() < 11 {
        cols.push(String::new());
    }
    let row = PaperRow {
        timestamp: cols[0].clone(),
        email: cols[1].clone(),
        paper_title: detex(&cols[2]),
        plain_title: detex(&cols[3]),
        authors: detex(&cols[4]),
        publication_date: cols[5].clone(),
        category: cols[6].clone(),
        public_abstract: detex(&cols[7]),
        paper_link: cols[8].clone(),
        figures_ok: cols[9].trim().eq_ignore_ascii_case("yes"),
        additional_comments: cols[10].clone(),
    };
    if row.paper_title.is_empty() {
        return Err("The paper title (column 3) is empty".into());
    }
    if row.public_abstract.is_empty() {
        return Err("The public abstract (column 8) is empty".into());
    }
    Ok(row)
}

/// Tab-separated cells, honouring Sheets' quoting: a cell that starts with a
/// quote runs to the closing quote (and may contain tabs and newlines), with
/// `""` standing for one quote. Stops at the end of the first row.
fn split_tsv(text: &str) -> Vec<String> {
    let mut cols = Vec::new();
    let mut chars = text.chars().peekable();
    loop {
        // skip spaces before a cell, so ` "quoted"` still counts as quoted
        while matches!(chars.peek(), Some(' ')) {
            chars.next();
        }
        let mut cell = String::new();
        if chars.peek() == Some(&'"') {
            chars.next();
            while let Some(c) = chars.next() {
                if c == '"' {
                    if chars.peek() == Some(&'"') {
                        chars.next();
                        cell.push('"');
                    } else {
                        break;
                    }
                } else {
                    cell.push(c);
                }
            }
            // anything after the closing quote up to the tab belongs to the cell
            while let Some(&c) = chars.peek() {
                if c == '\t' || c == '\n' {
                    break;
                }
                cell.push(c);
                chars.next();
            }
        } else {
            while let Some(&c) = chars.peek() {
                if c == '\t' || c == '\n' {
                    break;
                }
                cell.push(c);
                chars.next();
            }
        }
        cols.push(cell.trim().trim_end_matches('\r').trim().to_string());
        match chars.next() {
            Some('\t') => continue,
            _ => break,
        }
    }
    cols
}

/* ------------------------------------------------------------ arXiv */

/// The arXiv identifier in a link or a bare id: `2401.12345`, `2401.12345v3`,
/// `arXiv:2401.12345`, `hep-th/0701123`, or any arxiv.org /abs/ /pdf/ /src/
/// /e-print/ /format/ URL.
pub fn arxiv_id(input: &str) -> Option<String> {
    let s = input.trim();
    let lower = s.to_ascii_lowercase();
    let rest = if let Some(pos) = lower.find("arxiv.org/") {
        let mut after = &s[pos + "arxiv.org/".len()..];
        for prefix in ["abs/", "pdf/", "src/", "e-print/", "format/", "html/", "ftp/arxiv/papers/"] {
            if after.len() >= prefix.len() && after[..prefix.len()].eq_ignore_ascii_case(prefix) {
                after = &after[prefix.len()..];
                break;
            }
        }
        after
    } else if lower.starts_with("arxiv:") {
        &s[6..]
    } else {
        s
    };
    let id: String = rest.trim().chars().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '/' | '-')).collect();
    let id = id.trim_end_matches('/');
    let id = id.strip_suffix(".pdf").unwrap_or(id);
    if valid_new_id(id) || valid_old_id(id) {
        Some(id.to_string())
    } else {
        None
    }
}

fn strip_version(id: &str) -> &str {
    match id.rfind('v') {
        Some(i) if i + 1 < id.len() && id[i + 1..].bytes().all(|b| b.is_ascii_digit()) => &id[..i],
        _ => id,
    }
}

/// `YYMM.NNNN` or `YYMM.NNNNN`, optional `vN`.
fn valid_new_id(id: &str) -> bool {
    let base = strip_version(id);
    let Some((a, b)) = base.split_once('.') else { return false };
    a.len() == 4 && (b.len() == 4 || b.len() == 5) && a.bytes().all(|c| c.is_ascii_digit()) && b.bytes().all(|c| c.is_ascii_digit())
}

/// `archive[.XX]/YYMMNNN`, optional `vN`.
fn valid_old_id(id: &str) -> bool {
    let base = strip_version(id);
    let Some((arch, num)) = base.split_once('/') else { return false };
    let arch_ok = !arch.is_empty() && arch.split('.').next().is_some_and(|a| !a.is_empty() && a.bytes().all(|c| c.is_ascii_lowercase() || c == b'-'));
    arch_ok && num.len() == 7 && num.bytes().all(|c| c.is_ascii_digit())
}

pub fn arxiv_links(id: &str) -> Value {
    json!({
        "id": id,
        "abs": format!("https://arxiv.org/abs/{id}"),
        "pdf": format!("https://arxiv.org/pdf/{id}"),
        "src": format!("https://arxiv.org/src/{id}"),
    })
}

/* ------------------------------------------------------------ figures */

pub const MAX_FIGURES: usize = 40;
pub const MAX_FIGURE_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: usize = 300 * 1024 * 1024;

pub struct Figure {
    pub name: String,
    pub mime: &'static str,
    pub data: Vec<u8>,
    /// from the TeX source's `\caption` ("" when unknown)
    pub caption: String,
}

fn figure_mime(name: &str) -> Option<&'static str> {
    let ext = name.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => return None,
    })
}

fn hidden(path: &str) -> bool {
    path.split('/').any(|c| (c.starts_with('.') && c != "." && c != "..") || c == "__MACOSX")
}

/// The images and PDF figures inside an arXiv source download (a gzipped
/// tar, a plain tar, or, for papers without figures, a gzipped TeX file).
pub fn figures_from_archive(bytes: &[u8]) -> Result<Vec<Figure>, String> {
    if bytes.starts_with(b"%PDF") {
        return Err("arXiv has only the PDF of this paper, no source: add the PDF and pick its pages instead".into());
    }
    let gz = bytes.starts_with(&[0x1f, 0x8b]);
    let data = if gz { gunzip(bytes, MAX_TOTAL_BYTES + 100 * 1024 * 1024)? } else { bytes.to_vec() };
    if !is_tar(&data) {
        if gz {
            return Err("This paper's source has no figures (it is a single TeX file)".into());
        }
        return Err("That isn't a .tar.gz or .tar archive".into());
    }
    let entries = tar_entries(&data);
    // the figure files, in archive order
    let files: Vec<(&String, &[u8], &'static str)> = entries
        .iter()
        .filter(|(name, body)| !hidden(name) && !body.is_empty())
        .filter_map(|(name, body)| figure_mime(name).map(|m| (name, *body, m)))
        .collect();
    // the TeX: reading order and captions
    let texs: Vec<(String, String)> = entries
        .iter()
        .filter(|(name, _)| name.to_ascii_lowercase().ends_with(".tex") && !hidden(name))
        .map(|(name, body)| (name.clone(), strip_comments(&String::from_utf8_lossy(body))))
        .collect();
    let names: Vec<&str> = files.iter().map(|f| f.0.as_str()).collect();
    let mut order: Vec<usize> = Vec::new();
    let mut captions: Vec<String> = vec![String::new(); files.len()];
    if !texs.is_empty() {
        for (r, cap) in graphics_refs(&expanded_tex(&texs)) {
            if let Some(k) = match_ref(&names, &r) {
                if !order.contains(&k) {
                    order.push(k);
                    captions[k] = cap;
                }
            }
        }
    }
    for k in 0..files.len() {
        if !order.contains(&k) {
            order.push(k);
        }
    }
    let mut out: Vec<Figure> = Vec::new();
    let mut total = 0usize;
    for k in order {
        if out.len() >= MAX_FIGURES || total >= MAX_TOTAL_BYTES {
            break;
        }
        let (name, body, mime) = files[k];
        if body.len() > MAX_FIGURE_BYTES {
            continue;
        }
        total += body.len();
        out.push(Figure { name: name.clone(), mime, data: body.to_vec(), caption: std::mem::take(&mut captions[k]) });
    }
    if out.is_empty() {
        return Err("The paper's source has no PNG, JPEG, SVG or PDF figures".into());
    }
    Ok(out)
}

pub fn figures_json(figs: &[Figure]) -> Value {
    json!({
        "figures": figs.iter().map(|f| json!({ "name": f.name, "mime": f.mime, "caption": f.caption, "data": base64(&f.data) })).collect::<Vec<_>>()
    })
}

/// gzip → bytes (first member), refusing to grow past `limit`.
pub fn gunzip(b: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    let bad = || "The archive is damaged (bad gzip header)".to_string();
    if b.len() < 18 || b[0] != 0x1f || b[1] != 0x8b || b[2] != 8 {
        return Err(bad());
    }
    let flags = b[3];
    let mut i = 10;
    if flags & 4 != 0 {
        let n = *b.get(i).ok_or_else(bad)? as usize | (*b.get(i + 1).ok_or_else(bad)? as usize) << 8;
        i += 2 + n;
    }
    for bit in [8u8, 16] {
        if flags & bit != 0 {
            while *b.get(i).ok_or_else(bad)? != 0 {
                i += 1;
            }
            i += 1;
        }
    }
    if flags & 2 != 0 {
        i += 2;
    }
    if i >= b.len() {
        return Err(bad());
    }
    miniz_oxide::inflate::decompress_to_vec_with_limit(&b[i..], limit).map_err(|e| match e.status {
        miniz_oxide::inflate::TINFLStatus::HasMoreOutput => "The archive is too large".to_string(),
        _ => "The archive is damaged (could not decompress it)".to_string(),
    })
}

fn octal(field: &[u8]) -> Option<usize> {
    if field.first().is_some_and(|b| b & 0x80 != 0) {
        // base-256 (GNU, for sizes over 8 GB)
        let mut v: usize = 0;
        for (k, b) in field.iter().enumerate() {
            v = v.checked_mul(256)?.checked_add(if k == 0 { (b & 0x7f) as usize } else { *b as usize })?;
        }
        return Some(v);
    }
    let s: String = field.iter().take_while(|&&b| b != 0).map(|&b| b as char).collect();
    let s = s.trim();
    if s.is_empty() {
        return Some(0);
    }
    usize::from_str_radix(s, 8).ok()
}

fn cstr(field: &[u8]) -> String {
    let end = field.iter().position(|&b| b == 0).unwrap_or(field.len());
    String::from_utf8_lossy(&field[..end]).to_string()
}

fn header_ok(h: &[u8]) -> bool {
    if h.len() < 512 {
        return false;
    }
    let Some(want) = octal(&h[148..156]) else { return false };
    let sum: usize = h[..512].iter().enumerate().map(|(i, &b)| if (148..156).contains(&i) { 32 } else { b as usize }).sum();
    sum == want
}

fn is_tar(d: &[u8]) -> bool {
    d.len() >= 512 && (&d[257..262] == b"ustar" || header_ok(&d[..512]))
}

/// Regular files in a tar: (path, contents). Handles ustar prefixes, GNU long
/// names ('L') and pax headers ('x' path=).
pub fn tar_entries(d: &[u8]) -> Vec<(String, &[u8])> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    let mut long_name: Option<String> = None;
    while pos + 512 <= d.len() {
        let h = &d[pos..pos + 512];
        if h.iter().all(|&b| b == 0) || !header_ok(h) {
            break;
        }
        let Some(size) = octal(&h[124..136]) else { break };
        let start = pos + 512;
        let end = start.saturating_add(size).min(d.len());
        let body = &d[start..end];
        pos = start.saturating_add(size.div_ceil(512) * 512);
        let kind = h[156];
        match kind {
            b'L' => {
                long_name = Some(cstr(body));
                continue;
            }
            b'x' => {
                long_name = pax_path(body).or(long_name);
                continue;
            }
            b'g' => continue,
            _ => {}
        }
        let mut name = cstr(&h[0..100]);
        if &h[257..262] == b"ustar" {
            let prefix = cstr(&h[345..500]);
            if !prefix.is_empty() {
                name = format!("{prefix}/{name}");
            }
        }
        if let Some(n) = long_name.take() {
            name = n;
        }
        if kind == b'0' || kind == 0 || kind == b'7' {
            let name = name.trim_start_matches("./").to_string();
            out.push((name, body));
        }
    }
    out
}

fn pax_path(body: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(body);
    let mut found = None;
    let mut rest: &str = &text;
    while !rest.is_empty() {
        let (len, _) = rest.split_once(' ')?;
        let n: usize = len.parse().ok()?;
        if n == 0 || n > rest.len() {
            break;
        }
        let record = &rest[len.len() + 1..n];
        if let Some(v) = record.trim_end_matches('\n').strip_prefix("path=") {
            found = Some(v.to_string());
        }
        rest = &rest[n..];
    }
    found
}

pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/* ------------------------------------------------------------ posts */

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Posts {
    pub twitter: String,
    pub thread: Option<Vec<String>>,
    pub bluesky: String,
    pub linkedin: String,
    pub summary: String,
    pub markdown: String,
}

fn squash(t: &str) -> String {
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// At most `max` characters, ending in "…" when cut (at a word if one is near).
fn clip(t: &str, max: usize) -> String {
    if t.chars().count() <= max {
        return t.to_string();
    }
    if max == 0 {
        return String::new();
    }
    let cut: String = t.chars().take(max - 1).collect();
    let cut = match cut.rfind(' ') {
        Some(i) if cut[..i].chars().count() > max * 3 / 4 => cut[..i].to_string(),
        _ => cut,
    };
    format!("{}…", cut.trim_end_matches([' ', ',', ';', ':']))
}

/// Text, then the link, within `max` characters: the text is shortened, the
/// link never is.
fn with_link(text: &str, link: &str, max: usize) -> String {
    let link = link.trim();
    if link.is_empty() {
        return clip(text, max);
    }
    let room = max.saturating_sub(link.chars().count() + 1);
    format!("{} {link}", clip(text, room))
}

pub fn display_title(row: &PaperRow) -> &str {
    if row.plain_title.trim().is_empty() {
        row.paper_title.trim()
    } else {
        row.plain_title.trim()
    }
}

/// Posts built straight from the submission's own words (no AI).
pub fn offline_posts(row: &PaperRow, thread: bool, today: &str) -> Posts {
    let title = display_title(row);
    let authors = squash(&row.authors);
    let abs = squash(&row.public_abstract);
    let link = row.paper_link.trim();
    let lead = squash(&format!("USMCC Featured Paper — {title}: {abs}"));
    let twitter = with_link(&lead, link, 280);
    let bluesky = with_link(&lead, link, 300);
    let mut linkedin = format!("USMCC Featured Paper: {title}");
    if !authors.is_empty() {
        linkedin.push_str(&format!("\n\nBy {authors}."));
    }
    linkedin.push_str(&format!("\n\n{abs}"));
    if !link.is_empty() {
        linkedin.push_str(&format!("\n\nRead the paper: {link}"));
    }
    let thread = thread.then(|| {
        let mut parts = Vec::new();
        let head = if authors.is_empty() { format!("USMCC Featured Paper — {title}") } else { format!("USMCC Featured Paper — {title} · {authors}") };
        parts.push(clip(&squash(&head), 280));
        parts.push(with_link(&abs, link, 280));
        parts
    });
    let summary = abs.clone();
    let markdown = hugo_markdown(row, &summary, today);
    Posts { twitter, thread, bluesky, linkedin, summary, markdown }
}

fn yaml(s: &str) -> String {
    s.replace('\'', "''").replace(['\r', '\n'], " ").trim().to_string()
}

/// `YYYY-MM-DD` from an ISO date or Sheets' `M/D/YYYY …`.
fn iso_date(s: &str) -> Option<String> {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() >= 10 && b[4] == b'-' && b[7] == b'-' && s[..4].bytes().all(|c| c.is_ascii_digit()) {
        return Some(s[..10].to_string());
    }
    let first = s.split_whitespace().next()?;
    let p: Vec<&str> = first.split('/').collect();
    if p.len() == 3 {
        let (m, d, y): (u32, u32, u32) = (p[0].parse().ok()?, p[1].parse().ok()?, p[2].parse().ok()?);
        if (1..=12).contains(&m) && (1..=31).contains(&d) && y >= 1900 {
            return Some(format!("{y:04}-{m:02}-{d:02}"));
        }
    }
    None
}

/// The website's press item (Hugo + Blowfish `index.md`).
pub fn hugo_markdown(row: &PaperRow, body: &str, today: &str) -> String {
    let title = display_title(row);
    let date = iso_date(&row.publication_date).or_else(|| iso_date(&row.timestamp)).unwrap_or_else(|| today.to_string());
    let source = if row.category.trim().is_empty() { format!("USMCC, {date}") } else { format!("{}, {date}", row.category.trim()) };
    let body = if body.trim().is_empty() { row.public_abstract.trim() } else { body.trim() };
    format!(
        "---\ntitle: '{}'\ndescription: '{}'\nexternalUrl: '{}'\ndate: '{}'\nshowDate: true\ncascade:\n  showReadingTime: false\n---\n\n{}\n",
        yaml(title),
        yaml(&source),
        yaml(&row.paper_link),
        date,
        body
    )
}

pub const SYSTEM_PROMPT: &str = "You are a science communicator for the US Muon Collider Collaboration (USMCC). \
You translate physics papers into accurate, engaging publicity copy for non-expert audiences.\n\n\
Rules you never break:\n\
- Use only facts present in the inputs. Do not invent results, numbers, collaborators, or affiliations.\n\
- Credit the author list or collaboration exactly as provided.\n\
- No hype words (\"revolutionary\", \"groundbreaking\", \"game-changing\").\n\
- No formulas, no LaTeX, no jargon left undefined for general audiences.";

/// The one request that writes every post: (system, user message).
pub fn posts_prompt(row: &PaperRow, thread: bool) -> (String, String) {
    let link = row.paper_link.trim();
    let thread_rule = if thread {
        "- thread: a Twitter/X thread of 2–5 tweets, each at most 280 characters, numbered like \"1/\". Tweet 1 says this is a USMCC Featured Paper; the last tweet includes the link."
    } else {
        "- thread: an empty array."
    };
    let figures_rule = if row.figures_ok { "" } else { "\nThe authors have not cleared figures for reposting: never mention figures, images, or \"swipe\"." };
    let user = format!(
        "Write publicity copy for a USMCC Featured Paper. Fill every field:\n\
         - twitter: one Twitter/X post, at most 280 characters including the link, at most one emoji and two hashtags. Open with \"USMCC Featured Paper:\" (or a close natural variant) and end with the link.\n\
         {thread_rule}\n\
         - bluesky: one Bluesky post, at most 300 characters, no hashtags. Open with \"USMCC Featured Paper:\" (or a close natural variant) and end with the link.\n\
         - linkedin: a LinkedIn post of 100–200 words, professional tone, no emoji, paragraphs separated by blank lines. Begin with a clear \"USMCC Featured Paper:\" framing; end with the link and the author credit.\n\
         - summary: a plain-language summary for a curious member of the public, 120–180 words. Define any physics jargon on first use. No formulas.{figures_rule}\n\n\
         Link: {link}\n\
         Title: {}\n\
         Plain-language title: {}\n\
         Authors: {}\n\
         Category: {}\n\
         Abstract: {}\n\
         Comments from the authors: {}",
        row.paper_title.trim(),
        row.plain_title.trim(),
        row.authors.trim(),
        row.category.trim(),
        row.public_abstract.trim(),
        row.additional_comments.trim(),
    );
    (SYSTEM_PROMPT.to_string(), user)
}

pub fn posts_schema() -> Value {
    let s = json!({ "type": "string" });
    json!({
        "type": "object",
        "properties": {
            "twitter": s,
            "thread": { "type": "array", "items": { "type": "string" } },
            "bluesky": s,
            "linkedin": s,
            "summary": s,
        },
        "required": ["twitter", "thread", "bluesky", "linkedin", "summary"],
        "additionalProperties": false,
    })
}

/// Claude's JSON answer → posts (markdown built here from the summary).
pub fn posts_from_claude(row: &PaperRow, answer: &str, thread: bool, today: &str) -> Result<Posts, String> {
    let v: Value = serde_json::from_str(answer.trim()).map_err(|_| "Claude's answer wasn't the expected JSON".to_string())?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    let th: Vec<String> = v.get("thread").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|t| t.as_str()).map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect()).unwrap_or_default();
    let summary = s("summary");
    Ok(Posts {
        twitter: s("twitter"),
        thread: (thread && !th.is_empty()).then_some(th),
        bluesky: s("bluesky"),
        linkedin: s("linkedin"),
        markdown: hugo_markdown(row, &summary, today),
        summary,
    })
}

/// Days since 1970-01-01 → `YYYY-MM-DD` (civil calendar).
pub fn date_from_days(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

/* ------------------------------------------------------------ TeX → text */

/// LaTeX in a title, abstract, author list or caption turned into readable
/// Unicode: `$τ^+τ^-$` → `τ⁺τ⁻`, `$\gtrsim 10^{34}$` → `≳10³⁴`,
/// `\"{o}` → `ö`, `--` → `–`, `\text{TeV}` → `TeV`. Not a TeX engine: it
/// keeps the words and the common symbols and drops the rest.
pub fn detex(s: &str) -> String {
    let src: Vec<char> = s.chars().collect();
    let mut i = 0;
    let raw = tex_run(&src, &mut i, false, Stop::End);
    tidy(&raw)
}

#[derive(Clone, Copy, PartialEq)]
enum Stop {
    End,
    Brace,
    Dollar,
    Dollar2,
    Paren,
    Bracket,
}

const RELATIONS: &str = "→←↔⇒⇔≈∼≳≲≃≤≥≠≪≫∝≡∈=<>";

fn tex_run(src: &[char], i: &mut usize, math: bool, stop: Stop) -> String {
    let mut out = String::new();
    while *i < src.len() {
        let c = src[*i];
        match c {
            '}' if stop == Stop::Brace => {
                *i += 1;
                return out;
            }
            '}' => *i += 1,
            '{' => {
                *i += 1;
                out.push_str(&tex_run(src, i, math, Stop::Brace));
            }
            '$' if math && stop == Stop::Dollar2 && src.get(*i + 1) == Some(&'$') => {
                *i += 2;
                return out;
            }
            '$' if math && stop == Stop::Dollar => {
                *i += 1;
                return out;
            }
            '$' => {
                if src.get(*i + 1) == Some(&'$') {
                    *i += 2;
                    out.push_str(&tex_run(src, i, true, Stop::Dollar2));
                } else {
                    *i += 1;
                    out.push_str(&tex_run(src, i, true, Stop::Dollar));
                }
            }
            ']' if stop == Stop::Bracket => {
                *i += 1;
                return out;
            }
            '\\' => {
                *i += 1;
                let Some(&n) = src.get(*i) else { break };
                if n.is_ascii_alphabetic() {
                    let start = *i;
                    while *i < src.len() && src[*i].is_ascii_alphabetic() {
                        *i += 1;
                    }
                    let name: String = src[start..*i].iter().collect();
                    let r = command(src, i, math, &name);
                    push_math(&mut out, &r, math);
                    if !math {
                        // a word command eats the spaces after it, unless it wrote nothing
                        // visible and a word follows
                        if !r.is_empty() && !r.ends_with(' ') {
                            while *i < src.len() && src[*i] == ' ' && src.get(*i + 1).is_some_and(|c| !c.is_alphanumeric()) {
                                *i += 1;
                            }
                        }
                    }
                } else {
                    *i += 1;
                    match n {
                        ')' if stop == Stop::Paren => return out,
                        '(' => out.push_str(&tex_run(src, i, true, Stop::Paren)),
                        '[' => out.push_str(&tex_run(src, i, true, Stop::Bracket)),
                        ',' | ';' | ':' | ' ' | '>' => out.push(' '),
                        '!' => {}
                        '\\' => out.push(' '),
                        '%' | '&' | '$' | '#' | '_' | '{' | '}' => out.push(n),
                        '"' | '\'' | '`' | '^' | '~' | '=' | '.' => {
                            let a = read_arg(src, i, math);
                            out.push_str(&accent(n, &a));
                        }
                        _ => out.push(n),
                    }
                }
            }
            '^' | '_' if math => {
                *i += 1;
                let a = read_arg(src, i, true);
                out.push_str(&script(&a, c == '^'));
            }
            '~' => {
                *i += 1;
                out.push(' ');
            }
            '-' if !math => {
                if src.get(*i + 1) == Some(&'-') && src.get(*i + 2) == Some(&'-') {
                    *i += 3;
                    out.push('—');
                } else if src.get(*i + 1) == Some(&'-') {
                    *i += 2;
                    out.push('–');
                } else {
                    *i += 1;
                    out.push('-');
                }
            }
            '-' => {
                *i += 1;
                out.push('−');
            }
            '`' if !math => {
                if src.get(*i + 1) == Some(&'`') {
                    *i += 2;
                    out.push('“');
                } else {
                    *i += 1;
                    out.push('‘');
                }
            }
            '\'' if !math => {
                if src.get(*i + 1) == Some(&'\'') {
                    *i += 2;
                    out.push('”');
                } else {
                    *i += 1;
                    out.push('’');
                }
            }
            '\'' => {
                *i += 1;
                out.push('′');
            }
            c if math && c.is_whitespace() => *i += 1,
            c if math && "=<>".contains(c) => {
                *i += 1;
                push_math(&mut out, &c.to_string(), true);
            }
            _ => {
                *i += 1;
                out.push(c);
            }
        }
    }
    out
}

/// Math output: relations get a space either side, unless they open the
/// formula (`$\sim 10$` → `∼10`).
fn push_math(out: &mut String, r: &str, math: bool) {
    let rel = math && r.chars().count() == 1 && RELATIONS.contains(r);
    if rel && !out.trim().is_empty() {
        out.push(' ');
        out.push_str(r);
        out.push(' ');
    } else {
        out.push_str(r);
    }
}

/// One argument: a `{group}`, a `\command` or a single character.
fn read_arg(src: &[char], i: &mut usize, math: bool) -> String {
    while *i < src.len() && src[*i] == ' ' {
        *i += 1;
    }
    let Some(&c) = src.get(*i) else { return String::new() };
    match c {
        '{' => {
            *i += 1;
            tex_run(src, i, math, Stop::Brace)
        }
        '\\' => {
            *i += 1;
            let start = *i;
            while *i < src.len() && src[*i].is_ascii_alphabetic() {
                *i += 1;
            }
            if *i == start {
                *i += 1;
                return src.get(start).map(|c| c.to_string()).unwrap_or_default();
            }
            let name: String = src[start..*i].iter().collect();
            command(src, i, math, &name)
        }
        _ => {
            *i += 1;
            if math && c == '-' {
                "−".into()
            } else {
                c.to_string()
            }
        }
    }
}

/// Skip `[optional]` arguments.
fn skip_opt(src: &[char], i: &mut usize) {
    loop {
        let mut j = *i;
        while j < src.len() && src[j] == ' ' {
            j += 1;
        }
        if src.get(j) != Some(&'[') {
            return;
        }
        let mut depth = 0;
        while j < src.len() {
            match src[j] {
                '[' | '{' => depth += 1,
                ']' | '}' => {
                    depth -= 1;
                    if depth == 0 {
                        j += 1;
                        break;
                    }
                }
                _ => {}
            }
            j += 1;
        }
        *i = j;
    }
}

fn command(src: &[char], i: &mut usize, math: bool, name: &str) -> String {
    if let Some(s) = symbol(name) {
        return s.to_string();
    }
    match name {
        // the words inside
        "text" | "textrm" | "textit" | "textbf" | "textsf" | "texttt" | "textup" | "textsc" | "textnormal" | "emph" | "mbox" | "hbox" | "textmd" => {
            skip_opt(src, i);
            read_arg(src, i, false)
        }
        "mathrm" | "mathit" | "mathbf" | "mathsf" | "mathtt" | "mathcal" | "mathbb" | "mathfrak" | "mathscr" | "boldsymbol" | "bm" | "operatorname" | "mathnormal" | "pmb" => read_arg(src, i, true),
        "sqrt" => {
            skip_opt(src, i);
            let a = read_arg(src, i, true);
            if a.chars().count() > 1 {
                format!("√({a})")
            } else {
                format!("√{a}")
            }
        }
        "frac" | "dfrac" | "tfrac" => {
            let a = read_arg(src, i, true);
            let b = read_arg(src, i, true);
            let wrap = |s: String| if s.chars().count() > 1 && s.chars().any(|c| "+−-".contains(c)) { format!("({s})") } else { s };
            format!("{}/{}", wrap(a), wrap(b))
        }
        "bar" | "overline" => mark(&read_arg(src, i, math), '\u{0304}', true),
        "hat" | "widehat" => mark(&read_arg(src, i, math), '\u{0302}', false),
        "tilde" | "widetilde" => mark(&read_arg(src, i, math), '\u{0303}', false),
        "vec" => mark(&read_arg(src, i, math), '\u{20D7}', false),
        "dot" => mark(&read_arg(src, i, math), '\u{0307}', false),
        "ddot" => mark(&read_arg(src, i, math), '\u{0308}', false),
        // accents written as letters: \c{c}, \v{c}, \u{g}, \H{o}, \k{a}, \r{a}
        "c" | "v" | "u" | "H" | "k" | "r" | "d" | "b" => {
            let m = name.chars().next().unwrap();
            let a = read_arg(src, i, math);
            accent(m, &a)
        }
        "href" => {
            let _url = read_arg(src, i, false);
            read_arg(src, i, math)
        }
        "url" | "nolinkurl" => read_arg(src, i, false),
        // references and bookkeeping: dropped with their arguments
        "label" | "ref" | "eqref" | "cref" | "Cref" | "autoref" | "pageref" | "cite" | "citep" | "citet" | "citealp" | "citeauthor" | "onlinecite" | "footnote" | "footnotemark" | "thanks" | "vspace" | "hspace" | "phantom" | "hphantom" | "vphantom" | "protect" | "index" | "nocite" | "includegraphics" | "color" | "textcolor" => {
            skip_opt(src, i);
            if matches!(name, "protect" | "footnotemark") {
                return String::new();
            }
            let _ = read_arg(src, i, math);
            if name == "textcolor" {
                return read_arg(src, i, math);
            }
            String::new()
        }
        // switches and spacing that leave nothing behind
        "rm" | "it" | "bf" | "em" | "sf" | "tt" | "sc" | "small" | "footnotesize" | "scriptsize" | "large" | "Large" | "displaystyle" | "textstyle" | "scriptstyle" | "left" | "right" | "big" | "Big" | "bigg" | "Bigg" | "bigl" | "bigr" | "Bigl" | "Bigr" | "limits" | "nolimits" | "centering" | "noindent" | "par" | "relax" => String::new(),
        "quad" | "qquad" | "enspace" | "thinspace" | "medspace" | "newline" | "linebreak" => " ".into(),
        // anything else: the name goes, any braced argument that follows stays as text
        _ => String::new(),
    }
}

fn symbol(name: &str) -> Option<&'static str> {
    Some(match name {
        "alpha" => "α",
        "beta" => "β",
        "gamma" => "γ",
        "delta" => "δ",
        "epsilon" | "varepsilon" => "ε",
        "zeta" => "ζ",
        "eta" => "η",
        "theta" => "θ",
        "vartheta" => "ϑ",
        "iota" => "ι",
        "kappa" => "κ",
        "lambda" => "λ",
        "mu" => "μ",
        "nu" => "ν",
        "xi" => "ξ",
        "pi" => "π",
        "varpi" => "ϖ",
        "rho" | "varrho" => "ρ",
        "sigma" => "σ",
        "varsigma" => "ς",
        "tau" => "τ",
        "upsilon" => "υ",
        "phi" | "varphi" => "φ",
        "chi" => "χ",
        "psi" => "ψ",
        "omega" => "ω",
        "Gamma" => "Γ",
        "Delta" => "Δ",
        "Theta" => "Θ",
        "Lambda" => "Λ",
        "Xi" => "Ξ",
        "Pi" => "Π",
        "Sigma" => "Σ",
        "Upsilon" => "Υ",
        "Phi" => "Φ",
        "Psi" => "Ψ",
        "Omega" => "Ω",
        "sim" => "∼",
        "gtrsim" | "gtrapprox" => "≳",
        "lesssim" | "lessapprox" => "≲",
        "approx" => "≈",
        "simeq" => "≃",
        "cong" => "≅",
        "times" => "×",
        "cdot" => "·",
        "pm" => "±",
        "mp" => "∓",
        "to" | "rightarrow" | "longrightarrow" => "→",
        "leftarrow" | "gets" | "longleftarrow" => "←",
        "leftrightarrow" | "longleftrightarrow" => "↔",
        "Rightarrow" | "implies" => "⇒",
        "Leftrightarrow" | "iff" => "⇔",
        "ell" => "ℓ",
        "infty" => "∞",
        "le" | "leq" | "leqslant" => "≤",
        "ge" | "geq" | "geqslant" => "≥",
        "neq" | "ne" => "≠",
        "ll" => "≪",
        "gg" => "≫",
        "propto" => "∝",
        "equiv" => "≡",
        "in" => "∈",
        "partial" => "∂",
        "nabla" => "∇",
        "hbar" => "ℏ",
        "prime" => "′",
        "dagger" => "†",
        "ddagger" => "‡",
        "circ" => "∘",
        "degree" | "textdegree" => "°",
        "cdots" | "ldots" | "dots" | "dotsc" | "textellipsis" => "…",
        "langle" => "⟨",
        "rangle" => "⟩",
        "sum" => "∑",
        "prod" => "∏",
        "int" => "∫",
        "perp" => "⊥",
        "parallel" => "∥",
        "star" => "⋆",
        "ast" => "∗",
        "bullet" | "textbullet" => "•",
        "otimes" => "⊗",
        "oplus" => "⊕",
        "AA" => "Å",
        "aa" => "å",
        "ae" => "æ",
        "AE" => "Æ",
        "oe" => "œ",
        "o" => "ø",
        "O" => "Ø",
        "ss" => "ß",
        "l" => "ł",
        "L" => "Ł",
        "i" => "ı",
        "j" => "ȷ",
        "textendash" => "–",
        "textemdash" => "—",
        "textpm" => "±",
        "texttimes" => "×",
        "textmu" | "micro" => "μ",
        "copyright" | "textcopyright" => "©",
        "LaTeX" => "LaTeX",
        "TeX" => "TeX",
        "ie" => "i.e.",
        "eg" => "e.g.",
        "etal" => "et al.",
        "percent" => "%",
        _ => return None,
    })
}

/// A combining mark over one or every character of a group.
fn mark(a: &str, m: char, every: bool) -> String {
    let mut out = String::new();
    for (k, c) in a.chars().enumerate() {
        out.push(c);
        if every || k == 0 {
            out.push(m);
        }
    }
    out
}

/// Accented letters, precomposed where they are common.
fn accent(m: char, a: &str) -> String {
    let mut cs = a.chars();
    let Some(b) = cs.next() else {
        return match m {
            '~' => "~".into(),
            '^' => "^".into(),
            _ => String::new(),
        };
    };
    let rest: String = cs.collect();
    let table: &[(char, &str, &str)] = &[
        ('"', "aeiouyAEIOU", "äëïöüÿÄËÏÖÜ"),
        ('\'', "aeiouyAEIOUYcnszCNSZ", "áéíóúýÁÉÍÓÚÝćńśźĆŃŚŹ"),
        ('`', "aeiouAEIOU", "àèìòùÀÈÌÒÙ"),
        ('^', "aeiouAEIOU", "âêîôûÂÊÎÔÛ"),
        ('~', "anoANO", "ãñõÃÑÕ"),
        ('c', "csCS", "çşÇŞ"),
        ('v', "csznrezCSZNREZ", "čšžňřěžČŠŽŇŘĚŽ"),
        ('=', "aeiouAEIOU", "āēīōūĀĒĪŌŪ"),
        ('u', "agAG", "ăğĂĞ"),
        ('H', "ouOU", "őűŐŰ"),
        ('.', "zZ", "żŻ"),
        ('k', "aeAE", "ąęĄĘ"),
        ('r', "auAU", "åůÅŮ"),
    ];
    for (mm, from, to) in table {
        if *mm == m {
            if let Some(p) = from.chars().position(|c| c == b) {
                return format!("{}{rest}", to.chars().nth(p).unwrap());
            }
        }
    }
    let comb = match m {
        '"' => '\u{0308}',
        '\'' => '\u{0301}',
        '`' => '\u{0300}',
        '^' => '\u{0302}',
        '~' => '\u{0303}',
        'c' => '\u{0327}',
        'v' => '\u{030C}',
        '=' => '\u{0304}',
        'u' => '\u{0306}',
        'H' => '\u{030B}',
        '.' => '\u{0307}',
        'k' => '\u{0328}',
        'r' => '\u{030A}',
        'd' => '\u{0323}',
        'b' => '\u{0331}',
        _ => return format!("{b}{rest}"),
    };
    format!("{b}{comb}{rest}")
}

/// `^{…}` and `_{…}` as Unicode super- and subscripts where every character
/// has one; otherwise `^(…)`, or a subscript written inline.
fn script(a: &str, sup: bool) -> String {
    const SUP_FROM: &str = "0123456789+-−=()ni";
    const SUP_TO: &str = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾ⁿⁱ";
    const SUB_FROM: &str = "0123456789+-−=()aeoxhklmnpst";
    const SUB_TO: &str = "₀₁₂₃₄₅₆₇₈₉₊₋₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜ";
    let a = a.trim();
    if a.is_empty() {
        return String::new();
    }
    // primes, stars and daggers already sit high
    if sup && a.chars().all(|c| "′″‴*∗†‡".contains(c)) {
        return a.to_string();
    }
    let (from, to) = if sup { (SUP_FROM, SUP_TO) } else { (SUB_FROM, SUB_TO) };
    let mapped: Option<String> = a.chars().map(|c| from.chars().position(|f| f == c).map(|p| to.chars().nth(p).unwrap())).collect();
    match mapped {
        Some(m) => m,
        None if sup && a.chars().count() == 1 => format!("^{a}"),
        None if sup => format!("^({a})"),
        None => a.to_string(),
    }
}

/// Collapse spaces (keeping line breaks, at most one blank line), drop
/// spaces before closing punctuation, and the doubled full stop a removed
/// reference leaves (`Ref.~\cite{x}.`).
fn tidy(s: &str) -> String {
    let lines: Vec<String> = s.split('\n').map(|l| l.split_whitespace().collect::<Vec<_>>().join(" ")).collect();
    let mut joined = String::new();
    let mut blank = 0;
    for l in lines {
        if l.is_empty() {
            blank += 1;
            continue;
        }
        if !joined.is_empty() {
            joined.push_str(if blank > 0 { "\n\n" } else { "\n" });
        }
        blank = 0;
        joined.push_str(&l);
    }
    let cs: Vec<char> = joined.chars().collect();
    let mut out = String::with_capacity(joined.len());
    let mut dropped_space = false;
    for (k, &c) in cs.iter().enumerate() {
        if c == ' ' {
            let next = cs.get(k + 1).copied().unwrap_or(' ');
            let prev = if k > 0 { cs[k - 1] } else { ' ' };
            if ",.;:)]!?".contains(next) || "([".contains(prev) {
                dropped_space = true;
                continue;
            }
        }
        if c == '.' && dropped_space && out.ends_with('.') && !out.ends_with("..") {
            dropped_space = false;
            continue;
        }
        dropped_space = false;
        out.push(c);
    }
    out
}

/// Whitespace, newlines included, as single spaces.
fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/* ------------------------------------------------------------ arXiv metadata */

fn xml_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(p) = rest.find('&') {
        out.push_str(&rest[..p]);
        rest = &rest[p..];
        let Some(end) = rest.find(';').filter(|&e| e <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..end];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The text of every `<tag …>…</tag>` in `s` (not nested), in order.
fn xml_all<'a>(s: &'a str, tag: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut rest = s;
    while let Some(p) = rest.find(&open) {
        let after = &rest[p + open.len()..];
        // `<title>` but not `<titles>`
        if !after.starts_with(['>', ' ', '\n', '\t', '/']) {
            rest = after;
            continue;
        }
        let Some(gt) = after.find('>') else { break };
        if after[..gt].ends_with('/') {
            out.push("");
            rest = &after[gt + 1..];
            continue;
        }
        let body = &after[gt + 1..];
        let Some(end) = body.find(&close) else { break };
        out.push(&body[..end]);
        rest = &body[end + close.len()..];
    }
    out
}

fn xml_attr<'a>(s: &'a str, tag: &str, attr: &str) -> Option<&'a str> {
    let p = s.find(&format!("<{tag}"))?;
    let t = &s[p..p + s[p..].find('>')?];
    let a = t.find(&format!("{attr}=\""))? + attr.len() + 2;
    Some(&t[a..a + t[a..].find('"')?])
}

/// The paper's fields from the export.arxiv.org Atom feed for one id.
pub fn arxiv_meta(atom: &str) -> Result<PaperRow, String> {
    let entry = xml_all(atom, "entry").into_iter().next().ok_or("arXiv has no paper with that id")?;
    let get = |tag: &str| xml_all(entry, tag).first().map(|s| xml_unescape(s)).unwrap_or_default();
    let idurl = get("id");
    if idurl.contains("/api/errors") || idurl.is_empty() {
        return Err("arXiv has no paper with that id".into());
    }
    let id = arxiv_id(&idurl).ok_or("arXiv sent an id this app doesn't recognise")?;
    let id = strip_version(&id).to_string();
    let authors: Vec<String> = xml_all(entry, "author").iter().filter_map(|a| xml_all(a, "name").first().map(|n| xml_unescape(n).trim().to_string())).filter(|n| !n.is_empty()).collect();
    let published = get("published");
    Ok(PaperRow {
        paper_title: detex(&one_line(&get("title"))),
        authors: detex(&one_line(&authors.join(", "))),
        publication_date: published.chars().take(10).collect(),
        category: xml_attr(entry, "arxiv:primary_category", "term").unwrap_or("").to_string(),
        public_abstract: detex(&one_line(&get("summary"))),
        paper_link: format!("https://arxiv.org/abs/{id}"),
        ..Default::default()
    })
}

/* ------------------------------------------------------------ figure captions */

/// TeX source with `%` comments removed.
fn strip_comments(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    for line in t.lines() {
        let b = line.as_bytes();
        let mut cut = line.len();
        let mut k = 0;
        while k < b.len() {
            if b[k] == b'\\' {
                k += 2;
                continue;
            }
            if b[k] == b'%' {
                cut = k;
                break;
            }
            k += 1;
        }
        out.push_str(&line[..cut]);
        out.push('\n');
    }
    out
}

/// The `{…}` group starting at byte `at` (which must be `{`): its inside,
/// and the byte after its closing brace.
fn brace_group(s: &str, at: usize) -> Option<(&str, usize)> {
    let b = s.as_bytes();
    if b.get(at) != Some(&b'{') {
        return None;
    }
    let mut depth = 0;
    let mut k = at;
    while k < b.len() {
        match b[k] {
            b'\\' => k += 1,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((&s[at + 1..k], k + 1));
                }
            }
            _ => {}
        }
        k += 1;
    }
    None
}

/// Skip spaces and `[…]` optional arguments from byte `k`.
fn skip_opts(s: &str, mut k: usize) -> usize {
    let b = s.as_bytes();
    loop {
        while k < b.len() && (b[k] as char).is_whitespace() {
            k += 1;
        }
        if b.get(k) != Some(&b'[') {
            return k;
        }
        let mut depth = 0;
        while k < b.len() {
            match b[k] {
                b'[' | b'{' => depth += 1,
                b']' | b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        k += 1;
                        break;
                    }
                }
                _ => {}
            }
            k += 1;
        }
    }
}

/// The main TeX file with its `\input`/`\include` files put in place, then
/// any other TeX files: the figures in the order a reader meets them.
fn expanded_tex(texs: &[(String, String)]) -> String {
    fn find<'a>(texs: &'a [(String, String)], name: &str) -> Option<&'a (String, String)> {
        let n = name.trim().trim_start_matches("./");
        let n = n.strip_suffix(".tex").unwrap_or(n);
        texs.iter().find(|(p, _)| {
            let p = p.strip_suffix(".tex").unwrap_or(p);
            p == n || p.ends_with(&format!("/{n}"))
        })
    }
    fn expand(texs: &[(String, String)], body: &str, seen: &mut Vec<String>, depth: usize, out: &mut String) {
        let mut rest = body;
        loop {
            let next = ["\\input", "\\include", "\\subfile"].iter().filter_map(|c| rest.find(c).map(|p| (p, c.len()))).min();
            let Some((p, l)) = next else { break };
            out.push_str(&rest[..p]);
            let after = &rest[p + l..];
            // \input{x} or \input x
            let (name, used) = if let Some((g, end)) = brace_group(after, after.find('{').filter(|&b| after[..b].trim().is_empty()).unwrap_or(usize::MAX)) {
                (g.to_string(), end)
            } else if after.starts_with(' ') {
                let w: String = after.trim_start().chars().take_while(|c| !c.is_whitespace()).collect();
                let used = after.len() - after.trim_start().len() + w.len();
                (w, used)
            } else {
                // \includegraphics, \includeonly…: not a file to put in place
                out.push_str(&rest[p..p + l]);
                rest = after;
                continue;
            };
            rest = &after[used..];
            if depth < 12 {
                if let Some((path, t)) = find(texs, &name) {
                    if !seen.contains(path) {
                        seen.push(path.clone());
                        expand(texs, t, seen, depth + 1, out);
                    }
                }
            }
        }
        out.push_str(rest);
    }
    let mut out = String::new();
    let mut seen = Vec::new();
    let main = texs.iter().find(|(_, t)| t.contains("\\documentclass") && t.contains("\\begin{document}")).or_else(|| texs.iter().find(|(_, t)| t.contains("\\documentclass")));
    if let Some((p, t)) = main {
        seen.push(p.clone());
        expand(texs, t, &mut seen, 0, &mut out);
    }
    for (p, t) in texs {
        if !seen.contains(p) {
            seen.push(p.clone());
            out.push('\n');
            expand(texs, t, &mut seen, 0, &mut out);
        }
    }
    out
}

/// Every `\includegraphics` in reading order, with the caption of the figure
/// environment it is in ("" outside one).
fn graphics_refs(tex: &str) -> Vec<(String, String)> {
    // figure environments: (start, end, caption)
    let mut envs: Vec<(usize, usize, String)> = Vec::new();
    let mut from = 0;
    while let Some(p) = tex[from..].find("\\begin{figure").map(|p| p + from) {
        let end = tex[p..].find("\\end{figure").map(|e| e + p).unwrap_or(tex.len());
        let body = &tex[p..end];
        // the main caption: not one inside a subfigure
        let mut outer = String::new();
        let mut rest = body;
        while let Some(s) = rest.find("\\begin{subfigure") {
            outer.push_str(&rest[..s]);
            match rest[s..].find("\\end{subfigure") {
                Some(e) => rest = &rest[s + e + 14..],
                None => {
                    rest = "";
                    break;
                }
            }
        }
        outer.push_str(rest);
        let caption = last_caption(&outer).or_else(|| last_caption(body)).unwrap_or_default();
        envs.push((p, end, caption));
        from = end.max(p + 1);
    }
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(p) = tex[from..].find("\\includegraphics").map(|p| p + from) {
        let mut k = p + "\\includegraphics".len();
        if tex[k..].starts_with('*') {
            k += 1;
        }
        let k = skip_opts(tex, k);
        if let Some((path, end)) = brace_group(tex, k) {
            let cap = envs.iter().find(|(s, e, _)| p > *s && p < *e).map(|e| e.2.clone()).unwrap_or_default();
            out.push((path.trim().to_string(), cap));
            from = end;
        } else {
            from = k;
        }
    }
    out
}

fn last_caption(body: &str) -> Option<String> {
    let mut found = None;
    let mut from = 0;
    while let Some(p) = body[from..].find("\\caption").map(|p| p + from) {
        let mut k = p + "\\caption".len();
        // \captionof{figure}{…} and \captionsetup are not captions of this figure
        if body[k..].starts_with("of") || body[k..].starts_with("setup") || body[k..].starts_with('s') {
            from = k;
            continue;
        }
        if body[k..].starts_with('*') {
            k += 1;
        }
        let k = skip_opts(body, k);
        match brace_group(body, k) {
            Some((c, end)) => {
                found = Some(detex(&one_line(c)));
                from = end;
            }
            None => from = k,
        }
    }
    found
}

fn without_ext(p: &str) -> &str {
    let p = p.trim_start_matches("./");
    match p.rsplit_once('.') {
        Some((stem, ext)) if !ext.contains('/') && (1..=4).contains(&ext.len()) && ext.chars().all(|c| c.is_ascii_alphanumeric()) => stem,
        _ => p,
    }
}

/// Which figure file a `\includegraphics{ref}` means: the file whose path
/// without extension ends with the reference without extension, preferring
/// PDF, then PNG, then JPEG, as pdflatex does.
fn match_ref(names: &[&str], r: &str) -> Option<usize> {
    let want = without_ext(r);
    if want.is_empty() {
        return None;
    }
    let rank = |n: &str| match n.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).as_deref() {
        Some("pdf") => 0,
        Some("png") => 1,
        Some("jpg") | Some("jpeg") => 2,
        _ => 3,
    };
    names
        .iter()
        .enumerate()
        .filter(|(_, n)| {
            let s = without_ext(n);
            s == want || s.ends_with(&format!("/{want}"))
        })
        .min_by_key(|(_, n)| rank(n))
        .map(|(k, _)| k)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TIMESTAMP: &str = "2024-01-15 10:30:00";
    const TITLE: &str = "Novel Muon Collider Design";
    const PLAIN: &str = "A Better Way to Collide Muons";
    const AUTHORS: &str = "C. Anderson, S. Neddermeyer";
    const ABSTRACT: &str = "This paper presents a novel design for a muon collider. The design achieves higher luminosity with reduced beam emittance.";
    const LINK: &str = "https://arxiv.org/abs/2401.12345";
    const COMMENTS: &str = "Please highlight the energy efficiency aspect.";

    fn cols() -> Vec<&'static str> {
        vec![TIMESTAMP, "author@example.com", TITLE, PLAIN, AUTHORS, "2024-01-10", "accelerator", ABSTRACT, LINK, "Yes", COMMENTS]
    }

    #[test]
    fn bare_row() {
        let r = parse_row(&cols().join("\t")).unwrap();
        assert_eq!(r.paper_title, TITLE);
        assert_eq!(r.authors, AUTHORS);
        assert_eq!(r.public_abstract, ABSTRACT);
        assert!(r.figures_ok);
        assert_eq!(r.additional_comments, COMMENTS);
    }

    #[test]
    fn row_with_header() {
        let header = "Timestamp\tEmail Address\tPaper Title\tOptional less technical title\tAuthor list / Collaboration\tDate of publication or posting\tCategory\tPublic abstract/description\tLink to paper\tFigures/materials OK to repost?\tAdditional comments?";
        let r = parse_row(&format!("{header}\n{}", cols().join("\t"))).unwrap();
        assert_eq!(r.paper_title, TITLE);
        assert_eq!(r.public_abstract, ABSTRACT);
    }

    #[test]
    fn quoted_multiline_abstract() {
        let mut c = cols();
        c[7] = "\"This paper presents a novel design.\nIt achieves higher luminosity with \"\"unprecedented\"\" precision.\"";
        let r = parse_row(&c.join("\t")).unwrap();
        assert!(r.public_abstract.contains("\"unprecedented\""));
        assert!(r.public_abstract.contains('\n'));
        assert!(!r.public_abstract.starts_with('"'));
        assert_eq!(r.paper_link, LINK);
        assert_eq!(r.additional_comments, COMMENTS);
    }

    #[test]
    fn missing_trailing_columns() {
        let r = parse_row(&cols()[..9].join("\t")).unwrap();
        assert!(!r.figures_ok);
        assert_eq!(r.additional_comments, "");
        assert_eq!(r.paper_title, TITLE);
    }

    #[test]
    fn missing_title_or_abstract() {
        let mut c = cols();
        c[2] = "";
        assert!(parse_row(&c.join("\t")).is_err());
        let mut c = cols();
        c[7] = "";
        assert!(parse_row(&c.join("\t")).is_err());
        assert!(parse_row("   ").is_err());
    }

    #[test]
    fn collaboration_name() {
        let mut c = cols();
        c[4] = "USMCC Collaboration";
        assert_eq!(parse_row(&c.join("\t")).unwrap().authors, "USMCC Collaboration");
    }

    #[test]
    fn arxiv_ids() {
        let ok = |s: &str, id: &str| assert_eq!(arxiv_id(s).as_deref(), Some(id), "{s}");
        ok("https://arxiv.org/abs/2401.12345", "2401.12345");
        ok("https://arxiv.org/pdf/2401.12345.pdf", "2401.12345");
        ok("https://arxiv.org/pdf/2401.12345", "2401.12345");
        ok("https://arxiv.org/abs/2401.12345v3", "2401.12345v3");
        ok("https://arxiv.org/abs/hep-th/0701123", "hep-th/0701123");
        ok("https://arxiv.org/e-print/2401.12345", "2401.12345");
        ok("https://arxiv.org/src/2401.12345", "2401.12345");
        ok("https://export.arxiv.org/abs/2401.01234?context=hep-ex", "2401.01234");
        ok("2401.12345", "2401.12345");
        ok(" arXiv:2401.12345v2 ", "2401.12345v2");
        ok("physics.acc-ph/0501001", "physics.acc-ph/0501001");
        assert_eq!(arxiv_id("https://example.com/paper.pdf"), None);
        assert_eq!(arxiv_id(""), None);
        assert_eq!(arxiv_id("https://arxiv.org/list/hep-ex/new"), None);
        assert_eq!(arxiv_id("12345"), None);
    }

    fn tar_header(name: &str, size: usize, kind: u8) -> Vec<u8> {
        let mut h = vec![0u8; 512];
        h[..name.len().min(100)].copy_from_slice(&name.as_bytes()[..name.len().min(100)]);
        h[100..108].copy_from_slice(b"0000644\0");
        h[124..136].copy_from_slice(format!("{size:011o}\0").as_bytes());
        h[136..148].copy_from_slice(b"00000000000\0");
        h[156] = kind;
        h[257..263].copy_from_slice(b"ustar\0");
        h[263..265].copy_from_slice(b"00");
        h[148..156].copy_from_slice(b"        ");
        let sum: usize = h.iter().map(|&b| b as usize).sum();
        h[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
        h
    }

    fn tar(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        for (name, data) in files {
            if name.len() > 100 {
                let mut n = name.as_bytes().to_vec();
                n.push(0);
                out.extend(tar_header("././@LongLink", n.len(), b'L'));
                out.extend(&n);
                out.resize(out.len().div_ceil(512) * 512, 0);
            }
            out.extend(tar_header(name, data.len(), b'0'));
            out.extend(*data);
            out.resize(out.len().div_ceil(512) * 512, 0);
        }
        out.extend(vec![0u8; 1024]);
        out
    }

    fn gzip(data: &[u8]) -> Vec<u8> {
        let mut out = vec![0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3];
        out.extend(miniz_oxide::deflate::compress_to_vec(data, 6));
        out.extend([0u8; 8]); // crc + size (not checked)
        out
    }

    #[test]
    fn figures_from_tar_gz() {
        let long = format!("figures/{}/plot.pdf", "a".repeat(120));
        let t = tar(&[
            ("main.tex", b"\\documentclass{article}"),
            ("figs/beam.png", b"\x89PNG fake"),
            (".hidden.png", b"x"),
            ("__MACOSX/figs/._beam.png", b"x"),
            (&long, b"%PDF-1.4 fake"),
            ("photo.JPG", b"\xff\xd8 fake"),
        ]);
        let figs = figures_from_archive(&gzip(&t)).unwrap();
        let names: Vec<&str> = figs.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["figs/beam.png", long.as_str(), "photo.JPG"]);
        assert_eq!(figs[1].mime, "application/pdf");
        assert_eq!(figs[2].mime, "image/jpeg");
        assert_eq!(figs[0].data, b"\x89PNG fake");
        // a plain tar works too
        assert_eq!(figures_from_archive(&t).unwrap().len(), 3);
    }

    #[test]
    fn single_tex_and_junk() {
        let e = figures_from_archive(&gzip(b"\\documentclass{article}\\begin{document}hi\\end{document}")).err().unwrap();
        assert!(e.contains("single TeX file"), "{e}");
        assert!(figures_from_archive(b"%PDF-1.5 ...").is_err());
        assert!(figures_from_archive(b"hello").is_err());
        assert!(figures_from_archive(&gzip(&tar(&[("main.tex", b"x")]))).err().unwrap().contains("no PNG"));
    }

    #[test]
    fn base64_matches() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn offline_posts_fit() {
        let mut r = parse_row(&cols().join("\t")).unwrap();
        r.public_abstract = "word ".repeat(200);
        let p = offline_posts(&r, true, "2026-11-18");
        assert!(p.twitter.chars().count() <= 280, "{}", p.twitter.chars().count());
        assert!(p.bluesky.chars().count() <= 300);
        assert!(p.twitter.ends_with(LINK));
        assert!(p.twitter.starts_with("USMCC Featured Paper — A Better Way"));
        let t = p.thread.unwrap();
        assert_eq!(t.len(), 2);
        assert!(t.iter().all(|x| x.chars().count() <= 280));
        assert!(p.markdown.starts_with("---\ntitle: 'A Better Way to Collide Muons'\n"));
        assert!(p.markdown.contains("date: '2024-01-10'"));
        assert!(offline_posts(&r, false, "x").thread.is_none());
    }

    #[test]
    fn markdown_dates() {
        let mut r = PaperRow { paper_title: "It's".into(), public_abstract: "A".into(), ..Default::default() };
        assert!(hugo_markdown(&r, "", "2026-11-18").contains("date: '2026-11-18'"));
        assert!(hugo_markdown(&r, "", "2026-11-18").contains("title: 'It''s'"));
        r.timestamp = "1/5/2025 10:00:00".into();
        assert!(hugo_markdown(&r, "", "2026-11-18").contains("date: '2025-01-05'"));
        assert_eq!(date_from_days(0), "1970-01-01");
        assert_eq!(date_from_days(20_000), "2024-10-04");
    }

    #[test]
    fn claude_answer() {
        let r = parse_row(&cols().join("\t")).unwrap();
        let p = posts_from_claude(&r, r#"{"twitter":"t","thread":["a","b"],"bluesky":"b","linkedin":"l","summary":"s"}"#, true, "2026-01-01").unwrap();
        assert_eq!(p.thread.unwrap(), vec!["a", "b"]);
        assert!(p.markdown.contains("\ns\n"));
        assert!(posts_from_claude(&r, "nope", false, "").is_err());
        let (_, user) = posts_prompt(&r, false);
        assert!(user.contains("thread: an empty array"));
    }

    #[test]
    fn detex_fixture_strings() {
        assert_eq!(detex("Probing $τ$ lepton dipole moments at multi-TeV muon colliders"), "Probing τ lepton dipole moments at multi-TeV muon colliders");
        assert_eq!(detex(r"a luminosity of $\gtrsim 10^{34}$ cm$^{-2}$ s$^{-1}$ at $10\,\text{TeV}$"), "a luminosity of ≳10³⁴ cm⁻² s⁻¹ at 10 TeV");
        assert_eq!(detex(r"$τ^+τ^-$ production through $μ^+μ^-$ annihilation"), "τ⁺τ⁻ production through μ⁺μ⁻ annihilation");
        assert_eq!(detex(r"the radiative Higgs decay $H\toτ^+τ^-γ$."), "the radiative Higgs decay H → τ⁺τ⁻γ.");
        assert_eq!(detex(r"For a $10$~TeV muon collider with $10\,\mathrm{ab}^{-1}$"), "For a 10 TeV muon collider with 10 ab⁻¹");
        assert_eq!(detex(r"$|Δa_τ|<1.2\times10^{-5}$, $|d_τ^Z|<1.0\times10^{-19}\,e\,\mathrm{cm}$"), "|Δaτ| < 1.2×10⁻⁵, |dτ^Z| < 1.0×10⁻¹⁹ e cm");
        assert_eq!(detex(r"at the nominal $95\%$ confidence level"), "at the nominal 95% confidence level");
        assert_eq!(detex(r"$\sqrt{s}=10$ TeV and $\bar{\nu}$, $\sigma(\mu^+\mu^-\to hh)\sim 1$ fb"), "√s = 10 TeV and ν̄, σ(μ⁺μ⁻ → hh) ∼ 1 fb");
        assert_eq!(detex(r#"Schr\"odinger, Ma\v{c}ek, Fran\c{c}ois, Jos\'{e} --- a ``test'' of `quotes'"#), "Schrödinger, Maček, François, José — a “test” of ‘quotes’");
        assert_eq!(detex(r"\textit{Snowmass} 2021--2022 \emph{report}, \textbf{U.S.} plan"), "Snowmass 2021–2022 report, U.S. plan");
        assert_eq!(detex(r"$m_{H}$, $x_{12}$, $e^{i\pi}$"), "mH, x₁₂, e^(iπ)");
        // plain text goes through untouched
        let plain = "Input to the SCAC Facilities Subcommittee from the U.S. Muon Collider Collaboration (USMCC): 50% more.";
        assert_eq!(detex(plain), plain);
    }

    #[test]
    fn rows_are_detexed() {
        let row = format!("2026-11-16\tx@y.z\t{}\t\tA. B\\\"ohm, C. D\t2026-11-16\thep-ph\t{}\thttps://arxiv.org/abs/2611.21813\tYes\t", "Probing $τ$ lepton dipole moments", r"We reach $\gtrsim 10^{34}$ cm$^{-2}$ s$^{-1}$.");
        let r = parse_row(&row).unwrap();
        assert_eq!(r.paper_title, "Probing τ lepton dipole moments");
        assert_eq!(r.authors, "A. Böhm, C. D");
        assert_eq!(r.public_abstract, "We reach ≳10³⁴ cm⁻² s⁻¹.");
    }

    const ATOM: &str = r#"<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <id>https://arxiv.org/api/6QbbGE7Yr2LeiyxsM9GGtEMiEQs</id>
  <title>arXiv Query: search_query=&amp;id_list=2611.21813&amp;start=0&amp;max_results=10</title>
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2611.21813v1</id>
    <title>Probing $τ$ lepton dipole moments at multi-TeV muon colliders</title>
    <updated>2026-11-16T19:29:17Z</updated>
    <link href="https://arxiv.org/abs/2611.21813v1" rel="alternate" type="text/html"/>
    <summary>We investigate the sensitivity of future multi-TeV muon colliders to the electromagnetic and weak dipole moments of the $τ$ lepton. We obtain $|Δa_τ|&lt;1.2\times10^{-5}$ at $95\%$ CL.</summary>
    <category term="hep-ph" scheme="http://arxiv.org/schemas/atom"/>
    <published>2026-11-16T19:29:17Z</published>
    <arxiv:comment>40 pages, 21 figures</arxiv:comment>
    <arxiv:primary_category term="hep-ph"/>
    <author>
      <name>Dario Buttazzo</name>
    </author>
    <author>
      <name>Gabriele Levati</name>
    </author>
    <author>
      <name>ZeQiang Wang</name>
    </author>
  </entry>
</feed>"#;

    #[test]
    fn arxiv_metadata() {
        let r = arxiv_meta(ATOM).unwrap();
        assert_eq!(r.paper_title, "Probing τ lepton dipole moments at multi-TeV muon colliders");
        assert_eq!(r.authors, "Dario Buttazzo, Gabriele Levati, ZeQiang Wang");
        assert_eq!(r.public_abstract, "We investigate the sensitivity of future multi-TeV muon colliders to the electromagnetic and weak dipole moments of the τ lepton. We obtain |Δaτ| < 1.2×10⁻⁵ at 95% CL.");
        assert_eq!(r.publication_date, "2026-11-16");
        assert_eq!(r.category, "hep-ph");
        assert_eq!(r.paper_link, "https://arxiv.org/abs/2611.21813");
        assert!(!r.figures_ok);
        assert_eq!(r.plain_title, "");
        let empty = r#"<feed xmlns="http://www.w3.org/2005/Atom"><title>arXiv Query</title><opensearch:totalResults>0</opensearch:totalResults></feed>"#;
        assert!(arxiv_meta(empty).unwrap_err().contains("no paper"));
        let error = r#"<feed><entry><id>http://arxiv.org/api/errors#incorrect_id_format_for_1234</id><title>Error</title><summary>incorrect id format</summary></entry></feed>"#;
        assert!(arxiv_meta(error).unwrap_err().contains("no paper"));
    }

    #[test]
    fn figure_captions_and_order() {
        let main = br#"\documentclass{article}
\graphicspath{{figures/}}
\begin{document}
\input{sections/intro}
% \includegraphics{figures/commented}
\begin{figure*}[t]
  \centering
  \begin{subfigure}{0.45\textwidth}\includegraphics[width=\linewidth]{reach}\caption{left panel}\end{subfigure}
  \begin{subfigure}{0.45\textwidth}\includegraphics[width=\linewidth]{figures/flux.png}\caption{right}\end{subfigure}
  \caption[Short]{Reach for new particles at $\sqrt{s}=10$~TeV, see Ref.~\cite{x}.\label{fig:reach}}
\end{figure*}
\end{document}"#;
        let intro = br"\section{Intro} \begin{figure}\includegraphics[scale=.5]{./figures/layout}\caption{The ring layout (to scale).}\end{figure}";
        let t = tar(&[
            ("main.tex", main),
            ("sections/intro.tex", intro),
            ("figures/flux.png", b"\x89PNG flux"),
            ("figures/reach.pdf", b"%PDF reach"),
            ("figures/reach.png", b"\x89PNG reach copy"),
            ("figures/layout.jpg", b"\xff\xd8 layout"),
            ("figures/commented.png", b"\x89PNG unused"),
        ]);
        let figs = figures_from_archive(&gzip(&t)).unwrap();
        let got: Vec<(&str, &str)> = figs.iter().map(|f| (f.name.as_str(), f.caption.as_str())).collect();
        assert_eq!(
            got,
            vec![
                ("figures/layout.jpg", "The ring layout (to scale)."),
                ("figures/reach.pdf", "Reach for new particles at √s = 10 TeV, see Ref."),
                ("figures/flux.png", "Reach for new particles at √s = 10 TeV, see Ref."),
                ("figures/reach.png", ""),
                ("figures/commented.png", ""),
            ]
        );
        let j = figures_json(&figs);
        assert_eq!(j["figures"][0]["caption"], "The ring layout (to scale).");
    }
}

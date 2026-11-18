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
        paper_title: cols[2].clone(),
        plain_title: cols[3].clone(),
        authors: cols[4].clone(),
        publication_date: cols[5].clone(),
        category: cols[6].clone(),
        public_abstract: cols[7].clone(),
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
    let mut out: Vec<Figure> = Vec::new();
    let mut total = 0usize;
    for (name, body) in tar_entries(&data) {
        if out.len() >= MAX_FIGURES || total >= MAX_TOTAL_BYTES {
            break;
        }
        let Some(mime) = figure_mime(&name) else { continue };
        if hidden(&name) || body.is_empty() || body.len() > MAX_FIGURE_BYTES {
            continue;
        }
        total += body.len();
        out.push(Figure { name, mime, data: body.to_vec() });
    }
    if out.is_empty() {
        return Err("The paper's source has no PNG, JPEG, SVG or PDF figures".into());
    }
    Ok(out)
}

pub fn figures_json(figs: &[Figure]) -> Value {
    json!({
        "figures": figs.iter().map(|f| json!({ "name": f.name, "mime": f.mime, "data": base64(&f.data) })).collect::<Vec<_>>()
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
}

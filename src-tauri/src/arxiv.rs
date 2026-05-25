use base64::Engine;
use flate2::read::GzDecoder;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::io::Read;
use tar::Archive;

const MAX_TARBALL_BYTES: usize = 100 * 1024 * 1024;
const MAX_FIGURE_BYTES: usize = 20 * 1024 * 1024;
const MAX_FIGURES: usize = 30;
const USER_AGENT: &str =
    "USMCCPublicityHelper/0.1 (+https://github.com/lawrenceleejr/USMCCPaperPublicityHelper)";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArxivFigure {
    pub filename: String,
    pub mime_type: String,
    pub data_base64: String,
}

/// Pull the arXiv identifier (e.g. `2401.12345`, `2401.12345v3`, `hep-th/0701123`)
/// out of any of the common URL shapes: `/abs/...`, `/pdf/...`, `/e-print/...`,
/// `/format/...`, with or without a `.pdf` suffix.
pub fn extract_arxiv_id(url: &str) -> Option<String> {
    let trimmed = url.trim();
    let lower = trimmed.to_lowercase();
    let needle = "arxiv.org/";
    let pos = lower.find(needle)?;
    let mut after = &trimmed[pos + needle.len()..];
    for prefix in ["abs/", "pdf/", "e-print/", "format/", "ftp/arxiv/papers/"] {
        if let Some(stripped) = after.strip_prefix(prefix) {
            after = stripped;
            break;
        }
    }
    let id: String = after
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '/' || *c == '-')
        .collect();
    let id = id.trim_end_matches(".pdf").trim_end_matches('/').to_string();
    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}

pub fn eprint_url(arxiv_id: &str) -> String {
    format!("https://arxiv.org/e-print/{arxiv_id}")
}

pub fn pdf_url(arxiv_id: &str) -> String {
    format!("https://arxiv.org/pdf/{arxiv_id}.pdf")
}

pub async fn fetch_paper_pdf(arxiv_id: &str) -> Result<ArxivFigure, String> {
    let url = pdf_url(arxiv_id);
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error fetching {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("arXiv returned HTTP {status} for {url}"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read PDF body: {e}"))?;
    if bytes.len() > MAX_TARBALL_BYTES {
        return Err(format!(
            "Paper PDF is {} bytes; exceeds {}-byte cap",
            bytes.len(),
            MAX_TARBALL_BYTES
        ));
    }
    // Sanity-check the magic bytes so we don't ship an HTML error page to the
    // frontend as if it were a PDF.
    if bytes.len() < 4 || &bytes[0..4] != b"%PDF" {
        return Err(
            "Response was not a PDF (the paper may not have a public PDF on arXiv).".to_string(),
        );
    }
    Ok(ArxivFigure {
        filename: format!("{arxiv_id}.pdf"),
        mime_type: "application/pdf".to_string(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

pub async fn fetch_figures(arxiv_id: &str) -> Result<Vec<ArxivFigure>, String> {
    let url = eprint_url(arxiv_id);
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error fetching {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "arXiv returned HTTP {status} for {url}. Some papers do not publish source."
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read arXiv response body: {e}"))?;
    if bytes.len() > MAX_TARBALL_BYTES {
        return Err(format!(
            "arXiv source is {} bytes; exceeds {}-byte cap",
            bytes.len(),
            MAX_TARBALL_BYTES
        ));
    }
    extract_figures_from_response(&bytes, &content_type)
}

fn extract_figures_from_response(bytes: &[u8], content_type: &str) -> Result<Vec<ArxivFigure>, String> {
    // Try gzipped tar (the common case)
    if let Ok(figures) = try_extract_gzipped_tar(bytes) {
        if !figures.is_empty() {
            return Ok(figures);
        }
        // Fall through and report the most helpful error below.
    }
    // Try raw tar (uncompressed archive — rare but possible)
    if let Ok(figures) = try_extract_tar(bytes) {
        if !figures.is_empty() {
            return Ok(figures);
        }
    }
    // Detect single-file cases: a paper that submits only a .tex file is served as a plain
    // gzip of the tex source (1f 8b magic, but no tar inside). A PDF-only submission is
    // served as a literal PDF.
    let magic = sniff_magic(bytes);
    Err(match magic {
        Magic::Gzip => {
            "arXiv returned a gzipped single file (no tarball, no image figures). \
             This usually means the submission is a single .tex file with no graphics."
                .to_string()
        }
        Magic::Pdf => {
            "arXiv returned a PDF-only submission (no LaTeX source). Image figures cannot \
             be extracted; download the PDF directly to use its rasters."
                .to_string()
        }
        Magic::Tar => "Archive parsed but contained no png/jpg/gif/pdf/eps files.".to_string(),
        Magic::Unknown => format!(
            "Could not recognise the arXiv source format (content-type {content_type:?}, \
             {} bytes). The submission may have been withdrawn or be source-restricted.",
            bytes.len()
        ),
    })
}

fn try_extract_gzipped_tar(bytes: &[u8]) -> Result<Vec<ArxivFigure>, String> {
    if bytes.len() < 2 || bytes[0] != 0x1f || bytes[1] != 0x8b {
        return Err("not gzipped".to_string());
    }
    let gz = GzDecoder::new(bytes);
    let mut archive = Archive::new(gz);
    collect_image_entries(&mut archive)
}

fn try_extract_tar(bytes: &[u8]) -> Result<Vec<ArxivFigure>, String> {
    if bytes.len() < 512 {
        return Err("too short to be a tar".to_string());
    }
    // POSIX tar header has "ustar" at byte 257. Some tars omit it; check anyway.
    let mut archive = Archive::new(bytes);
    collect_image_entries(&mut archive)
}

fn collect_image_entries<R: std::io::Read>(
    archive: &mut Archive<R>,
) -> Result<Vec<ArxivFigure>, String> {
    let entries = archive
        .entries()
        .map_err(|e| format!("Could not iterate tar entries: {e}"))?;
    let mut figures = Vec::new();
    for entry in entries {
        let mut entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = match entry.path() {
            Ok(p) => p.to_path_buf(),
            Err(_) => continue,
        };
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase());
        let mime = match ext.as_deref() {
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            Some("gif") => "image/gif",
            Some("pdf") => "application/pdf",
            Some("eps") | Some("ps") => "application/postscript",
            _ => continue,
        };
        let declared_size = entry.header().size().unwrap_or(0) as usize;
        if declared_size > MAX_FIGURE_BYTES {
            continue;
        }
        let mut buffer = Vec::with_capacity(declared_size.min(MAX_FIGURE_BYTES));
        if entry.read_to_end(&mut buffer).is_err() {
            continue;
        }
        if buffer.len() > MAX_FIGURE_BYTES {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("figure")
            .to_string();
        figures.push(ArxivFigure {
            filename,
            mime_type: mime.to_string(),
            data_base64: base64::engine::general_purpose::STANDARD.encode(&buffer),
        });
        if figures.len() >= MAX_FIGURES {
            break;
        }
    }
    Ok(figures)
}

enum Magic {
    Gzip,
    Pdf,
    Tar,
    Unknown,
}

fn sniff_magic(bytes: &[u8]) -> Magic {
    if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        return Magic::Gzip;
    }
    if bytes.len() >= 4 && &bytes[0..4] == b"%PDF" {
        return Magic::Pdf;
    }
    if bytes.len() >= 262 && &bytes[257..262] == b"ustar" {
        return Magic::Tar;
    }
    Magic::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_from_abs_url() {
        assert_eq!(
            extract_arxiv_id("https://arxiv.org/abs/2401.12345"),
            Some("2401.12345".to_string())
        );
    }

    #[test]
    fn extracts_from_pdf_url_with_suffix() {
        assert_eq!(
            extract_arxiv_id("https://arxiv.org/pdf/2401.12345.pdf"),
            Some("2401.12345".to_string())
        );
    }

    #[test]
    fn extracts_from_pdf_url_without_suffix() {
        assert_eq!(
            extract_arxiv_id("https://arxiv.org/pdf/2401.12345"),
            Some("2401.12345".to_string())
        );
    }

    #[test]
    fn extracts_with_version_suffix() {
        assert_eq!(
            extract_arxiv_id("https://arxiv.org/abs/2401.12345v3"),
            Some("2401.12345v3".to_string())
        );
    }

    #[test]
    fn extracts_old_style_id() {
        assert_eq!(
            extract_arxiv_id("https://arxiv.org/abs/hep-th/0701123"),
            Some("hep-th/0701123".to_string())
        );
    }

    #[test]
    fn extracts_from_eprint_url() {
        assert_eq!(
            extract_arxiv_id("https://arxiv.org/e-print/2401.12345"),
            Some("2401.12345".to_string())
        );
    }

    #[test]
    fn returns_none_for_non_arxiv_url() {
        assert_eq!(extract_arxiv_id("https://example.com/paper.pdf"), None);
        assert_eq!(extract_arxiv_id(""), None);
    }

    #[test]
    fn eprint_url_uses_https() {
        assert_eq!(
            eprint_url("2401.12345"),
            "https://arxiv.org/e-print/2401.12345"
        );
    }
}

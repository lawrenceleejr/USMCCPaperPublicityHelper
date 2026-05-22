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

pub async fn fetch_figures(arxiv_id: &str) -> Result<Vec<ArxivFigure>, String> {
    let url = eprint_url(arxiv_id);
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Could not build HTTP client: {e}"))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch arXiv source: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("arXiv returned status {status} for {url}"));
    }
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
    extract_figures_from_gzipped_tar(&bytes)
}

fn extract_figures_from_gzipped_tar(bytes: &[u8]) -> Result<Vec<ArxivFigure>, String> {
    let gz = GzDecoder::new(bytes);
    let mut archive = Archive::new(gz);
    let entries = archive
        .entries()
        .map_err(|e| format!("Could not open tar archive (is this a gzipped tar?): {e}"))?;

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

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

pub fn parse_row(text: &str) -> Result<PaperRow, String> {
    let text = text.trim();

    // Strip header line if present
    let data_line = if let Some(first_line) = text.lines().next() {
        if first_line.starts_with("Timestamp") {
            let lines: Vec<&str> = text.lines().collect();
            if lines.len() < 2 {
                return Err("Input has header but no data row".to_string());
            }
            lines[1]
        } else {
            text
        }
    } else {
        return Err("Empty input".to_string());
    };

    let raw_cols: Vec<&str> = data_line.split('\t').collect();

    let mut cols: Vec<String> = raw_cols.iter().map(|s| unwrap_quoted(s.trim())).collect();
    while cols.len() < 11 {
        cols.push(String::new());
    }

    let paper_title = cols[2].clone();
    let public_abstract = cols[7].clone();

    if paper_title.is_empty() {
        return Err("Paper title is required (column 3)".to_string());
    }
    if public_abstract.is_empty() {
        return Err("Public abstract is required (column 8)".to_string());
    }

    let figures_ok = cols[9].to_lowercase() == "yes";

    Ok(PaperRow {
        timestamp: cols[0].clone(),
        email: cols[1].clone(),
        paper_title,
        plain_title: cols[3].clone(),
        authors: cols[4].clone(),
        publication_date: cols[5].clone(),
        category: cols[6].clone(),
        public_abstract,
        paper_link: cols[8].clone(),
        figures_ok,
        additional_comments: cols[10].clone(),
    })
}

fn unwrap_quoted(s: &str) -> String {
    let s = s.trim();
    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
        let inner = &s[1..s.len() - 1];
        inner.replace("\"\"", "\"")
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_row(cols: &[&str]) -> String {
        cols.join("\t")
    }

    const TIMESTAMP: &str = "2024-01-15 10:30:00";
    const EMAIL: &str = "author@example.com";
    const TITLE: &str = "Novel Muon Collider Design";
    const PLAIN_TITLE: &str = "A Better Way to Collide Muons";
    const AUTHORS: &str = "C. Anderson, S. Neddermeyer";
    const DATE: &str = "2024-01-10";
    const CATEGORY: &str = "accelerator";
    const ABSTRACT: &str = "This paper presents a novel design for a muon collider. The design achieves higher luminosity with reduced beam emittance.";
    const LINK: &str = "https://arxiv.org/abs/2401.12345";
    const FIGURES: &str = "Yes";
    const COMMENTS: &str = "Please highlight the energy efficiency aspect.";

    fn sample_cols() -> Vec<&'static str> {
        vec![
            TIMESTAMP, EMAIL, TITLE, PLAIN_TITLE, AUTHORS, DATE, CATEGORY, ABSTRACT, LINK,
            FIGURES, COMMENTS,
        ]
    }

    #[test]
    fn test_valid_bare_row() {
        let row = make_row(&sample_cols());
        let result = parse_row(&row).unwrap();
        assert_eq!(result.paper_title, TITLE);
        assert_eq!(result.authors, AUTHORS);
        assert_eq!(result.public_abstract, ABSTRACT);
        assert!(result.figures_ok);
        assert_eq!(result.additional_comments, COMMENTS);
    }

    #[test]
    fn test_row_with_header() {
        let header = "Timestamp\tEmail Address\tPaper Title\tOptional less technical title\tAuthor list / Collaboration\tDate of publication or posting\tCategory\tPublic abstract/description\tLink to paper\tFigures/materials OK to repost?\tAdditional comments?";
        let data = make_row(&sample_cols());
        let input = format!("{}\n{}", header, data);
        let result = parse_row(&input).unwrap();
        assert_eq!(result.paper_title, TITLE);
        assert_eq!(result.public_abstract, ABSTRACT);
    }

    #[test]
    fn test_quoted_multiline_abstract() {
        let abstract_with_quotes = "\"This paper presents a novel design.\nIt achieves higher luminosity with \"\"unprecedented\"\" precision.\"";
        let mut cols = sample_cols();
        cols[7] = abstract_with_quotes;
        let row = make_row(&cols);
        let result = parse_row(&row).unwrap();
        assert!(result.public_abstract.contains("\"unprecedented\""));
        assert!(!result.public_abstract.starts_with('"'));
    }

    #[test]
    fn test_missing_trailing_columns() {
        let cols = vec![
            TIMESTAMP, EMAIL, TITLE, PLAIN_TITLE, AUTHORS, DATE, CATEGORY, ABSTRACT, LINK,
        ];
        let row = make_row(&cols);
        let result = parse_row(&row).unwrap();
        assert!(!result.figures_ok);
        assert_eq!(result.additional_comments, "");
    }

    #[test]
    fn test_missing_title_returns_error() {
        let mut cols = sample_cols();
        cols[2] = "";
        let row = make_row(&cols);
        assert!(parse_row(&row).is_err());
    }

    #[test]
    fn test_missing_abstract_returns_error() {
        let mut cols = sample_cols();
        cols[7] = "";
        let row = make_row(&cols);
        assert!(parse_row(&row).is_err());
    }

    #[test]
    fn test_exactly_nine_columns() {
        let cols = vec![
            TIMESTAMP, EMAIL, TITLE, PLAIN_TITLE, AUTHORS, DATE, CATEGORY, ABSTRACT, LINK,
        ];
        let row = make_row(&cols);
        let result = parse_row(&row).unwrap();
        assert_eq!(result.paper_title, TITLE);
    }

    #[test]
    fn test_collaboration_name() {
        let mut cols = sample_cols();
        cols[4] = "USMCC Collaboration";
        let row = make_row(&cols);
        let result = parse_row(&row).unwrap();
        assert_eq!(result.authors, "USMCC Collaboration");
    }
}

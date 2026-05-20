import Foundation

public struct ArxivService {
    /// Detects arXiv ID from a URL or bare ID string.
    /// Supports formats: "2401.12345", "2401.12345v2", "https://arxiv.org/abs/2401.12345", "https://arxiv.org/pdf/2401.12345v1"
    public static func extractArxivID(from string: String) -> String? {
        let pattern = #"\b(\d{4}\.\d{4,5})(v\d+)?\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(string.startIndex..., in: string)
        guard let match = regex.firstMatch(in: string, range: range) else { return nil }
        guard let idRange = Range(match.range(at: 1), in: string) else { return nil }
        return String(string[idRange])
    }

    /// Fetches arXiv metadata XML for a given arXiv ID.
    /// Uses https://export.arxiv.org/abs/{id}
    public static func fetchMetadata(for arxivID: String) async throws -> String {
        let url = URL(string: "https://export.arxiv.org/abs/\(arxivID)")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return String(data: data, encoding: .utf8) ?? ""
    }
}

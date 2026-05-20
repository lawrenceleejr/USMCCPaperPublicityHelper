import Foundation

public struct MarkdownGenerator {
    public static func generate(from submission: PaperSubmission) -> String {
        let dateString: String
        if submission.publicationDate.trimmingCharacters(in: .whitespaces).isEmpty {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            dateString = formatter.string(from: Date())
        } else {
            dateString = submission.publicationDate
        }

        var md = """
        ---
        title: "\(submission.paperTitle)"
        externalUrl: \(submission.paperLink)
        showDate: true
        date: \(dateString)
        cascade:
          showReadingTime: false
        ---
        \(submission.publicAbstract)
        """

        if !submission.authors.trimmingCharacters(in: .whitespaces).isEmpty {
            md += "\n\n*Authors: \(submission.authors)*"
        }

        if !submission.additionalComments.trimmingCharacters(in: .whitespaces).isEmpty {
            md += "\n\n\(submission.additionalComments)"
        }

        return md
    }
}

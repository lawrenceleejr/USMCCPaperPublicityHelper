import Foundation

public struct TSVParser {
    /// Parses a single tab-delimited row pasted from Google Sheets.
    /// Column order: timestamp, email, paperTitle, optionalTitle, authors,
    /// publicationDate, category, publicAbstract, paperLink, agreedToPublish, additionalComments
    public static func parse(_ tsv: String) -> PaperSubmission? {
        let columns = tsv.components(separatedBy: "\t")
        guard columns.count >= 9 else { return nil }

        let timestamp = columns[0]
        let email = columns[1]
        let paperTitle = columns[2]
        let optionalTitle = columns[3]
        let authors = columns[4]
        let publicationDate = columns[5]
        let category = columns[6]
        let publicAbstract = columns[7]
        let paperLink = columns[8]
        let agreedToPublish = columns.count > 9 ? columns[9].uppercased() == "TRUE" : false
        let additionalComments = columns.count > 10 ? columns[10] : ""

        return PaperSubmission(
            timestamp: timestamp,
            email: email,
            paperTitle: paperTitle,
            optionalTitle: optionalTitle,
            authors: authors,
            publicationDate: publicationDate,
            category: category,
            publicAbstract: publicAbstract,
            paperLink: paperLink,
            agreedToPublish: agreedToPublish,
            additionalComments: additionalComments
        )
    }
}

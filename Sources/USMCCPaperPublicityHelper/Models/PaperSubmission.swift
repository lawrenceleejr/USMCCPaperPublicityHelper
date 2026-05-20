import Foundation

public struct PaperSubmission: Identifiable, Equatable {
    public var id = UUID()
    public var timestamp: String
    public var email: String
    public var paperTitle: String
    public var optionalTitle: String
    public var authors: String
    public var publicationDate: String
    public var category: String
    public var publicAbstract: String
    public var paperLink: String
    public var agreedToPublish: Bool
    public var additionalComments: String

    public var isValid: Bool {
        !paperTitle.trimmingCharacters(in: .whitespaces).isEmpty &&
        !publicAbstract.trimmingCharacters(in: .whitespaces).isEmpty &&
        !paperLink.trimmingCharacters(in: .whitespaces).isEmpty
    }

    public init(
        timestamp: String = "",
        email: String = "",
        paperTitle: String = "",
        optionalTitle: String = "",
        authors: String = "",
        publicationDate: String = "",
        category: String = "",
        publicAbstract: String = "",
        paperLink: String = "",
        agreedToPublish: Bool = false,
        additionalComments: String = ""
    ) {
        self.timestamp = timestamp
        self.email = email
        self.paperTitle = paperTitle
        self.optionalTitle = optionalTitle
        self.authors = authors
        self.publicationDate = publicationDate
        self.category = category
        self.publicAbstract = publicAbstract
        self.paperLink = paperLink
        self.agreedToPublish = agreedToPublish
        self.additionalComments = additionalComments
    }
}

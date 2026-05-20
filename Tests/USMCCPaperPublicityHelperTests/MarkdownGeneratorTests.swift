import XCTest
@testable import USMCCPaperPublicityHelperCore

final class MarkdownGeneratorTests: XCTestCase {
    func testBasicOutput() {
        var s = PaperSubmission()
        s.paperTitle = "Test Paper"
        s.paperLink = "https://arxiv.org/abs/2401.12345"
        s.publicAbstract = "A great abstract."
        s.publicationDate = "2024-01-15"
        let md = MarkdownGenerator.generate(from: s)
        XCTAssertTrue(md.contains("title: \"Test Paper\""))
        XCTAssertTrue(md.contains("externalUrl: https://arxiv.org/abs/2401.12345"))
        XCTAssertTrue(md.contains("date: 2024-01-15"))
        XCTAssertTrue(md.contains("A great abstract."))
    }

    func testAuthorsAppended() {
        var s = PaperSubmission()
        s.paperTitle = "Title"
        s.paperLink = "https://example.com"
        s.publicAbstract = "Abstract"
        s.authors = "Alice, Bob"
        let md = MarkdownGenerator.generate(from: s)
        XCTAssertTrue(md.contains("*Authors: Alice, Bob*"))
    }

    func testEmptyAuthorsNotAppended() {
        var s = PaperSubmission()
        s.paperTitle = "Title"
        s.paperLink = "https://example.com"
        s.publicAbstract = "Abstract"
        let md = MarkdownGenerator.generate(from: s)
        XCTAssertFalse(md.contains("*Authors:"))
    }

    func testAdditionalCommentsAppended() {
        var s = PaperSubmission()
        s.paperTitle = "Title"
        s.paperLink = "https://example.com"
        s.publicAbstract = "Abstract"
        s.additionalComments = "See also: our blog post."
        let md = MarkdownGenerator.generate(from: s)
        XCTAssertTrue(md.contains("See also: our blog post."))
    }
}

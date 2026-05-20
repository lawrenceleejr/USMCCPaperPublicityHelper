import XCTest
@testable import USMCCPaperPublicityHelperCore

final class PaperSubmissionParserTests: XCTestCase {
    func testValidTSV() {
        let tsv = "2024-01-15\ttest@example.com\tMy Paper Title\tAlt Title\tAuthor A, Author B\t2024-01-15\tPhysics\tThis is the abstract.\thttps://arxiv.org/abs/2401.12345\tTRUE\tNo comments"
        let result = TSVParser.parse(tsv)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.paperTitle, "My Paper Title")
        XCTAssertEqual(result?.authors, "Author A, Author B")
        XCTAssertEqual(result?.agreedToPublish, true)
        XCTAssertTrue(result?.isValid ?? false)
    }

    func testTooFewColumns() {
        let tsv = "col1\tcol2\tcol3"
        XCTAssertNil(TSVParser.parse(tsv))
    }

    func testEmptyTitle() {
        let tsv = "2024-01-15\ttest@example.com\t\t\tAuthor\t2024-01-15\tPhysics\tAbstract\thttps://arxiv.org/abs/2401.12345\tTRUE\t"
        let result = TSVParser.parse(tsv)
        XCTAssertNotNil(result)
        XCTAssertFalse(result?.isValid ?? true)
    }

    func testFalseAgreedToPublish() {
        let tsv = "2024-01-15\ttest@example.com\tTitle\t\tAuthor\t2024-01-15\tPhysics\tAbstract\thttps://arxiv.org\tFALSE\t"
        let result = TSVParser.parse(tsv)
        XCTAssertEqual(result?.agreedToPublish, false)
    }
}

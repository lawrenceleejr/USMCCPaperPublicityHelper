import XCTest
@testable import USMCCPaperPublicityHelperCore

final class ArxivIDDetectorTests: XCTestCase {
    func testBareID() {
        XCTAssertEqual(ArxivService.extractArxivID(from: "2401.12345"), "2401.12345")
    }

    func testIDWithVersion() {
        XCTAssertEqual(ArxivService.extractArxivID(from: "2401.12345v2"), "2401.12345")
    }

    func testFullAbsURL() {
        XCTAssertEqual(ArxivService.extractArxivID(from: "https://arxiv.org/abs/2401.12345"), "2401.12345")
    }

    func testFullPDFURL() {
        XCTAssertEqual(ArxivService.extractArxivID(from: "https://arxiv.org/pdf/2401.12345v1"), "2401.12345")
    }

    func testInspireURL() {
        XCTAssertNil(ArxivService.extractArxivID(from: "https://inspirehep.net/literature/123456"))
    }

    func testNoID() {
        XCTAssertNil(ArxivService.extractArxivID(from: "https://example.com/paper"))
    }

    func testFiveDigitID() {
        XCTAssertEqual(ArxivService.extractArxivID(from: "2401.123456"), "2401.123456")
    }
}

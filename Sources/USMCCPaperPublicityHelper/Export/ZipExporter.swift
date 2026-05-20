import Foundation

public struct ZipExporter {
    public static func export(
        submission: PaperSubmission,
        panelImages: [Data],
        figures: [URL],
        markdownContent: String,
        to destinationURL: URL
    ) throws {
        let sanitizedTitle = sanitize(submission.paperTitle)
        let folderName = "\(sanitizedTitle)_USMCC"

        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        let folderURL = tempDir.appendingPathComponent(folderName)
        let panelsURL = folderURL.appendingPathComponent("panels")
        let figuresURL = folderURL.appendingPathComponent("figures")

        try FileManager.default.createDirectory(at: panelsURL, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: figuresURL, withIntermediateDirectories: true)

        let panelNames = ["01_cover.png", "02_abstract.png", "03_figure.png", "04_links.png"]
        for (index, imageData) in panelImages.enumerated() {
            let name = index < panelNames.count ? panelNames[index] : "\(String(format: "%02d", index + 1))_panel.png"
            try imageData.write(to: panelsURL.appendingPathComponent(name))
        }

        for figureURL in figures {
            let dest = figuresURL.appendingPathComponent(figureURL.lastPathComponent)
            try FileManager.default.copyItem(at: figureURL, to: dest)
        }

        try markdownContent.write(
            to: folderURL.appendingPathComponent("index.md"),
            atomically: true,
            encoding: .utf8
        )

        let errorPipe = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/zip")
        process.arguments = ["-r", destinationURL.path, folderName]
        process.currentDirectoryURL = tempDir
        process.standardError = errorPipe
        try process.run()
        process.waitUntilExit()

        let cleanupError: Error? = {
            do { try FileManager.default.removeItem(at: tempDir); return nil }
            catch { return error }
        }()

        guard process.terminationStatus == 0 else {
            let stderrData = errorPipe.fileHandleForReading.readDataToEndOfFile()
            let stderrText = String(data: stderrData, encoding: .utf8) ?? ""
            throw ZipExporterError.zipFailed(status: process.terminationStatus, detail: stderrText)
        }

        if let cleanupError {
            throw ZipExporterError.cleanupFailed(underlying: cleanupError)
        }
    }

    private static func sanitize(_ title: String) -> String {
        let sanitized = title.unicodeScalars.map { char -> Character in
            let c = Character(char)
            return c.isLetter || c.isNumber ? c : "_"
        }
        let result = String(sanitized)
        return String(result.prefix(50))
    }
}

public enum ZipExporterError: Error, LocalizedError {
    case zipFailed(status: Int32, detail: String)
    case cleanupFailed(underlying: Error)

    public var errorDescription: String? {
        switch self {
        case .zipFailed(let status, let detail):
            let message = "zip exited with status \(status)"
            return detail.isEmpty ? message : "\(message): \(detail)"
        case .cleanupFailed(let underlying):
            return "Failed to remove temporary directory: \(underlying.localizedDescription)"
        }
    }
}

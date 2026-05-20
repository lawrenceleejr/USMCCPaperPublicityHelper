// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "USMCCPaperPublicityHelper",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .target(
            name: "USMCCPaperPublicityHelperCore",
            path: "Sources/USMCCPaperPublicityHelper",
            exclude: ["App", "Views"]
        ),
        .testTarget(
            name: "USMCCPaperPublicityHelperTests",
            dependencies: ["USMCCPaperPublicityHelperCore"],
            path: "Tests/USMCCPaperPublicityHelperTests"
        )
    ]
)

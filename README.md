# USMCCPaperPublicityHelper

## What It Does

USMCCPaperPublicityHelper is a native macOS SwiftUI application that automates the creation of social-media publicity materials for papers submitted to the US Muon Collider Community (USMCC). It parses a Google Sheets row (tab-separated values) containing a paper submission, lets you review and edit the metadata, generates four 1080×1080 Instagram-ready panel images (cover, abstract, figure, links), produces Hugo/Blowfish front-matter markdown for the USMCC website, and packages everything into a single ZIP file ready for upload.

---

## Download the Latest Build

Pre-built macOS app bundles are produced automatically by GitHub Actions on every push to `main`.

1. Go to the [**Actions** tab](../../actions) of this repository.
2. Click the most recent **"Build and Test"** workflow run that shows a green checkmark.
3. Scroll to the **Artifacts** section at the bottom of the run page.
4. Download **`USMCCPaperPublicityHelper-macOS`** and unzip it.
5. Right-click `USMCCPaperPublicityHelper.app` → **Open** (required the first time to bypass Gatekeeper on an unsigned build).

---

## How to Use the App

1. **Open the app.** You will see a three-column layout: left (input), center (panel editor), right (markdown preview).
2. **Paste a Google Sheets row** into the text area at the top-left. Copy an entire row from the USMCC paper-submission spreadsheet and paste it. The fields below will populate automatically.
3. **Review and edit** any of the parsed fields (title, authors, abstract, link, etc.) directly in the form.
4. **Preview the panels** using the carousel at the top of the center column. The canvas shows how each Instagram panel will look.
5. **Preview the markdown** in the right column. Click **"Copy to Clipboard"** to grab it for manual use.
6. When all required fields are filled (green checkmark visible), click **"Export ZIP"** at the bottom-right. Choose a save location and the app writes the ZIP automatically.

---

## How to Use the Output

The exported ZIP contains:

```
YourTitle_USMCC/
├── panels/
│   ├── 01_cover.png
│   ├── 02_abstract.png
│   ├── 03_figure.png
│   └── 04_links.png
├── figures/         ← any attached figures
└── index.md         ← Hugo/Blowfish front-matter + abstract body
```

- **`panels/`** — Upload the PNG files directly to Instagram or other social platforms.
- **`index.md`** — Drop this file (with its folder) into the `content/papers/` directory of the [USMCC website repo](https://github.com/lawrenceleejr/usmccwebsite) and open a pull request. The Hugo/Blowfish theme will render the paper card automatically.

---

## For Developers

### Requirements

- macOS 13 Ventura or later
- Xcode 15 or later
- [xcodegen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)

### Build Locally

```bash
git clone https://github.com/lawrenceleejr/USMCCPaperPublicityHelper.git
cd USMCCPaperPublicityHelper
xcodegen generate          # creates USMCCPaperPublicityHelper.xcodeproj
open USMCCPaperPublicityHelper.xcodeproj
```

Press **⌘R** in Xcode to build and run.

### Run Unit Tests

The core logic (parser, markdown generator, arXiv ID detector) is covered by a Swift Package test suite that runs without Xcode:

```bash
swift test
```

### Project Layout

| Path | Purpose |
|---|---|
| `Sources/…/Models/` | `PaperSubmission` data model |
| `Sources/…/Parsers/` | `TSVParser` — parses Google Sheets rows |
| `Sources/…/Services/` | `ArxivService` — arXiv ID extraction & metadata fetch |
| `Sources/…/Generators/` | `MarkdownGenerator` — Hugo front-matter output |
| `Sources/…/Export/` | `ZipExporter` — bundles panels + markdown into ZIP |
| `Sources/…/App/` | SwiftUI `App` entry point + `ContentView` |
| `Sources/…/Views/` | Individual SwiftUI views |
| `Tests/` | XCTest unit tests for core logic |
| `project.yml` | xcodegen spec |
| `Package.swift` | Swift Package for `swift test` |
| `.github/workflows/build.yml` | CI: test + build + artifact upload |

---

## Related Links

- **USMCC Website repo (Hugo template):** <https://github.com/lawrenceleejr/usmccwebsite>
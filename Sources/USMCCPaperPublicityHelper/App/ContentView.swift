import SwiftUI
import AppKit

struct ContentView: View {
    @State private var rawTSV = ""
    @State private var submission = PaperSubmission()
    @State private var selectedPanelIndex = 0
    @State private var exportError: String? = nil
    @State private var showExportSuccess = false

    var body: some View {
        NavigationSplitView {
            PasteInputView(rawTSV: $rawTSV, submission: $submission)
                .frame(minWidth: 280)
        } content: {
            VStack(spacing: 0) {
                PanelCarouselView(selectedPanelIndex: $selectedPanelIndex)
                    .padding(.vertical, 8)
                Divider()
                PanelCanvasView(submission: submission, selectedPanelIndex: selectedPanelIndex)
                    .frame(width: 500, height: 500)
                    .padding()
                Spacer()
            }
            .frame(minWidth: 540)
        } detail: {
            VStack {
                MarkdownPreviewView(submission: submission)
                Divider()
                HStack {
                    Spacer()
                    Button("Export ZIP") {
                        exportZIP()
                    }
                    .disabled(!submission.isValid)
                    .buttonStyle(.borderedProminent)
                    .padding()
                }
            }
            .frame(minWidth: 300)
        }
        .onChange(of: rawTSV) { newValue in
            if let parsed = TSVParser.parse(newValue) {
                submission = parsed
            }
        }
        .alert("Export Successful", isPresented: $showExportSuccess) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Your ZIP file has been saved.")
        }
        .alert("Export Error", isPresented: Binding(
            get: { exportError != nil },
            set: { if !$0 { exportError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(exportError ?? "")
        }
    }

    private func exportZIP() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.zip]
        panel.nameFieldStringValue = "\(submission.paperTitle.isEmpty ? "export" : submission.paperTitle)_USMCC.zip"
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            do {
                let markdown = MarkdownGenerator.generate(from: submission)
                try ZipExporter.export(
                    submission: submission,
                    panelImages: [],
                    figures: [],
                    markdownContent: markdown,
                    to: url
                )
                showExportSuccess = true
            } catch {
                exportError = error.localizedDescription
            }
        }
    }
}

import SwiftUI
import AppKit

struct MarkdownPreviewView: View {
    let submission: PaperSubmission

    private var markdown: String {
        MarkdownGenerator.generate(from: submission)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Hugo/Blowfish Markdown")
                .font(.headline)
                .padding(.horizontal)
                .padding(.top)

            TextEditor(text: .constant(markdown))
                .font(.system(.body, design: .monospaced))
                .background(Color(white: 0.96))
                .disabled(true)
                .padding(.horizontal)

            HStack {
                Spacer()
                Button("Copy to Clipboard") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(markdown, forType: .string)
                }
                .padding()
            }
        }
    }
}

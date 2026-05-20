import SwiftUI

struct PasteInputView: View {
    @Binding var rawTSV: String
    @Binding var submission: PaperSubmission

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Paste Google Sheets row:")
                    .font(.headline)

                TextEditor(text: $rawTSV)
                    .font(.system(.body, design: .monospaced))
                    .frame(height: 80)
                    .border(Color.secondary.opacity(0.4))

                HStack {
                    Image(systemName: submission.isValid ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundColor(submission.isValid ? .green : .red)
                    Text(submission.isValid ? "Valid submission" : "Missing required fields")
                        .font(.caption)
                        .foregroundColor(submission.isValid ? .green : .red)
                }

                Divider()

                Form {
                    Section("Paper Info") {
                        TextField("Title", text: $submission.paperTitle)
                        TextField("Optional Title", text: $submission.optionalTitle)
                        TextField("Authors", text: $submission.authors)
                        TextField("Publication Date", text: $submission.publicationDate)
                        TextField("Category", text: $submission.category)
                    }

                    Section("Content") {
                        Text("Abstract")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        TextEditor(text: $submission.publicAbstract)
                            .frame(height: 100)
                            .border(Color.secondary.opacity(0.4))
                    }

                    Section("Links") {
                        TextField("Paper Link", text: $submission.paperLink)
                    }
                }
            }
            .padding()
        }
    }
}

import SwiftUI

struct PanelCanvasView: View {
    let submission: PaperSubmission
    let selectedPanelIndex: Int

    var body: some View {
        Group {
            switch selectedPanelIndex {
            case 0: coverPanel
            case 1: abstractPanel
            case 2: figurePanel
            case 3: linksPanel
            default: coverPanel
            }
        }
        .frame(width: 500, height: 500)
        .clipped()
    }

    // MARK: - Panel 0: Cover
    private var coverPanel: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.0, green: 0.3, blue: 0.8), Color(red: 0.5, green: 0.0, blue: 0.8)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            VStack(spacing: 16) {
                Text("USMCC")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.white)

                Text(submission.paperTitle.isEmpty ? "Paper Title" : submission.paperTitle)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                Text(submission.authors.isEmpty ? "Authors" : submission.authors)
                    .font(.system(size: 14))
                    .foregroundColor(.white.opacity(0.9))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                Text(submission.publicationDate.isEmpty ? "Date" : submission.publicationDate)
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.7))
            }
            .padding(32)
        }
    }

    // MARK: - Panel 1: Abstract
    private var abstractPanel: some View {
        ZStack(alignment: .leading) {
            Color.white

            HStack(spacing: 0) {
                Rectangle()
                    .fill(Color.blue)
                    .frame(width: 6)
                Spacer()
            }

            VStack(alignment: .leading, spacing: 16) {
                Text("Abstract")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.blue)

                ScrollView {
                    Text(submission.publicAbstract.isEmpty ? "Abstract text will appear here." : submission.publicAbstract)
                        .font(.system(size: 14))
                        .foregroundColor(.black)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Spacer()

                Text("USMCC Muon Collider")
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
            }
            .padding(.leading, 24)
            .padding([.top, .trailing, .bottom], 24)
        }
    }

    // MARK: - Panel 2: Figure
    private var figurePanel: some View {
        ZStack {
            Color(white: 0.93)

            VStack(spacing: 12) {
                Text("Figure Panel")
                    .font(.system(size: 24))
                    .foregroundColor(.gray)

                Text("Drag figures after fetching from arXiv")
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
            }
        }
    }

    // MARK: - Panel 3: Links
    private var linksPanel: some View {
        ZStack {
            Color.white

            VStack(spacing: 20) {
                Text("Learn More")
                    .font(.system(size: 20, weight: .bold))

                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.blue)
                    .frame(height: 50)
                    .overlay(
                        Text(submission.paperLink.isEmpty ? "https://arxiv.org/abs/…" : submission.paperLink)
                            .font(.system(size: 12))
                            .foregroundColor(.white)
                            .lineLimit(2)
                            .padding(.horizontal, 12)
                    )
                    .padding(.horizontal, 32)

                Spacer()

                Text("US Muon Collider Community")
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
            }
            .padding(32)
        }
    }
}

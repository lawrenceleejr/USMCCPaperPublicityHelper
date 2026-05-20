import SwiftUI

struct PanelCarouselView: View {
    @Binding var selectedPanelIndex: Int

    private let panels = ["Cover", "Abstract", "Figure", "Links"]

    var body: some View {
        HStack(spacing: 12) {
            ForEach(Array(panels.enumerated()), id: \.offset) { index, name in
                VStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.gray.opacity(0.2))
                        .frame(width: 80, height: 80)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(selectedPanelIndex == index ? Color.blue : Color.clear, lineWidth: 2)
                        )
                        .overlay(
                            Text(name)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        )
                    Text(name)
                        .font(.caption)
                        .foregroundColor(selectedPanelIndex == index ? .blue : .primary)
                }
                .onTapGesture {
                    selectedPanelIndex = index
                }
            }
        }
        .padding(.horizontal)
    }
}

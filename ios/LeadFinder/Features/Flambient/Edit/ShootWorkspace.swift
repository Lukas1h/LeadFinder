import SwiftUI

/// Cull and Edit for one shoot, switched with a segmented control. Undo/redo
/// live here because both modes share the Mac's single history.
struct ShootWorkspace: View {
    let store: ShootStore
    @Environment(\.dismiss) private var dismiss
    @State private var mode: Mode = .cull
    @State private var undoTick = 0

    enum Mode: String, CaseIterable { case cull = "Cull", edit = "Edit" }

    var body: some View {
        NavigationStack {
            Group {
                switch mode {
                case .cull: CullScreen(store: store)
                case .edit: EditScreen(store: store)
                }
            }
            .background(Theme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                }
                ToolbarItem(placement: .principal) {
                    Picker("Mode", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 150)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { undoTick += 1; store.undo() } label: { Image(systemName: "arrow.uturn.backward") }
                        .disabled(!store.canUndo)
                        .accessibilityLabel(store.undoName.map { "Undo \($0)" } ?? "Undo")
                    Button { undoTick += 1; store.redo() } label: { Image(systemName: "arrow.uturn.forward") }
                        .disabled(!store.canRedo)
                        .accessibilityLabel(store.redoName.map { "Redo \($0)" } ?? "Redo")
                }
            }
            .sensoryFeedback(.impact(weight: .light), trigger: undoTick)
            .sensoryFeedback(.selection, trigger: mode)
        }
        .tint(Theme.primaryText)
        .preferredColorScheme(.dark)
    }
}

#Preview {
    ShootWorkspace(store: .mock())
}

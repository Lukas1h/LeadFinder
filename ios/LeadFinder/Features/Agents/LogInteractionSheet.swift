import SwiftUI

/// Log something that happened outside the app, mirroring the web's
/// `AddInteractionDialog`: who reached out, how, and — for a call — how it
/// went, one question at a time rather than every combination as a list.
///
/// The outcome step only exists for calls. A text or an email either happened
/// or it didn't; a reply is its own inbound interaction.
struct LogInteractionSheet: View {
    let agentId: String
    let agentName: String
    /// Set when this follows a call placed from the app: the first two
    /// questions are already answered, so it opens on "What happened?".
    var afterCall: Bool = false
    var onLogged: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var direction: Direction?
    @State private var channel: Channel?
    @State private var outcome: Outcome?
    @State private var occurredAt = Date()
    @State private var note = ""
    @State private var isSaving = false
    @State private var error: String?

    enum Direction: String, CaseIterable {
        case outbound, inbound
        var label: String { self == .outbound ? "I did" : "They did" }
    }

    enum Channel: String, CaseIterable {
        case call, text, email
        var label: String { rawValue.capitalized }
        var icon: String {
            switch self {
            case .call: "phone.fill"
            case .text: "message.fill"
            case .email: "envelope.fill"
            }
        }
    }

    enum Outcome: String, CaseIterable {
        case answered, noAnswer = "no_answer", voicemail

        // Phrased from whichever side placed the call, since "no answer"
        // means different things depending on who was holding the phone.
        func label(_ direction: Direction) -> String {
            switch (self, direction) {
            case (.answered, .outbound): "They answered"
            case (.noAnswer, .outbound): "No answer"
            case (.voicemail, .outbound): "Left a voicemail"
            case (.answered, .inbound): "I answered"
            case (.noAnswer, .inbound): "I missed it"
            case (.voicemail, .inbound): "They left a voicemail"
            }
        }
    }

    init(agentId: String, agentName: String, afterCall: Bool = false, onLogged: @escaping () -> Void) {
        self.agentId = agentId
        self.agentName = agentName
        self.afterCall = afterCall
        self.onLogged = onLogged
        _direction = State(initialValue: afterCall ? .outbound : nil)
        _channel = State(initialValue: afterCall ? .call : nil)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !afterCall {
                        step("Who reached out?") {
                            ForEach(Direction.allCases, id: \.self) { option in
                                choice(option.label, selected: direction == option) {
                                    direction = option
                                    // The outcome labels are written from the
                                    // caller's side, so this invalidates the pick.
                                    outcome = nil
                                }
                            }
                        }

                        if direction != nil {
                            step("How?") {
                                ForEach(Channel.allCases, id: \.self) { option in
                                    choice(option.label, icon: option.icon, selected: channel == option) {
                                        channel = option
                                        outcome = nil
                                    }
                                }
                            }
                        }
                    }

                    if let direction, channel == .call {
                        step(afterCall ? "How did the call go?" : "What happened?") {
                            ForEach(Outcome.allCases, id: \.self) { option in
                                choice(option.label(direction), selected: outcome == option) { outcome = option }
                            }
                        }
                    }

                    if channel != nil {
                        DatePicker("When", selection: $occurredAt, in: ...Date())
                            .font(.subheadline)
                            .foregroundStyle(Theme.secondaryText)
                            .tint(Theme.accent)

                        TextField("Note (optional) — what did you talk about?", text: $note, axis: .vertical)
                            .font(.subheadline)
                            .lineLimit(3...)
                            .padding(12)
                            .background(Theme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(Theme.border, lineWidth: 1)
                            )
                    }

                    if let error {
                        Text(error).font(.caption).foregroundStyle(Theme.danger)
                    }
                }
                .padding(16)
                .animation(.snappy(duration: 0.2), value: direction)
                .animation(.snappy(duration: 0.2), value: channel)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background)
            .navigationTitle(afterCall ? "Call with \(firstName)" : "Log an interaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(afterCall ? "Skip" : "Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(!canSave || isSaving)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
    }

    private var firstName: String {
        agentName.split(separator: " ").first.map(String.init) ?? agentName
    }

    private var canSave: Bool {
        direction != nil && channel != nil && (channel != .call || outcome != nil)
    }

    private func step<Choices: View>(_ label: String, @ViewBuilder choices: () -> Choices) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
            HStack(spacing: 6) { choices() }
        }
    }

    private func choice(_ label: String, icon: String? = nil, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let icon { Image(systemName: icon).font(.caption) }
                Text(label)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.85)
            }
            .font(.subheadline.weight(selected ? .semibold : .regular))
            .frame(maxWidth: .infinity)
            .frame(minHeight: 44)
            .padding(.horizontal, 6)
            .background(selected ? Theme.accent.opacity(0.16) : Theme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(selected ? Theme.accent.opacity(0.6) : Theme.border, lineWidth: 1)
            )
            .foregroundStyle(selected ? Theme.accent : Theme.secondaryText)
        }
        .buttonStyle(.plain)
    }

    private func save() async {
        guard let direction, let channel else { return }
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            try await APIClient.shared.logInteraction(
                agentId: agentId,
                channel: channel.rawValue,
                direction: direction.rawValue,
                outcome: channel == .call ? outcome?.rawValue : nil,
                note: note.nilIfBlank,
                occurredAt: occurredAt
            )
            onLogged()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

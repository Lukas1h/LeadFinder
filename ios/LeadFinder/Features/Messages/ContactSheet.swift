import SwiftUI

/// Contact an agent about a lead: pick a template, tweak the words, send.
///
/// Deliberately three things and nothing else — a dropdown, a message box, and
/// two buttons — because this gets used standing in a driveway. It mirrors the
/// web's text tab, minus everything that doesn't earn its place on a phone: the
/// AI draft, the email tab, and the explanatory subtext.
///
/// Nothing is sent from here. "Send text" opens the native Messages sheet with
/// the message ready, and the text is only recorded when that sheet says it went.
struct ContactSheet: View {
    let listingId: String
    let type: String
    let agentName: String?
    let agentPhone: String?
    let address: String?

    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var options: [MessageOption] = []
    @State private var selected: MessageOption?
    @State private var text = ""
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var isSending = false
    @State private var sendError: String?

    @State private var showComposer = false
    @State private var composerLaunch: ComposerLaunch?

    private struct ComposerLaunch {
        let recipients: [String]
        let body: String
        let secondMessage: String?
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    content
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Theme.background)
            .navigationTitle(agentName.map { "Contact \($0)" } ?? "Contact")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .task { await load() }
            // Half height by default: this is a quick errand, and the composer it
            // leads to is its own sheet.
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .sheet(isPresented: $showComposer) {
                if let launch = composerLaunch {
                    MessageComposer(
                        recipients: launch.recipients,
                        body: launch.body,
                        secondMessage: launch.secondMessage
                    ) { outcome in
                        showComposer = false
                        handle(outcome, launch: launch)
                    }
                }
            }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if let error = loadError ?? sendError {
            VStack(spacing: 12) {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Spacer()
            }
        } else if options.isEmpty {
            Text("No templates for this lead.")
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryText)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            templatePicker
            messageBox
            secondMessage
            Spacer(minLength: 0)
            buttons
        }
    }

    private var templatePicker: some View {
        Picker("Template", selection: Binding(
            get: { selected?.key ?? "" },
            set: { key in if let option = options.first(where: { $0.key == key }) { select(option) } }
        )) {
            ForEach(options, id: \.key) { option in
                Text(label(for: option)).tag(option.key)
            }
        }
        .pickerStyle(.menu)
        .tint(Theme.primaryText)
        .labelsHidden()
    }

    private var messageBox: some View {
        TextEditor(text: $text)
            .font(.subheadline)
            .scrollContentBackground(.hidden)
            .padding(8)
            .frame(height: 120)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// The follow-up the preset wants sent after this one. Shown because it's
    /// part of what you're agreeing to, and it's copied to the clipboard when
    /// the text goes out so it can be pasted straight after.
    @ViewBuilder
    private var secondMessage: some View {
        if let second = selected?.secondMessage?.nilIfBlank {
            VStack(alignment: .leading, spacing: 3) {
                Label("Then paste — copied when you send", systemImage: "doc.on.doc")
                    .font(.caption2)
                    .foregroundStyle(Theme.tertiaryText)
                Text(second)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    private var buttons: some View {
        HStack(spacing: 10) {
            if let digits = phoneDigits {
                Link(destination: URL(string: "tel://\(digits)")!) {
                    Image(systemName: "phone")
                        .font(.title3)
                        .foregroundStyle(Theme.primaryText)
                        .frame(width: 46, height: 46)
                        .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }

            Button {
                presentComposer()
            } label: {
                Label("Send text", systemImage: "message")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(canSend ? Theme.accent : Theme.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .foregroundStyle(canSend ? Theme.background : Theme.tertiaryText)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
    }

    // MARK: - Data

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSending
    }

    private var phoneDigits: String? {
        let digits = (agentPhone ?? "").filter(\.isNumber)
        return digits.isEmpty ? nil : digits
    }

    private func label(for option: MessageOption) -> String {
        var name = option.presetName
        if option.aiDraft { name += " (AI)" }
        if (option.recommended ?? false) && !option.aiDraft { name += " (Recommended)" }
        return name
    }

    private func load() async {
        do {
            let response = try await APIClient.shared.messageOptions(listingId: listingId, type: type)
            options = response.presets
            isLoading = false
            // Prefilled to the recommended template, as the web's dropdown is.
            let recommended = options.first { ($0.recommended ?? false) && !$0.aiDraft }
            if let pick = recommended ?? options.first { select(pick) }
        } catch let apiError as APIError {
            loadError = apiError.errorDescription
            isLoading = false
        } catch {
            loadError = error.localizedDescription
            isLoading = false
        }
    }

    private func select(_ option: MessageOption) {
        selected = option
        text = option.text
    }

    // MARK: - Sending

    private func presentComposer() {
        guard let digits = phoneDigits else {
            sendError = "This agent has no phone number on file."
            return
        }
        composerLaunch = ComposerLaunch(
            recipients: [digits],
            body: text,
            secondMessage: selected?.secondMessage?.nilIfBlank
        )
        showComposer = true
    }

    /// Only `.sent` records anything. A cancelled sheet means the message never
    /// went out, so the listing must stay exactly as it was.
    private func handle(_ outcome: MessageComposer.Outcome, launch: ComposerLaunch) {
        guard outcome == .sent else { return }

        if let second = launch.secondMessage {
            UIPasteboard.general.string = second
        }

        isSending = true
        sendError = nil
        Task {
            defer { isSending = false }
            do {
                try await APIClient.shared.confirmTextSent(
                    listingId: listingId,
                    type: type,
                    presetId: selected?.presetId ?? "",
                    variantId: selected?.variantId ?? "",
                    text: launch.body
                )
                await appState.leads.load(force: true)
                NotificationCenter.default.post(name: .leadsDidChange, object: nil)
                dismiss()
            } catch let apiError as APIError {
                sendError = apiError.errorDescription
            } catch {
                sendError = error.localizedDescription
            }
        }
    }
}
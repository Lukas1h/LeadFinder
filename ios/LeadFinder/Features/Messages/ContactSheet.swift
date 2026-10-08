import SwiftUI

/// "Contact <name>" for one lead: the server's presets, an AI draft, and then
/// the native Messages sheet. Mirrors the web's SendContactDialog, minus the
/// email tab — email stays on the web, so nothing can send mail from here.
struct ContactSheet: View {
    let listingId: String
    let type: String
    let agentName: String?
    let agentPhone: String?
    let address: String?

    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var options: [MessageOption] = []
    @State private var selectedId: String?
    @State private var text = ""
    @State private var secondMessage: String?
    @State private var isLoading = true
    @State private var loadError: String?

    @State private var instruction = ""
    @State private var isDrafting = false
    @State private var draftError: String?

    @State private var isSending = false
    @State private var sendError: String?

    @State private var showComposer = false
    @State private var composerOptions: ComposerLaunch?

    private struct ComposerLaunch {
        let recipients: [String]
        let body: String
        let secondMessage: String?
    }

    var body: some View {
        NavigationStack {
            Form {
                if isLoading {
                    Section { HStack { ProgressView(); Text("Loading presets…") } }
                } else if options.isEmpty {
                    Section { Text("No presets for this lead.").foregroundStyle(Theme.secondaryText) }
                } else {
                    presetsSection
                    draftSection
                    sendButton
                }

                if let error = sendError ?? draftError ?? loadError {
                    Section {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(Theme.danger)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(agentName.map { "Contact \($0)" } ?? "Contact")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .task { await load() }
            // A popup, not a full page: choosing a message is a quick detour,
            // and the composer it leads to is a sheet anyway.
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .sheet(isPresented: $showComposer) {
                if let launch = composerOptions {
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

    // MARK: - Presets

    private var presetsSection: some View {
        Section {
            ForEach(options, id: \.key) { option in
                Button {
                    select(option)
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: selectedId == option.key ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(selectedId == option.key ? Theme.accent : Theme.tertiaryText)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(option.presetName)
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(Theme.primaryText)
                                if option.aiDraft {
                                    Text("AI")
                                        .font(.caption2.weight(.bold))
                                        .foregroundStyle(Theme.violet)
                                }
                                if (option.recommended ?? false) && !option.aiDraft {
                                    BadgeChip(text: "Recommended", tint: Theme.positive)
                                }
                            }
                            Text(option.variantLabel)
                                .font(.caption2)
                                .foregroundStyle(Theme.tertiaryText)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            if !text.isEmpty || selectedId != nil {
                Section("Message") {
                    TextEditor(text: $text)
                        .frame(minHeight: 160)
                    HStack {
                        Spacer()
                        Text("\(text.count) characters")
                            .font(.caption2)
                            .foregroundStyle(Theme.tertiaryText)
                    }
                }
            }
        } header: {
            Text("Presets")
        } footer: {
            if let second = secondMessage, !second.isEmpty {
                Text("This preset has a second message — it'll be copied to the clipboard when you send, to paste right after.")
            }
        }
    }

    private var draftSection: some View {
        Section {
            TextField("Anything to tell the AI? (optional)", text: $instruction, axis: .vertical)
                .font(.footnote)
            Button {
                Task { await draft() }
            } label: {
                HStack {
                    Label("Draft with AI", systemImage: "sparkles")
                    if isDrafting { Spacer(); ProgressView().controlSize(.small) }
                }
            }
            .disabled(isDrafting)
        } header: {
            Text("AI draft")
        } footer: {
            Text("Writes a message for this listing. It fills the box above — read it before sending.")
        }
    }

    // MARK: - Loading

    private func load() async {
        do {
            let response = try await APIClient.shared.messageOptions(listingId: listingId, type: type)
            options = response.presets
            isLoading = false
            // The web defaults to the blank preset rather than the recommended
            // one: a suggested message is a starting point, not a decision.
            if let blank = options.first(where: { $0.blank == true }) ?? options.first {
                select(blank)
            }
        } catch let apiError as APIError {
            loadError = apiError.errorDescription
            isLoading = false
        } catch {
            loadError = error.localizedDescription
            isLoading = false
        }
    }

    private func select(_ option: MessageOption) {
        selectedId = option.key
        if option.aiDraft {
            text = ""
            secondMessage = nil
        } else {
            text = option.text
            secondMessage = option.secondMessage
        }
    }

    private func draft() async {
        isDrafting = true
        draftError = nil
        defer { isDrafting = false }

        do {
            let response = try await APIClient.shared.aiDraft(
                listingId: listingId,
                type: type,
                instruction: instruction.nilIfBlank
            )
            guard let drafted = response.presets.first else {
                draftError = "The AI didn't return a draft."
                return
            }
            text = drafted.text
            selectedId = drafted.key
            secondMessage = drafted.secondMessage
        } catch let apiError as APIError {
            draftError = apiError.errorDescription
        } catch {
            draftError = error.localizedDescription
        }
    }

    // MARK: - Sending

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSending
    }

    @ViewBuilder
    private var sendButton: some View {
        if canSend {
            Section {
                Button {
                    presentComposer()
                } label: {
                    Label("Open Messages", systemImage: "message")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .listRowBackground(Color.clear)
            } footer: {
                Text("Opens your Messages app with this ready to go. Nothing is sent until you tap send there.")
            }
        }
    }

    private func presentComposer() {
        let numbers = (agentPhone ?? "")
            .filter(\.isNumber)
        guard !numbers.isEmpty else {
            sendError = "This agent has no phone number on file, so there's nowhere to send a text."
            return
        }
        composerOptions = ComposerLaunch(
            recipients: [numbers],
            body: text,
            secondMessage: secondMessage?.nilIfBlank
        )
        showComposer = true
    }

    /// Only `.sent` records anything. A cancelled sheet means the message never
    /// went out, so the listing must stay untouched.
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
                    presetId: presetId ?? "",
                    variantId: variantId ?? "",
                    text: launch.body
                )
                await appState.leads.load(force: true)
                dismiss()
            } catch let apiError as APIError {
                sendError = apiError.errorDescription
            } catch {
                sendError = error.localizedDescription
            }
        }
    }

    private var presetId: String? {
        options.first { $0.key == selectedId }?.presetId
    }

    private var variantId: String? {
        options.first { $0.key == selectedId }?.variantId
    }
}
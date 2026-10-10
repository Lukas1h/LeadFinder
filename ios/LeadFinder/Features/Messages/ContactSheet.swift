import SwiftUI

/// Text an agent about a lead: who it's to, which template, the words, send.
///
/// Templates are one tap each in a row of chips rather than a menu, because
/// switching between two to compare them is the common case. "AI" is one of
/// those chips: picking it drafts a message on the spot, and a line under the
/// message steers a redraft ("shorter", "mention the drone shot").
///
/// Templates usually arrive before the sheet does — lead cards prefetch them
/// through `MessageOptionsCache` — so the message is there on the first frame.
///
/// Nothing is sent from here. "Send text" opens the native Messages sheet with
/// the message ready, and the text is only recorded when that sheet says it went.
struct ContactSheet: View {
    let listingId: String
    let type: String
    let agentName: String?
    let agentPhone: String?
    let agentSubtitle: String?
    let relationshipStatus: String?

    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var options: [MessageOption]
    @State private var selectedKey: String?
    @State private var text: String
    @State private var loadError: String?

    @State private var aiOption: MessageOption?
    @State private var isDrafting = false
    @State private var aiError: String?
    @State private var instruction = ""

    @State private var isRecording = false
    @State private var sendError: String?

    /// Opens at half height; typing pulls it up so the keyboard has room.
    @State private var detent: PresentationDetent = .medium

    @FocusState private var focus: Field?
    private enum Field { case message, instruction }

    init(
        listingId: String,
        type: String,
        agentName: String?,
        agentPhone: String?,
        agentSubtitle: String? = nil,
        relationshipStatus: String? = nil
    ) {
        self.listingId = listingId
        self.type = type
        self.agentName = agentName
        self.agentPhone = agentPhone
        self.agentSubtitle = agentSubtitle
        self.relationshipStatus = relationshipStatus

        let cached = MessageOptionsCache.shared.cached(listingId: listingId, type: type) ?? []
        let pick = Self.defaultOption(in: cached)
        _options = State(initialValue: cached)
        _selectedKey = State(initialValue: pick?.key)
        _text = State(initialValue: pick?.text ?? "")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    AgentRow(
                        name: agentName,
                        phone: agentPhone,
                        subtitle: agentSubtitle,
                        relationshipStatus: relationshipStatus
                    )
                    .card()

                    if let error = loadError {
                        ErrorBanner(message: error) { Task { await load() } }
                    } else if options.isEmpty {
                        loadingTemplates
                    } else {
                        templateChips
                        messageField
                        if isAISelected { aiControls }
                        secondMessageNote
                    }

                    if let sendError {
                        ErrorBanner(message: sendError)
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background)
            .safeAreaInset(edge: .bottom) { sendBar }
            .navigationTitle("Text \(firstName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .task { await load() }
        }
        .presentationDetents([.medium, .large], selection: $detent)
        .onChange(of: focus) { _, field in
            if field != nil { withAnimation(.snappy) { detent = .large } }
        }
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
    }

    // MARK: - Templates

    private var loadingTemplates: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { _ in
                    Capsule().fill(Theme.cardRaised).frame(width: 84, height: 32)
                }
            }
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Theme.card)
                .frame(height: 160)
                .overlay { ProgressView() }
        }
    }

    private var templateChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(chipOptions, id: \.key) { option in
                    chip(option)
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.horizontal, -16)
    }

    /// The AI chip first — it's the one worth trying — then the presets in the
    /// server's order.
    private var chipOptions: [MessageOption] {
        options.filter(\.aiDraft) + options.filter { !$0.aiDraft }
    }

    private func chip(_ option: MessageOption) -> some View {
        let selected = option.key == selectedKey
        return Button {
            select(option)
        } label: {
            HStack(spacing: 5) {
                if option.aiDraft {
                    Image(systemName: "sparkles")
                } else if option.recommended ?? false {
                    Image(systemName: "star.fill").font(.caption2)
                }
                Text(option.aiDraft ? "AI draft" : option.presetName)
                    .lineLimit(1)
            }
            .font(.subheadline.weight(selected ? .semibold : .regular))
            .padding(.horizontal, 14)
            .frame(height: 34)
            .background(selected ? Theme.accent.opacity(0.18) : Theme.card, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? Theme.accent.opacity(0.6) : Theme.border, lineWidth: 1))
            .foregroundStyle(selected ? Theme.accent : Theme.secondaryText)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Message

    private var messageField: some View {
        TextField("Write a message", text: $text, axis: .vertical)
            .font(.body)
            .foregroundStyle(Theme.primaryText)
            .lineLimit(4...)
            .focused($focus, equals: .message)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(focus == .message ? Theme.accent.opacity(0.5) : Theme.border, lineWidth: 1)
            )
            .overlay {
                if isDrafting {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.card.opacity(0.85))
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Drafting…").font(.subheadline).foregroundStyle(Theme.secondaryText)
                        }
                    }
                }
            }
            .disabled(isDrafting)
    }

    /// Steering for the next draft. Empty is fine: Redraft then just tries again.
    private var aiControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                TextField("Change something? e.g. shorter", text: $instruction)
                    .font(.subheadline)
                    .focused($focus, equals: .instruction)
                    .submitLabel(.go)
                    .onSubmit { Task { await draft() } }
                    .padding(.horizontal, 12)
                    .frame(height: 40)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(Theme.border, lineWidth: 1)
                    )

                Button {
                    Task { await draft() }
                } label: {
                    Label("Redraft", systemImage: "arrow.clockwise")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 12)
                        .frame(height: 40)
                        .background(Theme.violet.opacity(0.16), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .foregroundStyle(Theme.violet)
                }
                .buttonStyle(.plain)
                .disabled(isDrafting)
            }
            if let aiError {
                Text(aiError)
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
            }
        }
    }

    /// The follow-up the preset wants sent after this one. Once the first text
    /// goes out, Messages opens again with this one filled in.
    @ViewBuilder
    private var secondMessageNote: some View {
        if let second = selectedOption?.secondMessage?.nilIfBlank {
            VStack(alignment: .leading, spacing: 6) {
                Label("Sent next — Messages opens again with this", systemImage: "text.bubble")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.tertiaryText)
                Text(second)
                    .font(.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
    }

    // MARK: - Send bar

    private var sendBar: some View {
        HStack(spacing: 10) {
            if let digits = phoneDigits, let url = URL(string: "tel://\(digits)") {
                Link(destination: url) {
                    Image(systemName: "phone.fill")
                        .font(.title3)
                        .foregroundStyle(Theme.primaryText)
                        .frame(width: 52, height: 52)
                        .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }

            Button(action: presentComposer) {
                HStack(spacing: 8) {
                    if isRecording {
                        ProgressView().tint(Theme.background)
                    } else {
                        Image(systemName: "message.fill")
                    }
                    Text("Send text")
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(canSend ? Theme.accent : Theme.cardRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .foregroundStyle(canSend ? Theme.background : Theme.tertiaryText)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(Theme.background)
    }

    // MARK: - State

    private var selectedOption: MessageOption? {
        if let aiOption, aiOption.key == selectedKey { return aiOption }
        return options.first { $0.key == selectedKey }
    }

    private var isAISelected: Bool { selectedOption?.aiDraft ?? false }

    private var canSend: Bool {
        phoneDigits != nil && !isDrafting && !isRecording
            && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var phoneDigits: String? {
        let digits = (agentPhone ?? "").filter(\.isNumber)
        return digits.isEmpty ? nil : digits
    }

    private var firstName: String {
        agentName?.nilIfBlank?.split(separator: " ").first.map(String.init) ?? "agent"
    }

    /// The recommended template, as the web's dropdown preselects; never the
    /// AI placeholder, which would cost a draft just for opening the sheet.
    private static func defaultOption(in options: [MessageOption]) -> MessageOption? {
        let presets = options.filter { !$0.aiDraft }
        return presets.first { $0.recommended ?? false } ?? presets.first
    }

    private func select(_ option: MessageOption) {
        selectedKey = option.key
        if option.aiDraft {
            if let aiOption {
                text = aiOption.text
            } else {
                Task { await draft() }
            }
        } else {
            text = option.text
        }
    }

    private func load() async {
        loadError = nil
        do {
            let fresh = try await MessageOptionsCache.shared.options(listingId: listingId, type: type)
            let hadOptions = !options.isEmpty
            options = fresh
            // Don't overwrite what's on screen if it was already filled from cache.
            if !hadOptions, let pick = Self.defaultOption(in: fresh) {
                selectedKey = pick.key
                text = pick.text
            }
        } catch {
            if options.isEmpty { loadError = (error as? APIError)?.errorDescription ?? error.localizedDescription }
        }
    }

    private func draft() async {
        guard !isDrafting else { return }
        isDrafting = true
        aiError = nil
        defer { isDrafting = false }
        do {
            let option = try await APIClient.shared.aiDraft(
                listingId: listingId,
                type: type,
                instruction: instruction.nilIfBlank
            )
            aiOption = option
            selectedKey = option.key
            text = option.text
            instruction = ""
            focus = nil
        } catch {
            aiError = (error as? APIError)?.errorDescription ?? "Couldn't draft a message. Try again."
        }
    }

    // MARK: - Sending

    private func presentComposer() {
        guard let digits = phoneDigits else {
            sendError = "This agent has no phone number on file."
            return
        }
        focus = nil
        let body = text
        let option = selectedOption
        MessageComposer.present(recipients: [digits], body: body) { outcome in
            handle(outcome, body: body, option: option)
        }
    }

    /// Only `.sent` records anything. A cancelled sheet means the message never
    /// went out, so the listing must stay exactly as it was.
    private func handle(_ outcome: MessageComposer.Outcome, body: String, option: MessageOption?) {
        switch outcome {
        case .unavailable:
            sendError = "This iPhone can't send texts right now."
            return
        case .cancelled:
            return
        case .sent:
            break
        }

        let second = option?.secondMessage?.nilIfBlank
        let recipient = phoneDigits

        isRecording = true
        sendError = nil
        Task {
            defer { isRecording = false }
            // The first text is recorded while the second is being sent.
            let recording = Task {
                try await APIClient.shared.confirmTextSent(
                    listingId: listingId,
                    type: type,
                    presetId: option?.presetId ?? "",
                    variantId: option?.variantId ?? "",
                    text: body
                )
            }
            // The preset's second message goes out the same way, in its own
            // Messages sheet. Closing that sheet without sending is fine: the
            // first text went, and that's the one on record.
            if let second, let recipient {
                _ = await MessageComposer.present(recipients: [recipient], body: second)
            }
            do {
                _ = try await recording.value
                MessageOptionsCache.shared.forget(listingId: listingId)
                // Reloading takes this lead's card away, and this sheet and
                // anything on top of it with it — which is why it waits for the
                // second Messages sheet above.
                await appState.leads.load(force: true)
                NotificationCenter.default.post(name: .leadsDidChange, object: nil)
                dismiss()
            } catch {
                sendError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

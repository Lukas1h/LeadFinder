import SwiftUI

/// One message in full, with what can be done about the reply: the template's
/// quick actions, keep in touch, or mark declined.
///
/// "Keep in touch" and "Declined" only record what happened. An email quick
/// action is a real email, so it always goes through a confirm that names the
/// template and the address first. A text quick action opens the Messages
/// sheet filled in, and is recorded only if that sheet reports it sent.
struct MessageDetailView: View {
    let send: MessagesResponse.Send
    /// Opens straight on the quick actions, from the history row's long press:
    /// the one action if there's only one, a choice otherwise.
    var startsQuickActions = false

    @Environment(AppState.self) private var appState
    @State private var detail: MessageDetailResponse?
    @State private var isWorking = false
    @State private var error: String?
    @State private var confirmDeclined = false
    @State private var didApply = false
    /// The email quick action waiting on its confirm or on an address.
    @State private var pendingAction: QuickAction?
    @State private var confirmEmail = false
    @State private var askForEmail = false
    @State private var typedEmail = ""
    @State private var chooseAction = false
    /// What each finished quick action did, by template id.
    @State private var actionNotes: [String: String] = [:]
    /// The text quick action whose files are being fetched.
    @State private var preparing: String?
    @State private var openListing: Listing?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .card()
                        .padding(.horizontal, 16)
                }

                actions

                if let agent = detail?.agent {
                    agentCard(agent)
                } else if let name = send.agentName?.nilIfBlank {
                    agentCard(Agent(id: send.agentId ?? "", name: name, phone: send.agentPhone, email: send.agentEmail))
                }

                if let listing = detail?.listing {
                    listingCard(listing)
                }

                if let text = detail?.text, !text.isEmpty {
                    bodyCard(text)
                } else if detail == nil {
                    HStack {
                        ProgressView().controlSize(.small)
                        Text("Loading the message…")
                            .font(.footnote)
                            .foregroundStyle(Theme.tertiaryText)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
            }
            .padding(.vertical, 12)
        }
        .background(Theme.background)
        .navigationTitle(send.channel == "email" ? "Email" : "Text")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await load()
            if startsQuickActions, !didApply {
                if quickActions.count == 1 {
                    begin(quickActions[0])
                } else if quickActions.count > 1 {
                    chooseAction = true
                }
            }
        }
        .sheet(isPresented: $askForEmail) { emailEntry }
        .sheet(item: $openListing) { LeadListingSheet(listing: $0, agent: detail?.agent) }
        .confirmationDialog(
            "Email \"\(pendingAction?.name ?? "")\" to \(detail?.agent?.email ?? "them")?",
            isPresented: $confirmEmail,
            titleVisibility: .visible,
            presenting: pendingAction
        ) { action in
            Button("Send email") { Task { await sendEmail(action, email: nil) } }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("This emails \(send.recipient) now, from your address.")
        }
        .confirmationDialog("Quick actions", isPresented: $chooseAction, titleVisibility: .visible) {
            ForEach(quickActions) { action in
                Button(action.isEmail ? "Email \"\(action.name)\"…" : "Text \"\(action.name)\"…") { begin(action) }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "Mark \(send.recipient) as declined?",
            isPresented: $confirmDeclined,
            titleVisibility: .visible
        ) {
            Button("Mark declined", role: .destructive) { Task { await apply(.declined) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This records that they said no, and moves them to Declined. Nothing is sent to them.")
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text("\(send.channel == "email" ? "Email" : "Text") to \(send.recipient)")
                    .font(.headline)
                    .foregroundStyle(Theme.primaryText)
                Spacer(minLength: 0)
                if let outcome = send.outcomeLabel {
                    BadgeChip(text: outcome, tint: outcomeTint)
                }
            }

            Text(send.presetName)
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)

            if let when = DateFormatting.parse(send.sentAt) {
                Text(DateFormatting.dayTime.string(from: when))
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .padding(.horizontal, 16)
    }

    private var outcomeTint: Color {
        switch send.result {
        case "booked": Theme.emerald
        case "quoted": Theme.violet
        case "declined": Theme.red
        default: Theme.accent
        }
    }

    // MARK: - Actions

    private var actions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WHAT THEY SAID")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.tertiaryText)
                .kerning(0.6)

            // Once one of these has been applied the message has an outcome, so
            // offering the other one would contradict what was just recorded.
            if didApply {
                Label("Recorded.", systemImage: "checkmark.circle")
                    .font(.subheadline)
                    .foregroundStyle(Theme.positive)
            } else {
                // Several can follow one reply (the photos, then the contact
                // card), so a finished one is ticked and the rest stay.
                ForEach(quickActions) { action in
                    quickActionButton(action)
                }
                if actionNotes.isEmpty {
                HStack(spacing: 10) {
                    actionButton("Keep in touch", "clock") {
                        Task { await apply(.keepInTouch) }
                    }
                    actionButton("Declined", "hand.thumbsdown") {
                        confirmDeclined = true
                    }
                }
                .disabled(isWorking)
                }
            }

            if isWorking {
                ProgressView().controlSize(.small)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .padding(.horizontal, 16)
    }

    private func actionButton(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.medium))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private enum Outcome: String {
        case keepInTouch = "keep_in_touch"
        case declined
    }

    /// Records the outcome, then reloads so the stats and history reflect it.
    private func apply(_ outcome: Outcome) async {
        isWorking = true
        error = nil
        defer { isWorking = false }

        do {
            try await APIClient.shared.recordMessageReply(id: send.id, outcome: outcome.rawValue)
            didApply = true
            await appState.messages.load(force: true)
        } catch let apiError as APIError {
            error = apiError.errorDescription
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Cards

    private func agentCard(_ agent: Agent) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("AGENT")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.tertiaryText)
                .kerning(0.6)

            // Tap through to their own screen to call, text or email.
            TappableAgentRow(agent: agent, subtitle: agent.email)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .padding(.horizontal, 16)
    }

    private func listingCard(_ listing: Listing) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("LISTING")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.tertiaryText)
                .kerning(0.6)
            Button { openListing = listing } label: { ListingRow(listing: listing, showsChevron: true) }
                .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .padding(.horizontal, 16)
    }

    private func bodyCard(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("MESSAGE")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.tertiaryText)
                .kerning(0.6)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Theme.primaryText)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .padding(.horizontal, 16)
    }

    // MARK: - Quick actions

    private var quickActions: [QuickAction] {
        // Without the agent there's nobody to send to.
        detail?.agent == nil ? [] : detail?.quickActions ?? []
    }

    private func quickActionButton(_ action: QuickAction) -> some View {
        let note = actionNotes[action.presetId]
        return VStack(alignment: .leading, spacing: 4) {
            Button { begin(action) } label: {
                HStack(spacing: 8) {
                    if preparing == action.presetId {
                        ProgressView().controlSize(.small).tint(Theme.background)
                    } else {
                        Image(systemName: note != nil ? "checkmark" : action.isEmail ? "envelope.fill" : "message.fill")
                    }
                    Text(action.name).lineLimit(1)
                }
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(
                    note == nil ? Theme.accent : Theme.cardRaised,
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
                .foregroundStyle(note == nil ? Theme.background : Theme.primaryText)
            }
            .buttonStyle(.plain)
            .disabled(isWorking)

            Text(note ?? Self.caption(for: action))
                .font(.caption)
                .foregroundStyle(note == nil ? Theme.tertiaryText : Theme.positive)
        }
    }

    private static func caption(for action: QuickAction) -> String {
        let files = action.attachments.count
        let with = files == 0 ? "" : files == 1 ? " with \(action.attachments[0].filename)" : " with \(files) files"
        return action.isEmail ? "Sends an email\(with)" : "Opens a text\(with)"
    }

    private func begin(_ action: QuickAction) {
        guard !isWorking else { return }
        if action.isEmail {
            // An agent with an address on file is a confirm and one tap; without
            // one the address has to be typed (or pasted) first, as on the web.
            pendingAction = action
            if detail?.agent?.email?.nilIfBlank != nil {
                confirmEmail = true
            } else {
                typedEmail = ""
                askForEmail = true
            }
        } else {
            Task { await sendText(action) }
        }
    }

    /// Fetches the template's files, opens Messages with everything filled in,
    /// and records the text only if the sheet says it was sent.
    private func sendText(_ action: QuickAction) async {
        let phone = detail?.agent?.phone?.nilIfBlank ?? send.agentPhone?.nilIfBlank
        guard let digits = phone?.filter({ $0.isNumber || $0 == "+" }), !digits.isEmpty else {
            error = "\(send.recipient) has no phone number on file."
            return
        }

        isWorking = true
        error = nil
        defer { isWorking = false }

        var files: [MessageComposer.Attachment] = []
        preparing = action.presetId
        do {
            for attachment in action.attachments {
                let data = try await APIClient.shared.attachmentData(
                    presetId: action.presetId,
                    attachmentId: attachment.id
                )
                files.append(.init(
                    data: data,
                    typeIdentifier: attachment.typeIdentifier,
                    filename: attachment.filename
                ))
            }
        } catch {
            preparing = nil
            self.error = "Couldn't load the attachments: \((error as? APIError)?.errorDescription ?? error.localizedDescription)"
            return
        }
        preparing = nil

        switch await MessageComposer.present(recipients: [digits], body: action.text, attachments: files) {
        case .cancelled:
            return
        case .unavailable:
            error = files.isEmpty
                ? "This device can't send texts."
                : "This device can't send texts with attachments."
        case .sent:
            do {
                try await APIClient.shared.recordQuickActionText(
                    messageId: send.id,
                    presetId: action.presetId,
                    variantId: action.variantId
                )
                actionNotes[action.presetId] = "Texted to \(send.recipient)."
                await appState.messages.load(force: true)
            } catch {
                self.error = "The text was sent, but recording it failed: \((error as? APIError)?.errorDescription ?? error.localizedDescription)"
            }
        }
    }

    private var emailEntry: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("agent@example.com", text: $typedEmail)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Paste from clipboard") {
                        if let pasted = UIPasteboard.general.string { typedEmail = Self.firstEmail(in: pasted) ?? typedEmail }
                    }
                } header: {
                    Text("\(send.recipient) has no email on file")
                } footer: {
                    Text("Emails \"\(pendingAction?.name ?? "")\" there now, and saves the address to them.")
                }
                .listRowBackground(Theme.card)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.accent)
            .navigationTitle(pendingAction?.name ?? "Send email")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { askForEmail = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") {
                        let email = typedEmail
                        askForEmail = false
                        if let action = pendingAction { Task { await sendEmail(action, email: email) } }
                    }
                    .fontWeight(.semibold)
                    .disabled(Self.firstEmail(in: typedEmail) == nil)
                }
            }
        }
        .presentationDetents([.medium])
        .presentationBackground(Theme.background)
    }

    private static func firstEmail(in text: String) -> String? {
        text.range(of: #"[^\s@<>()\"',;:]+@[^\s@<>()\"',;:]+\.[A-Za-z]{2,}"#, options: .regularExpression)
            .map { String(text[$0]) }
    }

    private func sendEmail(_ action: QuickAction, email: String?) async {
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            let note = try await APIClient.shared.sendQuickActionEmail(
                messageId: send.id,
                presetId: action.presetId,
                email: email
            )
            actionNotes[action.presetId] = note ?? "Emailed to \(send.recipient)."
            await appState.messages.load(force: true)
        } catch let apiError as APIError {
            error = apiError.errorDescription
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func load() async {
        guard detail == nil else { return }
        do {
            detail = try await APIClient.shared.messageDetail(send.id)
        } catch {
            // The list already shows who and when; a missing body is a
            // disappointment, not a reason for an error screen.
            detail = nil
        }
    }
}
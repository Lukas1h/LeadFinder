import SwiftUI

/// One message in full, with what can be done about the reply: email the
/// template's samples, keep in touch, or mark declined.
///
/// "Keep in touch" and "Declined" only record what happened. "Send samples" is
/// a real email, so it always goes through a confirm that names the template
/// and the address first.
struct MessageDetailView: View {
    let send: MessagesResponse.Send
    /// Opens straight on the "Send samples" confirm, from the history row's
    /// quick action.
    var startsSamples = false

    @Environment(AppState.self) private var appState
    @State private var detail: MessageDetailResponse?
    @State private var isWorking = false
    @State private var error: String?
    @State private var confirmDeclined = false
    @State private var didApply = false
    @State private var confirmSamples = false
    @State private var askForEmail = false
    @State private var typedEmail = ""
    @State private var samplesResult: String?
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
            if startsSamples, canSendSamples, !didApply { beginSamples() }
        }
        .sheet(isPresented: $askForEmail) { emailEntry }
        .sheet(item: $openListing) { LeadListingSheet(listing: $0, agent: detail?.agent) }
        .confirmationDialog(
            "Email \(samplesTemplateName) to \(detail?.agent?.email ?? "them")?",
            isPresented: $confirmSamples,
            titleVisibility: .visible
        ) {
            Button("Send email") { Task { await sendSamples(email: nil) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This emails \(send.recipient) now, from your address.")
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
                Label(samplesResult ?? "Recorded.", systemImage: "checkmark.circle")
                    .font(.subheadline)
                    .foregroundStyle(Theme.positive)
            } else {
                if canSendSamples {
                    Button(action: beginSamples) {
                        Label("Send samples", systemImage: "envelope.fill")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .foregroundStyle(Theme.background)
                    }
                    .buttonStyle(.plain)
                    .disabled(isWorking)
                    Text("Emails \"\(samplesTemplateName)\"")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                }
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

    // MARK: - Send samples

    private var canSendSamples: Bool {
        detail?.followUpEmail != nil && detail?.agent != nil
    }

    private var samplesTemplateName: String {
        detail?.followUpEmail?.name ?? "the sample email"
    }

    /// An agent with an address on file is a confirm and one tap; without one
    /// the address has to be typed (or pasted) first, as on the web.
    private func beginSamples() {
        if detail?.agent?.email?.nilIfBlank != nil {
            confirmSamples = true
        } else {
            typedEmail = ""
            askForEmail = true
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
                    Text("Emails \"\(samplesTemplateName)\" there now, and saves the address to them.")
                }
                .listRowBackground(Theme.card)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.accent)
            .navigationTitle("Send samples")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { askForEmail = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") {
                        let email = typedEmail
                        askForEmail = false
                        Task { await sendSamples(email: email) }
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

    private func sendSamples(email: String?) async {
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            let note = try await APIClient.shared.sendSamples(messageId: send.id, email: email)
            samplesResult = note ?? "Samples emailed to \(send.recipient)."
            didApply = true
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
import SwiftUI

/// One message in full, with the two actions that are safe to take from a phone.
///
/// "Keep in touch" and "Declined" are the web's own buttons and only record
/// what happened — an interaction, a reply timestamp, and the agent's and
/// listing's status. Neither sends anything. The web's "Send samples" is
/// deliberately not here: it sends real email through SMTP.
struct MessageDetailView: View {
    let send: MessagesResponse.Send

    @Environment(AppState.self) private var appState
    @State private var detail: MessageDetailResponse?
    @State private var isWorking = false
    @State private var error: String?
    @State private var confirmDeclined = false
    @State private var didApply = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .card()
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

                if let followUp = detail?.followUpEmail {
                    samplesNote(followUp)
                }
            }
            .padding(.vertical, 12)
        }
        .background(Theme.background)
        .navigationTitle(send.channel == "email" ? "Email" : "Text")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
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
        .padding(.horizontal, 16)
        .card()
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
        .padding(.horizontal, 16)
        .card()
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

            AgentRow(
                name: agent.displayName,
                phone: agent.phone,
                subtitle: agent.email,
                relationshipStatus: agent.relationshipStatus
            )

            if let email = agent.email?.nilIfBlank {
                Link(destination: URL(string: "mailto:\(email)")!) {
                    Label(email, systemImage: "envelope")
                        .font(.footnote)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .card()
    }

    private func listingCard(_ listing: Listing) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("LISTING")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.tertiaryText)
                .kerning(0.6)
            ListingRow(listing: listing)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .card()
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
        .padding(.horizontal, 16)
        .card()
    }

    /// The web offers to send this preset's sample email. The phone says what it
    /// would be and leaves the sending to the web, where Compose lives.
    private func samplesNote(_ followUp: MessageDetailResponse.FollowUpEmail) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Sample email: \(followUp.name)", systemImage: "envelope.badge")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.primaryText)
            Text("Sending email stays on the web, so an agent never gets a surprise from the phone.")
                .font(.caption)
                .foregroundStyle(Theme.tertiaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .card()
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
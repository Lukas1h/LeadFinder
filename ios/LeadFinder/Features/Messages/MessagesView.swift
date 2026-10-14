import SwiftUI

/// The Messages tab: the web's `/messaging` page.
///
/// Shown here: the message history (each row opens the message, with its
/// quick actions and the "Keep in touch" / "Declined" outcomes), and the
/// template editor behind the toolbar button, under the goal and stats cards
/// (StatCards.swift; Home shows the headline numbers). The web's "Compose" is
/// absent.
struct MessagesView: View {
    @Environment(AppState.self) private var appState

    @State private var openSend: MessagesResponse.Send?
    /// Set by the row's long press, so its detail opens straight on the quick
    /// actions.
    @State private var quickActionsOnOpen = false
    @State private var showTemplates = false

    var body: some View {
        NavigationStack {
            Group {
                if let messages = appState.messages.value {
                    content(messages)
                } else if appState.messages.error != nil {
                    loadFailure
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(Theme.background)
            .navigationTitle("Messages")
            .sheet(item: $openSend) { send in
                MessageDetailView(send: send, startsQuickActions: quickActionsOnOpen)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .toolbar {
                ToolbarItem(placement: .trailingBar) {
                    Button {
                        showTemplates = true
                    } label: {
                        Label("Templates", systemImage: "text.bubble")
                    }
                }
            }
            .navigationDestination(isPresented: $showTemplates) { TemplatesView() }
            #if DEBUG
            .onAppear {
                if DebugLaunchArguments.opensTemplates { showTemplates = true }
            }
            #endif
            .task { await appState.messages.load() }
        }
    }

    private func content(_ messages: MessagesResponse) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ErrorBanner(
                message: appState.messages.error,
                onRetry: { Task { await appState.messages.load(force: true) } }
            )
            .padding(.horizontal, 16)
            .padding(.top, 8)

            // The web hides both cards when there's nothing to show, rather than
            // printing a wall of zeroes.
            if messages.stats.sms.sent == 0 && messages.sends.isEmpty {
                EmptyStateView(
                    icon: "paperplane",
                    title: "Nothing sent yet",
                    message: "Stats and recent messages show up here once you've texted or emailed an agent."
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        if let goal = messages.goal { GoalCard(goal: goal) }
                        if messages.stats.sms.sent > 0 { OutreachStatsCard(stats: messages.stats) }
                        history(messages.sends)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .refreshable { await appState.messages.load(force: true) }
            }
        }
    }

    /// The web's `formatRate`: a dash with no sends, one decimal under 10%,
    /// whole numbers above.
    static func rate(_ replied: Int, _ sent: Int) -> String {
        guard sent > 0 else { return "—" }
        let value = Double(replied) / Double(sent) * 100
        return value < 10 ? String(format: "%.1f%%", value) : "\(Int(value.rounded()))%"
    }

    // MARK: - History

    private func history(_ sends: [MessagesResponse.Send]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
                Text("Message history")
                    .font(.headline)
                    .foregroundStyle(Theme.primaryText)
                Text("· last \(sends.count)")
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
                Spacer(minLength: 0)
            }

            if sends.isEmpty {
                Text("No messages yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.tertiaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 8)
            } else {
                ForEach(sends) { send in
                    Button {
                        quickActionsOnOpen = false
                        openSend = send
                    } label: {
                        MessageHistoryRow(send: send)
                    }
                    .buttonStyle(.plain)
                    // A long press goes straight to the template's quick
                    // actions. Which ones it has comes with the message, so
                    // they're offered once it has loaded; an email still asks
                    // before anything is sent.
                    .contextMenu {
                        if send.channel != "email", send.result == nil || send.result == "pending" {
                            Button {
                                quickActionsOnOpen = true
                                openSend = send
                            } label: {
                                Label("Quick actions…", systemImage: "bolt")
                            }
                        }
                    }
                }
            }
        }
        .card(padding: 14)
    }

    private var loadFailure: some View {
        VStack(spacing: 14) {
            EmptyStateView(
                icon: "wifi.exclamationmark",
                title: "Couldn't load messages",
                message: appState.messages.error
            )
            Button("Try again") {
                Task { await appState.messages.load(force: true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Seven bars, one per weekday. A day with too few sends to mean anything is
/// faded, which is the web's way of saying "not enough data yet" without
/// drawing a line.
struct ReplyByDayChart: View {
    let buckets: [MessagesResponse.DayBucket]

    private static let minExpectedReplies = 5.0

    var body: some View {
        let maxRate = buckets.map { rate($0) }.max() ?? 0
        let sent = buckets.reduce(0) { $0 + $1.sent }
        let replied = buckets.reduce(0) { $0 + $1.replied }
        // A day with fewer sends than five replies would imply isn't evidence
        // of anything, so it's faded.
        let minSent = replied > 0 ? Self.minExpectedReplies * Double(sent) / Double(replied) : Double.infinity
        let best = buckets
            .filter { Double($0.sent) >= minSent }
            .max { rate($0) < rate($1) }

        VStack(alignment: .leading, spacing: 8) {
            Text("Reply rate by day sent")
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)

            HStack(alignment: .bottom, spacing: 8) {
                ForEach(Array(buckets.enumerated()), id: \.offset) { _, bucket in
                    VStack(spacing: 3) {
                        Text(Self.rate(bucket))
                            .font(.system(size: 10).monospacedDigit())
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)

                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(bucket == best ? Theme.accent : Theme.accent.opacity(0.45))
                            .opacity(Double(bucket.sent) < minSent ? 0.35 : 1)
                            .frame(height: barHeight(bucket, maxRate: maxRate))

                        Text(bucket.label)
                            .font(.system(size: 10))
                            .foregroundStyle(Theme.primaryText)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 70, alignment: .bottom)

            Text("Adjusted for which templates went out each day. Faded days have too few sends to tell yet.")
                .font(.caption2)
                .foregroundStyle(Theme.tertiaryText)
        }
    }

    /// The server's template-adjusted rate, or the plain one from a server
    /// that doesn't send it yet.
    private func rate(_ bucket: MessagesResponse.DayBucket) -> Double {
        guard bucket.sent > 0 else { return 0 }
        return bucket.adjustedRate ?? Double(bucket.replied) / Double(bucket.sent)
    }

    private func barHeight(_ bucket: MessagesResponse.DayBucket, maxRate: Double) -> CGFloat {
        guard maxRate > 0 else { return 2 }
        return max(2, CGFloat(rate(bucket) / maxRate) * 40)
    }

    private static func rate(_ bucket: MessagesResponse.DayBucket) -> String {
        guard bucket.sent > 0, let adjusted = bucket.adjustedRate else {
            return MessagesView.rate(bucket.replied, bucket.sent)
        }
        return "\(Int((adjusted * 100).rounded()))%"
    }
}

/// One message in the history list: who, which listing, which template and when,
/// and what came back. The web shows the same three lines and nothing else.
struct MessageHistoryRow: View {
    let send: MessagesResponse.Send

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: send.channel == "email" ? "envelope" : "paperplane")
                .font(.callout)
                .foregroundStyle(Theme.tertiaryText)
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 2) {
                Text(send.recipient)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)

                if let address = send.listingAddress?.nilIfBlank {
                    Text(address)
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                }

                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(Theme.tertiaryText)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if let outcome = send.outcomeLabel {
                BadgeChip(text: outcome, tint: tint(for: send))
            }
        }
        .padding(.vertical, 7)
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        let type = send.type == "initial_outreach" ? "Initial outreach" : "Follow-up"
        let when = DateFormatting.parse(send.sentAt)
            .map { DateFormatting.dayTime.string(from: $0) } ?? ""
        return "\(send.presetName) · \(type)\(when.isEmpty ? "" : " · \(when)")"
    }

    private func tint(for send: MessagesResponse.Send) -> Color {
        if let result = send.result, result != "pending" {
            switch result {
            case "booked": return Theme.emerald
            case "quoted": return Theme.violet
            case "declined": return Theme.red
            default: break
            }
        }
        return Theme.accent
    }
}

extension Double {
    var currencyString: String {
        formatted(.currency(code: "USD").precision(.fractionLength(0)).grouping(.automatic))
    }
}
import SwiftUI

/// The Messages tab: the web's `/messaging` page.
///
/// Shown here: the stats card, the reply-rate-by-day chart, the top templates,
/// the message history (each row opens the message, with its quick actions and
/// the "Keep in touch" / "Declined" outcomes), and the template editor behind
/// the toolbar button. The web's "Compose" is absent.
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
                ToolbarItem(placement: .topBarTrailing) {
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
                        statsCard(messages.stats)
                        replyByDay(messages.stats)
                        if !messages.stats.templates.isEmpty { topTemplates(messages.stats.templates) }
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

    // MARK: - Stats card

    /// The web's three headline numbers, texting only. The 30-day window applies
    /// to "sent" only — reply and booked rates are all-time, as on the web.
    private func statsCard(_ stats: MessagesResponse.Stats) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                spacing: 14
            ) {
                stat(
                    "Last 30 days",
                    "\(stats.sms.sentRecent) sent",
                    "texts"
                )
                stat(
                    "Text replies",
                    Self.rate(stats.sms.replied, stats.sms.sent),
                    "\(stats.sms.replied) of \(stats.sms.sent) texts"
                )
                stat(
                    "Booked",
                    "\(stats.sms.booked + stats.email.booked)",
                    "\(stats.revenue.currencyString) revenue"
                )
            }
        }
        .card(padding: 14)
    }

    private func stat(_ label: String, _ value: String, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
            Text(value)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.primaryText)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            Text(sub)
                .font(.caption2)
                .foregroundStyle(Theme.tertiaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The web's `formatRate`: a dash with no sends, one decimal under 10%,
    /// whole numbers above.
    static func rate(_ replied: Int, _ sent: Int) -> String {
        guard sent > 0 else { return "—" }
        let value = Double(replied) / Double(sent) * 100
        return value < 10 ? String(format: "%.1f%%", value) : "\(Int(value.rounded()))%"
    }

    // MARK: - Reply rate by day

    /// Texts only, as on the web: cold email was a one-off campaign and its
    /// reply rate sat next to live texting making it look worse.
    private func replyByDay(_ stats: MessagesResponse.Stats) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Reply rate by day sent")
                .font(.headline)
                .foregroundStyle(Theme.primaryText)

            ReplyByDayChart(buckets: stats.byDay.sms)
        }
        .card(padding: 14)
    }

    // MARK: - Top templates

    /// One row per template with the numbers on a second line. The web's
    /// four-column grid wraps "44 · 33%" onto two lines at phone widths, which
    /// makes the whole block unreadable.
    private func topTemplates(_ templates: [MessagesResponse.Template]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Top templates")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.primaryText)

            ForEach(templates) { template in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Image(systemName: "paperplane")
                            .font(.caption2)
                            .foregroundStyle(Theme.tertiaryText)
                        Text(template.name)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.primaryText)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }

                    HStack(spacing: 6) {
                        number("\(template.sent) sent")
                        number("\(template.replied) replies")
                        number(Self.rate(template.replied, template.sent))
                        if template.booked > 0 {
                            Text("\(template.booked) booked")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(Theme.positive)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .card(padding: 14)
    }

    private func number(_ text: String) -> some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(Theme.tertiaryText)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Theme.cardRaised, in: Capsule())
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

        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(Array(buckets.enumerated()), id: \.offset) { _, bucket in
                    VStack(spacing: 4) {
                        Text(Self.rate(bucket))
                            .font(.system(size: 9))
                            .foregroundStyle(Theme.tertiaryText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)

                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(barColor(bucket, maxRate: maxRate))
                            .frame(height: barHeight(bucket, maxRate: maxRate))

                        Text(bucket.label)
                            .font(.system(size: 9))
                            .foregroundStyle(Theme.secondaryText)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 62, alignment: .bottom)
        }
    }

    private func rate(_ bucket: MessagesResponse.DayBucket) -> Double {
        guard bucket.sent > 0 else { return 0 }
        return Double(bucket.replied) / Double(bucket.sent)
    }

    private func barHeight(_ bucket: MessagesResponse.DayBucket, maxRate: Double) -> CGFloat {
        guard maxRate > 0 else { return 2 }
        return max(2, CGFloat(rate(bucket) / maxRate) * 40)
    }

    private func barColor(_ bucket: MessagesResponse.DayBucket, maxRate: Double) -> Color {
        // Same rule as the web: if this day's rate came from fewer sends than
        // five replies would imply, it isn't evidence of anything.
        let minSent = bucket.replied > 0
            ? Self.minExpectedReplies * Double(bucket.sent) / Double(bucket.replied)
            : Double.infinity
        guard Double(bucket.sent) >= minSent else { return Theme.accent.opacity(0.35) }
        return rate(bucket) >= maxRate ? Theme.accent : Theme.accent.opacity(0.45)
    }

    private static func rate(_ bucket: MessagesResponse.DayBucket) -> String {
        guard bucket.sent > 0 else { return "—" }
        let value = Double(bucket.replied) / Double(bucket.sent) * 100
        return value < 10 ? String(format: "%.0f%%", value) : "\(Int(value.rounded()))%"
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
import SwiftUI

/// Messages: the goal card and the stats on top, the history list below —
/// the same three blocks as the phone, in the same order and with the same
/// wording, in a scrolling column rather than a phone stack.
///
/// The history rows are the shared `MessageHistoryRow`, and selecting one fills
/// the detail pane with the shared `MessageDetailView`, quick actions included.
struct MacMessagesView: View {
    @Environment(AppState.self) private var appState
    @Binding var selection: MessagesResponse.Send?

    @State private var showTemplates = false
    @State private var quickActionsOnOpen = false

    var body: some View {
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
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showTemplates = true
                } label: {
                    Label("Templates", systemImage: "text.bubble")
                }
                .help("Edit templates")
            }
        }
        .sheet(isPresented: $showTemplates) {
            NavigationStack { TemplatesView() }
        }
        .task { await appState.messages.load() }
    }

    private func content(_ messages: MessagesResponse) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ErrorBanner(
                    message: appState.messages.error,
                    onRetry: { Task { await appState.messages.load(force: true) } }
                )

                if messages.stats.sms.sent == 0 && messages.sends.isEmpty {
                    EmptyStateView(
                        icon: "paperplane",
                        title: "Nothing sent yet",
                        message: "Stats and recent messages show up here once you've texted or emailed an agent."
                    )
                } else {
                    if let goal = messages.goal { MacGoalCard(goal: goal) }
                    MacStatsCard(stats: messages.stats)
                    MacReplyByDay(buckets: messages.stats.byDay.sms)
                    if !messages.stats.templates.isEmpty { MacTopTemplates(templates: messages.stats.templates) }
                    history(messages.sends)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // The history is a list, so it's its own column rather than part of the
        // scroll — picking a message to read beside it is the Mac gesture.
        .safeAreaInset(edge: .bottom) { historyList(messages.sends) }
    }

    private func historyList(_ sends: [MessagesResponse.Send]) -> some View {
        List(selection: $selection) {
            ForEach(sends.prefix(50)) { send in
                MessageHistoryRow(send: send)
                    .tag(send)
            }
        }
        .listStyle(.inset)
        .frame(minHeight: 180, idealHeight: 260, maxHeight: 320)
        .background(Theme.background)
    }

    private func history(_ sends: [MessagesResponse.Send]) -> some View {
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
    }

    private var loadFailure: some View {
        VStack(spacing: 14) {
            EmptyStateView(icon: "wifi.exclamationmark", title: "Couldn't load messages", message: appState.messages.error)
            Button("Try again") {
                Task { await appState.messages.load(force: true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The monthly goal worked backwards into this week's work, as four numbers
/// side by side — the same figures as the phone's goal card, in a row because
/// a Mac window is wide.
private struct MacGoalCard: View {
    let goal: MessagesResponse.Goal

    var body: some View {
        let met = goal.gap == 0
        let week = goal.thisWeek
        let progress = goal.goal > 0 ? min(1, goal.booked / goal.goal) : 0

        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(goal.booked.currencyString) of \(goal.goal.currencyString) booked for \(goal.month)")
                    .font(.headline)
                    .foregroundStyle(Theme.primaryText)
                Spacer()
                Text(met
                    ? "Goal met"
                    : "\(goal.gap.currencyString) to go, about \(goal.jobsNeeded) job\(goal.jobsNeeded == 1 ? "" : "s") at \(goal.avgJob.currencyString)")
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
            }

            ProgressView(value: progress)
                .tint(Theme.emerald)

            HStack(spacing: 20) {
                stat("Texts to go", met ? "—" : "\(week.textsToGo) more", "\(week.texts) sent")
                stat("Replies to go", met ? "—" : "\(week.repliesToGo) more", "\(week.replies) so far")
                stat("Follow-ups due", "\(week.followUpsDue)", "\(week.followUps) sent this week")
                stat("Interested", "\(goal.interested.live)", met ? "in touch this month" : "of \(goal.interested.needed) needed")
            }
        }
        .card(padding: 14)
    }

    private func stat(_ label: String, _ value: String, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
            Text(value)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.primaryText)
            Text(sub)
                .font(.caption2)
                .foregroundStyle(Theme.tertiaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The three headline numbers from the web, in a row.
private struct MacStatsCard: View {
    let stats: MessagesResponse.Stats

    var body: some View {
        HStack(spacing: 20) {
            stat("Last 30 days", "\(stats.sms.sentRecent) sent", "texts")
            stat("Text replies", MessagesView.rate(stats.sms.replied, stats.sms.sent), "\(stats.sms.replied) of \(stats.sms.sent) texts")
            stat("Booked", "\(stats.sms.booked + stats.email.booked)", "\(stats.revenue.currencyString) revenue")
        }
        .card(padding: 14)
    }

    private func stat(_ label: String, _ value: String, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
            Text(value)
                .font(.title2.weight(.semibold))
                .foregroundStyle(Theme.primaryText)
            Text(sub)
                .font(.caption2)
                .foregroundStyle(Theme.tertiaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Reply rate by day sent — the shared chart, unchanged. A wide window makes
/// the seven bars legible in a way a phone column never could.
private struct MacReplyByDay: View {
    let buckets: [MessagesResponse.DayBucket]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Reply rate by day sent")
                .font(.headline)
                .foregroundStyle(Theme.primaryText)
            ReplyByDayChart(buckets: buckets)
        }
        .card(padding: 14)
    }
}

/// Top templates with their numbers, one per line.
private struct MacTopTemplates: View {
    let templates: [MessagesResponse.Template]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Top templates")
                .font(.headline)
                .foregroundStyle(Theme.primaryText)
            ForEach(templates) { template in
                HStack(spacing: 8) {
                    Image(systemName: "paperplane")
                        .font(.caption2)
                        .foregroundStyle(Theme.tertiaryText)
                    Text(template.name)
                        .font(.subheadline)
                        .foregroundStyle(Theme.primaryText)
                    Spacer()
                    Text("\(template.sent) sent")
                    Text(MessagesView.rate(template.replied, template.sent))
                    if template.booked > 0 {
                        Text("\(template.booked) booked")
                            .foregroundStyle(Theme.positive)
                    }
                }
                .font(.caption)
                .foregroundStyle(Theme.tertiaryText)
            }
        }
        .card(padding: 14)
    }
}

/// The detail pane for a message — the shared `MessageDetailView`, whose quick
/// actions (text with attachments, email) and its Keep in touch / Declined
/// buttons all work unchanged on the Mac.
struct MacMessageDetailHost: View {
    @Binding var selection: MessagesResponse.Send?

    var body: some View {
        if let send = selection {
            MessageDetailView(send: send)
                .navigationTitle(send.channel == "email" ? "Email" : "Text")
        } else {
            EmptyStateView(
                icon: "paperplane",
                title: "No message selected",
                message: "Pick a message to see the quick actions and what came back."
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
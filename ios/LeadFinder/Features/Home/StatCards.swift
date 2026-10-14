import SwiftUI

// The stat cards: on the iPhone they live together on the Home tab; the Mac's
// Messaging page still shows the goal and outreach cards, as the web does.

/// One number with a label above and a line of context below.
struct StatTile: View {
    let label: String
    let value: String
    let sub: String

    init(_ label: String, _ value: String, _ sub: String) {
        self.label = label
        self.value = value
        self.sub = sub
    }

    var body: some View {
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
}

/// The web's GoalCard: the monthly goal worked backwards into a weekly
/// pace of texts, replies and new clients.
struct GoalCard: View {
    let goal: MessagesResponse.Goal

    var body: some View {
        let met = goal.gap == 0
        let week = goal.thisWeek
        let progress = goal.goal > 0 ? min(1, goal.booked / goal.goal) : 0

        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text("\(goal.booked.currencyString) of \(goal.goal.currencyString) booked for \(goal.month)")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)

                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.cardRaised)
                        Capsule()
                            .fill(Theme.emerald)
                            .frame(width: proxy.size.width * progress)
                    }
                }
                .frame(height: 8)

                Text(met
                    ? "Goal met"
                    : "\(goal.gap.currencyString) to go, about \(goal.jobsNeeded) job\(goal.jobsNeeded == 1 ? "" : "s") at \(goal.avgJob.currencyString)")
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
            }

            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                spacing: 14
            ) {
                if let plan = goal.plan {
                    StatTile(
                        "Text this week",
                        week.textsToGo == 0 ? "On pace" : "\(week.textsToGo) more",
                        "\(week.texts) of \(plan.textsPerWeek) sent"
                    )
                    StatTile(
                        "Replies this week",
                        week.repliesToGo == 0 ? "On pace" : "\(week.repliesToGo) more",
                        "\(week.replies) of \(plan.repliesPerWeek)"
                    )
                } else {
                    StatTile("Text this week", "\(week.textsToGo) more", "\(week.texts) sent so far")
                    StatTile("Replies this week", "\(week.repliesToGo) more", "\(week.replies) so far")
                }
                StatTile("Follow-ups due", "\(week.followUpsDue)", "\(week.followUps) sent this week")
                if let plan = goal.plan {
                    StatTile(
                        "New clients",
                        "\(plan.newClientsThisMonth) this month",
                        "about \(Int(plan.newClientsPerMonth.rounded(.up))) a month needed"
                    )
                } else {
                    StatTile(
                        "Interested",
                        "\(goal.interested.live)",
                        "of the \(goal.interested.needed) it takes"
                    )
                }
            }

            if let note = goal.note?.nilIfBlank {
                Text(note)
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
                    .padding(.top, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .top) { Divider().overlay(Theme.cardRaised) }
            }
        }
        .card(padding: 14)
    }
}

/// The web's MessagingStatsCard: the three headline numbers, the top
/// templates and the reply rate by day, in one card. Texting only. The
/// 30-day window applies to "sent" only — reply and booked rates are
/// all-time, as on the web. Hidden until a text has gone out.
struct OutreachStatsCard: View {
    let stats: MessagesResponse.Stats

    var body: some View {
        if stats.sms.sent > 0 {
            let shown = Self.topTemplates(stats.templates)

            VStack(alignment: .leading, spacing: 14) {
                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                    spacing: 14
                ) {
                    StatTile("Last 30 days", "\(stats.sms.sentRecent) sent", "texts")
                    StatTile(
                        "Text replies",
                        MessagesView.rate(stats.sms.replied, stats.sms.sent),
                        "\(stats.sms.replied) of \(stats.sms.sent) texts"
                    )
                    StatTile(
                        "Booked",
                        "\(stats.sms.booked + stats.email.booked)",
                        "\(stats.revenue.currencyString) revenue"
                    )
                }

                if !shown.isEmpty {
                    Divider().overlay(Theme.cardRaised)
                    templateTable(shown)
                }

                Divider().overlay(Theme.cardRaised)
                ReplyByDayChart(buckets: stats.byDay.sms)
            }
            .card(padding: 14)
        }
    }

    /// The web's `topTemplates`: live texting templates that got a reply, by
    /// replies then bookings. Follow-ups and archived ones are left out; the
    /// totals above still count every send.
    private static func topTemplates(_ templates: [MessagesResponse.Template]) -> [MessagesResponse.Template] {
        templates
            .filter { $0.channel == "sms" && $0.replied > 0 && !$0.archived && $0.type != "follow_up" }
            .sorted { ($0.replied, $0.booked) > ($1.replied, $1.booked) }
            .prefix(3)
            .map { $0 }
    }

    /// Template / Sent / Replies / Booked, as the web's four-column grid.
    private func templateTable(_ templates: [MessagesResponse.Template]) -> some View {
        Grid(alignment: .trailing, horizontalSpacing: 14, verticalSpacing: 8) {
            GridRow {
                header("Template").gridColumnAlignment(.leading)
                header("Sent")
                header("Replies")
                header("Booked")
            }
            ForEach(templates) { template in
                GridRow {
                    HStack(spacing: 6) {
                        Image(systemName: "message")
                            .font(.caption2)
                            .foregroundStyle(Theme.tertiaryText)
                        Text(template.name)
                            .font(.subheadline)
                            .foregroundStyle(Theme.primaryText)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .gridColumnAlignment(.leading)

                    Text("\(template.sent)")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(Theme.primaryText)
                    HStack(spacing: 4) {
                        Text("\(template.replied)")
                            .foregroundStyle(Theme.primaryText)
                        Text("· \(MessagesView.rate(template.replied, template.sent))")
                            .foregroundStyle(Theme.tertiaryText)
                    }
                    .font(.subheadline.monospacedDigit())
                    Text(template.booked > 0 ? "\(template.booked)" : "\u{2014}")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(Theme.primaryText)
                }
            }
        }
    }

    private func header(_ title: String) -> some View {
        Text(title)
            .font(.caption)
            .foregroundStyle(Theme.secondaryText)
    }
}

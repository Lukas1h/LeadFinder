#if os(iOS)

import SwiftUI

/// The iPhone's first tab: what's left to do today, then every number in one
/// place (the month's goal, money, outreach). It reads the feeds the other
/// tabs already load, so it has no endpoint of its own and can't disagree
/// with them.
///
/// iPhone only: the Mac's sidebar mirrors the web, whose Messaging and Booked
/// pages carry these cards themselves.
struct HomeView: View {
    @Environment(AppState.self) private var appState
    @Binding var selection: AppTab
    @State private var openBooking: Booking?

    var body: some View {
        NavigationStack {
            Group {
                if hasAnything {
                    content
                } else if firstError != nil {
                    EmptyStateView(icon: "wifi.exclamationmark", title: "Couldn't load", message: firstError)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(Theme.background)
            .navigationTitle("Home")
            .navigationDestination(for: FollowUpRoute.self) { _ in FollowUpView() }
            .navigationDestination(for: BookingsRoute.self) { _ in BookingsView() }
            .sheet(item: $openBooking) { booking in
                BookingDetailView(booking: booking)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .task { await appState.messages.load() }
            .task { await appState.bookings.load() }
            .task { await appState.followUp.load() }
            .task { await appState.schedule.load() }
        }
    }

    private var hasAnything: Bool {
        appState.messages.value != nil || appState.bookings.value != nil || appState.followUp.value != nil
    }

    private var firstError: String? {
        appState.messages.error ?? appState.bookings.error ?? appState.followUp.error
    }

    private var content: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                ErrorBanner(message: firstError, onRetry: { Task { await reload() } })

                todaySection

                if let goal = appState.messages.value?.goal {
                    heading("This month")
                    GoalCard(goal: goal)
                }

                if let bookings = appState.bookings.value {
                    heading("Money")
                    unpaidCard(bookings)
                    BookingStatsView(completed: bookings.completed)
                }

                if let stats = appState.messages.value?.stats, stats.sms.sent > 0 {
                    heading("Outreach")
                    OutreachStatsCard(stats: stats)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .refreshable { await reload() }
    }

    private func reload() async {
        let state = appState
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await state.messages.load(force: true) }
            group.addTask { await state.bookings.load(force: true) }
            group.addTask { await state.followUp.load(force: true) }
            group.addTask { await state.schedule.load(force: true) }
        }
    }

    private func heading(_ title: String) -> some View {
        Text(title)
            .font(.headline)
            .foregroundStyle(Theme.primaryText)
            .padding(.top, 4)
    }

    // MARK: - Today

    /// The day's to-do list: each row is something waiting on him, and opens
    /// where it gets done. Rows with nothing in them are left out.
    @ViewBuilder
    private var todaySection: some View {
        let rows = todayRows
        if !rows.isEmpty {
            heading("Today")
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { Divider().overlay(Theme.cardRaised) }
                    todayRow(row)
                }
            }
            .card(padding: 4)
        }
    }

    private struct TodayRow: Identifiable {
        enum Target {
            case followUp
            case bookings
            case booking(Booking)
            case tab(AppTab)
        }

        let id: String
        let icon: String
        let tint: Color
        let title: String
        let detail: String
        let target: Target
    }

    private var todayRows: [TodayRow] {
        var rows: [TodayRow] = []

        if let followUp = appState.followUp.value, let today = followUp.today {
            let target = followUp.dailyTarget ?? 5
            let done = min(followUp.doneToday ?? 0, target)
            rows.append(TodayRow(
                id: "follow-up",
                icon: "heart.circle",
                tint: done >= target ? Theme.emerald : Theme.accent,
                title: "Follow-ups",
                detail: done >= target ? "All \(target) done" : "\(done) of \(target) done · \(today.count) waiting",
                target: .followUp
            ))

            let offers = (followUp.droneOffers ?? []).reduce(0) { $0 + $1.items.count }
            if offers > 0 {
                rows.append(TodayRow(
                    id: "drone",
                    icon: "airplane",
                    tint: Theme.sky,
                    title: "Free drone shots",
                    detail: "\(offers) agent\(offers == 1 ? "" : "s") to offer",
                    target: .followUp
                ))
            }
        }

        if let week = appState.messages.value?.goal?.thisWeek, week.textsToGo > 0 {
            rows.append(TodayRow(
                id: "texts",
                icon: "paperplane",
                tint: Theme.accent,
                title: "Texts this week",
                detail: "\(week.textsToGo) more to stay on pace",
                target: .tab(.leads)
            ))
        }

        let reminders = (appState.schedule.value?.items ?? []).filter {
            $0.kind == "reminder" && !$0.done && (DateFormatting.isToday($0.date) || DateFormatting.isPastDay($0.date))
        }
        if !reminders.isEmpty {
            rows.append(TodayRow(
                id: "reminders",
                icon: "bell",
                tint: Theme.amber,
                title: "Reminders",
                detail: "\(reminders.count) due",
                target: .tab(.schedule)
            ))
        }

        if let bookings = appState.bookings.value {
            if let next = Self.nextShoot(bookings) {
                rows.append(TodayRow(
                    id: "next-shoot",
                    icon: "camera",
                    tint: Theme.sky,
                    title: "Next shoot",
                    detail: [BookingFormat.jobLine(next), next.city].compactMap { $0?.nilIfBlank }.joined(separator: " · "),
                    target: .booking(next)
                ))
            }
            let tentative = bookings.tentative ?? []
            if !tentative.isEmpty {
                rows.append(TodayRow(
                    id: "tentative",
                    icon: "questionmark.circle",
                    tint: Theme.amber,
                    title: "Tentative",
                    detail: "\(tentative.count) waiting on a date",
                    target: .bookings
                ))
            }
            let editing = bookings.editing ?? []
            if !editing.isEmpty {
                rows.append(TodayRow(
                    id: "editing",
                    icon: "photo.on.rectangle",
                    tint: Theme.accent,
                    title: "Editing",
                    detail: "\(editing.count) to deliver",
                    target: .bookings
                ))
            }
        }

        return rows
    }

    /// The soonest dated, confirmed job that hasn't been shot, from today on.
    private static func nextShoot(_ bookings: BookingsResponse) -> Booking? {
        let startOfToday = Calendar.current.startOfDay(for: Date())
        return bookings.upcoming
            .filter { $0.dateTentative != true && $0.shotAt == nil }
            .compactMap { booking -> (Booking, Date)? in
                guard let date = DateFormatting.parse(booking.jobDate), date >= startOfToday else { return nil }
                return (booking, date)
            }
            .min { $0.1 < $1.1 }?
            .0
    }

    @ViewBuilder
    private func todayRow(_ row: TodayRow) -> some View {
        switch row.target {
        case .followUp:
            NavigationLink(value: FollowUpRoute()) { rowLabel(row) }.buttonStyle(.plain)
        case .bookings:
            NavigationLink(value: BookingsRoute()) { rowLabel(row) }.buttonStyle(.plain)
        case .booking(let booking):
            Button { openBooking = booking } label: { rowLabel(row) }.buttonStyle(.plain)
        case .tab(let tab):
            Button { selection = tab } label: { rowLabel(row) }.buttonStyle(.plain)
        }
    }

    private func rowLabel(_ row: TodayRow) -> some View {
        HStack(spacing: 12) {
            Image(systemName: row.icon)
                .font(.body)
                .foregroundStyle(row.tint)
                .frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                Text(row.detail)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.tertiaryText)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    // MARK: - Money

    /// Work booked but not paid for yet, by stage, each with what it's worth.
    /// Opens the bookings list.
    private func unpaidCard(_ bookings: BookingsResponse) -> some View {
        let upcoming = bookings.upcoming.filter { $0.dateTentative != true && $0.shotAt == nil }
        let tiles: [(String, [Booking])] = [
            ("Upcoming", upcoming),
            ("Tentative", bookings.tentative ?? []),
            ("Editing", bookings.editing ?? []),
            ("Invoice sent", bookings.waitingForPayment),
        ]
        let owed = tiles.reduce(0) { $0 + Self.worth($1.1) }

        return NavigationLink(value: BookingsRoute()) {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Not paid yet")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.primaryText)
                    Spacer(minLength: 0)
                    Text(owed.currencyString)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.primaryText)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.tertiaryText)
                }
                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                    spacing: 14
                ) {
                    ForEach(tiles, id: \.0) { tile in
                        StatTile(tile.0, Self.worth(tile.1).currencyString, "\(tile.1.count) job\(tile.1.count == 1 ? "" : "s")")
                    }
                }
            }
            .card(padding: 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private static func worth(_ bookings: [Booking]) -> Int {
        bookings.reduce(0) { $0 + BookingStatsView.profit($1) }
    }
}

#endif

#if os(iOS)

import SwiftUI

/// The iPhone's first tab: Outreach, then Bookings, each as a grid of stat
/// tiles with today's quota underneath. It reads the feeds the
/// other tabs already load, so it has no endpoint of its own and can't
/// disagree with them.
///
/// iPhone only: the Mac's sidebar mirrors the web, whose Messaging and Booked
/// pages carry these numbers themselves.
struct HomeView: View {
    @Environment(AppState.self) private var appState
    @Binding var selection: AppTab
    @State private var openBooking: Booking?

    var body: some View {
        NavigationStack {
            Group {
                if appState.messages.value != nil || appState.bookings.value != nil {
                    content
                } else if let error = firstError {
                    EmptyStateView(icon: "wifi.exclamationmark", title: "Couldn't load", message: error)
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
        }
    }

    private var firstError: String? {
        appState.messages.error ?? appState.bookings.error ?? appState.followUp.error
    }

    private var content: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                ErrorBanner(message: firstError, onRetry: { Task { await reload() } })
                if let messages = appState.messages.value { outreachSection(messages) }
                if let bookings = appState.bookings.value { bookingsSection(bookings) }
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
        }
    }

    // MARK: - Sections

    /// Texting stats, then today's texts and follow-ups.
    @ViewBuilder
    private func outreachSection(_ messages: MessagesResponse) -> some View {
        let stats = messages.stats
        sectionHeading("Outreach")
        grid {
            StatTile("Texts sent", "\(stats.sms.sentRecent)", "last 30 days").tile()
            StatTile(
                "Reply rate",
                MessagesView.rate(stats.sms.replied, stats.sms.sent),
                "\(stats.sms.replied) of \(stats.sms.sent) texts"
            ).tile()
            StatTile("Booked", "\(stats.sms.booked + stats.email.booked)", "jobs from outreach").tile()
            StatTile("Revenue", stats.revenue.currencyString, "from outreach").tile()
        }
        if stats.sms.sent > 0 {
            ReplyByDayChart(buckets: stats.byDay.sms).tile()
        }

        todayHeading
        grid {
            if let today = messages.goal?.today {
                Button { selection = .leads } label: {
                    quota("Texts", done: today.texts, of: today.textsTarget)
                }
                .buttonStyle(.plain)
            }
            if let followUp = appState.followUp.value, let target = followUp.dailyTarget {
                NavigationLink(value: FollowUpRoute()) {
                    quota("Follow-ups", done: followUp.doneToday ?? 0, of: target)
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// Money from finished jobs, then the next shoot and what's left to edit.
    @ViewBuilder
    private func bookingsSection(_ bookings: BookingsResponse) -> some View {
        let stats = BookingStatsView.stats(bookings.completed)
        let next = Self.nextShoot(bookings)
        let editing = bookings.editing ?? []

        sectionHeading("Bookings")
        grid {
            StatTile("Last 30 days", stats.recentProfit.currencyString, Self.count(stats.recentCount, "booking")).tile()
            StatTile("All time", stats.allTimeProfit.currencyString, Self.count(stats.allTimeCount, "booking")).tile()
            StatTile("Avg per booking", stats.average.map { $0.currencyString } ?? "—", "profit").tile()
            StatTile(
                "Avg per hour",
                stats.perHour.map { "\($0.currencyString)/hr" } ?? "—",
                stats.perHour != nil ? "profit" : "no hours recorded"
            ).tile()
        }

        todayHeading
        grid {
            Button { if let next { openBooking = next } } label: {
                StatTile(
                    "Next shoot",
                    next.flatMap { DateFormatting.parse($0.jobDate) }.map(Self.day) ?? "None booked",
                    next.map(Self.timeAndPlace) ?? "nothing on the calendar"
                )
                .tile(highlighted: true)
            }
            .buttonStyle(.plain)
            .disabled(next == nil)

            NavigationLink(value: BookingsRoute()) {
                StatTile("To edit", "\(editing.count)", editing.isEmpty ? "all delivered" : "shot, not delivered")
                    .tile(highlighted: true)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Building blocks

    private func sectionHeading(_ title: String) -> some View {
        Text(title)
            .font(.title3.weight(.semibold))
            .foregroundStyle(Theme.primaryText)
            .padding(.top, 8)
    }

    private var todayHeading: some View {
        Text("Today")
            .font(.caption.weight(.semibold))
            .foregroundStyle(Theme.secondaryText)
            .textCase(.uppercase)
            .padding(.top, 4)
    }

    private func grid<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
            spacing: 12,
            content: content
        )
    }

    /// "12 of 20" over a progress bar, green once it's met.
    private func quota(_ label: String, done: Int, of target: Int) -> some View {
        let met = done >= target
        let progress = target > 0 ? min(1, Double(done) / Double(target)) : 1
        return VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
            HStack(spacing: 6) {
                Text("\(done) of \(target)")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(met ? Theme.emerald : Theme.primaryText)
                if met {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(Theme.emerald)
                }
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.cardRaised)
                    Capsule()
                        .fill(met ? Theme.emerald : Theme.accent.opacity(0.7))
                        .frame(width: proxy.size.width * progress)
                }
            }
            .frame(height: 6)
            Text(met ? "done for today" : "\(target - done) more")
                .font(.caption2)
                .foregroundStyle(Theme.tertiaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tile(highlighted: true)
    }

    private static func count(_ n: Int, _ noun: String) -> String {
        "\(n) \(noun)\(n == 1 ? "" : "s")"
    }

    // MARK: - Next shoot

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

    /// "Today", "Tomorrow", or "Fri, Oct 16".
    private static func day(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInTomorrow(date) { return "Tomorrow" }
        return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    /// "9:00 AM · Roseburg".
    private static func timeAndPlace(_ booking: Booking) -> String {
        let time = DateFormatting.parse(booking.jobDate).map { DateFormatting.time.string(from: $0) }
        return [time, booking.city?.nilIfBlank].compactMap { $0 }.joined(separator: " · ")
    }
}

private extension View {
    /// One stat in its own small card. Highlighted for the "Today" quota, so
    /// what's left to do stands apart from the numbers above it.
    func tile(highlighted: Bool = false) -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(
                highlighted ? Theme.accent.opacity(0.07) : Theme.card,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(highlighted ? Theme.accent.opacity(0.3) : Theme.border, lineWidth: 0.5)
            )
            .contentShape(Rectangle())
    }
}

#endif

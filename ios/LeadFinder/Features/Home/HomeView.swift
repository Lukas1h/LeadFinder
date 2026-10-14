#if os(iOS)

import SwiftUI

/// The iPhone's first tab: two cards, Outreach and Bookings, each with its
/// stats on top and what today asks for underneath. It reads the feeds the
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
            LazyVStack(alignment: .leading, spacing: 16) {
                ErrorBanner(message: firstError, onRetry: { Task { await reload() } })
                if let messages = appState.messages.value { outreachCard(messages) }
                if let bookings = appState.bookings.value { bookingsCard(bookings) }
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

    // MARK: - Cards

    /// Texting stats, then today's texts and follow-ups.
    private func outreachCard(_ messages: MessagesResponse) -> some View {
        let stats = messages.stats
        return card("Outreach") {
            grid {
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
        } today: {
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
    }

    /// Money from finished jobs, then the next shoot and what's left to edit.
    private func bookingsCard(_ bookings: BookingsResponse) -> some View {
        let next = Self.nextShoot(bookings)
        let editing = bookings.editing ?? []
        return card("Bookings") {
            BookingStatsView(completed: bookings.completed, standalone: false)
        } today: {
            grid {
                Button { if let next { openBooking = next } } label: {
                    StatTile(
                        "Next shoot",
                        next.flatMap { DateFormatting.parse($0.jobDate) }.map(Self.day) ?? "None booked",
                        next.map(Self.timeAndPlace) ?? "nothing on the calendar"
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(next == nil)

                NavigationLink(value: BookingsRoute()) {
                    StatTile(
                        "To edit",
                        "\(editing.count)",
                        editing.isEmpty ? "all delivered" : "shot, not delivered"
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Building blocks

    /// A titled card: stats, a divider, then "Today" and its quota.
    private func card<Stats: View, Today: View>(
        _ title: String,
        @ViewBuilder stats: () -> Stats,
        @ViewBuilder today: () -> Today
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(.headline)
                .foregroundStyle(Theme.primaryText)
            stats()
            Divider().overlay(Theme.cardRaised)
            Text("Today")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.secondaryText)
                .textCase(.uppercase)
            today()
        }
        .card(padding: 14)
    }

    private func grid<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
            spacing: 14,
            content: content
        )
    }

    /// "12 of 20" with what's left underneath, green once it's met.
    private func quota(_ label: String, done: Int, of target: Int) -> some View {
        let met = done >= target
        return VStack(alignment: .leading, spacing: 3) {
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
            Text(met ? "done for today" : "\(target - done) more")
                .font(.caption2)
                .foregroundStyle(Theme.tertiaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
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

#endif

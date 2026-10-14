#if os(iOS)

import SwiftUI

/// The iPhone's first tab: every stat card the app has, in one place, a
/// section at a time. Each section shows its stats exactly as they look on
/// their own page, then what's left to do today for it.
///
/// The cards are the same views the Messages and Bookings pages use, fed by
/// the same cached feeds, so the numbers can't disagree with those pages.
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

                if let messages = appState.messages.value {
                    if let goal = messages.goal {
                        heading("Monthly goal")
                        GoalCard(goal: goal)
                    }

                    heading("Outreach")
                    OutreachStatsCard(stats: messages.stats)
                    outreachToDo(messages)
                }

                if let bookings = appState.bookings.value {
                    heading("Bookings")
                    BookingStatsView(completed: bookings.completed)
                    bookingsToDo(bookings)
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
        }
    }

    // MARK: - What's left to do

    /// Today's texts (this week's leftover spread over the days left) and
    /// today's follow-ups.
    private func outreachToDo(_ messages: MessagesResponse) -> some View {
        toDoCard {
            if let today = messages.goal?.today {
                Button { selection = .leads } label: {
                    quota("Texts today", done: today.texts, of: today.textsTarget)
                }
                .buttonStyle(.plain)
            }
            if let followUp = appState.followUp.value, let target = followUp.dailyTarget {
                NavigationLink(value: FollowUpRoute()) {
                    quota("Follow-ups today", done: followUp.doneToday ?? 0, of: target)
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// The next shoot, and the jobs shot but not delivered.
    private func bookingsToDo(_ bookings: BookingsResponse) -> some View {
        let next = Self.nextShoot(bookings)
        let editing = bookings.editing ?? []
        return toDoCard {
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
                StatTile("To edit", "\(editing.count)", editing.isEmpty ? "all delivered" : "shot, not delivered")
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Building blocks

    private func heading(_ title: String) -> some View {
        Text(title)
            .font(.headline)
            .foregroundStyle(Theme.primaryText)
            .padding(.top, 8)
    }

    /// A stat card like the others, headed "To do".
    private func toDoCard<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("To do")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.secondaryText)
                .textCase(.uppercase)
            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                spacing: 14,
                content: content
            )
        }
        .card(padding: 14)
    }

    /// "12 of 20" and what's left, green with a check once it's met.
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
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                if met {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(Theme.emerald)
                }
            }
            Text(met ? "done for today" : "\(target - done) more")
                .font(.caption2)
                .foregroundStyle(Theme.tertiaryText)
                .lineLimit(1)
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

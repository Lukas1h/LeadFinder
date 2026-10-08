import SwiftUI

/// The bookings list, reached from the Schedule tab's header. The Schedule tab
/// itself is about reminders and follow-ups; jobs are a longer list of a
/// different shape (money, lockboxes, invoices), so they get their own page
/// instead of sitting under thirty days of reminders.
///
/// Read-only in Phase 2 — marking an invoice sent or completing a job arrives
/// with the booking actions.
struct BookingsView: View {
    @Environment(AppState.self) private var appState
    @State private var openBooking: Booking?

    var body: some View {
        Group {
            if let bookings = appState.bookings.value {
                content(bookings)
            } else if appState.bookings.error != nil {
                loadFailure
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .navigationTitle("Bookings")
        .task { await appState.bookings.load() }
        .sheet(item: $openBooking) { booking in
            BookingDetailView(booking: booking)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    private func content(_ response: BookingsResponse) -> some View {
        let sections = Self.sections(from: response)

        return VStack(alignment: .leading, spacing: 0) {
            ErrorBanner(
                message: appState.bookings.error,
                onRetry: { Task { await appState.bookings.load(force: true) } }
            )
            .padding(.horizontal, 16)
            .padding(.top, 8)

            if sections.isEmpty {
                EmptyStateView(
                    icon: "calendar",
                    title: "No bookings yet",
                    message: "Jobs you take on will show up here."
                )
                .frame(maxWidth: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 20) {
                        BookingStatsView(completed: response.completed)

                        ForEach(sections) { section in
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(spacing: 8) {
                                    Text(section.title)
                                        .font(.headline)
                                        .foregroundStyle(Theme.primaryText)
                                    BadgeChip(text: "\(section.bookings.count)", tint: Theme.secondaryText)
                                    Spacer(minLength: 0)
                                }
                                ForEach(section.bookings) { booking in
                                    BookingCard(booking: booking, openBooking: { openBooking = $0 })
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 28)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .refreshable { await appState.bookings.load(force: true) }
            }
        }
    }

    /// The web's three buckets, in its order, with empty ones dropped.
    static func sections(from response: BookingsResponse) -> [BookingSection] {
        [
            BookingSection(title: "Upcoming", bookings: response.upcoming),
            BookingSection(title: "Waiting for payment", bookings: response.waitingForPayment),
            BookingSection(title: "Completed", bookings: response.completed),
        ]
        .filter { !$0.bookings.isEmpty }
    }

    private var loadFailure: some View {
        VStack(spacing: 14) {
            EmptyStateView(
                icon: "wifi.exclamationmark",
                title: "Couldn't load bookings",
                message: appState.bookings.error
            )
            Button("Try again") {
                Task { await appState.bookings.load(force: true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// One job row: when it is, where, who for, what it pays, and the lockbox code
/// — that last one is what Lukas is standing in front of on site.
///
/// No photo: a booking is about a person and a place on a calendar, and the
/// lead card is where a property photo earns its space.
struct BookingCard: View {
    let booking: Booking
    var openBooking: (Booking) -> Void = { _ in }

    var body: some View {
        Button { openBooking(booking) } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "calendar")
                    .font(.title3)
                    .foregroundStyle(Theme.tertiaryText)
                    .frame(width: 26)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(BookingFormat.jobLine(booking))
                            .font(.caption)
                            .foregroundStyle(Theme.tertiaryText)
                        Spacer(minLength: 0)
                        if let code = booking.lockboxCode?.nilIfBlank {
                            BadgeChip(text: "Lockbox \(code)", tint: Theme.warning, filled: true)
                        }
                    }
                    Text(booking.addressLine.isEmpty ? "No address on file" : booking.addressLine)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.primaryText)
                    Text(contactAndTotal)
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                    if let drive = booking.driveTime?.nilIfBlank {
                        Label(drive, systemImage: "car")
                            .font(.caption)
                            .foregroundStyle(Theme.tertiaryText)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .card()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
    }

    private var contactAndTotal: String {
        var parts: [String] = []
        if let name = booking.contactName?.nilIfBlank {
            parts.append(name)
        }
        parts.append(BookingFormat.price(booking.total))
        return parts.joined(separator: " · ")
    }
}

/// Value pushed from the Schedule tab to reach the bookings page.
struct BookingsRoute: Hashable {
    init() {}
}

struct BookingSection: Identifiable {
    let title: String
    let bookings: [Booking]

    var id: String { title }
}
/// The four numbers the web's Booked page leads with (BookingStats in
/// BookedList.tsx), ported from src/app/booked/bookingMath.ts so the two agree.
///
/// Counts only completed bookings — money actually in hand. "Last 30 days"
/// goes by the job date rather than when it was marked complete, because older
/// jobs entered after the fact were all completed on the day they were
/// backfilled; a booking with no job date falls back to its completed date.
struct BookingStatsView: View {
    let completed: [Booking]

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
            spacing: 14
        ) {
            stat("Last 30 days", stats.recentProfit.currencyString, "\(stats.recentCount) booking\(stats.recentCount == 1 ? "" : "s")")
            stat("All time", stats.allTimeProfit.currencyString, "\(stats.allTimeCount) booking\(stats.allTimeCount == 1 ? "" : "s")")
            stat("Avg per booking", stats.average.map { $0.currencyString } ?? "—", "profit")
            stat(
                "Avg per hour",
                stats.perHour.map { "\($0.currencyString)/hr" } ?? "—",
                stats.perHour != nil ? "profit" : "no hours recorded"
            )
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
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(sub)
                .font(.caption2)
                .foregroundStyle(Theme.tertiaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var stats: Stats {
        let cutoff = Date().addingTimeInterval(-30 * 24 * 60 * 60)
        let recent = completed.filter { booking in
            let when = DateFormatting.parse(booking.jobDate) ?? DateFormatting.parse(booking.completedAt)
            return (when ?? .distantPast) >= cutoff
        }
        let allTimeProfit = completed.reduce(0) { $0 + Self.profit($1) }
        return Stats(
            recentCount: recent.count,
            recentProfit: recent.reduce(0) { $0 + Self.profit($1) },
            allTimeCount: completed.count,
            allTimeProfit: allTimeProfit,
            average: completed.isEmpty ? nil : Double(allTimeProfit) / Double(completed.count),
            perHour: Self.averageProfitPerHour(completed)
        )
    }

    private struct Stats {
        var recentCount: Int
        var recentProfit: Int
        var allTimeCount: Int
        var allTimeProfit: Int
        var average: Double?
        var perHour: Double?
    }

    /// bookingProfit: the line-item total minus any additional costs recorded
    /// when the job was completed.
    private static func profit(_ booking: Booking) -> Int {
        booking.total - (booking.additionalCosts ?? 0)
    }

    private static func hours(_ booking: Booking) -> Double {
        [booking.driveHours, booking.shootingHours, booking.editingHours, booking.logisticsHours]
            .reduce(0) { $0 + ($1 ?? 0) }
    }

    /// Only bookings with hours recorded count: one with profit but no hours
    /// would otherwise inflate the rate.
    private static func averageProfitPerHour(_ bookings: [Booking]) -> Double? {
        let timed = bookings.filter { hours($0) > 0 }
        let total = timed.reduce(0.0) { $0 + hours($1) }
        guard total > 0 else { return nil }
        return Double(timed.reduce(0) { $0 + profit($1) }) / total
    }
}

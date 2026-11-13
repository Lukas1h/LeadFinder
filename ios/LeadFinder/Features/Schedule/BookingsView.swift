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
    @State private var newBooking = false

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
        .toolbar {
            ToolbarItem(placement: .trailingBar) {
                Button { newBooking = true } label: { Label("Add booking", systemImage: "plus") }
            }
        }
        .sheet(isPresented: $newBooking) {
            BookingEditSheet { _ in
                Task {
                    await appState.bookings.load(force: true)
                    await appState.schedule.load(force: true)
                }
            }
        }
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
                        BookingStatsView(completed: response.completed, outstanding: response.waitingForPayment)

                        ForEach(sections) { section in
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(spacing: 8) {
                                    Text(section.title)
                                        .font(.headline)
                                        .foregroundStyle(Theme.primaryText)
                                    BadgeChip(text: "\(section.bookings.count)", tint: Theme.secondaryText)
                                    Spacer(minLength: 0)
                                    Text(section.totalLabel)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(Theme.primaryText)
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

    /// One section per booking stage, in the order a job moves through
    /// them, with empty ones dropped. Every booking is in exactly one.
    static func sections(from response: BookingsResponse) -> [BookingSection] {
        let scheduled = response.scheduled ?? response.upcoming.filter { $0.currentStage == .scheduled }
        return [
            BookingSection(stage: .tentative, bookings: response.tentative ?? response.upcoming.filter { $0.currentStage == .tentative }),
            BookingSection(stage: .scheduled, bookings: scheduled),
            BookingSection(stage: .editing, bookings: response.editing ?? []),
            BookingSection(stage: .invoiceSent, bookings: response.waitingForPayment),
            BookingSection(stage: .completed, bookings: response.completed),
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
                    // Needs ATC authorization before the drone flies there. Only
                    // while it's still to shoot, as on the web: once the job is
                    // done the airspace is no longer in question.
                    if let airspace = airspaceBadge {
                        BadgeChip(text: airspace, tint: Theme.warning, filled: true, icon: "exclamationmark.triangle.fill")
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
        parts.append(BookingFormat.price(booking.revenue))
        return parts.joined(separator: " · ")
    }

    /// "Class D airspace" when the address needs ATC authorization, nil
    /// otherwise. Shot, invoiced or completed jobs drop it: the web's card only
    /// warns while the shoot is still ahead.
    private var airspaceBadge: String? {
        guard booking.currentStage.isUpcoming else { return nil }
        return booking.airspace?.badgeLabel
    }
}

/// Value pushed from the Schedule tab to reach the bookings page.
struct BookingsRoute: Hashable {
    init() {}
}

struct BookingSection: Identifiable {
    let stage: BookingStage
    let bookings: [Booking]

    var id: String { stage.rawValue }
    var title: String { stage.label }

    /// What the section is worth in revenue (line items, before costs).
    var total: Int {
        bookings.reduce(0) { $0 + $1.revenue }
    }

    /// Invoice sent reads as money still owed: "$1,250 outstanding".
    var totalLabel: String {
        stage == .invoiceSent ? "\(total.currencyString) outstanding" : total.currencyString
    }
}

/// The numbers the Bookings page leads with: revenue, not profit (profit is
/// on each booking's Time & money and on Finances).
///
/// "Last 30 days" goes by the job date rather than when it was paid, because
/// older jobs entered after the fact were all completed on the day they were
/// backfilled; a booking with no job date falls back to its paid date.
struct BookingStatsView: View {
    let completed: [Booking]
    var outstanding: [Booking] = []

    var body: some View {
        let cutoff = Date().addingTimeInterval(-30 * 24 * 60 * 60)
        let recent = completed.filter { booking in
            let when = DateFormatting.parse(booking.jobDate)
                ?? DateFormatting.parse(booking.paidAt ?? booking.completedAt)
            return (when ?? .distantPast) >= cutoff
        }
        let recentRevenue = recent.reduce(0) { $0 + $1.revenue }
        let allTime = completed.reduce(0) { $0 + $1.revenue }
        let owed = outstanding.reduce(0) { $0 + $1.revenue }
        return LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
            spacing: 14
        ) {
            StatTile("Last 30 days", recentRevenue.currencyString, Self.jobs(recent.count))
            StatTile("All time", allTime.currencyString, Self.jobs(completed.count))
            StatTile(
                "Avg per job",
                completed.isEmpty ? "\u{2014}" : (allTime / completed.count).currencyString,
                "revenue"
            )
            StatTile("Outstanding", owed.currencyString, "\(outstanding.count) invoice\(outstanding.count == 1 ? "" : "s") out")
        }
        .card(padding: 14)
    }

    private static func jobs(_ n: Int) -> String {
        "\(n) paid job\(n == 1 ? "" : "s")"
    }
}

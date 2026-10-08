import SwiftUI

/// Schedule tab: today first (past-due items stay visible under an "Earlier"
/// group), then the next ~30 days grouped by day, then the three booking
/// buckets. Read-only in Phase 2 — checking reminders off arrives later.
struct ScheduleView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        NavigationStack {
            Group {
                if appState.schedule.value != nil || appState.bookings.value != nil {
                    content
                } else if appState.schedule.error != nil || appState.bookings.error != nil {
                    errorState
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(Theme.background)
            .navigationTitle("Schedule")
            .navigationDestination(for: Booking.self) { BookingDetailView(booking: $0) }
            .refreshable {
                await appState.schedule.load(force: true)
                await appState.bookings.load(force: true)
            }
            .task { await appState.schedule.load() }
            .task { await appState.bookings.load() }
        }
    }

    // MARK: - Derived data

    private var scheduleItems: [ScheduleResponse.Item] {
        appState.schedule.value?.items ?? []
    }

    private var todayItems: [ScheduleResponse.Item] {
        scheduleItems.filter { DateFormatting.isToday($0.date) }
    }

    /// Past-due and unfinished: without this group an overdue reminder would
    /// silently disappear the moment its day rolls over.
    private var earlierItems: [ScheduleResponse.Item] {
        scheduleItems.filter { DateFormatting.isPastDay($0.date) && !$0.done }
    }

    private var futureItems: [ScheduleResponse.Item] {
        scheduleItems.filter { !DateFormatting.isPastDay($0.date) && !DateFormatting.isToday($0.date) }
    }

    private var bookingSections: [BookingSection] {
        guard let bookings = appState.bookings.value else { return [] }
        return [
            BookingSection(title: "Upcoming", bookings: bookings.upcoming),
            BookingSection(title: "Waiting for payment", bookings: bookings.waitingForPayment),
            BookingSection(title: "Completed", bookings: bookings.completed),
        ]
        .filter { !$0.bookings.isEmpty }
    }

    private var bookingById: [String: Booking] {
        guard let bookings = appState.bookings.value else { return [:] }
        var map: [String: Booking] = [:]
        for booking in bookings.upcoming + bookings.waitingForPayment + bookings.completed {
            map[booking.id] = booking
        }
        return map
    }

    private var hasContent: Bool {
        !scheduleItems.isEmpty || !bookingSections.isEmpty
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            FreshnessBar(
                fetchedAt: [appState.schedule.fetchedAt, appState.bookings.fetchedAt].compactMap { $0 }.min(),
                isRefreshing: appState.schedule.isRefreshing || appState.bookings.isRefreshing,
                error: appState.schedule.error ?? appState.bookings.error
            )
            .padding(.horizontal, 16)
            .padding(.top, 8)

            if !hasContent {
                EmptyStateView(
                    icon: "calendar",
                    title: "Nothing scheduled",
                    message: "Reminders, listing follow-ups and jobs will show up here."
                )
                .frame(maxWidth: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 20) {
                        if appState.schedule.value != nil {
                            todaySection
                        }
                        upcomingSection
                        bookingsSection
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 28)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    // MARK: - Today (with the overdue leftovers under "Earlier")

    @ViewBuilder
    private var todaySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Today")
                    .font(.headline)
                    .foregroundStyle(Theme.primaryText)
                if let day = DateFormatting.parseDay(appState.schedule.value?.today) {
                    Text(DateFormatting.weekday.string(from: day))
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                }
                Spacer(minLength: 0)
                if !todayItems.isEmpty {
                    BadgeChip(text: "\(todayItems.count)", tint: Theme.secondaryText)
                }
            }

            if todayItems.isEmpty && earlierItems.isEmpty {
                Text("Nothing today")
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
            }

            ForEach(todayItems) { item in
                itemRow(item)
            }

            if !earlierItems.isEmpty {
                Text("EARLIER")
                    .font(.caption2.weight(.bold))
                    .kerning(0.6)
                    .foregroundStyle(Theme.warning)
                    .padding(.top, 6)
                ForEach(earlierItems) { item in
                    itemRow(item)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Upcoming

    @ViewBuilder
    private var upcomingSection: some View {
        let result = upcomingBuckets(futureItems)
        if !result.buckets.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                sectionHeader("Upcoming", count: result.buckets.reduce(0) { $0 + $1.items.count })
                ForEach(result.buckets) { bucket in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(DateFormatting.relativeDay(bucket.date).nilIfBlank ?? bucket.date)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.secondaryText)
                        ForEach(bucket.items) { item in
                            itemRow(item)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                if result.truncated {
                    Text("Showing the next 30 days.")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Items arrive date-sorted from the API, so a plain group-by keeps each
    /// day's own order; anything past the ~30 day horizon is dropped and flagged.
    private func upcomingBuckets(_ items: [ScheduleResponse.Item]) -> (buckets: [DayBucket], truncated: Bool) {
        let horizon = Calendar.current.date(byAdding: .day, value: 30, to: Calendar.current.startOfDay(for: Date()))

        var kept: [ScheduleResponse.Item] = []
        var truncated = false
        for item in items {
            if let horizon, let day = DateFormatting.parseDay(item.date), day > horizon {
                truncated = true
            } else {
                kept.append(item)
            }
        }
        return (dayBuckets(kept), truncated)
    }

    private func dayBuckets(_ items: [ScheduleResponse.Item]) -> [DayBucket] {
        var buckets: [String: [ScheduleResponse.Item]] = [:]
        for item in items {
            buckets[item.date, default: []].append(item)
        }
        return buckets.keys.sorted().map { DayBucket(date: $0, items: buckets[$0] ?? []) }
    }

    // MARK: - Bookings

    @ViewBuilder
    private var bookingsSection: some View {
        if !bookingSections.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                sectionHeader("Bookings", count: bookingSections.reduce(0) { $0 + $1.bookings.count })
                ForEach(bookingSections) { section in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(section.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.secondaryText)
                        ForEach(section.bookings) { booking in
                            bookingRow(booking)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func bookingRow(_ booking: Booking) -> some View {
        NavigationLink(value: booking) {
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
                    Text(contactAndTotal(booking))
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

    private func contactAndTotal(_ booking: Booking) -> String {
        var parts: [String] = []
        if let name = booking.contactName?.nilIfBlank {
            parts.append(name)
        }
        parts.append(BookingFormat.price(booking.total))
        return parts.joined(separator: " · ")
    }

    // MARK: - Schedule item rows

    @ViewBuilder
    private func itemRow(_ item: ScheduleResponse.Item) -> some View {
        if let booking = item.bookingId.flatMap({ bookingById[$0] }) {
            NavigationLink(value: booking) {
                scheduleRow(item)
            }
            .buttonStyle(.plain)
        } else {
            scheduleRow(item)
        }
    }

    private func scheduleRow(_ item: ScheduleResponse.Item) -> some View {
        let overdue = DateFormatting.isPastDay(item.date) && !item.done
        return HStack(alignment: .top, spacing: 10) {
            kindIcon(item)
                .font(.title3)
                .foregroundStyle(iconTint(item))
                .frame(width: 26)

            VStack(alignment: .leading, spacing: 3) {
                Text(timeLine(item, overdue: overdue))
                    .font(.caption)
                    .foregroundStyle(overdue ? Theme.warning : Theme.tertiaryText)
                Text(item.title)
                    .font(.subheadline.weight(.semibold))
                    .strikethrough(item.done)
                    .foregroundStyle(item.done ? Theme.tertiaryText : Theme.primaryText)
                if let subtitle = item.subtitle?.nilIfBlank {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                }
                if let notes = item.notes?.nilIfBlank {
                    Text(notes)
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(2)
                }
                if let agent = item.agent {
                    Label(agent.displayName, systemImage: "person")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            rowTrailing(item, overdue: overdue)
        }
        .card()
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Done state is a picture, not a control: Phase 2 can't write it back.
    private func kindIcon(_ item: ScheduleResponse.Item) -> Image {
        switch item.kind {
        case "booking":
            return Image(systemName: "camera")
        case "followUp":
            return Image(systemName: "bell")
        default:
            return item.done ? Image(systemName: "checkmark.circle.fill") : Image(systemName: "circle")
        }
    }

    private func iconTint(_ item: ScheduleResponse.Item) -> Color {
        item.kind == "reminder" && item.done ? Theme.positive : Theme.tertiaryText
    }

    @ViewBuilder
    private func rowTrailing(_ item: ScheduleResponse.Item, overdue: Bool) -> some View {
        if overdue || item.kind != "reminder" {
            VStack(alignment: .trailing, spacing: 5) {
                if overdue {
                    BadgeChip(text: "Overdue", tint: Theme.warning, filled: true)
                }
                if item.kind == "booking" || item.kind == "followUp" {
                    Text(item.kind == "booking" ? "BOOKING" : "FOLLOW-UP")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
        }
    }

    private func timeLine(_ item: ScheduleResponse.Item, overdue: Bool) -> String {
        let clock = ScheduleClock.label(item.time, durationMinutes: item.durationMinutes)
        return overdue ? "\(DateFormatting.relativeDay(item.date)) · \(clock)" : clock
    }

    // MARK: - Shared bits

    private func sectionHeader(_ title: String, count: Int) -> some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.headline)
                .foregroundStyle(Theme.primaryText)
            BadgeChip(text: "\(count)", tint: Theme.secondaryText)
            Spacer(minLength: 0)
        }
    }

    private var errorState: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Theme.tertiaryText)
            Text("Couldn't load the schedule")
                .font(.headline)
                .foregroundStyle(Theme.secondaryText)
            if let error = appState.schedule.error ?? appState.bookings.error {
                Text(error)
                    .font(.subheadline)
                    .foregroundStyle(Theme.tertiaryText)
                    .multilineTextAlignment(.center)
            }
            Button("Try again") {
                Task {
                    await appState.schedule.load(force: true)
                    await appState.bookings.load(force: true)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Helpers

/// The API sends schedule times as "HH:MM" wall-clock strings; formatted by
/// hand so no shared formatter grows a schedule-only date format.
private enum ScheduleClock {
    static func label(_ time: String?, durationMinutes: Int?) -> String {
        guard let start = parse(time) else { return "All day" }
        let open = clock(start.0, start.1)
        guard let durationMinutes, durationMinutes > 0 else { return open }
        let end = (start.0 * 60 + start.1 + durationMinutes) % (24 * 60)
        return "\(open) – \(clock(end / 60, end % 60))"
    }

    private static func parse(_ time: String?) -> (Int, Int)? {
        guard let time else { return nil }
        let parts = time.split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else { return nil }
        return (hour, minute)
    }

    private static func clock(_ hour: Int, _ minute: Int) -> String {
        let hour12 = hour % 12 == 0 ? 12 : hour % 12
        return "\(hour12):\(String(format: "%02d", minute)) \(hour < 12 ? "AM" : "PM")"
    }
}

private struct DayBucket: Identifiable {
    let date: String
    let items: [ScheduleResponse.Item]

    var id: String { date }
}

private struct BookingSection: Identifiable {
    let title: String
    let bookings: [Booking]

    var id: String { title }
}

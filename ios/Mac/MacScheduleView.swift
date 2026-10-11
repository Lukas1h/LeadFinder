import SwiftUI

/// Schedule: reminders and listing follow-ups, grouped by day, exactly as the
/// phone groups them — today first with anything overdue under "Earlier", then
/// everything else by day. Grouping and the day rules are the shared
/// `ScheduleView`'s, so "is there anything today?" can't disagree between the
/// two apps.
struct MacScheduleView: View {
    @Environment(AppState.self) private var appState
    @Binding var selection: ScheduleResponse.Item?

    @State private var reminderSheet: ScheduleResponse.Item?
    @State private var newReminder = false

    var body: some View {
        Group {
            if appState.schedule.value != nil {
                list
            } else if appState.schedule.error != nil {
                errorState
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    newReminder = true
                } label: {
                    Label("Add Reminder", systemImage: "plus")
                }
                .help("Add a reminder")
            }
        }
        .sheet(isPresented: $newReminder) {
            ReminderSheet(existing: nil) {
                Task { await appState.schedule.load(force: true) }
            }
        }
        .sheet(item: $reminderSheet) { item in
            ReminderSheet(existing: item) {
                Task { await appState.schedule.load(force: true) }
            }
        }
        .task { await appState.schedule.load() }
    }

    private var items: [ScheduleResponse.Item] {
        appState.schedule.value?.items ?? []
    }

    private var today: [ScheduleResponse.Item] {
        items.filter { DateFormatting.isToday($0.date) }
    }

    /// Past-due and unfinished: without this group an overdue reminder would
    /// silently disappear the moment its day rolls over.
    private var earlier: [ScheduleResponse.Item] {
        items.filter { DateFormatting.isPastDay($0.date) && !$0.done }
    }

    private var upcoming: [ScheduleResponse.Item] {
        items.filter { !DateFormatting.isPastDay($0.date) && !DateFormatting.isToday($0.date) }
    }

    private var list: some View {
        List(selection: $selection) {
            if let weekday = DateFormatting.parseDay(appState.schedule.value?.today) {
                Section("Today · \(DateFormatting.weekday.string(from: weekday))") {
                    rows(today)
                    if today.isEmpty && earlier.isEmpty {
                        Text("Nothing today")
                            .font(.caption)
                            .foregroundStyle(Theme.tertiaryText)
                    }
                }
            }

            if !earlier.isEmpty {
                Section("Earlier") {
                    rows(earlier)
                }
            }

            ForEach(groupedUpcoming, id: \.day) { group in
                Section(DateFormatting.relativeDay(group.day)) {
                    rows(group.items)
                }
            }
        }
        .listStyle(.inset)
        .contextMenu(forSelectionType: ScheduleResponse.Item.self) { items in
            if let item = items.first {
                Button("Edit…", systemImage: "pencil") { reminderSheet = item }
            }
        } primaryAction: { items in
            selection = items.first
        }
    }

    /// The next ~30 days, each day's items under that day's heading.
    private var groupedUpcoming: [(day: String, items: [ScheduleResponse.Item])] {
        Dictionary(grouping: upcoming, by: \.date)
            .sorted { $0.key < $1.key }
            .prefix(30)
            .map { (day: $0.key, items: $0.value) }
    }

    @ViewBuilder
    private func rows(_ items: [ScheduleResponse.Item]) -> some View {
        ForEach(items) { item in
            MacScheduleRow(item: item) { done(item) }
        }
    }

    /// Ticking an off is its own request, and the row stays put until it lands.
    private func done(_ item: ScheduleResponse.Item) {
        guard let reminderId = item.reminderId else { return }
        Task {
            try? await APIClient.shared.setReminderDone(id: reminderId, done: !item.done)
            await appState.schedule.load(force: true)
        }
    }

    private var errorState: some View {
        VStack(spacing: 14) {
            EmptyStateView(icon: "wifi.exclamationmark", title: "Couldn't load the schedule", message: appState.schedule.error)
            Button("Try again") {
                Task { await appState.schedule.load(force: true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// One reminder: the circle to tick it off, the title, and when.
private struct MacScheduleRow: View {
    let item: ScheduleResponse.Item
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onToggle) {
                Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(item.done ? Theme.positive : Theme.tertiaryText)
            }
            .buttonStyle(.plain)
            .disabled(item.reminderId == nil)
            .help(item.done ? "Mark as not done" : "Mark as done")

            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .font(.body)
                    .foregroundStyle(item.done ? Theme.tertiaryText : Theme.primaryText)
                    .strikethrough(item.done)
                    .lineLimit(1)
                if let subtitle = item.subtitle?.nilIfBlank {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)

            if let time = item.time?.nilIfBlank {
                Text(time)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Theme.secondaryText)
            }
            if let code = item.bookingId {
                BadgeChip(text: "Job", tint: Theme.sky)
                .accessibilityIdentifier("job-\(code)")
            }
        }
        .padding(.vertical, 2)
    }
}

/// Bookings: the three buckets from the web's Booked page, in its order, with
/// empty ones dropped — the same rule `BookingsView.sections(from:)` applies on
/// the phone, so both apps bucket a job identically.
struct MacBookingsView: View {
    @Environment(AppState.self) private var appState
    @Binding var selection: Booking?

    @State private var newBooking = false

    var body: some View {
        Group {
            if let bookings = appState.bookings.value {
                list(bookings)
            } else if appState.bookings.error != nil {
                loadFailure
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    newBooking = true
                } label: {
                    Label("Add Booking", systemImage: "plus")
                }
                .help("Add a booking")
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
        .task { await appState.bookings.load() }
    }

    private func list(_ response: BookingsResponse) -> some View {
        List(selection: $selection) {
            ForEach(BookingsView.sections(from: response)) { section in
                Section(section.title) {
                    ForEach(section.bookings) { booking in
                        MacBookingRow(booking: booking)
                    }
                }
            }
        }
        .listStyle(.inset)
    }

    private var loadFailure: some View {
        VStack(spacing: 14) {
            EmptyStateView(icon: "wifi.exclamationmark", title: "Couldn't load bookings", message: appState.bookings.error)
            Button("Try again") {
                Task { await appState.bookings.load(force: true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// One job: when, where, who for, what it pays and the lockbox code.
private struct MacBookingRow: View {
    let booking: Booking

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(booking.addressLine.isEmpty ? "No address on file" : booking.addressLine)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(BookingFormat.jobLine(booking))
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                    if let contact = booking.contactName?.nilIfBlank {
                        Text("·")
                            .foregroundStyle(Theme.tertiaryText)
                        Text(contact)
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                    }
                }
            }

            Spacer(minLength: 0)

            if let code = booking.lockboxCode?.nilIfBlank {
                BadgeChip(text: code, tint: Theme.warning, filled: true)
                    .help("Lockbox code")
            }
            Text(BookingFormat.price(booking.total))
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(Theme.secondaryText)
            BookingStatusBadge(booking: booking)
        }
        .padding(.vertical, 2)
    }
}

/// The detail pane for a job: the shared `BookingDetailView`, told it is in a
/// column so it drops its `NavigationStack` and Done button. Everything else —
/// the status actions, the line items, the links, Edit — is the phone's.
struct MacBookingDetailHost: View {
    @Binding var selection: Booking?

    var body: some View {
        if let booking = selection {
            BookingDetailView(booking: booking, isInDetailColumn: true)
        } else {
            EmptyStateView(
                icon: "list.bullet.rectangle",
                title: "No job selected",
                message: "Pick a job to see its times, costs and invoice."
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
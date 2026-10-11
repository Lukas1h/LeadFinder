import SwiftUI

/// One booking: the job, where, the contact, line items and status, plus the
/// links that open Maps, the dialer or Safari. Edit changes any of it (or
/// deletes the booking).
struct BookingDetailView: View {
    /// What the opener had. Replaced by a fresh copy after an edit.
    private let initial: Booking
    private var booking: Booking { fresh ?? initial }

    /// True when this fills the Mac window's detail column rather than a phone
    /// sheet. The column brings its own navigation, so the screen drops the
    /// `NavigationStack` and the Done button, which only means anything in a
    /// sheet. Everything inside is identical either way.
    var isInDetailColumn = false

    @State private var fresh: Booking?
    @State private var openContact: AgentsResponse.Row?
    @State private var showEdit = false
    @State private var showComplete = false
    @State private var isWorking = false
    @State private var actionError: String?

    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    init(booking: Booking, isInDetailColumn: Bool = false) {
        initial = booking
        self.isInDetailColumn = isInDetailColumn
    }

    var body: some View {
        screen
            .navigationStackIfNeeded(isInDetailColumn)
    }

    private var screen: some View {
        detail
            .navigationTitle("Booking")
            .titleDisplay(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    // Nothing to dismiss in the Mac's detail column.
                    if !isInDetailColumn { Button("Done") { dismiss() } }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Edit") { showEdit = true }
                }
            }
            .sheet(isPresented: $showComplete) {
                CompleteBookingSheet(booking: booking) { Task { await refresh() } }
            }
            .sheet(isPresented: $showEdit) {
                BookingEditSheet(booking: booking) { deleted in
                    Task {
                        await appState.bookings.load(force: true)
                        await appState.schedule.load(force: true)
                        if deleted {
                            dismiss()
                        } else if let updated = try? await APIClient.shared.bookingDetail(booking.id) {
                            fresh = updated
                        }
                    }
                }
            }
    }

    private var detail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                statusActions
                if hasContact { contact }
                if hasLineItems { lineItems }
                if let notes = booking.notes?.nilIfBlank {
                    textCard(title: "Notes", text: notes)
                }
                if let note = booking.invoiceNote?.nilIfBlank {
                    textCard(title: "Invoice note", text: note)
                }
                if !timeRows.isEmpty {
                    rowsCard(title: "Time & costs", rows: timeRows)
                }
                if !statusRows.isEmpty {
                    rowsCard(title: "Status", rows: statusRows)
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .sheet(item: $openContact) { AgentDirectoryDetail(agent: $0) }
    }

    // MARK: - Status actions

    /// Where the job is and the step that comes next, as on the web: upcoming,
    /// then invoice sent (waiting for payment), then completed. Reopen steps
    /// back one.
    private var statusActions: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                sectionTitle("Status")
                Spacer(minLength: 0)
                BookingStatusBadge(booking: booking)
            }

            HStack(spacing: 8) {
                if booking.completedAt == nil {
                    if booking.invoiceSentAt == nil {
                        actionButton("Invoice sent", "paperplane.fill") {
                            await run { try await APIClient.shared.markInvoiceSent(bookingId: booking.id) }
                        }
                    }
                    actionButton("Complete", "checkmark.circle.fill", prominent: true) {
                        showComplete = true
                    }
                }
                if booking.completedAt != nil || booking.invoiceSentAt != nil {
                    actionButton("Reopen", "arrow.uturn.backward") {
                        await run { try await APIClient.shared.reopenBooking(id: booking.id) }
                    }
                }
            }
            .disabled(isWorking)

            if let actionError {
                Text(actionError).font(.caption).foregroundStyle(Theme.danger)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func actionButton(
        _ title: String,
        _ symbol: String,
        prominent: Bool = false,
        action: @escaping () async -> Void
    ) -> some View {
        Button {
            Task { await action() }
        } label: {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(
                    prominent ? Theme.accent : Theme.cardRaised,
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
                .foregroundStyle(prominent ? Theme.background : Theme.primaryText)
        }
        .buttonStyle(.plain)
    }

    private func run(_ work: () async throws -> Void) async {
        isWorking = true
        actionError = nil
        defer { isWorking = false }
        do {
            try await work()
            await refresh()
        } catch {
            actionError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// After a status change: this screen, the bookings list and the schedule.
    private func refresh() async {
        if let updated = try? await APIClient.shared.bookingDetail(booking.id) { fresh = updated }
        await appState.bookings.load(force: true)
        await appState.schedule.load(force: true)
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(booking.addressLine.isEmpty ? "No address on file" : booking.addressLine)
                .font(.title3.weight(.bold))
                .foregroundStyle(Theme.primaryText)

            Label(BookingFormat.jobLine(booking), systemImage: "calendar")
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryText)

            if let drive = booking.driveTime?.nilIfBlank {
                Label(drive, systemImage: "car")
                    .font(.subheadline)
                    .foregroundStyle(Theme.secondaryText)
            }

            if let code = booking.lockboxCode?.nilIfBlank {
                lockboxBanner(code)
            }

            if mapsURL != nil || galleryURL != nil {
                HStack(spacing: 10) {
                    if let mapsURL {
                        linkButton("Directions", icon: "map.fill", url: mapsURL)
                    }
                    if let galleryURL {
                        linkButton("Gallery", icon: "photo.on.rectangle", url: galleryURL)
                    }
                }
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    /// Lukas needs the code on site, so it gets more than a footnote.
    private func lockboxBanner(_ code: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "key.fill")
                .font(.subheadline)
            Text("Lockbox \(code)")
                .font(.headline)
        }
        .foregroundStyle(Theme.warning)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.warning.opacity(0.14), in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.warning.opacity(0.35), lineWidth: 0.5))
    }

    // MARK: - Contact

    private var hasContact: Bool {
        booking.contactName?.nilIfBlank != nil || booking.contactPhone?.nilIfBlank != nil
    }

    private var contact: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle("Contact")
            if let name = booking.contactName?.nilIfBlank {
                if let agentId = booking.contactAgentId {
                    // The contact is an agent: tap through to their screen.
                    Button {
                        openContact = AgentsResponse.Row(
                            id: agentId,
                            name: name,
                            phone: booking.contactPhone,
                            email: nil,
                            relationshipStatus: nil,
                            lastContactedAt: nil
                        )
                    } label: {
                        AgentRow(name: name, showsChevron: true)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(name)
                        .font(.headline)
                        .foregroundStyle(Theme.primaryText)
                }
            }
            if let phone = booking.contactPhone?.nilIfBlank {
                if let telURL {
                    Link(destination: telURL) {
                        Label(phone, systemImage: "phone.fill")
                            .font(.subheadline)
                            .foregroundStyle(Theme.accent)
                    }
                } else {
                    Text(phone)
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var telURL: URL? {
        guard let phone = booking.contactPhone?.nilIfBlank else { return nil }
        let cleaned = phone.filter { $0.isNumber || $0 == "+" }
        return cleaned.isEmpty ? nil : URL(string: "tel://\(cleaned)")
    }

    // MARK: - Line items

    private var hasLineItems: Bool {
        !booking.lineItems.isEmpty || booking.total != 0
    }

    private var lineItems: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Line items")
            ForEach(booking.lineItems.indices, id: \.self) { index in
                let item = booking.lineItems[index]
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(item.description)
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                    Spacer(minLength: 12)
                    Text(BookingFormat.price(item.amount))
                        .font(.subheadline)
                        .foregroundStyle(Theme.primaryText)
                }
            }
            if !booking.lineItems.isEmpty {
                Rectangle()
                    .fill(Theme.hairline)
                    .frame(height: 1)
            }
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("Total")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)
                Spacer(minLength: 12)
                Text(BookingFormat.price(booking.total))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    // MARK: - Cards

    private func textCard(title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle(title)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryText)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func rowsCard(title: String, rows: [DetailRow]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle(title)
            ForEach(rows) { row in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(row.label)
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                    Spacer(minLength: 12)
                    Text(row.value)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.primaryText)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.caption2.weight(.bold))
            .foregroundStyle(Theme.tertiaryText)
            .kerning(0.6)
    }

    // MARK: - Recorded hours and status flags

    private var timeRows: [DetailRow] {
        var rows: [DetailRow] = []
        if let hours = booking.driveHours {
            rows.append(DetailRow(label: "Drive time", value: Self.hours(hours)))
        }
        if let hours = booking.editingHours {
            rows.append(DetailRow(label: "Editing", value: Self.hours(hours)))
        }
        if let hours = booking.shootingHours {
            rows.append(DetailRow(label: "Shooting", value: Self.hours(hours)))
        }
        if let hours = booking.logisticsHours {
            rows.append(DetailRow(label: "Logistics", value: Self.hours(hours)))
        }
        if let costs = booking.additionalCosts {
            rows.append(DetailRow(label: "Additional costs", value: BookingFormat.price(costs)))
        }
        return rows
    }

    private var statusRows: [DetailRow] {
        var rows: [DetailRow] = []
        if let value = stamp(booking.completedAt) {
            rows.append(DetailRow(label: "Completed", value: value))
        }
        if let value = stamp(booking.invoiceSentAt) {
            rows.append(DetailRow(label: "Invoice sent", value: value))
        }
        if let number = booking.invoiceNumber {
            rows.append(DetailRow(label: "Invoice #", value: "\(number)"))
        }
        if let value = stamp(booking.invoicedAt) {
            rows.append(DetailRow(label: "Invoiced", value: value))
        }
        return rows
    }

    private func stamp(_ iso: String?) -> String? {
        guard let raw = iso?.nilIfBlank else { return nil }
        guard let date = DateFormatting.parse(raw) else { return raw }
        return DateFormatting.dayTime.string(from: date)
    }

    private static func hours(_ value: Double) -> String {
        "\(value.formatted(.number.precision(.fractionLength(0...1)))) h"
    }

    // MARK: - Links

    private func linkButton(_ title: String, icon: String, url: URL) -> some View {
        Link(destination: url) {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Theme.accent.opacity(0.18), in: Capsule())
                .foregroundStyle(Theme.accent)
        }
    }

    /// `mapsQuery` is already "address, city, state" — Apple Maps geocodes it.
    private var mapsURL: URL? {
        guard let query = booking.mapsQuery?.nilIfBlank else { return nil }
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&+=")
        guard let encoded = query.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return URL(string: "http://maps.apple.com/?q=" + encoded)
    }

    private var galleryURL: URL? {
        guard let raw = booking.galleryUrl?.nilIfBlank else { return nil }
        return URL(string: raw)
    }
}

// MARK: -

private struct DetailRow: Identifiable {
    let label: String
    let value: String

    var id: String { label }
}

/// Formatting shared by the schedule list and this screen, so a booking's
/// total and job time read the same in both places.
enum BookingFormat {
    /// Whole dollars with grouping, like the web's formatPrice.
    static func price(_ amount: Int) -> String {
        let digits = abs(amount).formatted(.number.grouping(.automatic))
        return amount < 0 ? "-$\(digits)" : "$\(digits)"
    }

    /// "Wed 15 Oct · 2:00 PM", or "No job date set".
    static func jobLine(_ booking: Booking) -> String {
        guard let date = DateFormatting.parse(booking.jobDate) else { return "No job date set" }
        return DateFormatting.dayTime.string(from: date)
    }
}

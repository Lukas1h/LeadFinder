import SwiftUI

/// Read-only booking detail: everything the Phase 2 payload carries, plus the
/// links that only open Maps, the dialer, or Safari. No action buttons — mark
/// invoice sent / complete / reopen are Phase 3.
struct BookingDetailView: View {
    let booking: Booking

    @State private var openContact: AgentsResponse.Row?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
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
        .navigationTitle("Booking")
        .navigationBarTitleDisplayMode(.inline)
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

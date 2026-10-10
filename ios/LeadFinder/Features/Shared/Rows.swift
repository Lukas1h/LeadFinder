import SwiftUI

// The three compact reference rows, mirroring `src/app/AgentRow.tsx`,
// `src/app/ListingRow.tsx` and `src/app/booked/BookingRow.tsx`. The web reuses
// them wherever one thing references another (an agent inside a listing, a
// listing inside a booking), so they share one look — the same reason these
// exist as separate views here: one 48pt icon-or-thumb, a title line, a
// subtitle line, and a right-aligned badge.

/// The small ">" on a row that opens something when tapped.
struct RowChevron: View {
    var body: some View {
        Image(systemName: "chevron.right")
            .font(.caption2.weight(.bold))
            .foregroundStyle(Theme.tertiaryText)
    }
}

/// A compact listing reference: thumb, address, "price · listed", status badge.
struct ListingRow: View {
    let listing: Listing
    var showsChevron = false

    var body: some View {
        HStack(spacing: 12) {
            thumb
            VStack(alignment: .leading, spacing: 1) {
                Text(listing.addressLine.nilIfBlank ?? "Unknown address")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if let status = listing.status { ListingStatusBadge(status: status) }
            if showsChevron { RowChevron() }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        let price = listing.priceLine
        guard let listed = DateFormatting.parse(listing.listedAt) else { return price }
        return "\(price) · Listed \(DateFormatting.monthDay.string(from: listed))"
    }

    private var thumb: some View {
        Group {
            if let urlString = listing.photos?.first {
                RemoteImage(photo: urlString, size: .card)
            } else {
                ZStack {
                    Theme.cardRaised
                    Text("No photo")
                        .font(.system(size: 9))
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
        }
        .frame(width: 48, height: 48)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

/// A compact agent reference: person icon, name, optional subtitle, phone,
/// relationship badge. Renders as plain text with no icon affordance when
/// there is no phone to offer, matching the web's AgentRow.
struct AgentRow: View {
    var name: String?
    var phone: String?
    var subtitle: String?
    var relationshipStatus: String?
    var showsChevron = false

    var body: some View {
        HStack(spacing: 12) {
            icon
            VStack(alignment: .leading, spacing: 1) {
                Text(name?.nilIfBlank ?? "Unknown agent")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                }
                if let phone {
                    Text(phone)
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if let relationshipStatus {
                BadgeChip(text: relationshipStatus.relationshipLabel, tint: relationshipStatus.relationshipTint)
            }
            if showsChevron { RowChevron() }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    private var icon: some View {
        ZStack {
            Theme.cardRaised
            Image(systemName: "person.fill")
                .font(.callout)
                .foregroundStyle(Theme.tertiaryText)
        }
        .frame(width: 48, height: 48)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

/// A compact booking reference: calendar icon, job date, "total · contact".
struct BookingRow: View {
    let booking: Booking
    var showsChevron = false

    var body: some View {
        HStack(spacing: 12) {
            icon
            VStack(alignment: .leading, spacing: 1) {
                Text(DateFormatting.parseDay(booking.jobDate)
                    .map { DateFormatting.dayTime.string(from: $0) } ?? "No job date set")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            BookingStatusBadge(booking: booking)
            if showsChevron { RowChevron() }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        [booking.total > 0 ? booking.total.currencyString : nil, booking.contactName]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    private var icon: some View {
        ZStack {
            Theme.cardRaised
            Image(systemName: "calendar")
                .font(.callout)
                .foregroundStyle(Theme.tertiaryText)
        }
        .frame(width: 48, height: 48)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

/// The web's StatusBadge palette (STATUS_STYLES in badges.tsx).
struct ListingStatusBadge: View {
    let status: String

    var body: some View {
        BadgeChip(text: label, tint: tint)
    }

    private var label: String {
        status.split(separator: "_").map { $0.capitalized }.joined(separator: " ")
    }

    private var tint: Color {
        switch status {
        case "new": Theme.emerald
        case "saved": Theme.sky
        case "replied": Theme.violet
        case "quoted": Color.indigo.opacity(0.9)
        case "booked": Theme.emerald
        // Both dead ends read muted but stay distinct: "declined" is an answer
        // from the agent and worth spotting, "passed" is Lukas's own housekeeping.
        case "declined": Theme.amber
        default: Theme.secondaryText
        }
    }
}

/// The booking's state, from BookingStatusBadge on the web: completed once
/// done, awaiting payment once the invoice is out but unpaid.
struct BookingStatusBadge: View {
    let booking: Booking

    var body: some View {
        if booking.completedAt != nil {
            BadgeChip(text: "Completed", tint: Theme.emerald)
        } else if booking.invoiceSentAt != nil {
            BadgeChip(text: "Awaiting payment", tint: Theme.amber)
        } else {
            BadgeChip(text: "Upcoming", tint: Theme.sky)
        }
    }
}

extension Int {
    var currencyString: String {
        formatted(.currency(code: "USD").grouping(.automatic))
    }
}

extension AgentsResponse.Row {
    /// The directory row for an agent we only have the card-sized copy of. The
    /// sheet fills in the rest (email, history, listings) when it loads.
    init(agent: Agent, brokerage: String? = nil) {
        self.init(
            id: agent.id,
            name: agent.name,
            phone: agent.phone,
            email: agent.email,
            relationshipStatus: agent.relationshipStatus,
            lastContactedAt: agent.lastContactedAt,
            brokerage: brokerage,
            callerNumber: nil,
            callerLabel: nil
        )
    }
}

/// An agent reference that opens the agent's sheet when tapped. Every place
/// that names an agent uses this, so they all behave the same. With no agent
/// record behind it (a listing whose agent was never matched) it is plain text.
struct TappableAgentRow: View {
    var agent: Agent?
    var name: String?
    var subtitle: String?
    var brokerage: String?
    /// The web hides the badge on cold agents on lead cards: it's the baseline
    /// and nearly every lead, so it would be noise there.
    var hidesCold = false

    @State private var open: AgentsResponse.Row?

    var body: some View {
        if let agent, !agent.id.isEmpty {
            Button {
                open = AgentsResponse.Row(agent: agent, brokerage: brokerage)
            } label: {
                row(showsChevron: true)
            }
            .buttonStyle(.plain)
            .sheet(item: $open) { AgentDirectoryDetail(agent: $0) }
        } else {
            row(showsChevron: false)
        }
    }

    private func row(showsChevron: Bool) -> some View {
        AgentRow(
            name: name ?? agent?.displayName,
            subtitle: subtitle,
            relationshipStatus: agent?.relationshipStatus.flatMap { hidesCold && $0 == "cold" ? nil : $0 },
            showsChevron: showsChevron
        )
    }
}

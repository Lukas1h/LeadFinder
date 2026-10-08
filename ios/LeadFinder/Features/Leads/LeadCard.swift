import SwiftUI

/// One agent on the Leads page, mirroring `src/app/AgentLeadCard.tsx`.
///
/// Outreach is about the person, not the property — most texts offer Lukas as
/// a backup photographer — so the agent leads the card and their best open
/// listing sits under them as the reason to text. The photo strip is the
/// web's five-photo sample, swipeable.
struct LeadCard: View {
    let group: LeadsResponse.Group
    var onShowListing: (() -> Void)?

    @State private var showOthers = false

    private var agent: LeadsResponse.Group { group }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            photosAndFacts
            if let notes = group.best.notes?.nilIfBlank { notesLine(notes) }
            if !group.others.isEmpty { othersDisclosure }
        }
        .card(padding: 14)
    }

    // MARK: - Agent

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(group.agentName ?? group.best.agentName ?? "No agent listed")
                        .font(.headline)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(1)
                    // The web hides the badge on cold agents: it's the neutral
                    // baseline and almost every lead, so it would be noise.
                    if let status = group.agent?.relationshipStatus, status != "cold" {
                        BadgeChip(text: status.relationshipLabel, tint: status.relationshipTint)
                    }
                }
                // Contact first, as on the web: brokerage names truncate.
                Text([group.contactLine, group.brokerName]
                    .compactMap { $0 }
                    .joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if totalListings > 1 {
                Text("\(totalListings) listings")
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
            }
        }
    }

    // MARK: - Photos and facts

    private var photosAndFacts: some View {
        HStack(alignment: .top, spacing: 12) {
            PhotoCarousel(
                photos: PhotoSampling.card(group.best.photos ?? []),
                alt: group.best.address ?? "Listing photo",
                onTap: onShowListing
            )
            .frame(width: 140)
            .frame(maxHeight: 132)

            VStack(alignment: .leading, spacing: 5) {
                Text(group.best.address?.nilIfBlank ?? "Unknown address")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                if !group.badges.isEmpty {
                    FlowRow(spacing: 5) {
                        ForEach(group.badges, id: \.kind) { badge in
                            BadgeChip(text: badge.label, tint: badge.badgeTint(photoScore: group.best.score))
                        }
                    }
                }

                Text(group.best.priceLine)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)

                Text([group.best.city, group.best.state]
                    .compactMap { $0?.nilIfBlank }
                    .joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)

                Text(specs)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)

                if let listed = DateFormatting.parse(group.best.listedAt) {
                    Text("Listed \(DateFormatting.monthDay.string(from: listed))")
                        .font(.caption2)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private var specs: String {
        let beds = group.best.bedrooms.map { Int($0) == 0 ? "— bd" : "\(Int($0)) bd" } ?? "— bd"
        let baths = group.best.bathrooms.map { "\($0.formatted(.number.precision(.fractionLength(0...1)))) ba" } ?? "— ba"
        return "\(beds) / \(baths)"
    }

    private func notesLine(_ notes: String) -> some View {
        HStack(alignment: .top, spacing: 4) {
            Image(systemName: "note.text")
                .font(.caption2)
                .foregroundStyle(Theme.tertiaryText)
                .padding(.top, 1)
            Text(notes)
                .font(.caption)
                .foregroundStyle(Theme.tertiaryText)
                .lineLimit(1)
        }
    }

    // MARK: - Other listings

    private var othersDisclosure: some View {
        VStack(alignment: .leading, spacing: 2) {
            Divider().overlay(Theme.hairline)
            Button {
                withAnimation(.snappy(duration: 0.22)) { showOthers.toggle() }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Theme.tertiaryText)
                        .rotationEffect(.degrees(showOthers ? 90 : 0))
                    Text("\(group.others.count) more listing\(group.others.count == 1 ? "" : "s")")
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
                .padding(.vertical, 6)
            }
            .buttonStyle(.plain)

            if showOthers {
                ForEach(group.others) { listing in
                    ListingRow(listing: listing)
                }
            }
        }
    }

    private var totalListings: Int { group.others.count + 1 }
}

/// Wraps badge chips to the next line instead of truncating, the way the web's
/// `flex-wrap` does. A `Layout` rather than nested stacks so badges flow
/// without the row needing to know how many there are.
struct FlowRow: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 5

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
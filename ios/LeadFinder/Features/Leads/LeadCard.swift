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
    /// Debug only: opens the contact sheet as soon as this card appears, so the
    /// sheet can be screenshotted without tapping through to it.
    var openContactOnAppear: Bool = false

    @State private var showOthers = false
    @State private var showContact = false
    @State private var openListing: Listing?
    @State private var working: Action?

    private enum Action: String { case pass }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            photosAndFacts
            if let notes = group.best.notes?.nilIfBlank { notesLine(notes) }
            actions
            if !group.others.isEmpty { othersDisclosure }
        }
        .card(padding: 14)
        // So tapping Contact opens on the message, not a spinner.
        .onAppear { MessageOptionsCache.shared.prefetch(listingId: group.best.id, type: "initial_outreach") }
        .task {
            #if DEBUG
            if openContactOnAppear { showContact = true }
            #endif
        }
        .sheet(item: $openListing) { LeadListingSheet(listing: $0, agent: group.agent) }
        .sheet(isPresented: $showContact) {
            ContactSheet(
                listingId: group.best.id,
                type: "initial_outreach",
                agentName: group.agentName ?? group.best.agentName,
                agentPhone: group.agentPhone ?? group.best.agentPhone,
                agentSubtitle: group.best.addressLine.nilIfBlank,
                agent: group.agent
            )
        }
    }

    /// The web's LeadActions: contact, save, pass. Pass covers every listing in
    /// the agent's group, because that's what the card is about.
    private var actions: some View {
        HStack(spacing: 8) {
            Button {
                showContact = true
            } label: {
                Label("Contact \(firstName)", systemImage: "message")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .foregroundStyle(Theme.background)
            }
            .buttonStyle(.plain)
            .disabled(working != nil)

            Button {
                Task { await run(.pass) }
            } label: {
                actionIcon("xmark", tint: Theme.tertiaryText)
            }
            .buttonStyle(.plain)
            .disabled(working != nil)
        }
    }

    private func actionIcon(_ symbol: String, tint: Color) -> some View {
        Image(systemName: symbol)
            .font(.callout)
            .foregroundStyle(tint)
            .frame(width: 38, height: 36)
            .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay {
                if working != nil {
                    ProgressView().controlSize(.mini)
                }
            }
    }

    private var firstName: String {
        let name = group.agentName ?? group.best.agentName ?? ""
        return name.split(separator: " ").first.map(String.init) ?? "agent"
    }

    private func run(_ action: Action) async {
        working = action
        defer { working = nil }

        do {
            switch action {
            case .pass:
                // The whole group, as the web's "Pass all N" does: the card is
                // about this agent, not one of their listings.
                try await APIClient.shared.setListingStatus(listingIds: group.listingIds, status: "passed")
            }
            await refresh()
        } catch {
            // Leave the card in place: a failed action shouldn't look like it
            // worked. The error surfaces on the next pull-to-refresh.
        }
    }

    private func refresh() async {
        NotificationCenter.default.post(name: .leadsDidChange, object: nil)
    }

    // MARK: - Agent

    private var header: some View {
        TappableAgentRow(
            agent: group.agent,
            name: group.agentName ?? group.best.agentName,
            // Contact first, as on the web: brokerage names truncate. Only
            // what has actually happened — no "Never texted" on every card.
            subtitle: [group.contactSummary, group.brokerName]
                .compactMap { $0 }
                .joined(separator: " · ")
                .nilIfBlank,
            brokerage: group.brokerName,
            hidesCold: true
        )
        .padding(.vertical, -6)
    }

    // MARK: - Photos and facts

    /// Photo across the top, facts underneath. Side by side left the image too
    /// small to judge a property from, which is the whole reason the card is
    /// here — you swipe the photos to decide whether it's worth a text.
    private var photosAndFacts: some View {
        VStack(alignment: .leading, spacing: 10) {
            PhotoCarousel(
                photos: PhotoSampling.card(group.best.photos ?? []),
                alt: group.best.address ?? "Listing photo",
                // The web's card photo box is a little taller than 3:2.
                aspectRatio: 1.5,
                size: .card,
                onTap: onShowListing
            )

            // City in a quieter colour, so the street still reads first.
            (Text(group.best.address?.nilIfBlank ?? "Unknown address")
                .foregroundStyle(Theme.primaryText)
                + Text(group.best.city?.nilIfBlank.map { ", \($0)" } ?? "")
                .foregroundStyle(Theme.secondaryText))
                .font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)

            if !group.cardBadges.isEmpty {
                FlowRow(spacing: 5) {
                    ForEach(group.cardBadges, id: \.kind) { badge in
                        BadgeChip(text: badge.label, tint: badge.badgeTint(photoScore: group.best.score))
                    }
                }
            }

            HStack(spacing: 8) {
                Text(group.best.priceLine)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)
                Text(specs)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                Spacer(minLength: 0)
                if let listed = DateFormatting.parse(group.best.listedAt) {
                    Text(DateFormatting.monthDay.string(from: listed))
                        .font(.caption2)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
        }
    }

    private var specs: String {
        let beds = group.best.bedrooms.map { Int($0) == 0 ? "— bd" : "\(Int($0)) bd" } ?? "— bd"
        let baths = group.best.bathrooms.map { "\($0.formatted(.number.precision(.fractionLength(0...1)))) ba" } ?? "— ba"
        // "~1h 30m drive" from home, when the server knows the city.
        return ["\(beds) / \(baths)", group.best.driveTime?.nilIfBlank].compactMap { $0 }.joined(separator: " · ")
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
                    Button { openListing = listing } label: { ListingRow(listing: listing, showsChevron: true) }
                        .buttonStyle(.plain)
                }
            }
        }
    }

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
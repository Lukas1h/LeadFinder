import SwiftUI

/// Tap-through for a lead: every photo, the price, the agent, and what Lukas
/// has already done with them. Read-only in Phase 2; texting and Pass come later.
///
/// Layout follows the web's ListingModal: the photos first, then the listing
/// facts, then the agent, then the agent's other listings as ListingRows.
struct LeadDetailView: View {
    let group: LeadsResponse.Group

    /// The lead card only carries a five-photo sample of the best listing, so
    /// the full set is fetched here — the same `/listings/:id` the web's listing
    /// modal shows. Falls back to the card's copy until it lands, and keeps it
    /// if the fetch fails.
    @State private var detail: ListingDetailResponse?

    /// The best listing, with every photo once `/listings/:id` has answered.
    private var listing: Listing { detail?.listing ?? group.best }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                photos
                listingFacts
                if !group.badges.isEmpty { badgeReasons }
                agentBlock
                if !group.others.isEmpty { otherListings }
            }
            .padding(.vertical, 12)
        }
        .background(Theme.background)
        .navigationTitle(group.best.address?.nilIfBlank ?? "Lead")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            detail = try? await APIClient.shared.listingDetail(group.best.id)
        }
    }

    // MARK: - Photos

    /// Every photo, not the five-photo card sample: this is where the full set
    /// lives. The web's modal uses alwaysShowControls because a modal is a
    /// full-size context, and the same is true here.
    private var photos: some View {
        Group {
            if let urls = listing.photos, !urls.isEmpty {
                PhotoCarousel(
                    photos: urls,
                    alt: listing.address ?? "Listing photos",
                    alwaysShowControls: true
                )
                .frame(height: 240)
                if let total = listing.photoCount, total > urls.count {
                    Text("Showing \(urls.count) of \(total) photos")
                        .font(.caption2)
                        .foregroundStyle(Theme.tertiaryText)
                        .padding(.horizontal, 16)
                }
            }
        }
    }

    // MARK: - Listing

    private var listingFacts: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(group.best.priceLine)
                .font(.title2.weight(.bold))
                .foregroundStyle(Theme.primaryText)

            Text(group.best.address?.nilIfBlank ?? "Unknown address")
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryText)

            HStack(spacing: 8) {
                if let beds = group.best.bedrooms {
                    chip(Int(beds) == 0 ? "Studio" : "\(Int(beds)) bed")
                }
                if let baths = group.best.bathrooms, baths > 0 {
                    chip("\(baths.formatted(.number.precision(.fractionLength(0...1)))) bath")
                }
                if let area = group.best.livingArea {
                    chip("\(area.formatted(.number.grouping(.automatic))) sqft")
                }
            }

            if let homeType = group.best.homeTypeLabel {
                Text(homeType)
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
            }

            if let urlString = group.best.listingUrl, let url = URL(string: urlString) {
                Link(destination: url) {
                    Label("Open the listing", systemImage: "arrow.up.right.square")
                        .font(.footnote.weight(.medium))
                }
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .card()
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(Theme.secondaryText)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Theme.cardRaised, in: Capsule())
    }

    private var badgeReasons: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Badges")
            FlowRow(spacing: 6) {
                ForEach(group.badges, id: \.kind) { badge in
                    BadgeChip(text: badge.label, tint: badge.badgeTint(photoScore: group.best.score))
                }
            }
            // Why a badge is there matters as much as that it is: the server
            // sends the reasoning (score reason, duplicate address).
            ForEach(group.badges.filter { $0.detail != nil }, id: \.kind) { badge in
                HStack(alignment: .top, spacing: 6) {
                    Text(badge.label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(badge.badgeTint(photoScore: group.best.score))
                    Text(badge.detail ?? "")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .card()
    }

    // MARK: - Agent

    private var agentBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Agent")

            AgentRow(
                name: group.agentName ?? group.best.agentName,
                phone: group.agentPhone ?? group.best.agentPhone,
                subtitle: group.brokerName ?? group.best.brokerName,
                relationshipStatus: group.agent?.relationshipStatus
            )

            if let contact = group.contactLine {
                Label(contact, systemImage: "clock.arrow.circlepath")
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
            }

            let phone = (group.agentPhone ?? group.best.agentPhone)
                .flatMap { $0.nilIfBlank?.filter(\.isNumber) }
            if let phone, !phone.isEmpty {
                Link(destination: URL(string: "tel://\(phone)")!) {
                    Label("Call \(group.agentName ?? group.best.agentName ?? "agent")", systemImage: "phone")
                        .font(.footnote)
                }
            }

            if let email = group.agent?.email?.nilIfBlank {
                Link(destination: URL(string: "mailto:\(email)")!) {
                    Label(email, systemImage: "envelope")
                        .font(.footnote)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .card()
    }

    // MARK: - Other listings

    private var otherListings: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle("Other listings (\(group.others.count))")
            ForEach(group.others) { listing in
                ListingRow(listing: listing)
                if listing.id != group.others.last?.id {
                    Divider().overlay(Theme.hairline)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .card()
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.caption2.weight(.bold))
            .foregroundStyle(Theme.tertiaryText)
            .kerning(0.6)
    }
}
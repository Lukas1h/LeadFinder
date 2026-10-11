import SwiftUI

/// One listing, opened from somewhere that already knows which agent it belongs
/// to. Split out of the lead detail screen so the same listing can be opened
/// from an agent, a booking or a message without dragging the lead's actions
/// along with it.
struct LeadListingSheet: View {
    let listing: Listing
    var agent: Agent?

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    photos
                    // Re-inset the facts so they don't run into the photo's edges.
                    VStack(alignment: .leading, spacing: 16) {
                    facts
                    if let agent {
                        agentRow(agent)
                    }
                    }
                }
                .padding(.bottom, 12)
            }
            .background(Theme.background)
            .navigationTitle(listing.address?.nilIfBlank ?? "Listing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private var photos: some View {
        if let urls = listing.photos, !urls.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                PhotoCarousel(photos: urls, alt: listing.address ?? "Listing photos", alwaysShowControls: true)
            }
        }
    }

    private var facts: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(listing.priceLine)
                .font(.title2.weight(.bold))
                .foregroundStyle(Theme.primaryText)

            Text(listing.addressLine.nilIfBlank ?? "Unknown address")
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryText)

            HStack(spacing: 8) {
                if let beds = listing.bedrooms {
                    chip(Int(beds) == 0 ? "Studio" : "\(Int(beds)) bed")
                }
                if let baths = listing.bathrooms, baths > 0 {
                    chip("\(baths.formatted(.number.precision(.fractionLength(0...1)))) bath")
                }
                if let area = listing.livingArea {
                    chip("\(area.formatted(.number.grouping(.automatic))) sqft")
                }
            }

            if let homeType = listing.homeTypeLabel {
                Text(homeType)
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
            }

            if let notes = listing.notes?.nilIfBlank {
                Text(notes)
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.top, 2)
            }

            if let urlString = listing.listingUrl, let url = URL(string: urlString) {
                Link(destination: url) {
                    Label("Open the listing", systemImage: "arrow.up.right.square")
                        .font(.footnote.weight(.medium))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .padding(.horizontal, 16)
    }

    private func agentRow(_ agent: Agent) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("AGENT")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.tertiaryText)
                .kerning(0.6)
            TappableAgentRow(
                agent: agent,
                subtitle: listing.brokerName,
                brokerage: listing.brokerName
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .padding(.horizontal, 16)
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(Theme.secondaryText)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Theme.cardRaised, in: Capsule())
    }
}
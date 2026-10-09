import SwiftUI

/// The Follow up board. Reached from the Agents tab's header rather than being
/// a tab of its own, so it brings no NavigationStack with it — the one it is
/// pushed onto supplies the bar and the back button.
struct FollowUpView: View {
    @Environment(AppState.self) private var appState
    @State private var query = ""
    @State private var openAgent: Agent?

    var body: some View {
        Group {
            if let response = appState.followUp.value {
                content(response)
            } else if appState.followUp.error != nil {
                errorState
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .navigationTitle("Follow up")
        // The same agent sheet the directory opens, so an agent looks and
        // behaves the same wherever you tap them.
        .sheet(item: $openAgent) { agent in
            AgentDirectoryDetail(agent: AgentsResponse.Row(
                id: agent.id,
                name: agent.name,
                phone: agent.phone,
                email: agent.email,
                relationshipStatus: agent.relationshipStatus,
                lastContactedAt: agent.lastContactedAt
            ))
        }
        .refreshable { await appState.followUp.load(force: true) }
        .task { await appState.followUp.load() }
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Search name, notes, phone"
        )
    }

    // MARK: - Content

    @ViewBuilder
    private func content(_ response: FollowUpResponse) -> some View {
        let justListed = response.justListed.filter { matches($0.agent) }
        let groups = response.groups.compactMap { group -> FollowUpResponse.Group? in
            let entries = group.entries.filter { matches($0.agent) }
            guard !entries.isEmpty else { return nil }
            return FollowUpResponse.Group(label: group.label, entries: entries)
        }

        if justListed.isEmpty && groups.isEmpty {
            emptyState
        } else {
            VStack(alignment: .leading, spacing: 0) {
                ErrorBanner(
                    message: appState.followUp.error,
                    onRetry: { Task { await appState.followUp.load(force: true) } }
                )
                .padding(.horizontal, 16)
                .padding(.top, 8)

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 20) {
                        if !justListed.isEmpty {
                            justListedSection(justListed)
                        }
                        ForEach(groups) { group in
                            groupSection(group)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 28)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollDismissesKeyboard(.immediately)
            }
        }
    }

    @ViewBuilder
    private func justListedSection(_ items: [FollowUpResponse.JustListed]) -> some View {
        sectionHeader("Just listed", count: items.count)
        ForEach(items) { item in
            justListedCard(item)
        }
    }

    @ViewBuilder
    private func groupSection(_ group: FollowUpResponse.Group) -> some View {
        sectionHeader(group.label, count: group.entries.count)
        ForEach(group.entries) { entry in
            Button { openAgent = entry.agent } label: {
                FollowUpAgentRow(agent: entry.agent, lastReplyAt: entry.lastReplyAt)
                    .card()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
        }
    }

    private func sectionHeader(_ title: String, count: Int) -> some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.headline)
                .foregroundStyle(Theme.primaryText)
            BadgeChip(text: "\(count)", tint: Theme.secondaryText)
            Spacer(minLength: 0)
        }
    }

    // MARK: - Just listed card

    @ViewBuilder
    private func justListedCard(_ item: FollowUpResponse.JustListed) -> some View {
        Button { openAgent = item.agent } label: {
            VStack(alignment: .leading, spacing: 0) {
                if let listing = item.listing,
                   let photo = listing.photos?.first {
                    RemoteImage(url: PhotoSize.card.url(photo), size: .card)
                    .frame(height: 168)
                    .frame(maxWidth: .infinity)
                    .clipped()
                }

                VStack(alignment: .leading, spacing: 8) {
                    if let listing = item.listing {
                        Text(listing.priceLine)
                            .font(.title3.weight(.bold))
                            .foregroundStyle(Theme.primaryText)
                        if !listing.addressLine.isEmpty {
                            Text(listing.addressLine)
                                .font(.subheadline)
                                .foregroundStyle(Theme.secondaryText)
                        }
                        if let detail = listingDetail(listing) {
                            Text(detail)
                                .font(.caption)
                                .foregroundStyle(Theme.tertiaryText)
                        }
                    }

                    FollowUpAgentRow(agent: item.agent, lastReplyAt: item.lastReplyAt)
                        .padding(.top, item.listing == nil ? 0 : 4)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
            }
            .card(padding: 0)
        }
        .buttonStyle(.plain)
    }

    private func listingDetail(_ listing: Listing) -> String? {
        var parts: [String] = []
        if let homeType = listing.homeTypeLabel {
            parts.append(homeType)
        }
        if let photoCount = listing.photoCount ?? listing.photos?.count {
            parts.append("\(photoCount) photo\(photoCount == 1 ? "" : "s")")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    // MARK: - Search (view-level filter over already-fetched data)

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespaces)
    }

    private func matches(_ agent: Agent) -> Bool {
        let search = trimmedQuery
        guard !search.isEmpty else { return true }
        if agent.displayName.localizedCaseInsensitiveContains(search) { return true }
        if let notes = agent.notes, notes.localizedCaseInsensitiveContains(search) { return true }
        if let phone = agent.phone {
            if phone.localizedCaseInsensitiveContains(search) { return true }
            let digits = search.filter(\.isNumber)
            if !digits.isEmpty, phone.filter(\.isNumber).contains(digits) { return true }
        }
        return false
    }

    // MARK: - Empty / error

    @ViewBuilder
    private var emptyState: some View {
        if trimmedQuery.isEmpty {
            EmptyStateView(
                icon: "arrow.triangle.2.circlepath",
                title: "Nothing to follow up",
                message: "Agents who replied or listed a new property will show up here."
            )
        } else {
            EmptyStateView(
                icon: "magnifyingglass",
                title: "No matches",
                message: "No follow-ups match \u{201C}\(trimmedQuery)\u{201D}."
            )
        }
    }

    private var errorState: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Theme.tertiaryText)
            Text("Couldn't load follow-ups")
                .font(.headline)
                .foregroundStyle(Theme.secondaryText)
            if let error = appState.followUp.error {
                Text(error)
                    .font(.subheadline)
                    .foregroundStyle(Theme.tertiaryText)
                    .multilineTextAlignment(.center)
            }
            Button {
                Task { await appState.followUp.load(force: true) }
            } label: {
                Text("Try again")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 18)
                    .padding(.vertical, 9)
                    .background(Theme.accent.opacity(0.18), in: Capsule())
                    .foregroundStyle(Theme.accent)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Agent row

/// One agent in a follow-up card: the shared AgentRow, with when you last
/// heard from them and the start of their notes.
private struct FollowUpAgentRow: View {
    let agent: Agent
    var lastReplyAt: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            AgentRow(
                name: agent.displayName,
                phone: agent.phone?.nilIfBlank,
                subtitle: contactLine,
                relationshipStatus: agent.relationshipStatus?.nilIfBlank
            )
            if let notes = agent.notes?.nilIfBlank {
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(2)
                    .padding(.leading, 60)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var contactLine: String? {
        if let relative = DateFormatting.relative(agent.lastContactedAt).nilIfBlank {
            return "Last contact \(relative)"
        }
        if let relative = DateFormatting.relative(lastReplyAt).nilIfBlank {
            return "Last reply \(relative)"
        }
        return nil
    }
}

/// Value pushed from the Agents tab to reach the Follow up board. A wrapper
/// rather than pushing `FollowUpView` directly, so the navigation value type
/// says which screen it is and can't collide with another view's.
struct FollowUpRoute: Hashable {
    init() {}
}

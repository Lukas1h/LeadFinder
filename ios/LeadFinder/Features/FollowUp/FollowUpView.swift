import SwiftUI

/// The Follow up board. Reached from the Agents tab's header rather than being
/// a tab of its own, so it brings no NavigationStack with it — the one it is
/// pushed onto supplies the bar and the back button.
struct FollowUpView: View {
    @Environment(AppState.self) private var appState
    @State private var query = ""

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
        .navigationDestination(for: Agent.self) { FollowUpAgentDetailView(agent: $0) }
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
            NavigationLink(value: entry.agent) {
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
        NavigationLink(value: item.agent) {
            VStack(alignment: .leading, spacing: 0) {
                if let listing = item.listing,
                   let photoURL = listing.photos?.first.flatMap({ URL(string: $0) }) {
                    AsyncImage(url: photoURL) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFill()
                        case .failure:
                            photoPlaceholder
                        case .empty:
                            ZStack {
                                Theme.cardRaised
                                ProgressView()
                            }
                        @unknown default:
                            photoPlaceholder
                        }
                    }
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

    private var photoPlaceholder: some View {
        ZStack {
            Theme.cardRaised
            Image(systemName: "photo")
                .font(.system(size: 22, weight: .light))
                .foregroundStyle(Theme.tertiaryText)
        }
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

/// One agent's block in a follow-up card: name, relationship badge,
/// last-contact line, phone, and the first couple of notes lines.
private struct FollowUpAgentRow: View {
    let agent: Agent
    var lastReplyAt: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(agent.displayName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                if let status = agent.relationshipStatus?.nilIfBlank {
                    BadgeChip(text: status.relationshipLabel, tint: status.relationshipTint)
                }
                Spacer(minLength: 0)
            }
            if let contact = contactLine {
                Text(contact)
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
            }
            if let phone = agent.phone?.nilIfBlank {
                Text(phone)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
            }
            if let notes = agent.notes?.nilIfBlank {
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(2)
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

// MARK: - Agent detail (read-only, built only from the follow-up payload)

private struct FollowUpAgentDetailView: View {
    let agent: Agent

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text(agent.displayName)
                            .font(.title3.weight(.bold))
                            .foregroundStyle(Theme.primaryText)
                        if let status = agent.relationshipStatus?.nilIfBlank {
                            BadgeChip(text: status.relationshipLabel, tint: status.relationshipTint, filled: true)
                        }
                        Spacer(minLength: 0)
                    }
                    if let last = DateFormatting.relative(agent.lastContactedAt).nilIfBlank {
                        Text("Last contact \(last)")
                            .font(.subheadline)
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()

                if telURL != nil || mailURL != nil {
                    VStack(spacing: 10) {
                        if let telURL, let phone = agent.phone?.nilIfBlank {
                            contactLink(url: telURL, icon: "phone.fill", text: phone)
                        }
                        if let mailURL, let email = agent.email?.nilIfBlank {
                            contactLink(url: mailURL, icon: "envelope.fill", text: email)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                }

                if let notes = agent.notes?.nilIfBlank {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("NOTES")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.tertiaryText)
                        Text(notes)
                            .font(.subheadline)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                }
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("Agent")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func contactLink(url: URL, icon: String, text: String) -> some View {
        Link(destination: url) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.subheadline)
                    .foregroundStyle(Theme.accent)
                    .frame(width: 20)
                Text(text)
                    .font(.subheadline)
                    .foregroundStyle(Theme.primaryText)
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.forward")
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
            }
        }
    }

    private var telURL: URL? {
        guard let phone = agent.phone?.nilIfBlank else { return nil }
        let cleaned = phone.filter { $0.isNumber || $0 == "+" }
        return cleaned.isEmpty ? nil : URL(string: "tel://\(cleaned)")
    }

    private var mailURL: URL? {
        guard let email = agent.email?.nilIfBlank,
              let url = URL(string: "mailto://\(email)") else { return nil }
        return url
    }
}

/// Value pushed from the Agents tab to reach the Follow up board. A wrapper
/// rather than pushing `FollowUpView` directly, so the navigation value type
/// says which screen it is and can't collide with another view's.
struct FollowUpRoute: Hashable {
    init() {}
}

import SwiftUI

/// The Follow up board. Reached from the Agents tab's header rather than being
/// a tab of its own, so it brings no NavigationStack with it — the one it is
/// pushed onto supplies the bar and the back button.
struct FollowUpView: View {
    @Environment(AppState.self) private var appState
    @State private var query = ""
    @State private var openAgent: Agent?
    /// Hidden the moment they're snoozed, rather than waiting on the reload.
    @State private var snoozed: Set<String> = []
    @State private var snoozeError: String?

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
            AgentDirectoryDetail(agent: AgentsResponse.Row(agent: agent))
        }
        .alert(
            "Couldn't snooze",
            isPresented: Binding(get: { snoozeError != nil }, set: { if !$0 { snoozeError = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(snoozeError ?? "")
        }
        .refreshable { await appState.followUp.load(force: true) }
        .task { await appState.followUp.load() }
        .searchField(
            text: $query,
            prompt: "Search name, notes, phone"
        )
    }

    // MARK: - Content

    @ViewBuilder
    private func content(_ response: FollowUpResponse) -> some View {
        if let today = response.today, let later = response.later {
            rankedContent(
                today: today.filter { matches($0.agent) },
                later: later.filter { matches($0.agent) },
                done: response.doneToday ?? 0,
                target: response.dailyTarget ?? 5
            )
        } else {
            sectionedContent(response)
        }
    }

    /// Today's few, then everyone else who is due, in the server's order:
    /// strongest reason first. Each card leads with its reason.
    @ViewBuilder
    private func rankedContent(
        today: [FollowUpResponse.JustListed],
        later: [FollowUpResponse.JustListed],
        done: Int,
        target: Int
    ) -> some View {
        if today.isEmpty && later.isEmpty {
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
                        HStack(spacing: 8) {
                            Text("Today")
                                .font(.headline)
                                .foregroundStyle(Theme.primaryText)
                            BadgeChip(text: "\(min(done, target)) of \(target) done", tint: Theme.secondaryText)
                            Spacer(minLength: 0)
                        }
                        if today.isEmpty {
                            Text(done >= target ? "That's today's five. The rest will keep." : "Nobody else is due.")
                                .font(.subheadline)
                                .foregroundStyle(Theme.secondaryText)
                        }
                        ForEach(today) { item in
                            justListedCard(item)
                        }
                        if !later.isEmpty {
                            sectionHeader("Later", count: later.count)
                            ForEach(later) { item in
                                justListedCard(item)
                            }
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

    /// The page as it was before the server ranked it: sections by kind. Only
    /// reached from a response cached before 2026-10-11.
    @ViewBuilder
    private func sectionedContent(_ response: FollowUpResponse) -> some View {
        let news = (response.news ?? []).filter { matches($0.agent) }
        let justListed = response.justListed.filter { matches($0.agent) }
        let groups = response.groups.compactMap { group -> FollowUpResponse.Group? in
            let entries = group.entries.filter { matches($0.agent) }
            guard !entries.isEmpty else { return nil }
            return FollowUpResponse.Group(label: group.label, entries: entries)
        }

        if news.isEmpty && justListed.isEmpty && groups.isEmpty {
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
                        if !news.isEmpty {
                            newsSection(news)
                        }
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

    /// A listing of theirs went under contract or closed: a reason to say congrats.
    @ViewBuilder
    private func newsSection(_ items: [FollowUpResponse.JustListed]) -> some View {
        sectionHeader("Under contract or sold", count: items.count)
        ForEach(items) { item in
            justListedCard(item)
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
            tappable(entry.agent) {
                FollowUpAgentRow(
                    agent: entry.agent,
                    lastReplyAt: entry.lastReplyAt,
                    onSnooze: { Task { await snooze(entry.agent) } }
                )
                .card()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: - Opening and snoozing

    /// Tap opens the agent, long-press offers the snooze. A tap gesture rather
    /// than a Button, so the row's own snooze button keeps its taps.
    private func tappable<Content: View>(_ agent: Agent, @ViewBuilder _ content: () -> Content) -> some View {
        content()
            .contentShape(Rectangle())
            .onTapGesture { openAgent = agent }
            .accessibilityAddTraits(.isButton)
            .contextMenu {
                Button {
                    Task { await snooze(agent) }
                } label: {
                    Label("Snooze 4 weeks", systemImage: "moon.zzz")
                }
            }
    }

    /// "Not now": takes the agent off Follow up for four weeks, whatever put
    /// them there (gone quiet, just listed, under contract), as the web's
    /// snooze does. Nobody is contacted. Put back if the server didn't take it.
    private func snooze(_ agent: Agent) async {
        withAnimation(.snappy(duration: 0.22)) { _ = snoozed.insert(agent.id) }
        do {
            try await APIClient.shared.snoozeFollowUp(agentId: agent.id)
            await appState.followUp.load(force: true)
        } catch {
            snoozed.remove(agent.id)
            snoozeError = "\(agent.displayName) is still on the list. Check your connection and try again."
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
        tappable(item.agent) {
            VStack(alignment: .leading, spacing: 0) {
                if let listing = item.listing,
                   let photo = listing.photos?.first {
                    RemoteImage(photo: photo, size: .card)
                    .frame(height: 168)
                    .frame(maxWidth: .infinity)
                    .clipped()
                }

                VStack(alignment: .leading, spacing: 8) {
                    if let headline = item.headline?.nilIfBlank {
                        // A reason to text is green; "quiet" is only the lack of one.
                        Text(headline)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(item.reason == "quiet" ? Theme.secondaryText : Theme.emerald)
                    }
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

                    FollowUpAgentRow(
                        agent: item.agent,
                        lastReplyAt: item.lastReplyAt,
                        onSnooze: { Task { await snooze(item.agent) } }
                    )
                    .padding(.top, item.listing == nil ? 0 : 4)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
            }
            .card(padding: 0)
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
        if snoozed.contains(agent.id) { return false }
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
    /// "Not now": takes the agent off Follow up for four weeks.
    var onSnooze: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                AgentRow(
                    name: agent.displayName,
                    subtitle: contactLine,
                    relationshipStatus: agent.relationshipStatus?.nilIfBlank
                )
                if let onSnooze {
                    // Sized like the Leads card's pass button.
                    Button(action: onSnooze) {
                        Image(systemName: "moon.zzz")
                            .font(.callout)
                            .foregroundStyle(Theme.tertiaryText)
                            .frame(width: 38, height: 36)
                            .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Snooze \(agent.displayName) for 4 weeks")
                }
            }
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

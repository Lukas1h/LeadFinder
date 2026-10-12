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
    /// The snooze lengths the server takes, in days.
    fileprivate static let snoozeChoices: [(days: Int, label: String)] = [
        (7, "1 week"), (14, "2 weeks"), (28, "4 weeks"),
    ]
    @State private var openListing: Listing?
    @State private var contactError: String?
    /// Set when Call is tapped, so coming back from the call asks how it went,
    /// as the web's card does on its way back from the dialer.
    @State private var callAgent: Agent?
    @State private var callTappedAt: Date?
    @State private var callStarted = false
    @State private var logAgent: Agent?

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
        .sheet(item: $openListing) { LeadListingSheet(listing: $0) }
        .sheet(item: $logAgent) { agent in
            LogInteractionSheet(agentId: agent.id, agentName: agent.displayName, afterCall: true) {
                Task { await appState.followUp.load(force: true) }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Platform.didLeaveForeground)) { _ in
            if let callTappedAt, Date().timeIntervalSince(callTappedAt) < 20 { callStarted = true }
            callTappedAt = nil
        }
        .onReceive(NotificationCenter.default.publisher(for: Platform.didEnterForeground)) { _ in
            guard callStarted else { return }
            callStarted = false
            logAgent = callAgent
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
                upcoming: (response.upcoming ?? []).filter { matches($0.agent) },
                droneOffers: (response.droneOffers ?? []).compactMap { group in
                    var group = group
                    group.items = group.items.filter { matches($0.agent) }
                    return group.items.isEmpty && (group.heldBack ?? 0) == 0 ? nil : group
                },
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
        upcoming: [FollowUpResponse.Upcoming],
        droneOffers: [FollowUpResponse.DroneOfferGroup],
        done: Int,
        target: Int
    ) -> some View {
        if today.isEmpty && later.isEmpty && upcoming.isEmpty && droneOffers.isEmpty {
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
                    LazyVStack(alignment: .leading, spacing: 24) {
                        // The web's header: what the page is and how it picks.
                        Text("Agents you know who have a reason to hear from you, best reason first: a new listing, samples that got no answer, a sale, a price cut, then anyone who\u{2019}s gone quiet. Nobody shows up within 10 days of your last text, and each follow-up that goes unanswered doubles the wait.")
                            .font(.footnote)
                            .foregroundStyle(Theme.secondaryText)

                        if let contactError {
                            Text(contactError)
                                .font(.caption)
                                .foregroundStyle(Theme.danger)
                        }

                        // The free drone shots trial: who to offer them to,
                        // by where he'll be this week.
                        if !droneOffers.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                webHeading("Free drone shots this week")
                                Text("Agents you know near where you\u{2019}re already driving, who haven\u{2019}t had the offer yet. One free shoot each.")
                                    .font(.footnote)
                                    .foregroundStyle(Theme.secondaryText)
                                ForEach(droneOffers) { group in
                                    Text(group.title)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(Theme.primaryText)
                                        .padding(.top, 4)
                                    ForEach(group.items) { followUpCard($0) }
                                    if let held = group.heldBack, held > 0 {
                                        Text("\(group.items.isEmpty ? "\(held)" : "\(held) more") you know here heard from you in the last 10 days.")
                                            .font(.footnote)
                                            .foregroundStyle(Theme.secondaryText)
                                    }
                                }
                            }
                        }

                        VStack(alignment: .leading, spacing: 12) {
                            webHeading("Today (\(min(done, target)) of \(target) done)")
                            Text(
                                today.isEmpty
                                    ? (done >= target ? "That\u{2019}s today\u{2019}s five. The rest will keep." : "Nobody else is due.")
                                    : "The top of the list, \(target) a day. Text one or snooze it and the next moves up."
                            )
                            .font(.subheadline)
                            .foregroundStyle(Theme.secondaryText)
                            ForEach(today) { followUpCard($0) }
                        }

                        if !later.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                webHeading("Later (\(later.count))")
                                ForEach(later) { followUpCard($0) }
                            }
                        }

                        // Everyone not due yet, with the date they will be,
                        // so nobody is ever just missing from the page.
                        if !upcoming.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                webHeading("Coming up (\(upcoming.count))")
                                Text("Not due yet. Interested agents come back 2 weeks after your last contact, warm agents after 3, clients after 4, or sooner if they list or sell something.")
                                    .font(.footnote)
                                    .foregroundStyle(Theme.secondaryText)
                                ForEach(upcoming) { upcomingRow($0) }
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

    /// One line per person who isn't due yet: who, why then, and the date.
    private func upcomingRow(_ item: FollowUpResponse.Upcoming) -> some View {
        Button { openAgent = item.agent } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.agent.displayName)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.primaryText)
                        .multilineTextAlignment(.leading)
                    if let note = item.note?.nilIfBlank {
                        Text(note)
                            .font(.caption)
                            .foregroundStyle(Theme.tertiaryText)
                    }
                }
                Spacer(minLength: 8)
                Text(DateFormatting.parse(item.dueAt).map { DateFormatting.monthDay.string(from: $0) } ?? "When they list or sell")
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The web's section heading: small, bold, uppercase, muted.
    private func webHeading(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.secondaryText)
            .kerning(0.5)
    }

    // MARK: - Agent card (the web's AgentCard)

    /// Everything the web's card shows, in its order: the reason, name and
    /// status, phone and email, the listing count and dates, notes, then
    /// snooze / call / text / email, and under them the text to start from
    /// and the listing the reason is about.
    private func followUpCard(_ item: FollowUpResponse.JustListed) -> some View {
        let agent = item.agent
        let digits = agent.phone?.filter(\.isNumber).nilIfBlank
        let email = agent.email?.nilIfBlank

        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                // The reason leads: it's what the text will be about. A plain
                // "quiet" is the absence of one, so it's muted.
                if let headline = item.headline?.nilIfBlank {
                    Text(headline)
                        .font(.subheadline.weight(item.reason == "quiet" ? .regular : .medium))
                        .foregroundStyle(item.reason == "quiet" ? Theme.secondaryText : Theme.emerald)
                }
                HStack(spacing: 8) {
                    Button { openAgent = agent } label: {
                        Text(agent.displayName)
                            .font(.headline)
                            .foregroundStyle(Theme.primaryText)
                            .multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.plain)
                    if let status = agent.relationshipStatus?.nilIfBlank {
                        BadgeChip(text: status.relationshipLabel, tint: status.relationshipTint)
                    }
                    Spacer(minLength: 0)
                }

                if let phone = agent.phone?.nilIfBlank {
                    Text(phone)
                        .font(.caption.monospaced())
                        .foregroundStyle(Theme.secondaryText)
                }
                if let email {
                    Text(email)
                        .font(.caption.monospaced())
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                let facts = Self.facts(for: item)
                if !facts.isEmpty {
                    Text(facts.joined(separator: "  \u{00B7}  "))
                        .font(.footnote)
                        .foregroundStyle(Theme.secondaryText)
                        .padding(.top, 2)
                }

                if let notes = agent.notes?.nilIfBlank {
                    Label {
                        Text(notes).lineLimit(2)
                    } icon: {
                        Image(systemName: "note.text")
                    }
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.top, 4)
                }
            }

            HStack(spacing: 8) {
                Spacer(minLength: 0)
                // A menu, so the length is picked rather than assumed.
                Menu {
                    Section("Hide for (a new listing still brings them back)") {
                        ForEach(Self.snoozeChoices, id: \.days) { choice in
                            Button(choice.label) { Task { await snooze(agent, days: choice.days) } }
                        }
                    }
                } label: {
                    iconLabel("moon.zzz")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Snooze \(agent.displayName)")
                if let digits {
                    iconButton("phone", label: "Call \(agent.displayName)") {
                        if let url = URL(string: "tel://\(digits)") {
                            callAgent = agent
                            callTappedAt = Date()
                            Platform.open(url)
                        }
                    }
                    iconButton("message", label: "Text \(agent.displayName)") {
                        text(agent, digits: digits, body: item.suggestion ?? "")
                    }
                }
                if let email, let url = URL(string: "mailto:\(email)") {
                    iconButton("envelope", label: "Email \(agent.displayName)") { Platform.open(url) }
                }
            }

            if let suggestion = item.suggestion?.nilIfBlank {
                suggestedText(suggestion, agent: agent, digits: digits)
            }
            if let listing = item.listing {
                Button { openListing = listing } label: { ListingRow(listing: listing, showsChevron: true) }
                    .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
        .contextMenu {
            ForEach(Self.snoozeChoices, id: \.days) { choice in
                Button {
                    Task { await snooze(agent, days: choice.days) }
                } label: {
                    Label("Snooze \(choice.label)", systemImage: "moon.zzz")
                }
            }
        }
    }

    /// A text to start from, written by the server for this reason. Tapping it
    /// opens Messages with it, as the card's Text button does; nothing goes
    /// out until he sends it.
    private func suggestedText(_ suggestion: String, agent: Agent, digits: String?) -> some View {
        Button {
            if let digits { text(agent, digits: digits, body: suggestion) }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text("Suggested text")
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
                Text(suggestion)
                    .font(.subheadline)
                    .foregroundStyle(Theme.primaryText)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(digits == nil)
    }

    private func iconLabel(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.callout)
            .foregroundStyle(Theme.primaryText)
            .frame(width: 40, height: 36)
            .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Theme.border, lineWidth: 0.5))
    }

    private func iconButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { iconLabel(symbol) }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
    }

    /// "12 listings", "Last contacted Sep 2", "Last replied Oct 3",
    /// "~45d between listings" — the web card's stats line.
    private static func facts(for item: FollowUpResponse.JustListed) -> [String] {
        var parts: [String] = []
        if let count = item.listingCount {
            parts.append("\(count) listing\(count == 1 ? "" : "s")")
        }
        if let date = DateFormatting.parse(item.agent.lastContactedAt) {
            parts.append("Last contacted \(DateFormatting.monthDay.string(from: date))")
        }
        if let date = DateFormatting.parse(item.lastReplyAt) {
            parts.append("Last replied \(DateFormatting.monthDay.string(from: date))")
        }
        if let days = item.avgDaysBetweenListings {
            parts.append("~\(days)d between listings")
        }
        return parts
    }

    /// Opens Messages to this agent with the suggested text written, for him
    /// to edit and send. Only a text that went out is recorded.
    private func text(_ agent: Agent, digits: String, body: String) {
        contactError = nil
        MessageComposer.present(recipients: [digits], body: body) { outcome in
            switch outcome {
            case .unavailable:
                contactError = "This device can't send texts right now."
            case .cancelled:
                break
            case .sent:
                Task {
                    do {
                        try await APIClient.shared.confirmAgentTextSent(agentId: agent.id)
                        await appState.followUp.load(force: true)
                    } catch {
                        contactError = "The text went out, but recording it failed: "
                            + ((error as? APIError)?.errorDescription ?? error.localizedDescription)
                    }
                }
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
                    onSnooze: { days in Task { await snooze(entry.agent, days: days) } }
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
                ForEach(Self.snoozeChoices, id: \.days) { choice in
                    Button {
                        Task { await snooze(agent, days: choice.days) }
                    } label: {
                        Label("Snooze \(choice.label)", systemImage: "moon.zzz")
                    }
                }
            }
    }

    /// "Not now": takes the agent off Follow up for the weeks picked, whatever put
    /// them there (gone quiet, just listed, under contract), as the web's
    /// snooze does. Nobody is contacted. Put back if the server didn't take it.
    private func snooze(_ agent: Agent, days: Int) async {
        withAnimation(.snappy(duration: 0.22)) { _ = snoozed.insert(agent.id) }
        do {
            try await APIClient.shared.snoozeFollowUp(agentId: agent.id, days: days)
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
                        onSnooze: { days in Task { await snooze(item.agent, days: days) } }
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
    /// "Not now": takes the agent off Follow up for the number of days picked.
    var onSnooze: ((Int) -> Void)?

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
                    Menu {
                        ForEach(FollowUpView.snoozeChoices, id: \.days) { choice in
                            Button(choice.label) { onSnooze(choice.days) }
                        }
                    } label: {
                        Image(systemName: "moon.zzz")
                            .font(.callout)
                            .foregroundStyle(Theme.tertiaryText)
                            .frame(width: 38, height: 36)
                            .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Snooze \(agent.displayName)")
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

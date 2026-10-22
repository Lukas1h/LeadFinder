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
    /// The feed key a call was started from, sent with the call's log.
    @State private var callFeed: String?
    /// The selected tab: a feed's key, or `comingUp`.
    @State private var tab: String?
    @State private var editor: EditorLink?

    private static let comingUp = "coming_up"

    /// A "photo editor" deep link from a feed card.
    private struct EditorLink: Identifiable {
        let listingId: String?
        let presetId: String?
        var id: String { "\(listingId ?? "")|\(presetId ?? "")" }

        /// "/photo-editor?listing=<id>&preset=<id>", the web's path.
        init(href: String) {
            let items = URLComponents(string: "https://x\(href)")?.queryItems ?? []
            listingId = items.first { $0.name == "listing" }?.value
            presetId = items.first { $0.name == "preset" }?.value
        }
    }

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
        .sheet(item: $editor) { link in
            NavigationStack {
                PhotoEditorView(listingId: link.listingId, initialPresetId: link.presetId)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { editor = nil }
                        }
                    }
            }
        }
        .sheet(item: $logAgent) { agent in
            LogInteractionSheet(agentId: agent.id, agentName: agent.displayName, afterCall: true, followUpFeed: callFeed) {
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
        #if DEBUG
        .task {
            if let key = DebugLaunchArguments.followUpTab, key != "-" { tab = key }
        }
        #endif
        .searchField(
            text: $query,
            prompt: "Search name, notes, phone"
        )
    }

    // MARK: - Content

    @ViewBuilder
    private func content(_ response: FollowUpResponse) -> some View {
        if let feeds = response.feeds {
            feedContent(response, feeds: feeds)
        } else if let today = response.today, let later = response.later {
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

    // MARK: - Feeds (the page since 2026-10-21)

    /// One tab per feed with the day/week counter above, as the web's page.
    /// A feed with nobody in it doesn't get a tab; "Coming up" is last.
    @ViewBuilder
    private func feedContent(_ response: FollowUpResponse, feeds: [FollowUpResponse.Feed]) -> some View {
        let shown: [FollowUpResponse.Feed] = feeds.compactMap { feed in
            var feed = feed
            feed.groups = feed.groups.compactMap { group in
                var group = group
                group.items = group.items.filter { matches($0.agent) }
                return group.items.isEmpty && (trimmedQuery.isEmpty ? (group.heldBack ?? 0) == 0 : true) ? nil : group
            }
            return feed.itemCount > 0 ? feed : nil
        }
        let upcoming = (response.upcoming ?? []).filter { matches($0.agent) }
        let tabs: [(key: String, title: String, count: Int)] =
            shown.map { ($0.key, $0.title, $0.itemCount) }
            + (upcoming.isEmpty ? [] : [(Self.comingUp, "Coming up", upcoming.count)])
        let active = tabs.first { $0.key == tab }?.key ?? tabs.first?.key

        VStack(alignment: .leading, spacing: 0) {
            ErrorBanner(
                message: appState.followUp.error,
                onRetry: { Task { await appState.followUp.load(force: true) } }
            )
            .padding(.horizontal, 16)
            .padding(.top, 8)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if let stats = response.stats {
                        HStack(spacing: 12) {
                            counter("Today", stats.today)
                            counter("This week", stats.week)
                        }
                    }

                    if let contactError {
                        Text(contactError)
                            .font(.caption)
                            .foregroundStyle(Theme.danger)
                    }

                    if tabs.isEmpty {
                        emptyState
                    } else {
                        tabBar(tabs, active: active)
                        if active == Self.comingUp {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Not due yet. Interested agents come back 2 weeks after your last contact, warm agents after 3, clients after 4, or sooner if they list or sell something.")
                                    .font(.footnote)
                                    .foregroundStyle(Theme.secondaryText)
                                ForEach(upcoming) { upcomingRow($0) }
                            }
                        } else if let feed = shown.first(where: { $0.key == active }) {
                            feedBody(feed)
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

    /// Follow-ups done (back in touch after a gap) against the pace, and how
    /// many of those have answered since: the web's Stat.
    private func counter(_ label: String, _ count: FollowUpResponse.Stats.Count) -> some View {
        let met = count.done >= count.target
        return VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.secondaryText)
                .kerning(0.5)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(count.done)")
                    .font(.title2.weight(.semibold).monospacedDigit())
                    .foregroundStyle(met ? Theme.emerald : Theme.primaryText)
                Text("/ \(count.target)")
                    .font(.subheadline)
                    .foregroundStyle(Theme.secondaryText)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.cardRaised)
                    Capsule()
                        .fill(met ? Theme.emerald : Theme.primaryText.opacity(0.8))
                        .frame(width: max(6, proxy.size.width * min(1, Double(count.done) / Double(max(1, count.target)))))
                }
            }
            .frame(height: 6)
            Text("\(count.replied) \(count.replied == 1 ? "reply" : "replies")")
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }

    private func tabBar(_ tabs: [(key: String, title: String, count: Int)], active: String?) -> some View {
        ScrollViewReader { proxy in
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(tabs, id: \.key) { item in
                    let selected = item.key == active
                    Button {
                        withAnimation(.snappy(duration: 0.2)) { tab = item.key }
                    } label: {
                        HStack(spacing: 6) {
                            Text(item.title)
                            Text("\(item.count)")
                                .font(.caption.weight(.semibold).monospacedDigit())
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(selected ? Theme.background.opacity(0.25) : Theme.cardRaised, in: Capsule())
                        }
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(selected ? Theme.accent : Theme.card, in: Capsule())
                        .foregroundStyle(selected ? Theme.background : Theme.primaryText)
                        .overlay(Capsule().strokeBorder(Theme.border, lineWidth: selected ? 0 : 0.5))
                    }
                    .buttonStyle(.plain)
                    .id(item.key)
                }
            }
        }
        .scrollClipDisabled()
        // Keeps the chosen tab on screen, however it was chosen.
        .onChange(of: active) { _, key in
            if let key { withAnimation { proxy.scrollTo(key, anchor: .center) } }
        }
        .task(id: active) {
            if let active { proxy.scrollTo(active, anchor: .center) }
        }
        }
    }

    /// A feed's blurb, then its groups of cards. Every card carries the
    /// feed's key so Text and Call count toward that feed's reply rate.
    private func feedBody(_ feed: FollowUpResponse.Feed) -> some View {
        // The one feed that is "it's been a while" rather than a reason.
        let muted = feed.key == "check_ins"
        return VStack(alignment: .leading, spacing: 12) {
            if let blurb = feed.blurb?.nilIfBlank {
                Text(blurb)
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
            }
            ForEach(feed.groups) { group in
                VStack(alignment: .leading, spacing: 12) {
                    if feed.groups.count > 1 {
                        Text(group.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.primaryText)
                            .padding(.top, 4)
                    }
                    ForEach(group.items) { followUpCard($0, feedKey: feed.key, muted: muted) }
                    if let held = group.heldBack, held > 0 {
                        Text("\(group.items.isEmpty ? "\(held)" : "\(held) more") heard from you too recently to ask.")
                            .font(.footnote)
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
            }
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
    private func followUpCard(_ item: FollowUpResponse.JustListed, feedKey: String? = nil, muted: Bool = false) -> some View {
        let agent = item.agent
        let digits = agent.phone?.filter(\.isNumber).nilIfBlank
        let email = agent.email?.nilIfBlank

        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                // The reason leads: it's what the text will be about. A plain
                // "quiet" is the absence of one, so it's muted.
                if let headline = item.headline?.nilIfBlank {
                    let quiet = muted || item.reason == "quiet"
                    Text(headline)
                        .font(.subheadline.weight(quiet ? .regular : .medium))
                        .foregroundStyle(quiet ? Theme.secondaryText : Theme.emerald)
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
                            callFeed = feedKey
                            callTappedAt = Date()
                            Platform.open(url)
                        }
                    }
                    iconButton("message", label: "Text \(agent.displayName)") {
                        text(agent, digits: digits, body: item.suggestion ?? "", feedKey: feedKey)
                    }
                }
                if let email, let url = URL(string: "mailto:\(email)") {
                    iconButton("envelope", label: "Email \(agent.displayName)") { Platform.open(url) }
                }
            }

            if let suggestion = item.suggestion?.nilIfBlank {
                suggestedText(suggestion, agent: agent, digits: digits, feedKey: feedKey)
            }
            if let listing = item.listing {
                Button { openListing = listing } label: { ListingRow(listing: listing, showsChevron: true) }
                    .buttonStyle(.plain)
            }
            if let href = item.editorHref?.nilIfBlank {
                Button { editor = EditorLink(href: href) } label: {
                    Label("Open in photo editor", systemImage: "wand.and.stars")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.emerald)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 2)
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
    private func suggestedText(_ suggestion: String, agent: Agent, digits: String?, feedKey: String? = nil) -> some View {
        Button {
            if let digits { text(agent, digits: digits, body: suggestion, feedKey: feedKey) }
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
    private func text(_ agent: Agent, digits: String, body: String, feedKey: String? = nil) {
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
                        try await APIClient.shared.confirmAgentTextSent(agentId: agent.id, followUpFeed: feedKey)
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

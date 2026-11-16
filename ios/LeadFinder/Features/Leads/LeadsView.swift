import SwiftUI

/// The full Leads list: same sections, order and badges as the web Leads page.
/// Read-only in Phase 2 — Text and Pass arrive with the texting phase.
struct LeadsView: View {
    @Environment(AppState.self) private var appState

    /// Sections the server marked collapsed (just "Unlikely matches") start
    /// closed, matching the web page.
    @State private var collapsed: Set<String> = []
    /// Which "Agents you know" group is showing: "all", or clients, interested,
    /// warm, office (the web's tabs on that section).
    @State private var knownFilter = "all"
    @State private var didSetInitialCollapse = false
    @State private var openLead: LeadsResponse.Group?
    @State private var contactKey: String?

    var body: some View {
        NavigationStack {
            Group {
                if let leads = appState.leads.value {
                    leadsList(leads)
                        .id(appState.leadsMarket)
                } else if appState.leads.error != nil {
                    loadFailure
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            // The tabs ride in a top safe-area bar instead of sitting in a
            // VStack above the list: the scroll view is then the screen's
            // primary scroll view, so the nav bar collapses with it and the
            // cards scroll under the bar rather than over or through it.
            // Outside the list, so a market switch only swaps the cards.
            .modifier(TopBar { marketTabs.padding(.top, 4).padding(.bottom, 8) })
            .background(Theme.background)
            .navigationTitle("Leads")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink {
                        PhotoEditorView()
                    } label: {
                        Label("Photo editor", systemImage: "wand.and.stars")
                    }
                }
            }
            .sheet(item: $openLead) { group in
                LeadDetailView(group: group)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .task {
                #if DEBUG
                // `-lead-detail` opens the first lead straight away, so the detail
                // screen can be screenshotted without anyone tapping. It waits for
                // the data, because at first appear there is nothing to push.
                guard DebugLaunchArguments.opensLeadDetail else { return }
                for _ in 0..<60 {
                    if let first = appState.leads.value?.sections.first?.groups.first {
                        if DebugLaunchArguments.opensContact {
                            contactKey = first.key
                        } else {
                            openLead = first
                        }
                        return
                    }
                    try? await Task.sleep(for: .milliseconds(250))
                }
                #endif
            }
            .onReceive(NotificationCenter.default.publisher(for: .leadsDidChange)) { _ in
                Task { await appState.leads.load(force: true) }
            }
            .task {
                await appState.leads.load()
                // The other two markets in the background, so switching tabs
                // shows cards straight away instead of a spinner.
                await appState.preloadLeadMarkets()
            }
            .task {
                guard !didSetInitialCollapse else { return }
                didSetInitialCollapse = true
                collapsed = Set(
                    (appState.leads.value?.sections ?? [])
                        .filter(\.collapsed)
                        .map(\.key)
                )
            }
        }
    }

    private func leadsList(_ leads: LeadsResponse) -> some View {
        ScrollView {

            LazyVStack(spacing: 14, pinnedViews: []) {
                ErrorBanner(
                    message: appState.leads.error,
                    onRetry: { Task { await appState.leads.load(force: true) } }
                )
                .padding(.horizontal, 16)

                header(leads.counts)

                // Every card is its own child of the LazyVStack. Wrapping a
                // section's cards in a VStack made the whole section one lazy
                // item, so opening Leads built all ~300 Backup cards at once.
                ForEach(leads.sections) { section in
                    sectionHeader(section)
                    if !collapsed.contains(section.key) {
                        if section.key == "known" { knownTabs(section.groups) }
                        let groups = section.key == "known" && knownFilter != "all"
                            ? section.groups.filter { $0.knownGroup == knownFilter }
                            : section.groups
                        ForEach(Array(groups.enumerated()), id: \.element.id) { offset, group in
                            card(group)
                                .onAppear { prefetchPhotos(after: offset, in: groups) }
                        }
                    }
                }

                if leads.sections.isEmpty {
                    EmptyStateView(
                        icon: "sparkles",
                        title: "No open leads",
                        message: "Nothing is waiting on you right now."
                    )
                }
            }
            .padding(.vertical, 12)
        }
        .refreshable { await appState.leads.load(force: true) }
    }

    /// The web's tabs over "Agents you know", in its order. Clients are people
    /// who have paid for a shoot; "Same office" are strangers at a client's
    /// brokerage. Only shown when there's more than one group to switch between.
    @ViewBuilder
    private func knownTabs(_ groups: [LeadsResponse.Group]) -> some View {
        let order: [(key: String, label: String)] = [
            ("clients", "Clients"), ("interested", "Interested"), ("warm", "Warm"), ("office", "Same office"),
        ]
        let present = order.filter { entry in groups.contains { $0.knownGroup == entry.key } }
        if present.count > 1 {
            let tabs = [("all", "All", groups.count)]
                + present.map { entry in (entry.key, entry.label, groups.filter { $0.knownGroup == entry.key }.count) }
            let active = tabs.contains { $0.0 == knownFilter } ? knownFilter : "all"
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(tabs, id: \.0) { key, label, count in
                        let selected = key == active
                        Button {
                            withAnimation(.snappy(duration: 0.2)) { knownFilter = key }
                        } label: {
                            HStack(spacing: 6) {
                                Text(label)
                                Text("\(count)")
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
                    }
                }
                .padding(.horizontal, 16)
            }
            .scrollClipDisabled()
        }
    }

    /// Local | Regional | each shooter market (Portland, Central Coast), as on
    /// the web (lib/markets.ts; the server's `markets` list drives the tabs).
    /// Each market is its own board, sorted by nearness to who shoots it:
    /// Winston for local and regional, the subcontracted photographer's base
    /// for a shooter market (Oregon City for Portland).
    private var marketTabs: some View {
        // Counts are the same on every market's response; use whichever is loaded.
        let markets = appState.leads.value?.markets
            ?? appState.leadsLocal.value?.markets
            ?? appState.leadsRegional.value?.markets
            ?? appState.leadsPortland.value?.markets
            ?? appState.leadsCentralCoast.value?.markets
        let fallback: [LeadsResponse.Market] = [
            .init(key: "local", label: "Local", count: 0),
            .init(key: "regional", label: "Regional", count: 0),
            .init(key: "portland", label: "Portland", count: 0),
            .init(key: "central_coast", label: "Central Coast", count: 0),
        ]
        let tabs = markets ?? fallback
        // Equal-width segments when every label fits; otherwise (narrow phone,
        // more markets) a scrolling row of intrinsic-width segments.
        return ViewThatFits(in: .horizontal) {
            marketTabRow(tabs, showCounts: markets != nil, equalWidth: true)
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    marketTabRow(tabs, showCounts: markets != nil, equalWidth: false)
                }
                .onAppear { proxy.scrollTo(appState.leadsMarket, anchor: .center) }
                .onChange(of: appState.leadsMarket) { _, key in
                    proxy.scrollTo(key, anchor: .center)
                }
            }
        }
    }

    private func marketTabRow(_ tabs: [LeadsResponse.Market], showCounts: Bool, equalWidth: Bool) -> some View {
        let layout = equalWidth ? AnyLayout(EqualWidthHStack(spacing: 4)) : AnyLayout(HStackLayout(spacing: 4))
        return layout {
            ForEach(tabs) { market in
                let selected = market.key == appState.leadsMarket
                Button {
                    guard !selected else { return }
                    // No animation: animating hundreds of cards out and in
                    // is what made the switch stutter.
                    appState.leadsMarket = market.key
                    Task { await appState.leads.load() }
                } label: {
                    VStack(spacing: 1) {
                        Text(market.label)
                            .font(.footnote.weight(selected ? .semibold : .medium))
                        if showCounts {
                            HStack(spacing: 4) {
                                Text("\(market.count)")
                                    .font(.caption.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(selected ? Theme.secondaryText : Theme.tertiaryText)
                                if let fresh = market.newAgents, fresh > 0 {
                                    // Brand-new agents (first seen today) in this market.
                                    Text("+\(fresh)")
                                        .font(.caption2.weight(.bold).monospacedDigit())
                                        .foregroundStyle(Theme.accent)
                                        .padding(.horizontal, 5)
                                        .padding(.vertical, 1)
                                        .background(Theme.accent.opacity(0.16), in: Capsule())
                                        .accessibilityLabel("\(fresh) new agents")
                                }
                            }
                        }
                    }
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 10)
                    .frame(maxWidth: equalWidth ? .infinity : nil)
                    .padding(.vertical, 6)
                    .background(selected ? Theme.cardRaised : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                    .foregroundStyle(selected ? Theme.primaryText : Theme.secondaryText)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .id(market.key)
            }
        }
        .padding(3)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border, lineWidth: 0.5))
        .padding(.horizontal, 16)
    }

    private func header(_ counts: LeadsResponse.Counts) -> some View {
        HStack(spacing: 6) {
            Text("\(counts.agents) agents · \(counts.listings) listings")
            if counts.queued > 0 {
                Text("·")
                Text("\(counts.queued) queued").foregroundStyle(Theme.warning)
            }
            Spacer(minLength: 0)
        }
        .font(.footnote.weight(.medium))
        .foregroundStyle(Theme.secondaryText)
        .padding(.horizontal, 16)
    }

    private func sectionHeader(_ section: LeadsResponse.Section) -> some View {
        let isCollapsed = collapsed.contains(section.key)
        return Button {
            withAnimation(.snappy(duration: 0.22)) {
                if isCollapsed { collapsed.remove(section.key) } else { collapsed.insert(section.key) }
            }
        } label: {
            HStack(spacing: 6) {
                Text(section.label)
                    .font(.headline)
                    .foregroundStyle(Theme.primaryText)
                Text("\(section.groups.count)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.tertiaryText)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(Theme.cardRaised, in: Capsule())
                Spacer(minLength: 0)
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Theme.tertiaryText)
                    .rotationEffect(.degrees(isCollapsed ? -90 : 0))
            }
            .contentShape(Rectangle())
            .padding(.horizontal, 16)
            .padding(.top, 6)
        }
        .buttonStyle(.plain)
    }

    private func card(_ group: LeadsResponse.Group) -> some View {
        Button { openLead = group } label: {
            LeadCard(
                group: group,
                openContactOnAppear: DebugLaunchArguments.opensContact && contactKey == group.key
            )
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
    }

    /// The first photo of the next few cards, so they're loaded by the time
    /// they scroll into view.
    private func prefetchPhotos(after offset: Int, in groups: [LeadsResponse.Group]) {
        let upcoming = groups.dropFirst(offset + 1).prefix(4)
        let urls = upcoming.compactMap { PhotoSampling.card($0.best.photos ?? []).first.flatMap(PhotoSize.card.url) }
        ImagePipeline.shared.prefetch(urls, maxPixel: PhotoSize.card.maxPixel)
    }

    private var loadFailure: some View {
        VStack(spacing: 14) {
            EmptyStateView(
                icon: "wifi.exclamationmark",
                title: "Couldn't load leads",
                message: appState.leads.error
            )
            Button("Try again") {
                Task { await appState.leads.load(force: true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
/// Posted after a card's Save or Pass lands, so the list can refetch and drop
/// the card rather than leaving a row that no longer exists.
extension Notification.Name {
    static let leadsDidChange = Notification.Name("leadsDidChange")
}

/// An HStack whose children all get the widest child's width. Reports that
/// real width (widest × count), so `ViewThatFits` can tell when the market
/// tabs no longer fit side by side and fall back to scrolling.
private struct EqualWidthHStack: Layout {
    var spacing: CGFloat = 4

    private func maxSize(_ subviews: Subviews) -> CGSize {
        subviews.reduce(.zero) { acc, view in
            let s = view.sizeThatFits(.unspecified)
            return CGSize(width: max(acc.width, s.width), height: max(acc.height, s.height))
        }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard !subviews.isEmpty else { return .zero }
        let item = maxSize(subviews)
        let gaps = spacing * CGFloat(subviews.count - 1)
        let needed = item.width * CGFloat(subviews.count) + gaps
        return CGSize(width: max(needed, proposal.width ?? needed), height: item.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard !subviews.isEmpty else { return }
        let gaps = spacing * CGFloat(subviews.count - 1)
        let width = (bounds.width - gaps) / CGFloat(subviews.count)
        var x = bounds.minX
        for view in subviews {
            view.place(at: CGPoint(x: x, y: bounds.minY), proposal: ProposedViewSize(width: width, height: bounds.height))
            x += width + spacing
        }
    }
}

/// Pins content below the navigation bar. On iOS 26+ a `safeAreaBar`, which
/// joins the nav bar's Liquid Glass scroll-edge effect; earlier, a safe-area
/// inset on the system bar material.
private struct TopBar<Bar: View>: ViewModifier {
    @ViewBuilder var bar: () -> Bar

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.safeAreaBar(edge: .top, spacing: 0) { bar() }
        } else {
            content.safeAreaInset(edge: .top, spacing: 0) {
                bar().frame(maxWidth: .infinity).background(.bar)
            }
        }
    }
}

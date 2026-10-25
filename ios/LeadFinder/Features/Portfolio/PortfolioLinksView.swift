import SwiftUI

/// Pushed onto a NavigationStack to open the portfolio links.
struct PortfolioLinksRoute: Hashable {
    init() {}
}

/// One link's activity.
struct PortfolioActivityRoute: Hashable {
    let id: String
}

/// How the web's portfolio pages word times and durations.
enum PortfolioFormat {
    /// 45 -> "45s", 252 -> "4m 12s", 3900 -> "1h 5m".
    static func duration(_ seconds: Int) -> String {
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m \(seconds % 60)s" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    private static let pacific = TimeZone(identifier: "America/Los_Angeles")!

    /// "Oct 15, 2:00 PM", Pacific, as the web shows a visit.
    static func when(_ iso: String?) -> String {
        guard let date = DateFormatting.parse(iso) else { return "" }
        var style = Date.FormatStyle.dateTime.month(.abbreviated).day().hour().minute()
        style.timeZone = pacific
        return date.formatted(style)
    }

    /// "2:00:05 PM", for an event inside a visit.
    static func clock(_ iso: String?) -> String {
        guard let date = DateFormatting.parse(iso) else { return "" }
        var style = Date.FormatStyle.dateTime.hour().minute().second()
        style.timeZone = pacific
        return date.formatted(style)
    }

    /// "Oct 15", for "last viewed".
    static func day(_ iso: String?) -> String {
        guard let date = DateFormatting.parse(iso) else { return "" }
        var style = Date.FormatStyle.dateTime.month(.abbreviated).day()
        style.timeZone = pacific
        return date.formatted(style)
    }
}

/// The web's /portfolio-links: every personalized agent page with who it was
/// made for, how many times it's been opened and what they did, and the
/// actions on it. Preview opens the link with `?preview=1`, so Lukas looking
/// at his own page is not a visit; Copy and Share send the plain link.
struct PortfolioLinksView: View {
    @State private var links: [PortfolioLinkSummary]?
    @State private var error: String?
    @State private var builder: PortfolioBuilderStart?
    @State private var copied: String?
    @State private var debugActivity: PortfolioActivityRoute?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                ErrorBanner(message: error, onRetry: { Task { await load() } })
                if let links {
                    if links.isEmpty {
                        EmptyStateView(icon: "link", title: "No links yet", message: "New link builds one.")
                    }
                    ForEach(links) { row($0) }
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(Theme.background)
        .navigationTitle("Portfolio links")
        .titleDisplay(.inline)
        .toolbar {
            ToolbarItem(placement: .trailingBar) {
                Button { builder = .new(agent: nil) } label: { Label("New link", systemImage: "plus") }
            }
        }
        .navigationDestination(for: PortfolioActivityRoute.self) { PortfolioActivityView(id: $0.id) }
        .navigationDestination(item: $debugActivity) { PortfolioActivityView(id: $0.id) }
        .sheet(item: $builder) { start in
            PortfolioBuilderView(start: start) { Task { await load() } }
        }
        .refreshable { await load() }
        .task { await load() }
        #if DEBUG
        .task {
            // `-portfolio-open edit|new` opens the builder, for screenshots.
            if DebugLaunchArguments.opensPortfolioActivity {
                try? await Task.sleep(for: .seconds(3))
                if let first = links?.first { debugActivity = PortfolioActivityRoute(id: first.id) }
            }
            guard let mode = DebugLaunchArguments.portfolioOpen else { return }
            try? await Task.sleep(for: .seconds(3))
            switch mode {
            case "edit": if let first = links?.first { builder = .editing(linkId: first.id) }
            case "new": builder = .new(agent: nil)
            default: break
            }
        }
        #endif
    }

    private func load() async {
        do {
            links = try await APIClient.shared.portfolioLinks()
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func row(_ link: PortfolioLinkSummary) -> some View {
        let highlights = [link.contactSaves > 0 ? "Saved your contact" : nil, link.bookTaps > 0 ? "Tapped Book a shoot" : nil]
            .compactMap { $0 }
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                NavigationLink(value: PortfolioActivityRoute(id: link.id)) {
                    Text(link.agentName?.nilIfBlank ?? "No agent attached")
                        .font(.headline)
                        .foregroundStyle(Theme.primaryText)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                Spacer(minLength: 6)
                Text(summary(link))
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.trailing)
            }
            if !highlights.isEmpty {
                Text(highlights.joined(separator: " · "))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.emerald)
            }
            Text(link.url)
                .font(.caption.monospaced())
                .foregroundStyle(Theme.tertiaryText)
                .lineLimit(1)
                .truncationMode(.middle)

            HStack(spacing: 8) {
                action("Preview", "eye") {
                    if let url = PortfolioSite.previewURL(link.url) { Platform.open(url) }
                }
                action("Edit", "pencil") { builder = .editing(linkId: link.id) }
                NavigationLink(value: PortfolioActivityRoute(id: link.id)) {
                    actionLabel("Activity", "chart.bar")
                }
                .buttonStyle(.plain)
                action(copied == link.id ? "Copied" : "Copy", copied == link.id ? "checkmark" : "doc.on.doc") {
                    Platform.copy(link.url)
                    copied = link.id
                    Task {
                        try? await Task.sleep(for: .seconds(2))
                        if copied == link.id { copied = nil }
                    }
                }
                if let url = URL(string: link.url) {
                    ShareLink(item: url) { actionLabel("Share", "square.and.arrow.up") }
                        .buttonStyle(.plain)
                }
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }

    /// "3 visits · 4m 12s · last Oct 15".
    private func summary(_ link: PortfolioLinkSummary) -> String {
        var parts = ["\(link.visits) visit\(link.visits == 1 ? "" : "s")"]
        if link.visits > 0 { parts.append(PortfolioFormat.duration(link.activeSeconds)) }
        if let last = link.lastViewedAt { parts.append("last \(PortfolioFormat.day(last))") }
        return parts.joined(separator: " · ")
    }

    private func action(_ title: String, _ symbol: String, perform: @escaping () -> Void) -> some View {
        Button(action: perform) { actionLabel(title, symbol) }
            .buttonStyle(.plain)
    }

    private func actionLabel(_ title: String, _ symbol: String) -> some View {
        VStack(spacing: 3) {
            Image(systemName: symbol).font(.callout)
            Text(title).font(.caption2.weight(.medium))
        }
        .foregroundStyle(Theme.primaryText)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 7)
        .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Theme.border, lineWidth: 0.5))
    }
}

// MARK: - Activity

/// One link's activity, laid out as the web's activity page: the totals, then
/// every visit with when, device, time on the page, deepest scroll, seconds
/// per section and what they tapped.
struct PortfolioActivityView: View {
    let id: String

    @State private var activity: PortfolioActivity?
    @State private var error: String?
    @State private var builder: PortfolioBuilderStart?

    /// Page order, so the bars read top to bottom like the page itself.
    private static let sections: [(key: String, label: String)] = [
        ("hero", "Headline"),
        ("before_after", "Before / after"),
        ("photos", "Photos"),
        ("video", "Video"),
        ("why", "Why Hahn Media"),
        ("listings", "Recent listings"),
        ("testimonial", "Review"),
        ("pricing", "Pricing"),
        ("book", "Book / save contact"),
    ]

    private static let eventLabels: [String: (label: String, symbol: String)] = [
        "save_contact": ("Saved your contact", "person.crop.circle.badge.plus"),
        "book_shoot": ("Tapped Book a shoot", "message"),
        "sound_on": ("Turned the video's sound on", "speaker.wave.2"),
        "sound_off": ("Turned the sound off", "speaker.slash"),
        "listing_prev": ("Previous photo", "chevron.left"),
        "listing_next": ("Next photo", "chevron.right"),
        "reviews": ("Opened your Google reviews", "star"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ErrorBanner(message: error, onRetry: { Task { await load() } })
                if let activity {
                    header(activity)
                    totals(activity)
                    if activity.visits.isEmpty {
                        Text("No visits yet." + (activity.viewCount > 0 ? " (The page was loaded before visit tracking existed, or only by a link preview.)" : ""))
                            .font(.subheadline)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    ForEach(activity.visits) { visit($0) }
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(Theme.background)
        .navigationTitle("Activity")
        .titleDisplay(.inline)
        .sheet(item: $builder) { start in
            PortfolioBuilderView(start: start) { Task { await load() } }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        do {
            activity = try await APIClient.shared.portfolioActivity(id)
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func header(_ activity: PortfolioActivity) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(activity.agentName?.nilIfBlank ?? "No agent attached")
                .font(.title2.weight(.semibold))
                .foregroundStyle(Theme.primaryText)
            Text(((activity.area?.nilIfBlank).map { "\($0) · " } ?? "") + "made \(PortfolioFormat.when(activity.createdAt))")
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryText)
            ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                headerButton("Preview", "eye") {
                    if let url = PortfolioSite.previewURL(activity.url) { Platform.open(url) }
                }
                headerButton("Edit", "pencil") { builder = .editing(linkId: activity.id) }
                headerButton("Copy link", "doc.on.doc") { Platform.copy(activity.url) }
                if let url = URL(string: activity.url) {
                    ShareLink(item: url) { headerLabel("Share", "square.and.arrow.up") }
                        .buttonStyle(.plain)
                }
                if let agentId = activity.agentId {
                    headerButton("New for them", "plus") {
                        builder = .new(agent: PortfolioAgentMatch(id: agentId, name: activity.agentName, phone: nil, email: nil))
                    }
                }
            }
            }
            .scrollClipDisabled()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func headerButton(_ title: String, _ symbol: String, perform: @escaping () -> Void) -> some View {
        Button(action: perform) { headerLabel(title, symbol) }
            .buttonStyle(.plain)
    }

    private func headerLabel(_ title: String, _ symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .font(.caption.weight(.medium))
            .lineLimit(1)
            .foregroundStyle(Theme.primaryText)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(Theme.cardRaised, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 0.5))
    }

    private func totals(_ activity: PortfolioActivity) -> some View {
        let visits = activity.visits
        let devices = Set(visits.map { "\($0.ip ?? "")|\($0.device)|\($0.browser)" }).count
        let events = visits.flatMap(\.events)
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            StatTile("Visits", "\(visits.count)", "\(devices) device\(devices == 1 ? "" : "s")")
            StatTile("Time on page", PortfolioFormat.duration(visits.reduce(0) { $0 + $1.activeSeconds }), "tab visible")
            StatTile("Saved contact", "\(events.filter { $0.event == "save_contact" }.count)", "")
            StatTile("Tapped Book", "\(events.filter { $0.event == "book_shoot" }.count)", "")
        }
        .card(padding: 14)
    }

    private func visit(_ visit: PortfolioVisit) -> some View {
        let seen = Self.sections.filter { (visit.sectionSeconds[$0.key] ?? 0) > 0 }
        let most = max(1, seen.map { visit.sectionSeconds[$0.key] ?? 0 }.max() ?? 1)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(PortfolioFormat.when(visit.startedAt))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)
                Spacer(minLength: 8)
                Text("\(PortfolioFormat.duration(visit.activeSeconds)) on the page · scrolled \(visit.maxScrollPct)%")
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.trailing)
            }
            Text([visit.device, visit.browser, visit.location, visit.screen].compactMap { $0?.nilIfBlank }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(Theme.tertiaryText)

            if !seen.isEmpty {
                VStack(spacing: 5) {
                    ForEach(seen, id: \.key) { section in
                        let seconds = visit.sectionSeconds[section.key] ?? 0
                        HStack(spacing: 8) {
                            Text(section.label)
                                .font(.caption)
                                .foregroundStyle(Theme.secondaryText)
                                .lineLimit(1)
                                .frame(width: 112, alignment: .leading)
                            GeometryReader { proxy in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Theme.cardRaised)
                                    Capsule()
                                        .fill(Theme.sky.opacity(0.75))
                                        .frame(width: max(4, proxy.size.width * Double(seconds) / Double(most)))
                                }
                            }
                            .frame(height: 8)
                            Text(PortfolioFormat.duration(seconds))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(Theme.primaryText)
                                .frame(width: 54, alignment: .trailing)
                        }
                    }
                }
            }

            if !visit.events.isEmpty {
                Divider().overlay(Theme.hairline)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(visit.events) { event in
                        let info = Self.eventLabels[event.event] ?? (event.event, "chevron.right")
                        let strong = event.event == "save_contact" || event.event == "book_shoot"
                        HStack(spacing: 8) {
                            Text(PortfolioFormat.clock(event.at))
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(Theme.tertiaryText)
                                .frame(width: 74, alignment: .leading)
                            Image(systemName: info.symbol)
                                .font(.caption)
                                .foregroundStyle(strong ? Theme.emerald : Theme.secondaryText)
                                .frame(width: 18)
                            (Text(info.label).fontWeight(strong ? .medium : .regular)
                                + Text(event.detail?.nilIfBlank.map { " · \($0)" } ?? "").foregroundColor(Theme.secondaryText))
                                .font(.footnote)
                                .foregroundStyle(Theme.primaryText)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }
}

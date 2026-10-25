#if os(iOS)

import Charts
import SwiftUI

/// The iPhone's first tab: the whole business at a glance. Rewritten
/// 2026-10-16, when Finances added a third set of numbers.
///
/// Stats first, then what's left to do (Lukas's order). Each stat section is
/// a few headline numbers that tap through to its full page:
///
/// 1. **Goal**: the month's booked revenue against the goal, and the weekly
///    quotas that get there (texts, replies, new clients, interested). → Messages
/// 2. **Money**: this month's revenue, real profit and per hour, the last six
///    months' profit, and the year with its tax. → Finances
/// 3. **Funnel**: how texts turn into replies, interest and bookings. → Messages
/// 4. **Bookings**: where every job is, tentative to unpaid. → Bookings
/// 5. **To do**: today's texts and follow-ups, the next shoot, jobs to edit,
///    trips not logged yet.
///
/// Every number is the server's (goal, stats, finance reports); this screen
/// only lays them out, so it can't disagree with the pages it opens.
struct HomeView: View {
    @Environment(AppState.self) private var appState
    @Binding var selection: AppTab
    @State private var openBooking: Booking?
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if appState.messages.value != nil || appState.bookings.value != nil || appState.finances.value != nil {
                    content
                } else if let error = firstError {
                    EmptyStateView(icon: "wifi.exclamationmark", title: "Couldn't load", message: error)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(Theme.background)
            .navigationTitle("Home")
            .navigationDestination(for: FollowUpRoute.self) { _ in FollowUpView() }
            .navigationDestination(for: BookingsRoute.self) { _ in BookingsView() }
            .navigationDestination(for: FinancesRoute.self) { route in FinancesView(tab: route.tab) }
            .navigationDestination(for: PortfolioLinksRoute.self) { _ in PortfolioLinksView() }
            .sheet(item: $openBooking) { booking in
                BookingDetailView(booking: booking)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .task { await appState.messages.load() }
            .task { await appState.bookings.load() }
            .task { await appState.followUp.load() }
            .task { await appState.finances.load() }
            .task { await appState.portfolioOverview.load() }
            .task { await appState.galleryVisits.load() }
            .task { await appState.financeJobs.load() }
            #if DEBUG
            .task {
                if let tab = DebugLaunchArguments.financesTab { path.append(FinancesRoute(tab: tab)) }
                if DebugLaunchArguments.followUpTab != nil { path.append(FollowUpRoute()) }
                if let id = DebugLaunchArguments.bookingId {
                    openBooking = try? await APIClient.shared.bookingDetail(id)
                }
            }
            #endif
        }
    }

    private var firstError: String? {
        appState.messages.error ?? appState.bookings.error ?? appState.finances.error ?? appState.followUp.error
    }

    private var content: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                ErrorBanner(message: firstError, onRetry: { Task { await reload() } })

                if let goal = appState.messages.value?.goal {
                    goalSection(goal).id("goal")
                }
                if let finances = appState.finances.value {
                    moneySection(finances).id("money")
                }
                if let messages = appState.messages.value, let goal = messages.goal {
                    funnelSection(goal, stats: messages.stats).id("funnel")
                }
                if let bookings = appState.bookings.value {
                    bookingsSection(bookings).id("bookings")
                }
                if let overview = appState.portfolioOverview.value {
                    portfolioSection(overview).id("portfolio")
                }
                toDoSection.id("todo")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .refreshable { await reload() }
        #if DEBUG
        .task {
            guard let section = DebugLaunchArguments.homeSection else { return }
            try? await Task.sleep(for: .seconds(4))
            proxy.scrollTo(section, anchor: .top)
        }
        #endif
        }
    }

    private func reload() async {
        let state = appState
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await state.messages.load(force: true) }
            group.addTask { await state.bookings.load(force: true) }
            group.addTask { await state.followUp.load(force: true) }
            group.addTask { await state.finances.load(force: true) }
            group.addTask { await state.portfolioOverview.load(force: true) }
            group.addTask { await state.galleryVisits.load(force: true) }
            group.addTask { await state.financeJobs.load(force: true) }
        }
    }

    // MARK: - Portfolio links

    /// How the pages he's sent are doing: how many get opened, how long and
    /// how far down people read, then what just happened on them. Taps through
    /// to the links. The numbers are the server's (`/portfolio-links/overview`).
    private func portfolioSection(_ overview: PortfolioOverview) -> some View {
        navSection("Portfolio links", see: "Links", value: PortfolioLinksRoute()) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    StatTile(
                        "Opened",
                        overview.sent > 0 ? Self.percent(Double(overview.opened) / Double(overview.sent)) : "\u{2014}",
                        "\(overview.opened) of \(overview.sent) links"
                    )
                    StatTile(
                        "Time on page",
                        overview.avgActiveSeconds.map { PortfolioFormat.duration(Int($0.rounded())) } ?? "\u{2014}",
                        "avg per visit"
                    )
                    StatTile(
                        "Scrolled",
                        overview.avgScrollPct.map { "\(Int($0.rounded()))%" } ?? "\u{2014}",
                        "avg depth"
                    )
                }

                if !overview.events.isEmpty {
                    Divider().overlay(Theme.cardRaised)
                    // Its own scroll area, so the card stays a fixed height.
                    HStack(spacing: 6) {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.caption)
                            .foregroundStyle(Theme.tertiaryText)
                        Text("Recent activity")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.primaryText)
                        Text("\u{00B7} last \(overview.events.count)")
                            .font(.caption)
                            .foregroundStyle(Theme.tertiaryText)
                    }
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(overview.events) { PortfolioEventRow(event: $0) }
                        }
                    }
                    .frame(height: min(250, CGFloat(overview.events.count) * 66))
                }
            }
        }
    }

    // MARK: - 1. Goal

    /// The month's goal as a hero number, then the quotas that reach it.
    private func goalSection(_ goal: MessagesResponse.Goal) -> some View {
        let met = goal.gap == 0
        let week = goal.thisWeek
        return section("\(goal.month) goal", see: "Messages", action: { selection = .messages }) {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(goal.booked.currencyString)
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                            .foregroundStyle(Theme.primaryText)
                        Text("of \(goal.goal.currencyString) booked")
                            .font(.subheadline)
                            .foregroundStyle(Theme.secondaryText)
                        Spacer(minLength: 0)
                        if met {
                            Label("Met", systemImage: "checkmark.circle.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Theme.emerald)
                        }
                    }
                    ProgressBar(fraction: goal.goal > 0 ? goal.booked / goal.goal : 0, met: met, height: 10)
                    Text(met
                        ? "\(goal.jobs) jobs this month"
                        : "\(goal.gap.currencyString) to go · about \(goal.jobsNeeded) job\(goal.jobsNeeded == 1 ? "" : "s") at \(goal.avgJob.currencyString)")
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                }

                Divider().overlay(Theme.cardRaised)

                VStack(alignment: .leading, spacing: 12) {
                    Text("The pace that gets there")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.secondaryText)
                        .textCase(.uppercase)
                    if let plan = goal.plan {
                        QuotaRow(label: "Texts this week", done: week.texts, target: plan.textsPerWeek)
                        QuotaRow(label: "Replies this week", done: week.replies, target: plan.repliesPerWeek)
                        QuotaRow(
                            label: "New clients this month",
                            done: plan.newClientsThisMonth,
                            target: Int(plan.newClientsPerMonth.rounded(.up))
                        )
                    }
                    QuotaRow(label: "Interested, in touch", done: goal.interested.live, target: goal.interested.needed)
                }
            }
        }
    }

    // MARK: - 2. Money

    private func moneySection(_ report: FinanceOverview) -> some View {
        let month = report.thisMonth
        let year = report.yearToDate
        // Oldest to newest, the last six months, for the bars.
        let recent = Array(report.months.prefix(6).reversed())

        return navSection("Money", see: "Finances", value: FinancesRoute()) {
            VStack(alignment: .leading, spacing: 14) {
                Text("\(FinanceFormat.monthLabel(report.month, withYear: false)) so far")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.secondaryText)
                    .textCase(.uppercase)
                HStack(alignment: .top, spacing: 12) {
                    StatTile("Revenue", FinanceFormat.dollars(month.revenue), "\(month.jobs) jobs")
                    StatTile("Real profit", FinanceFormat.dollars(month.profit), "\(FinanceFormat.dollars(month.costs)) costs")
                    StatTile("Per hour", FinanceFormat.perHour(month.perHour), "\(Int(month.hours.rounded())) h worked")
                }

                if recent.count > 1 {
                    ProfitBars(months: recent)
                        .frame(height: 92)
                }

                Divider().overlay(Theme.cardRaised)

                HStack(alignment: .top, spacing: 12) {
                    StatTile("\(String(report.year)) revenue", FinanceFormat.dollars(year.revenue), "\(year.jobs) jobs")
                    StatTile("\(String(report.year)) profit", FinanceFormat.dollars(year.profit), FinanceFormat.perHour(year.perHour))
                    StatTile("Tax to set aside", FinanceFormat.dollars(report.yearTaxOwed), "estimate")
                }
            }
        }
    }

    // MARK: - 3. Funnel

    /// How a text becomes a booking. The rates are the goal's own (what the
    /// pace above is worked out from), not recomputed here.
    private func funnelSection(_ goal: MessagesResponse.Goal, stats: MessagesResponse.Stats) -> some View {
        let sample = goal.bookSample
        return section("Funnel", see: "Messages", action: { selection = .messages }) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 8) {
                    FunnelStep(label: "Texted", value: "\(stats.sms.sentRecent)", sub: "last 30 days", rate: nil)
                    FunnelStep(
                        label: "Reply",
                        value: Self.percent(goal.rates.reply),
                        sub: "\(stats.sms.replied) of \(stats.sms.sent)",
                        rate: goal.rates.reply
                    )
                    FunnelStep(
                        label: "Interested",
                        value: Self.percent(goal.rates.interested),
                        sub: "of replies",
                        rate: goal.rates.interested
                    )
                    FunnelStep(
                        label: "Book",
                        value: Self.percent(goal.rates.book),
                        sub: sample.map { "\($0.booked) of \($0.of)" } ?? "of interested",
                        rate: goal.rates.book
                    )
                }
            }
        }
    }

    /// Whole percents read faster at a glance: "17%".
    private static func percent(_ rate: Double) -> String {
        "\(Int((rate * 100).rounded()))%"
    }

    // MARK: - 4. Bookings

    private func bookingsSection(_ bookings: BookingsResponse) -> some View {
        let stages: [(String, Int, String)] = [
            ("Tentative", bookings.tentative?.count ?? 0, "date to settle"),
            ("Upcoming", bookings.upcoming.filter { $0.dateTentative != true }.count, "to shoot"),
            ("Editing", bookings.editing?.count ?? 0, "to deliver"),
            ("Unpaid", bookings.waitingForPayment.count, "invoice out"),
        ]
        return navSection("Bookings", see: "Bookings", value: BookingsRoute()) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 8) {
                    ForEach(stages, id: \.0) { label, count, sub in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(label)
                                .font(.caption)
                                .foregroundStyle(Theme.secondaryText)
                            Text("\(count)")
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(count == 0 ? Theme.tertiaryText : Theme.primaryText)
                            Text(sub)
                                .font(.caption2)
                                .foregroundStyle(Theme.tertiaryText)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                if let goal = appState.messages.value?.goal {
                    Text("\(goal.jobs) job\(goal.jobs == 1 ? "" : "s") dated in \(goal.month), \(goal.avgJob.currencyString) on average")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                }

                let recent = appState.galleryVisits.value?.visits ?? []
                if !recent.isEmpty {
                    Divider().overlay(Theme.cardRaised)
                    HStack(spacing: 6) {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.caption)
                            .foregroundStyle(Theme.tertiaryText)
                        Text("Gallery visits")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.primaryText)
                        Text("\u{00B7} last \(recent.count)")
                            .font(.caption)
                            .foregroundStyle(Theme.tertiaryText)
                    }
                    // Its own scroll area; a tap opens the booking.
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(recent) { visit in
                                Button {
                                    Task { openBooking = try? await APIClient.shared.bookingDetail(visit.bookingId) }
                                } label: { GalleryVisitRow(visit: visit) }
                                    .buttonStyle(.plain)
                            }
                        }
                    }
                    .frame(height: min(250, CGFloat(recent.count) * 66))
                }
            }
        }
    }

    // MARK: - 5. To do

    private var toDoSection: some View {
        let messages = appState.messages.value
        let bookings = appState.bookings.value
        let next = bookings.flatMap(Self.nextShoot)
        let editing = bookings?.editing ?? []
        let untracked = (appState.financeJobs.value?.jobs ?? []).filter { $0.tripIds.isEmpty }

        return VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Left to do today")
            VStack(spacing: 0) {
                if let today = messages?.goal?.today {
                    todoRow(icon: "paperplane", title: "Texts", detail: nil, done: today.texts, target: today.textsTarget) {
                        selection = .leads
                    }
                }
                if let followUp = appState.followUp.value, let target = followUp.dailyTarget {
                    divider
                    NavigationLink(value: FollowUpRoute()) {
                        todoLabel(icon: "heart", title: "Follow-ups", detail: nil, done: followUp.doneToday ?? 0, target: target)
                    }
                    .buttonStyle(.plain)
                }
                divider
                todoRow(
                    icon: "camera",
                    title: next.flatMap { DateFormatting.parse($0.jobDate) }.map { "Next shoot \(Self.day($0).lowercasedFirstIfRelative)" } ?? "No shoot booked",
                    detail: next.map(Self.timeAndPlace) ?? "nothing on the calendar"
                ) {
                    if let next { openBooking = next }
                }
                .disabled(next == nil)
                if !editing.isEmpty {
                    divider
                    NavigationLink(value: BookingsRoute()) {
                        todoLabel(icon: "wand.and.stars", title: "\(editing.count) to edit and deliver", detail: "shot, not delivered")
                    }
                    .buttonStyle(.plain)
                }
                if !untracked.isEmpty {
                    divider
                    NavigationLink(value: FinancesRoute(tab: .jobs)) {
                        todoLabel(
                            icon: "car",
                            title: "\(untracked.count) shot job\(untracked.count == 1 ? "" : "s") without a trip",
                            detail: "log the drive so profit counts gas"
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .card(padding: 0)
        }
    }

    private var divider: some View {
        Divider().overlay(Theme.hairline).padding(.leading, 48)
    }

    private func todoRow(
        icon: String,
        title: String,
        detail: String?,
        done: Int? = nil,
        target: Int? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            todoLabel(icon: icon, title: title, detail: detail, done: done, target: target)
        }
        .buttonStyle(.plain)
    }

    /// One line of the to-do card. With a target it reads "8 of 34" and turns
    /// green with a check once met.
    private func todoLabel(icon: String, title: String, detail: String?, done: Int? = nil, target: Int? = nil) -> some View {
        let met = done != nil && target != nil && done! >= target!
        return HStack(spacing: 12) {
            Image(systemName: met ? "checkmark.circle.fill" : icon)
                .font(.body)
                .foregroundStyle(met ? Theme.emerald : Theme.secondaryText)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                if let done, let target {
                    Text(met ? "done for today" : "\(target - done) more to go")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                } else if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let done, let target {
                Text("\(done) of \(target)")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(met ? Theme.emerald : Theme.primaryText)
            }
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.tertiaryText)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    // MARK: - Building blocks

    private func sectionHeader(_ title: String, see: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.primaryText)
            Spacer()
            if let see {
                HStack(spacing: 3) {
                    Text(see)
                    Image(systemName: "chevron.right")
                }
                .font(.subheadline)
                .foregroundStyle(Theme.accent)
            }
        }
    }

    /// A section whose header and card both tap through via an action (a tab switch).
    private func section<Content: View>(
        _ title: String,
        see: String,
        action: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                sectionHeader(title, see: see)
                content()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card(padding: 14)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The same, pushing a page onto Home's stack.
    private func navSection<Route: Hashable, Content: View>(
        _ title: String,
        see: String,
        value: Route,
        @ViewBuilder content: () -> Content
    ) -> some View {
        NavigationLink(value: value) {
            VStack(alignment: .leading, spacing: 10) {
                sectionHeader(title, see: see)
                content()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card(padding: 14)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Next shoot

    /// The soonest dated, confirmed job that hasn't been shot, from today on.
    private static func nextShoot(_ bookings: BookingsResponse) -> Booking? {
        let startOfToday = Calendar.current.startOfDay(for: Date())
        return bookings.upcoming
            .filter { $0.dateTentative != true && $0.shotAt == nil }
            .compactMap { booking -> (Booking, Date)? in
                guard let date = DateFormatting.parse(booking.jobDate), date >= startOfToday else { return nil }
                return (booking, date)
            }
            .min { $0.1 < $1.1 }?
            .0
    }

    /// "Today", "Tomorrow", or "Fri, Oct 16".
    private static func day(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInTomorrow(date) { return "Tomorrow" }
        return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    /// "9:00 AM · Roseburg".
    private static func timeAndPlace(_ booking: Booking) -> String {
        let time = DateFormatting.parse(booking.jobDate).map { DateFormatting.time.string(from: $0) }
        return [time, booking.city?.nilIfBlank].compactMap { $0 }.joined(separator: " · ")
    }
}

private extension String {
    /// "Today" -> "today" so it reads mid-sentence; dates stay as they are.
    var lowercasedFirstIfRelative: String {
        self == "Today" || self == "Tomorrow" ? lowercased() : self
    }
}

// MARK: - Pieces

/// A client opening or downloading from a job's gallery, as a row like the
/// Messages history's: icon, the job, what they did, who and when.
private struct GalleryVisitRow: View {
    let visit: GalleryVisitsResponse.Visit

    private var info: (title: String, symbol: String, strong: Bool) {
        switch visit.event {
        case "view": ("Opened the gallery", "eye", false)
        case "download_all": ("Downloaded the photos", "arrow.down.circle", true)
        case "download_video": ("Downloaded a video", "film", true)
        case "invoice_view": ("Opened the invoice", "doc.text", false)
        case "staging_request": ("Asked for staging", "sparkles", true)
        default: (visit.event, "circle", false)
        }
    }

    var body: some View {
        let info = info
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: info.symbol)
                .font(.callout)
                .foregroundStyle(info.strong ? Theme.emerald : Theme.tertiaryText)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(visit.address?.nilIfBlank ?? "No address")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text(info.title)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                Text(sub)
                    .font(.caption2)
                    .foregroundStyle(Theme.tertiaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if info.strong {
                BadgeChip(text: visit.event == "staging_request" ? "Request" : "Download", tint: Theme.emerald)
            }
        }
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    /// "Roxanne Wergeland · Oct 24, 2:34 PM · Portland, OR".
    private var sub: String {
        [visit.contactName?.nilIfBlank, PortfolioFormat.when(visit.at), visit.location?.nilIfBlank]
            .compactMap { $0 }
            .joined(separator: " \u{00B7} ")
    }
}

/// One thing that happened on a portfolio link, laid out like a row of the
/// Messages tab's history: icon, who, what, when, and a badge for the
/// ones that matter.
private struct PortfolioEventRow: View {
    let event: PortfolioOverview.Event

    private var info: (title: String, symbol: String, strong: Bool) {
        switch event.event {
        case "visit": ("Opened the page", "eye", false)
        case "save_contact": ("Saved your contact", "person.crop.circle.badge.plus", true)
        case "book_shoot": ("Tapped Book a shoot", "message", true)
        case "sound_on": ("Turned the sound on", "speaker.wave.2", false)
        case "sound_off": ("Turned the sound off", "speaker.slash", false)
        case "reviews": ("Opened your reviews", "star", false)
        default: (event.event, "circle", false)
        }
    }

    var body: some View {
        let info = info
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: info.symbol)
                .font(.callout)
                .foregroundStyle(info.strong ? Theme.emerald : Theme.tertiaryText)
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 2) {
                Text(event.agentName?.nilIfBlank ?? "No agent attached")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text(info.title)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                Text(sub)
                    .font(.caption2)
                    .foregroundStyle(Theme.tertiaryText)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if info.strong {
                BadgeChip(text: event.event == "book_shoot" ? "Book" : "Saved", tint: Theme.emerald)
            }
        }
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// "Oct 24, 2:34 PM · 2s on page · scrolled 13%" for a visit, else when and where.
    private var sub: String {
        var parts = [PortfolioFormat.when(event.at)]
        if event.event == "visit" {
            if let seconds = event.activeSeconds { parts.append("\(PortfolioFormat.duration(seconds)) on page") }
            if let scroll = event.maxScrollPct { parts.append("scrolled \(scroll)%") }
        } else if let detail = event.detail?.nilIfBlank {
            parts.append(detail)
        }
        return parts.joined(separator: " \u{00B7} ")
    }
}

/// A rounded progress bar; the fill turns green once the target is met.
private struct ProgressBar: View {
    let fraction: Double
    var met = false
    var height: CGFloat = 6

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.cardRaised)
                Capsule()
                    .fill(met ? Theme.emerald : Theme.sky)
                    .frame(width: max(height, proxy.size.width * min(1, max(0, fraction))))
            }
        }
        .frame(height: height)
    }
}

/// "Texts this week   103 of 163" over a bar; a check once it's met.
private struct QuotaRow: View {
    let label: String
    let done: Int
    let target: Int

    var body: some View {
        let met = done >= target
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                Spacer()
                if met {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(Theme.emerald)
                }
                Text("\(done) of \(target)")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Theme.primaryText)
            }
            ProgressBar(fraction: target > 0 ? Double(done) / Double(target) : 1, met: met)
        }
    }
}

/// One stage of the funnel: the rate, what it's of, and a bar showing it.
private struct FunnelStep: View {
    let label: String
    let value: String
    let sub: String
    let rate: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
            Text(value)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.primaryText)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            // The first step is a count, not a rate: no bar, same spacing.
            ProgressBar(fraction: rate ?? 0, height: 4)
                .opacity(rate == nil ? 0 : 1)
            Text(sub)
                .font(.caption2)
                .foregroundStyle(Theme.tertiaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Real profit by month, one hue, the latest month labelled.
private struct ProfitBars: View {
    let months: [FinanceOverview.Month]

    var body: some View {
        Chart(months) { m in
            BarMark(
                x: .value("Month", FinanceFormat.shortMonth(m.month)),
                y: .value("Profit", m.profit),
                width: .ratio(0.55)
            )
            .foregroundStyle(m.id == months.last?.id ? Theme.sky : Theme.sky.opacity(0.45))
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            .annotation(position: m.profit < 0 ? .bottom : .top, spacing: 2) {
                if m.id == months.last?.id {
                    Text(FinanceFormat.dollars(m.profit))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Theme.primaryText)
                }
            }
        }
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks { _ in
                AxisValueLabel()
                    .font(.caption2)
                    .foregroundStyle(Theme.tertiaryText)
            }
        }
        .accessibilityLabel("Real profit for the last \(months.count) months")
    }
}

#endif

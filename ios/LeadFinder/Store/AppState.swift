import Foundation
import Observation

/// One cached-then-refreshed endpoint, shared by all four tabs.
///
/// The point of the class: the cached copy is published before the network is
/// touched, so the first frame renders from disk and the refresh lands
/// afterwards. Callers never wait on the network to see data.
@MainActor
@Observable
final class Resource<Value: Decodable & Sendable> {
    private(set) var value: Value?
    private(set) var fetchedAt: Date?
    private(set) var isRefreshing = false
    private(set) var error: String?

    private let client: APIClient
    private let path: String
    private let key: CacheKey
    private var hasLoaded = false

    /// Fired every time a load sets `value`, cached copy or network answer, so
    /// whoever owns the resource can follow what the server sent without
    /// polling. AppState uses it to keep the market list current.
    var onValueLoaded: ((Value) -> Void)?

    init(client: APIClient = .shared, path: String, key: CacheKey) {
        self.client = client
        self.path = path
        self.key = key
    }

    var hasValue: Bool { value != nil }

    /// Cached-then-network. Safe to call from `.task` on every appear; the
    /// `hasLoaded` guard keeps a tab switch from refetching.
    func load(force: Bool = false) async {
        if hasLoaded, !force {
            // Still refresh if what we have is old enough to be misleading.
            let fresh = try? await client.cached(path, key: key, as: Value.self)
            if let fresh, Date().timeIntervalSince(fresh.fetchedAt) < 120 { return }
        }
        hasLoaded = true

        if let cached = try? await client.cached(path, key: key, as: Value.self) {
            value = cached.value
            fetchedAt = cached.fetchedAt
            onValueLoaded?(cached.value)
        }

        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let fetched = try await client.refresh(path, key: key, as: Value.self)
            value = fetched.value
            fetchedAt = fetched.fetchedAt
            error = nil
            onValueLoaded?(fetched.value)
        } catch let apiError as APIError {
            error = apiError.errorDescription
        } catch is CancellationError {
            // The screen that asked went away (a tab switch, a push); not a failure.
            hasLoaded = false
        } catch let urlError as URLError where urlError.code == .cancelled {
            hasLoaded = false
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Deletes the cached copies and reloads. Wired to pull-to-refresh in
/// Settings-style screens later; useful now for testing.
@MainActor
@Observable
final class AppState {
    /// The Leads tab, one board per market, each cached on its own so switching
    /// markets is instant. Markets live in the server's database now, so the
    /// boards aren't a fixed list: one is made the first time its market is
    /// asked for. `leads` is whichever one is picked; the pick survives
    /// relaunches.
    private var leadResources: [String: Resource<LeadsResponse>] = [:]

    /// The market list the server last sent, from whichever board loaded last,
    /// so views can draw the picker's tabs without knowing the markets in code.
    private(set) var leadMarkets: [LeadsResponse.Market] = []

    var leadsMarket: String = UserDefaults.standard.string(forKey: "leadsMarket") ?? "local" {
        didSet { UserDefaults.standard.set(leadsMarket, forKey: "leadsMarket") }
    }

    /// The board for one market, created on first use. The key is the server's
    /// slug ("central_coast"), so it's percent-encoded into the query.
    func leadsResource(for marketKey: String) -> Resource<LeadsResponse> {
        if let existing = leadResources[marketKey] { return existing }
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.~")
        let encoded = marketKey.addingPercentEncoding(withAllowedCharacters: allowed) ?? marketKey
        let resource = Resource<LeadsResponse>(
            path: "api/app/v1/leads?market=\(encoded)",
            key: .leadsMarket(marketKey)
        )
        // Every market's response carries the whole market list, so the last
        // board to land keeps `leadMarkets` current as markets are added or
        // paused on the web.
        resource.onValueLoaded = { [weak self] response in
            guard let markets = response.markets, !markets.isEmpty else { return }
            self?.leadMarkets = markets
        }
        leadResources[marketKey] = resource
        return resource
    }

    /// Loads the markets not on screen (cached first, then the network), so a
    /// tab switch has cards to show immediately.
    func preloadLeadMarkets() async {
        // The server's list once any board has loaded one; before that, the two
        // markets every server has had.
        let keys = leadMarkets.isEmpty ? ["local", "regional"] : leadMarkets.map(\.key)
        for key in keys where key != leadsMarket {
            await leadsResource(for: key).load()
        }
    }

    var leads: Resource<LeadsResponse> { leadsResource(for: leadsMarket) }
    let followUp = Resource<FollowUpResponse>(path: "api/app/v1/follow-up", key: .followUp)
    let schedule = Resource<ScheduleResponse>(path: "api/app/v1/schedule", key: .schedule)
    let bookings = Resource<BookingsResponse>(path: "api/app/v1/bookings", key: .bookings)
    let agents = Resource<AgentsResponse>(path: "api/app/v1/agents", key: .agents)
    let messages = Resource<MessagesResponse>(path: "api/app/v1/messages", key: .messages)

    let galleryVisits = Resource<GalleryVisitsResponse>(path: "api/app/v1/bookings/gallery-visits", key: .galleryVisits)
    let portfolioOverview = Resource<PortfolioOverview>(path: "api/app/v1/portfolio-links/overview", key: .portfolioOverview)

    // Finances: the Overview also feeds Home's money numbers.
    let finances = Resource<FinanceOverview>(path: "api/app/v1/finances", key: .finances)
    let financeJobs = Resource<FinanceJobsReport>(path: "api/app/v1/finances/jobs", key: .financeJobs)
    let financeTrips = Resource<MileageReport>(path: "api/app/v1/finances/trips", key: .financeTrips)
    let financeExpenses = Resource<ExpensesResponse>(path: "api/app/v1/finances/expenses", key: .financeExpenses)
    let financeTaxes = Resource<TaxReport>(path: "api/app/v1/finances/taxes", key: .financeTaxes)
    let financeLinkOptions = Resource<FinanceLinkOptions>(path: "api/app/v1/finances/link-options", key: .financeLinkOptions)
    let profitFirst = Resource<ProfitFirstReport>(path: "api/app/v1/finances/profit-first", key: .profitFirst)
    let shooterSummary = Resource<ShooterSummary>(path: "api/app/v1/finances/shooters", key: .shooterSummary)

    init() {}

    func warmCache() async {
        // Pull everything once at launch so tab switches are instant and the
        // two big payloads are already decoded when their tab opens.
        AppNotifications.configure()
        // Small, and what the reminder and booking alerts are built from, so
        // they're current even if the Schedule tab is never opened.
        await schedule.load()
        await bookings.load()
        await syncNotifications()

        await leads.load()
        #if os(iOS)
        await CallerIDSync.syncIfChanged()
        #endif
    }

    /// After a trip or an expense is saved: every report it moves (a trip
    /// changes gas, profit, per hour, deductions and the tax estimate) and the
    /// bookings, whose `costs` carry it too.
    func reloadFinances() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.finances.load(force: true) }
            group.addTask { await self.financeJobs.load(force: true) }
            group.addTask { await self.financeTrips.load(force: true) }
            group.addTask { await self.financeExpenses.load(force: true) }
            group.addTask { await self.financeTaxes.load(force: true) }
            group.addTask { await self.financeLinkOptions.load(force: true) }
            group.addTask { await self.profitFirst.load(force: true) }
            group.addTask { await self.shooterSummary.load(force: true) }
            group.addTask { await self.bookings.load(force: true) }
        }
    }

    /// Rebuilds the reminder and booking alerts from what's loaded now. Called
    /// at launch and again whenever either list reloads (an edit, a tick, a
    /// pull to refresh).
    func syncNotifications() async {
        await AppNotifications.sync(schedule: schedule.value, bookings: bookings.value)
    }
}
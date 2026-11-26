import Foundation

/// Cache keys. One per endpoint, so a stale `/schedule` never invalidates Leads.
///
/// Leads is the exception: markets live in the database, so the server decides
/// how many boards there are. Each market gets its key made on demand,
/// `leadsMarket(key)`, instead of a case per market.
enum CacheKey: Hashable {
    /// One market's Leads board. `.leadsMarket("local")` is the old `.leads`.
    case leadsMarket(String)
    case followUp
    case schedule
    case bookings
    case agents
    case callerID
    case messages
    case finances
    case galleryVisits
    case portfolioOverview
    case financeJobs
    case financeTrips
    case financeExpenses
    case financeTaxes
    case financeLinkOptions
    case profitFirst
    case shooterSummary

    /// The file stem, so a key's cache survives as long as its name does.
    ///
    /// The fixed names are unchanged from the raw values this enum used to
    /// have, and the first markets keep theirs ("leads", "leads-regional", …)
    /// so caches written before markets moved into the database still load.
    var fileName: String {
        switch self {
        case .leadsMarket(let key):
            switch key {
            case "local": "leads"
            case "regional": "leads-regional"
            case "portland": "leads-portland"
            case "central_coast": "leads-central-coast"
            default: "leads-" + key.replacingOccurrences(of: "_", with: "-")
            }
        case .followUp: "follow-up"
        case .schedule: "schedule"
        case .bookings: "bookings"
        case .agents: "agents"
        case .callerID: "caller-id"
        case .messages: "messages"
        case .finances: "finances"
        case .galleryVisits: "gallery-visits"
        case .portfolioOverview: "portfolio-overview"
        case .financeJobs: "finance-jobs"
        case .financeTrips: "finance-trips"
        case .financeExpenses: "finance-expenses"
        case .financeTaxes: "finance-taxes"
        case .financeLinkOptions: "finance-link-options"
        case .profitFirst: "profit-first"
        case .shooterSummary: "shooter-summary"
        }
    }

    /// The endpoints whose key never varies. Per-market Leads boards are made
    /// on demand, so eviction finds them among the files on disk instead.
    static let fixed: [CacheKey] = [
        .followUp, .schedule, .bookings, .agents, .callerID, .messages, .finances,
        .galleryVisits, .portfolioOverview, .financeJobs, .financeTrips,
        .financeExpenses, .financeTaxes, .financeLinkOptions, .profitFirst,
        .shooterSummary,
    ]
}

/// Offline-first store: every screen renders the last cached JSON immediately,
/// then refreshes. That is the main speed fix — `/leads` is ~1 MB and
/// `/agents` ~2.5 MB gzipped, far too slow to block the first frame on.
///
/// Application Support rather than Caches: we manage eviction ourselves (by
/// age) and don't want iOS to purge the directory out from under us.
actor CacheStore {
    struct Entry: Sendable {
        let data: Data
        let etag: String?
        let fetchedAt: Date
    }

    private struct Meta: Codable, Sendable {
        var fetchedAt: Date
        var etag: String?
    }

    private let directory: URL
    private var memory: [CacheKey: Entry] = [:]
    private let maxAge: TimeInterval = 14 * 24 * 60 * 60

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        directory = base.appendingPathComponent("LeadFinder", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private func fileURL(for key: CacheKey, ext: String) -> URL {
        directory.appendingPathComponent("\(key.fileName).\(ext)")
    }

    /// Every cache on this device: the fixed endpoints plus one key per Leads
    /// market file, which is how markets the server has since dropped (paused
    /// or killed) still get swept.
    private func keysOnDisk() -> [CacheKey] {
        var keys = CacheKey.fixed
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for name in names where name.hasSuffix(".json") {
            let stem = String(name.dropLast(".json".count))
            if stem == "leads" {
                keys.append(.leadsMarket("local"))
            } else if stem.hasPrefix("leads-") {
                keys.append(.leadsMarket(String(stem.dropFirst("leads-".count))))
            }
        }
        return keys
    }

    func entry(for key: CacheKey) -> Entry? {
        if let cached = memory[key] { return cached }
        guard let data = try? Data(contentsOf: fileURL(for: key, ext: "json")),
              let metaData = try? Data(contentsOf: fileURL(for: key, ext: "meta")),
              let meta = try? JSONDecoder().decode(Meta.self, from: metaData)
        else { return nil }

        let entry = Entry(data: data, etag: meta.etag, fetchedAt: meta.fetchedAt)
        memory[key] = entry
        return entry
    }

    func write(_ data: Data, etag: String?, for key: CacheKey) {
        let now = Date()
        let meta = Meta(fetchedAt: now, etag: etag)
        guard let metaData = try? JSONEncoder().encode(meta) else { return }
        try? data.write(to: fileURL(for: key, ext: "json"), options: .atomic)
        try? metaData.write(to: fileURL(for: key, ext: "meta"), options: .atomic)
        memory[key] = Entry(data: data, etag: etag, fetchedAt: now)
    }

    func isStale(_ key: CacheKey, after interval: TimeInterval) -> Bool {
        guard let entry = entry(for: key) else { return true }
        return Date().timeIntervalSince(entry.fetchedAt) > interval
    }

    /// Keeps the cache from growing without bound on a phone that never
    /// reinstalls for months.
    func purgeExpired() {
        for key in keysOnDisk() {
            if let entry = entry(for: key), Date().timeIntervalSince(entry.fetchedAt) > maxAge {
                try? FileManager.default.removeItem(at: fileURL(for: key, ext: "json"))
                try? FileManager.default.removeItem(at: fileURL(for: key, ext: "meta"))
                memory[key] = nil
            }
        }
    }

    func clear() {
        for key in keysOnDisk() {
            try? FileManager.default.removeItem(at: fileURL(for: key, ext: "json"))
            try? FileManager.default.removeItem(at: fileURL(for: key, ext: "meta"))
        }
        memory.removeAll()
    }
}
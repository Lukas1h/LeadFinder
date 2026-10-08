import Foundation

/// Cache keys. One per endpoint, so a stale `/schedule` never invalidates Leads.
enum CacheKey: String, CaseIterable {
    case leads
    case followUp = "follow-up"
    case schedule
    case bookings
    case agents
    case callerID = "caller-id"
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
        directory.appendingPathComponent("\(key.rawValue).\(ext)")
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
        for key in CacheKey.allCases {
            if let entry = entry(for: key), Date().timeIntervalSince(entry.fetchedAt) > maxAge {
                try? FileManager.default.removeItem(at: fileURL(for: key, ext: "json"))
                try? FileManager.default.removeItem(at: fileURL(for: key, ext: "meta"))
                memory[key] = nil
            }
        }
    }

    func clear() {
        for key in CacheKey.allCases {
            try? FileManager.default.removeItem(at: fileURL(for: key, ext: "json"))
            try? FileManager.default.removeItem(at: fileURL(for: key, ext: "meta"))
        }
        memory.removeAll()
    }
}
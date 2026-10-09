import Foundation

/// The contact sheet's templates, fetched before the sheet opens.
///
/// Each lead card asks for its listing's options as it scrolls into view, so
/// tapping Contact shows the message straight away instead of a spinner. One
/// request per listing however often it's asked; entries go stale after a few
/// minutes because the server's recommendation depends on contact history.
@MainActor
final class MessageOptionsCache {
    static let shared = MessageOptionsCache()

    private struct Entry {
        let options: [MessageOption]
        let fetchedAt: Date
    }

    private var entries: [String: Entry] = [:]
    private var inFlight: [String: Task<[MessageOption], Error>] = [:]
    private let maxAge: TimeInterval = 10 * 60

    private func key(_ listingId: String, _ type: String) -> String { "\(listingId)|\(type)" }

    /// What's already here, for the sheet's first frame.
    func cached(listingId: String, type: String) -> [MessageOption]? {
        guard let entry = entries[key(listingId, type)],
              Date().timeIntervalSince(entry.fetchedAt) < maxAge
        else { return nil }
        return entry.options
    }

    func options(listingId: String, type: String) async throws -> [MessageOption] {
        if let hit = cached(listingId: listingId, type: type) { return hit }
        let key = key(listingId, type)
        if let task = inFlight[key] { return try await task.value }

        let task = Task {
            try await APIClient.shared.messageOptions(listingId: listingId, type: type).presets
        }
        inFlight[key] = task
        defer { inFlight[key] = nil }
        let options = try await task.value
        entries[key] = Entry(options: options, fetchedAt: Date())
        return options
    }

    func prefetch(listingId: String, type: String) {
        guard cached(listingId: listingId, type: type) == nil else { return }
        Task(priority: .utility) { _ = try? await options(listingId: listingId, type: type) }
    }

    /// After a text goes out the recommendation changes, so don't reuse it.
    func forget(listingId: String) {
        entries = entries.filter { !$0.key.hasPrefix("\(listingId)|") }
    }
}

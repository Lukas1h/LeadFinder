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
        }

        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let fetched = try await client.refresh(path, key: key, as: Value.self)
            value = fetched.value
            fetchedAt = fetched.fetchedAt
            error = nil
        } catch let apiError as APIError {
            error = apiError.errorDescription
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
    let leads = Resource<LeadsResponse>(path: "api/app/v1/leads", key: .leads)
    let followUp = Resource<FollowUpResponse>(path: "api/app/v1/follow-up", key: .followUp)
    let schedule = Resource<ScheduleResponse>(path: "api/app/v1/schedule", key: .schedule)
    let bookings = Resource<BookingsResponse>(path: "api/app/v1/bookings", key: .bookings)
    let agents = Resource<AgentsResponse>(path: "api/app/v1/agents", key: .agents)
    let messages = Resource<MessagesResponse>(path: "api/app/v1/messages", key: .messages)

    init() {}

    func warmCache() async {
        // Pull everything once at launch so tab switches are instant and the
        // two big payloads are already decoded when their tab opens.
        await leads.load()
        await CallerIDSync.syncIfChanged()
    }
}
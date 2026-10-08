import Foundation

/// Result of one refresh: where the bytes came from, and how fresh they are.
struct Fetched<T: Sendable>: Sendable {
    let value: T
    let fetchedAt: Date
    let fromNetwork: Bool
}

actor APIClient {
    static let shared = APIClient()

    private let cache: CacheStore
    private let session: URLSession
    private let decoder = JSONDecoder()

    init(cache: CacheStore = CacheStore()) {
        self.cache = cache

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        // The plan's whole premise: cached JSON first, refresh in the background.
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.waitsForConnectivity = true
        session = URLSession(configuration: config)
    }

    // MARK: - Reads

    /// Cached-then-network read. Returns the cache immediately when it has
    /// something, so a screen can paint without waiting for the network; a
    /// background refresh overwrites it when it lands.
    func cached<T: Decodable & Sendable>(_ path: String, key: CacheKey, as type: T.Type) async throws -> Fetched<T>? {
        guard let entry = await cache.entry(for: key),
              let value = try? decoder.decode(T.self, from: entry.data)
        else { return nil }
        return Fetched(value: value, fetchedAt: entry.fetchedAt, fromNetwork: false)
    }

    /// Network read with ETag revalidation. A 304 means nothing changed, so the
    /// cached copy stays and its fetch date rolls forward.
    func refresh<T: Decodable & Sendable>(_ path: String, key: CacheKey, as type: T.Type) async throws -> Fetched<T> {
        guard let base = AppConfig.baseURL else { throw APIError.notConfigured }
        guard let secret = AppConfig.apiSecret else { throw APIError.notConfigured }

        var request = URLRequest(url: base.appendingPathComponent(path))
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        // `/agents` is 2.5 MB; the ETag keeps repeat syncs at a few hundred bytes.
        let cachedEtag = await cache.entry(for: key)?.etag
        if let cachedEtag { request.setValue(cachedEtag, forHTTPHeaderField: "If-None-Match") }

        let (data, response) = try await send(request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.http(-1, "No response")
        }

        if http.statusCode == 304, let entry = await cache.entry(for: key),
           let value = try? decoder.decode(T.self, from: entry.data) {
            return Fetched(value: value, fetchedAt: Date(), fromNetwork: true)
        }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, message(from: data))
        }

        do {
            let value = try decoder.decode(T.self, from: data)
            await cache.write(data, etag: http.value(forHTTPHeaderField: "ETag"), for: key)
            return Fetched(value: value, fetchedAt: Date(), fromNetwork: true)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    private func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let error as URLError where error.code == .notConnectedToInternet {
            throw APIError.http(0, "No connection")
        }
    }

    private func message(from data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let error = object["error"] as? String
        else { return nil }
        return error
    }

    // MARK: - Writes (Phases 3+)

    /// A single listing with its full photo set, used by the lead detail screen
    /// where the list endpoints' five-photo sample isn't enough.
    ///
    /// Deliberately not cached: it's one small read behind a screen the user
    /// opened deliberately, and caching it would mean a disk entry per listing
    /// the app has ever looked at.
    func listingDetail(_ id: String) async throws -> ListingDetailResponse {
        guard let base = AppConfig.baseURL else { throw APIError.notConfigured }
        guard let secret = AppConfig.apiSecret else { throw APIError.notConfigured }

        var request = URLRequest(url: base.appendingPathComponent("api/app/v1/listings/\(id)"))
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await send(request)
        guard let http = response as? HTTPURLResponse else { throw APIError.http(-1, "No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, message(from: data))
        }
        do {
            return try decoder.decode(ListingDetailResponse.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    /// POST/PATCH/PUT/DELETE. Nothing in Phase 2 sends a text or an email; the
    /// write endpoints used later are the ones in docs/ios-backend-spec.md B5.
    func send<Body: Encodable & Sendable, T: Decodable & Sendable>(
        _ method: String,
        _ path: String,
        body: Body?,
        as type: T.Type
    ) async throws -> T {
        guard let base = AppConfig.baseURL else { throw APIError.notConfigured }
        guard let secret = AppConfig.apiSecret else { throw APIError.notConfigured }

        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await send(request)
        guard let http = response as? HTTPURLResponse else { throw APIError.http(-1, "No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, message(from: data))
        }
        return try decoder.decode(T.self, from: data)
    }
}
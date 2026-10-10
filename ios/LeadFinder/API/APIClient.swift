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

        /// One agent with their timeline, open listings and bookings — what the
    /// agent detail screen shows.
    func agentDetail(_ id: String) async throws -> AgentDetailResponse {
        try await read("api/app/v1/agents/\(id)")
    }

    /// One message in full: the text as it reads for this agent and listing.
    func messageDetail(_ id: String) async throws -> MessageDetailResponse {
        try await read("api/app/v1/messages/\(id)")
    }

    // MARK: - Writes

    // MARK: - Contacting a lead

    /// The presets the web's send dialog offers for this listing, plus the
    /// "AI Draft" placeholder that POST /listings/:id/ai-draft fills in.
    func messageOptions(listingId: String, type: String) async throws -> MessageOptionsResponse {
        try await read(
            "api/app/v1/listings/\(listingId)/message-options",
            query: [URLQueryItem(name: "type", value: type)]
        )
    }

    /// Asks Gemini for a one-off message for this listing.
    /// The server answers `{ option }`, the drafted AI preset.
    func aiDraft(listingId: String, type: String, instruction: String?) async throws -> MessageOption {
        struct Body: Encodable, Sendable {
            let type: String
            let instruction: String?
        }
        struct Response: Decodable, Sendable { let option: MessageOption }
        return try await send(
            "POST",
            "api/app/v1/listings/\(listingId)/ai-draft",
            body: Body(type: type, instruction: instruction),
            as: Response.self
        ).option
    }

    /// Records that the text went out. Called **only** when the Messages sheet
    /// reports `.sent` — the native composer reports back, so unlike the web
    /// there is no "did you send it?" prompt to answer afterwards.
    func confirmTextSent(listingId: String, type: String, presetId: String, variantId: String, text: String) async throws {
        struct Body: Encodable, Sendable {
            let type: String
            let presetId: String
            let variantId: String
            let text: String
        }
        struct OK: Decodable, Sendable { let ok: Bool }
        _ = try await send(
            "POST",
            "api/app/v1/listings/\(listingId)/texts",
            body: Body(type: type, presetId: presetId, variantId: variantId, text: text),
            as: OK.self
        )
    }

    /// Records a text sent to an agent directly, with no listing behind it.
    /// Called only when the Messages sheet reports `.sent`.
    func confirmAgentTextSent(agentId: String) async throws {
        struct Body: Encodable, Sendable {}
        struct OK: Decodable, Sendable { let ok: Bool }
        _ = try await send("POST", "api/app/v1/agents/\(agentId)/texts", body: Body(), as: OK.self)
    }

    /// Logs a call, text or email that happened outside the app — the web's
    /// Add interaction dialog.
    func logInteraction(
        agentId: String,
        channel: String,
        direction: String,
        outcome: String?,
        note: String?,
        occurredAt: Date
    ) async throws {
        struct Body: Encodable, Sendable {
            let channel: String
            let direction: String
            let outcome: String?
            let note: String?
            let occurredAt: String
        }
        struct OK: Decodable, Sendable { let ok: Bool }
        _ = try await send(
            "POST",
            "api/app/v1/agents/\(agentId)/interactions",
            body: Body(
                channel: channel,
                direction: direction,
                outcome: outcome,
                note: note,
                occurredAt: occurredAt.formatted(.iso8601)
            ),
            as: OK.self
        )
    }

    /// Save or Pass. Pass takes every listing in the group so dropping a card
    /// drops the whole agent group, as the web's "Pass all N" does.
    func setListingStatus(listingIds: [String], status: String) async throws {
        struct Body: Encodable, Sendable {
            let listingIds: [String]
            let status: String
        }
        struct OK: Decodable, Sendable { let ok: Bool }
        _ = try await send("POST", "api/app/v1/listings/status", body: Body(listingIds: listingIds, status: status), as: OK.self)
    }

    /// Records how a message went: "keep_in_touch" or "declined". This is the
    /// web's `markSendReply`, which writes an interaction and moves the agent's
    /// and listing's status. **It sends nothing** — the two send paths on the web
    /// (Send samples, Compose) are deliberately not exposed to the phone.
    func recordMessageReply(id: String, outcome: String) async throws {
        struct Body: Encodable, Sendable { let outcome: String }
        struct OK: Decodable, Sendable { let ok: Bool }
        _ = try await send("POST", "api/app/v1/messages/\(id)/reply", body: Body(outcome: outcome), as: OK.self)
    }

    // MARK: - Phase 3+ writes

    /// A single listing with its full photo set, used by the lead detail screen
    /// where the list endpoints' five-photo sample isn't enough.
    func listingDetail(_ id: String) async throws -> ListingDetailResponse {
        try await read("api/app/v1/listings/\(id)")
    }

    /// A plain GET with no cache. For one-off reads behind a screen the user
    /// opened deliberately — caching these would mean a disk entry per listing
    /// or per message the app has ever looked at.
    private func read<T: Decodable & Sendable>(_ path: String) async throws -> T {
        try await read(path, query: [])
    }

    /// `URL.appendingPathComponent` percent-encodes a "?", so a query string has
    /// to be attached as a real query — otherwise "?type=initial_outreach" ends
    /// up as part of the path and the route 404s.
    private func read<T: Decodable & Sendable>(_ path: String, query: [URLQueryItem]) async throws -> T {
        let request = try await authorizedRequest(path, query: query)
        let (data, response) = try await send(request)

        guard let http = response as? HTTPURLResponse else { throw APIError.http(-1, "No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, message(from: data))
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    private func authorizedRequest(_ path: String, query: [URLQueryItem] = []) async throws -> URLRequest {
        guard let base = AppConfig.baseURL else { throw APIError.notConfigured }
        guard let secret = AppConfig.apiSecret else { throw APIError.notConfigured }

        let url = query.isEmpty
            ? base.appendingPathComponent(path)
            : base.appendingPathComponent(path).appending(queryItems: query)

        var request = URLRequest(url: url)
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
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
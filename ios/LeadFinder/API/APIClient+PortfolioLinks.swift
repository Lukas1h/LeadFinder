import Foundation

// The portfolio-link endpoints (src/app/api/app/v1/portfolio-links). Making or
// saving a link only writes the link: nothing here contacts an agent.

extension APIClient {
    private struct OK: Decodable, Sendable { let ok: Bool }

    /// What create and save answer: the link's slug and its public URL.
    struct SavedPortfolioLink: Decodable, Sendable {
        /// Missing from an older server.
        let id: String?
        let slug: String
        let url: String
    }

    // MARK: - Reads

    func portfolioLinks() async throws -> [PortfolioLinkSummary] {
        let response: PortfolioLinksResponse = try await read("api/app/v1/portfolio-links")
        return response.links
    }

    func portfolioActivity(_ id: String) async throws -> PortfolioActivity {
        let response: PortfolioActivityResponse = try await read("api/app/v1/portfolio-links/\(id)")
        return response.activity
    }

    func portfolioLinkForEdit(_ id: String) async throws -> PortfolioEditResponse {
        try await read("api/app/v1/portfolio-links/\(id)/edit")
    }

    /// What the builder fills in when an agent is picked.
    func portfolioPrefill(agentId: String) async throws -> PortfolioPrefill {
        try await read("api/app/v1/portfolio-links/prefill", query: [URLQueryItem(name: "agent", value: agentId)])
    }

    func portfolioCatalog() async throws -> PortfolioCatalog {
        try await read("api/app/v1/portfolio-links/catalog")
    }

    func searchPortfolioAgents(_ query: String) async throws -> [PortfolioAgentMatch] {
        struct Response: Decodable, Sendable { let agents: [PortfolioAgentMatch] }
        let response: Response = try await read("api/app/v1/portfolio-links/agents", query: [URLQueryItem(name: "q", value: query)])
        return response.agents
    }

    /// Finished jobs with a gallery, matched on address or city.
    func searchPortfolioJobs(_ query: String) async throws -> [PortfolioListing] {
        struct Response: Decodable, Sendable { let listings: [PortfolioListing] }
        let response: Response = try await read("api/app/v1/portfolio-links/jobs", query: [URLQueryItem(name: "q", value: query)])
        return response.listings
    }

    /// Every photo of every listing of theirs on file, grouped by listing.
    func portfolioListingPhotos(agentId: String) async throws -> [PortfolioListingPhotosResponse.Group] {
        let response: PortfolioListingPhotosResponse = try await read(
            "api/app/v1/portfolio-links/listing-photos",
            query: [URLQueryItem(name: "agent", value: agentId)]
        )
        return response.groups
    }

    /// The two "Portfolio link" texts for a link's agent, in order: the
    /// template body, then its second message with the link. No side effects.
    struct PortfolioLinkTexts: Decodable, Sendable {
        let first: String
        let second: String?
        let phone: String
    }

    func portfolioLinkTexts(linkId: String) async throws -> PortfolioLinkTexts {
        try await read("api/app/v1/portfolio-links/\(linkId)/text")
    }

    // MARK: - Writes

    /// Records the "Portfolio link" texts as sent (message history, their last message replied). Sends nothing.
    func recordPortfolioLinkText(linkId: String) async throws {
        struct Empty: Encodable, Sendable {}
        struct OK: Decodable, Sendable { let ok: Bool }
        _ = try await send("POST", "api/app/v1/portfolio-links/\(linkId)/text", body: Empty(), as: OK.self)
    }

    private struct LinkBody: Encodable, Sendable {
        let agentId: String?
        let content: PortfolioContent
    }

    func createPortfolioLink(agentId: String?, content: PortfolioContent) async throws -> SavedPortfolioLink {
        try await send("POST", "api/app/v1/portfolio-links", body: LinkBody(agentId: agentId, content: content), as: SavedPortfolioLink.self)
    }

    /// Saves in place: same URL, same activity.
    func updatePortfolioLink(id: String, agentId: String?, content: PortfolioContent) async throws -> SavedPortfolioLink {
        try await send("PATCH", "api/app/v1/portfolio-links/\(id)", body: LinkBody(agentId: agentId, content: content), as: SavedPortfolioLink.self)
    }

    /// A before/after photo from the phone. `jpeg` is already shrunk (about
    /// 2400px); the answer is the stored path, "/api/portfolio-image/<id>".
    func uploadPortfolioImage(jpeg: Data) async throws -> String {
        struct Result: Decodable, Sendable { let url: String }
        let boundary = "lf-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"photo.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".utf8))
        body.append(jpeg)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        var request = try await authorizedRequest("api/app/v1/portfolio-links/images")
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 60
        let bytes = try await checked(request)
        do {
            return try decoder.decode(Result.self, from: bytes).url
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    /// The photo editor's "Use as before/after". Each side is a data: URL or a
    /// listing photo URL; the answer is the stored paths for the builder.
    func saveBeforeAfter(before: String, after: String) async throws -> (beforeSrc: String, afterSrc: String) {
        struct Body: Encodable, Sendable {
            let before: String
            let after: String
        }
        struct Result: Decodable, Sendable {
            let beforeSrc: String
            let afterSrc: String
        }
        let result = try await send("POST", "api/app/v1/portfolio-links/before-after", body: Body(before: before, after: after), as: Result.self)
        return (result.beforeSrc, result.afterSrc)
    }
}

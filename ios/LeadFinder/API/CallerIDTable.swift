import Foundation

/// `GET /api/app/v1/caller-id`: `{ version, entries: [[number, label], …] }`.
/// Compiled into both the app and the caller ID extension.
struct CallerIDTable: Decodable, Sendable {
    let version: String
    let entries: [(Int64, String)]

    private enum CodingKeys: String, CodingKey { case version, entries }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decode(String.self, forKey: .version)
        var list = try c.nestedUnkeyedContainer(forKey: .entries)
        var entries: [(Int64, String)] = []
        while !list.isAtEnd {
            var pair = try list.nestedUnkeyedContainer()
            entries.append((try pair.decode(Int64.self), try pair.decode(String.self)))
        }
        self.entries = entries
    }

    enum Failure: Error { case notConfigured, http(Int) }

    static func download() async throws -> CallerIDTable {
        guard let base = AppConfig.baseURL, let secret = AppConfig.apiSecret else { throw Failure.notConfigured }
        var request = URLRequest(url: base.appendingPathComponent("api/app/v1/caller-id"))
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else { throw Failure.http(status) }
        return try JSONDecoder().decode(CallerIDTable.self, from: data)
    }
}

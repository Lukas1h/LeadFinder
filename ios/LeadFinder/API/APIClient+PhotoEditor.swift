import Foundation

/// The photo editor's three endpoints (see src/app/api/app/v1/photo-editor):
/// the presets, a listing search, and one photo edited per call.
extension APIClient {
    struct PhotoPreset: Decodable, Sendable, Identifiable, Hashable {
        let id: String
        let label: String
        let description: String
    }

    struct EditorListing: Decodable, Sendable, Identifiable, Hashable {
        let id: String
        let address: String?
        let city: String?
        let agentName: String?
        let score: Int?
        let thumb: String?
    }

    /// Where a photo to edit comes from: a listing photo the server fetches
    /// itself, or one picked from the phone, sent as JPEG.
    enum EditSource: Sendable {
        case url(String)
        case jpeg(Data)
    }

    /// Edits take 10–25 seconds, and Gemini sometimes asks the server to wait
    /// and retry, so these get their own session with a far longer timeout
    /// than the app's 30-second one.
    private static let editSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 180
        config.timeoutIntervalForResource = 240
        return URLSession(configuration: config)
    }()

    func photoPresets() async throws -> [PhotoPreset] {
        struct Response: Decodable, Sendable { let presets: [PhotoPreset] }
        let response: Response = try await read("api/app/v1/photo-editor")
        return response.presets
    }

    func searchEditorListings(_ query: String) async throws -> [EditorListing] {
        struct Response: Decodable, Sendable { let listings: [EditorListing] }
        let response: Response = try await read(
            "api/app/v1/photo-editor/listings",
            query: [URLQueryItem(name: "q", value: query)]
        )
        return response.listings
    }

    /// One photo edited with a preset, or with `prompt` when it's given.
    /// Returns the edited JPEG.
    func editPhoto(_ source: EditSource, presetId: String?, prompt: String?) async throws -> Data {
        struct Body: Encodable, Sendable {
            var url: String?
            var data: String?
            var mimeType: String?
            var presetId: String?
            var prompt: String?
        }
        struct Response: Decodable, Sendable {
            let image: String?
            let error: String?
        }

        var body = Body(presetId: presetId, prompt: prompt)
        switch source {
        case .url(let url):
            body.url = url
        case .jpeg(let data):
            body.data = data.base64EncodedString()
            body.mimeType = "image/jpeg"
        }

        var request = try await authorizedRequest("api/app/v1/photo-editor/edit")
        request.httpMethod = "POST"
        request.httpBody = try JSONEncoder().encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await Self.editSession.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.http(-1, "No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        let decoded = try? decoder.decode(Response.self, from: data)
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, decoded?.error)
        }
        // "data:image/jpeg;base64,…"
        guard let image = decoded?.image,
              let comma = image.firstIndex(of: ","),
              let bytes = Data(base64Encoded: String(image[image.index(after: comma)...]))
        else { throw APIError.decoding("No image in the response") }
        return bytes
    }
}

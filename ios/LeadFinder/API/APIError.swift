import Foundation

enum APIError: LocalizedError {
    case notConfigured
    case unauthorized
    case http(Int, String?)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            "The app isn't configured yet. Copy Config/Secrets.example.xcconfig to Secrets.xcconfig and set MOBILE_API_SECRET."
        case .unauthorized:
            "The API rejected the app's token."
        case let .http(code, message):
            message.map { "Server error \(code): \($0)" } ?? "Server error \(code)."
        case let .decoding(what):
            "The server sent data the app couldn't read (\(what))."
        }
    }

    /// A 401 means the secret in Secrets.xcconfig is stale, which no amount of
    /// retrying fixes, so the UI should offer the setup screen instead.
    var isAuthFailure: Bool {
        if case .unauthorized = self { return true }
        if case let .http(code, _) = self { return code == 401 }
        return false
    }
}
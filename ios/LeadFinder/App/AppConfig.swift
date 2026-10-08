import Foundation

/// Config read from the Info.plist keys that project.yml fills in from
/// `Config/Secrets.xcconfig`. When the secret is missing the app shows a setup
/// screen instead of failing every request, so a fresh clone is still buildable.
enum AppConfig {
    static var baseURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "MOBILE_API_BASE_URL") as? String,
              !raw.isEmpty,
              !raw.contains("$(")  // unexpanded xcconfig value
        else { return nil }
        return URL(string: raw)
    }

    static var apiSecret: String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "MOBILE_API_SECRET") as? String,
              !raw.isEmpty,
              !raw.contains("$(")
        else { return nil }
        return raw
    }

    static var isConfigured: Bool { baseURL != nil && apiSecret != nil }
}
#if os(iOS)

import CallKit
import Foundation

/// Tells iOS to re-run the caller ID extension when the agent table changed.
///
/// The extension downloads the table itself; this only checks the `version`
/// so a launch with nothing new doesn't make iOS rebuild ~6,000 entries.
/// iPhone only — the Call Directory is an iOS feature, so the Mac app has no
/// equivalent to keep in step.
enum CallerIDSync {
    static let extensionID = "art.lukashahn.LeadFinder.CallerID"
    private static let versionKey = "callerIDVersion"

    static func syncIfChanged() async {
        guard let table = try? await CallerIDTable.download() else { return }
        let defaults = UserDefaults.standard
        guard defaults.string(forKey: versionKey) != table.version else { return }
        do {
            try await CXCallDirectoryManager.sharedInstance.reloadExtension(withIdentifier: extensionID)
            defaults.set(table.version, forKey: versionKey)
        } catch {
            // Usually: not switched on yet in Settings › Apps › Phone ›
            // Call Blocking & Identification. Retried next launch.
        }
    }
}

#endif
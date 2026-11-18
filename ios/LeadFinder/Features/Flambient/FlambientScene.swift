#if os(iOS)

import SwiftUI

extension FlambientLink {
    /// Follows the app's scene phase: browse while someone can see the screen,
    /// stop when the phone is put away.
    ///
    /// The Flambient screen calls this from `.onChange(of: scenePhase)` and once
    /// on appear, so the link is live exactly as long as the app is. `.inactive`
    /// (the app switcher, a permission prompt) is deliberately left alone: it
    /// comes and goes too quickly to tear a session down and build it again.
    func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .active:
            start()
        case .background:
            stop()
        case .inactive:
            break
        @unknown default:
            break
        }
    }
}

#endif

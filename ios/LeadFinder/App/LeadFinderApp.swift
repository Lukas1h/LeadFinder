#if os(iOS)

import SwiftUI

/// The iPhone app: four tabs in a `TabView`, one window, portrait only.
///
/// The Mac app's entry point is `Mac/LeadFinderMacApp.swift`. Both compile the
/// same `LeadFinder/` sources, so this file plus `AppTab.swift` is the whole of
/// the iOS-specific shell.
@main
struct LeadFinderApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            Group {
                if AppConfig.isConfigured {
                    RootTabView()
                        .environment(appState)
                        .task { await appState.warmCache() }
                } else {
                    SetupRequiredView(error: nil)
                }
            }
            .preferredColorScheme(.dark)
        }
    }
}

#endif
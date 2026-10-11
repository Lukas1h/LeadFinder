import SwiftUI

/// The Mac app. One resizable window with a sidebar, rather than the iPhone's
/// four tabs — on a Mac the sections are peers you move between, not panes you
/// switch.
///
/// Everything below the shell is the same code the iPhone app runs: the same
/// `APIClient`, the same cached `AppState`, and the same views for a lead, an
/// agent, a message or a job. What's here is only what a Mac needs and a phone
/// doesn't: the split view, the sidebar, the toolbar and the menu bar.
@main
struct LeadFinderMacApp: App {
    /// Held on the app rather than inside the window, because the menu bar's
    /// commands are not in the view hierarchy: they can't read `@Environment`.
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            Group {
                if AppConfig.isConfigured {
                    RootSplitView()
                        .environment(appState)
                        .task { await appState.warmCache() }
                } else {
                    SetupRequiredView(error: nil)
                }
            }
            .frame(minWidth: 900, minHeight: 560)
        }
        .defaultSize(width: 1280, height: 820)
        .commands { MacCommands(appState: appState) }
    }
}

/// Menu bar items. Only what a Mac user expects to find there and would be
/// surprised not to: refresh, and the standard window and help menus.
struct MacCommands: Commands {
    /// Passed in rather than read from the environment — see `LeadFinderMacApp`.
    let appState: AppState

    var body: some Commands {
        // Replaces "New" — there is no document to create; everything here is
        // a view onto the same synced data.
        CommandGroup(replacing: .newItem) {}

        CommandGroup(after: .toolbar) {
            Button("Refresh All") {
                Task { await refreshEverything() }
            }
            .keyboardShortcut("r", modifiers: .command)
        }

        CommandGroup(replacing: .help) {
            Button("LeadFinder on the Web") {
                if let url = URL(string: "https://realestate.lukashahn.art") {
                    Platform.open(url)
                }
            }
        }
    }

    private func refreshEverything() async {
        await appState.leads.load(force: true)
        await appState.schedule.load(force: true)
        await appState.bookings.load(force: true)
        await appState.messages.load(force: true)
        await appState.agents.load(force: true)
        await appState.followUp.load(force: true)
    }
}
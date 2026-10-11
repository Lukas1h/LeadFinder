import SwiftUI

/// The Mac app.
///
/// It is the iPhone app's screens in a window, arranged the way the web app
/// is: the same sidebar, the same page order, one centred column of content.
/// Everything below the shell — the API client, the cache, the cards, the
/// sheets — is the iPhone app's own code, so it looks, scrolls and loads the
/// same way.
@main
struct LeadFinderMacApp: App {
    /// Held here, not in the window, because the menu bar's commands live
    /// outside the view hierarchy and can't read `@Environment`.
    @State private var appState = AppState()
    @State private var navigator = Navigator()

    var body: some Scene {
        WindowGroup {
            Group {
                if AppConfig.isConfigured {
                    RootView()
                        .environment(appState)
                        .environment(navigator)
                        .task {
                            #if DEBUG
                            if let page = DebugSnapshot.page { navigator.page = page }
                            DebugSnapshot.scheduleIfRequested()
                            #endif
                            await appState.warmCache()
                        }
                } else {
                    SetupRequiredView(error: nil)
                }
            }
            .preferredColorScheme(.dark)
            .frame(minWidth: 980, minHeight: 620)
        }
        .defaultSize(width: 1240, height: 860)
        .commands { MacCommands(appState: appState, navigator: navigator) }
    }
}

/// Where the window is: which page the sidebar has open. Kept outside the view
/// so ⌘1…⌘6 in the menu bar can move it.
@MainActor
@Observable
final class Navigator {
    var page: Page = .leads
    /// Bumped to make the open page scroll back to the top and reload.
    var refreshToken = 0
}

/// The web's sidebar, in the web's order (src/app/nav-links.ts), limited to
/// the pages the phone API serves.
enum Page: String, CaseIterable, Identifiable {
    case leads, followUp, agents, messaging, booked, schedule

    var id: String { rawValue }

    var title: String {
        switch self {
        case .leads: "Leads"
        case .followUp: "Follow up"
        case .agents: "Agents"
        case .messaging: "Messaging"
        case .booked: "Booked"
        case .schedule: "Schedule"
        }
    }

    /// SF Symbols standing in for the web's lucide icons.
    var icon: String {
        switch self {
        case .leads: "tray"
        case .followUp: "heart.circle"
        case .agents: "person.2"
        case .messaging: "paperplane"
        case .booked: "calendar.badge.checkmark"
        case .schedule: "calendar"
        }
    }

    var shortcut: KeyEquivalent {
        switch self {
        case .leads: "1"
        case .followUp: "2"
        case .agents: "3"
        case .messaging: "4"
        case .booked: "5"
        case .schedule: "6"
        }
    }
}

struct MacCommands: Commands {
    let appState: AppState
    let navigator: Navigator

    var body: some Commands {
        // There's no document to create; everything is a view onto synced data.
        CommandGroup(replacing: .newItem) {}

        CommandMenu("Go") {
            ForEach(Page.allCases) { page in
                Button(page.title) { navigator.page = page }
                    .keyboardShortcut(page.shortcut, modifiers: .command)
            }
        }

        CommandGroup(after: .toolbar) {
            Button("Refresh") { Task { await refresh() } }
                .keyboardShortcut("r", modifiers: .command)
        }

        CommandGroup(replacing: .help) {
            Button("LeadFinder on the Web") {
                if let url = URL(string: "https://realestate.lukashahn.art") { Platform.open(url) }
            }
        }
    }

    /// Reloads what the open page shows.
    private func refresh() async {
        switch navigator.page {
        case .leads: await appState.leads.load(force: true)
        case .followUp: await appState.followUp.load(force: true)
        case .agents: await appState.agents.load(force: true)
        case .messaging: await appState.messages.load(force: true)
        case .booked: await appState.bookings.load(force: true)
        case .schedule:
            await appState.schedule.load(force: true)
            await appState.bookings.load(force: true)
        }
    }
}

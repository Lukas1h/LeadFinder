import SwiftUI

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

enum AppTab: Int, Hashable, CaseIterable {
    case leads
    case followUp
    case schedule
    case agents

    var title: String {
        switch self {
        case .leads: "Leads"
        case .followUp: "Follow up"
        case .schedule: "Schedule"
        case .agents: "Agents"
        }
    }

    var icon: String {
        switch self {
        case .leads: "sparkles"
        case .followUp: "arrow.triangle.2.circlepath"
        case .schedule: "calendar"
        case .agents: "person.2"
        }
    }
}

struct RootTabView: View {
    @Environment(AppState.self) private var appState
    @State private var selection: AppTab = .leads

    var body: some View {
        TabView(selection: $selection) {
            LeadsView()
                .tabItem { Label(AppTab.leads.title, systemImage: AppTab.leads.icon) }
                .tag(AppTab.leads)

            FollowUpView()
                .tabItem { Label(AppTab.followUp.title, systemImage: AppTab.followUp.icon) }
                .tag(AppTab.followUp)

            ScheduleView()
                .tabItem { Label(AppTab.schedule.title, systemImage: AppTab.schedule.icon) }
                .tag(AppTab.schedule)

            AgentsView()
                .tabItem { Label(AppTab.agents.title, systemImage: AppTab.agents.icon) }
                .tag(AppTab.agents)
        }
        .tint(Theme.accent)
        .task {
            #if DEBUG
            // `-tab 2` or `-tab:2` opens straight to a tab, so a build can be
            // screenshotted without anyone tapping. Debug builds only.
            if let tab = DebugLaunchArguments.tab {
                selection = tab
            }
            #endif
        }
    }
}

#if DEBUG
enum DebugLaunchArguments {
    /// Both `-tab 2` and `-tab:2`, because both read naturally and a build script
    /// shouldn't have to care which one it used.
    static var tab: AppTab? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let flag = arguments.firstIndex(where: { $0.hasPrefix("-tab") }) else { return nil }

        let afterColon = arguments[flag].split(separator: ":").last.map(String.init)
        let next = flag + 1 < arguments.count ? arguments[flag + 1] : nil
        let value = afterColon ?? next

        guard let value, let index = Int(value) else { return nil }
        return AppTab(rawValue: index)
    }

    static var opensLeadDetail: Bool {
        ProcessInfo.processInfo.arguments.contains("-lead-detail")
    }
}
#endif
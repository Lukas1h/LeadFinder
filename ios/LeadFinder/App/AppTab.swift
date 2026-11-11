import SwiftUI

/// The iPhone's tab bar contents: Home, Leads, Follow up, Schedule, Messages.
///
/// iOS only — the Mac app has a sidebar (`Mac/RootView.swift`) rather than tabs,
/// and a `TabView` is not what a Mac window wants.
///
/// Follow up became a tab on 2026-11-10: it's as much of the work as new
/// leads. Five is the most a phone's tab bar holds before "More", so the agent
/// directory moved under Follow up's header (it used to be the other way
/// round); bookings hang off Schedule's. Home (added 2026-10-14) gathers the
/// stat cards that used to be split across Messages and Bookings.
enum AppTab: Int, Hashable, CaseIterable {
    case home
    case leads
    case followUp
    case schedule
    case messages

    var title: String {
        switch self {
        case .home: "Home"
        case .leads: "Leads"
        case .followUp: "Follow up"
        case .schedule: "Schedule"
        case .messages: "Messages"
        }
    }

    var icon: String {
        switch self {
        case .home: "square.grid.2x2"
        case .leads: "sparkles"
        case .followUp: "arrow.triangle.2.circlepath"
        case .schedule: "calendar"
        case .messages: "paperplane"
        }
    }
}

#if os(iOS)

struct RootTabView: View {
    @Environment(AppState.self) private var appState
    @State private var selection: AppTab = .home

    var body: some View {
        TabView(selection: $selection) {
            HomeView(selection: $selection)
                .tabItem { Label(AppTab.home.title, systemImage: AppTab.home.icon) }
                .tag(AppTab.home)

            LeadsView()
                .tabItem { Label(AppTab.leads.title, systemImage: AppTab.leads.icon) }
                .tag(AppTab.leads)

            FollowUpTab()
                .tabItem { Label(AppTab.followUp.title, systemImage: AppTab.followUp.icon) }
                .tag(AppTab.followUp)

            ScheduleView()
                .tabItem { Label(AppTab.schedule.title, systemImage: AppTab.schedule.icon) }
                .tag(AppTab.schedule)

            MessagesView()
                .tabItem { Label(AppTab.messages.title, systemImage: AppTab.messages.icon) }
                .tag(AppTab.messages)
        }
        .tint(Theme.accent)
        // Whenever the schedule or the bookings reload, re-plan the alerts.
        .onChange(of: appState.schedule.fetchedAt) { Task { await appState.syncNotifications() } }
        .onChange(of: appState.bookings.fetchedAt) { Task { await appState.syncNotifications() } }
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

/// The Follow up tab: the feed list, with the agent directory and portfolio
/// links a tap away in its header.
struct FollowUpTab: View {
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            FollowUpView()
                .navigationDestination(for: AgentsRoute.self) { _ in AgentsView(embedded: true) }
                .navigationDestination(for: PortfolioLinksRoute.self) { _ in PortfolioLinksView() }
                .toolbar {
                    ToolbarItemGroup(placement: .trailingBar) {
                        NavigationLink(value: PortfolioLinksRoute()) {
                            Label("Portfolio links", systemImage: "link")
                        }
                        NavigationLink(value: AgentsRoute()) {
                            Label("Agents", systemImage: "person.2")
                        }
                    }
                }
                #if DEBUG
                .task {
                    if DebugLaunchArguments.opensPortfolio { path.append(PortfolioLinksRoute()) }
                    if DebugLaunchArguments.opensAgent { path.append(AgentsRoute()) }
                }
                #endif
        }
    }
}

/// The agent directory, pushed from the Follow up tab.
struct AgentsRoute: Hashable {
    init() {}
}

#endif

#if DEBUG
enum DebugLaunchArguments {
    /// Both `-tab 2` and `-tab:2`, because both read naturally and a build script
    /// shouldn't have to care which one it used.
    static var tab: AppTab? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let flag = arguments.firstIndex(where: { $0.hasPrefix("-tab") }) else { return nil }

        let afterColon = arguments[flag].contains(":") ? arguments[flag].split(separator: ":").last.map(String.init) : nil
        let next = flag + 1 < arguments.count ? arguments[flag + 1] : nil
        let value = afterColon ?? next

        guard let value, let index = Int(value) else { return nil }
        return AppTab(rawValue: index)
    }

    static var opensLeadDetail: Bool {
        ProcessInfo.processInfo.arguments.contains("-lead-detail")
    }

    /// `-contact` opens the Contact sheet on the first lead, for screenshotting.
    static var opensContact: Bool {
        ProcessInfo.processInfo.arguments.contains("-contact")
    }

    /// `-agent` opens the first agent's detail sheet on arrival.
    static var opensAgent: Bool {
        ProcessInfo.processInfo.arguments.contains("-agent")
    }

    /// `-templates` opens the Messages tab's template list on arrival.
    static var opensTemplates: Bool {
        ProcessInfo.processInfo.arguments.contains("-templates")
    }

    /// `-bookings` opens the Schedule tab's bookings page on arrival.
    static var opensBookings: Bool {
        ProcessInfo.processInfo.arguments.contains("-bookings")
    }

    private static func value(after flag: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }

    /// `-home-section money` scrolls Home to a section (goal, money, funnel,
    /// bookings, todo), for screenshotting the parts below the fold.
    static var homeSection: String? { value(after: "-home-section") }

    /// `-finances jobs` opens Finances from Home on that tab.
    static var financesTab: FinanceTab? { value(after: "-finances").flatMap(FinanceTab.init(rawValue:)) }

    /// `-finance-form expense|trip` opens that form over Finances.
    static var financeForm: String? { value(after: "-finance-form") }

    /// `-booking <id>` opens that booking's detail sheet from Home.
    static var bookingId: String? { value(after: "-booking") }

    /// `-scroll-bottom` opens the booking sheet scrolled to its end.
    static var scrollsToBottom: Bool {
        ProcessInfo.processInfo.arguments.contains("-scroll-bottom")
    }

    /// `-follow-up [feed key]` opens Follow up from Home, on that tab.
    static var followUpTab: String? { value(after: "-follow-up") }

    /// `-portfolio` opens the portfolio links from the Agents tab; its value
    /// (`-portfolio-open edit|new`) opens the builder on top, for screenshots.
    static var opensPortfolio: Bool {
        ProcessInfo.processInfo.arguments.contains("-portfolio")
    }

    static var portfolioOpen: String? { value(after: "-portfolio-open") }

    /// `-portfolio-activity` opens the first link's activity.
    static var opensPortfolioActivity: Bool {
        ProcessInfo.processInfo.arguments.contains("-portfolio-activity")
    }

    /// `-no-alert-prompt` skips asking for notification permission, which
    /// would otherwise cover a fresh simulator's first screenshot.
    static var skipsAlertPrompt: Bool {
        ProcessInfo.processInfo.arguments.contains("-no-alert-prompt")
    }
}
#endif
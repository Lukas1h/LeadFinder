import SwiftUI

/// The Mac's window: a sidebar of sections, a content list, and a detail pane.
///
/// The iPhone's four tabs become sidebar rows, with bookings and follow-up
/// promoted out of Schedule and Agents into rows of their own — on a Mac there
/// is room, and they are separate kinds of thing (jobs, agents) that deserve to
/// be reachable without a detour. `AppTab` is shared so the names and icons
/// stay the same on both platforms.
enum MacSection: String, CaseIterable, Identifiable {
    case leads
    case schedule
    case bookings
    case followUp
    case messages
    case agents

    var id: String { rawValue }

    var title: String {
        switch self {
        case .leads: "Leads"
        case .schedule: "Schedule"
        case .bookings: "Bookings"
        case .followUp: "Follow Up"
        case .messages: "Messages"
        case .agents: "Agents"
        }
    }

    var icon: String {
        switch self {
        case .leads: AppTab.leads.icon
        case .schedule: AppTab.schedule.icon
        case .bookings: "list.bullet.rectangle"
        case .followUp: "arrow.triangle.2.circlepath"
        case .messages: AppTab.messages.icon
        case .agents: AppTab.agents.icon
        }
    }

    /// Shown under the sidebar's title when nothing is selected.
    var emptyState: (icon: String, title: String, message: String) {
        switch self {
        case .leads:
            ("sparkles", "No lead selected", "Pick a lead to see its photos, price and agent.")
        case .schedule:
            ("calendar", "Nothing scheduled", "Reminders and listing follow-ups show up here.")
        case .bookings:
            ("list.bullet.rectangle", "No job selected", "Pick a job to see its times, costs and invoice.")
        case .followUp:
            ("arrow.triangle.2.circlepath", "Nothing to follow up", "Agents who replied or listed something new show up here.")
        case .messages:
            ("paperplane", "No message selected", "Pick a message to see the quick actions and what came back.")
        case .agents:
            ("person.2", "No agent selected", "Pick an agent to call, text or email them.")
        }
    }
}

/// Sidebar → content → detail.
///
/// Two columns of navigation rather than one: a Mac window is wide, and the
/// phone's "tap a row to open a sheet" becomes "pick a row, read it beside the
/// list" — which is what makes the window worth resizing.
struct RootSplitView: View {
    @Environment(AppState.self) private var appState

    @State private var section: MacSection? = .leads
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    /// The toolbar's shared refresh button and the sidebar's selection both
    /// funnel through here.
    @State private var refreshToken = 0

    /// What each list has selected, which is what the detail pane shows. Kept
    /// here rather than inside each list view because in a split view the list
    /// and the detail are separate views and they have to agree.
    @State private var leadSelection: LeadsResponse.Group?
    @State private var scheduleSelection: ScheduleResponse.Item?
    @State private var bookingSelection: Booking?
    @State private var messageSelection: MessagesResponse.Send?
    @State private var agentSelection: AgentsResponse.Row?

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            Sidebar(section: $section)
        } content: {
            content
                .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 460)
        } detail: {
            detail
        }
        .navigationTitle(section?.title ?? "LeadFinder")
        .toolbar { toolbarContent }
        // `.id` on the token restarts each section's `.task`, which is how a
        // single refresh button re-fetches whichever list is on screen.
        .id(refreshToken)
    }

    // MARK: - Content and detail

    @ViewBuilder
    private var content: some View {
        switch section {
        case .leads:
            MacLeadsView(selection: $leadSelection) {
                NotificationCenter.default.post(name: .leadsDidChange, object: nil)
            }
        case .schedule:
            MacScheduleView(selection: $scheduleSelection)
        case .bookings:
            MacBookingsView(selection: $bookingSelection)
        case .followUp:
            // The follow-up board is wide and shallow, so it fills the content
            // column rather than becoming a list-and-detail pair.
            MacFollowUpDetailHost()
        case .messages:
            MacMessagesView(selection: $messageSelection)
        case .agents:
            MacAgentsView(selection: $agentSelection)
        case .none:
            Text("Choose a section")
                .foregroundStyle(Theme.tertiaryText)
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch section {
        case .leads: MacLeadDetailHost(selection: $leadSelection)
        case .schedule, .bookings: MacBookingDetailHost(selection: $bookingSelection)
        case .followUp: placeholder(for: .followUp)
        case .messages: MacMessageDetailHost(selection: $messageSelection)
        case .agents: MacAgentDetailHost(selection: $agentSelection)
        case .none: placeholder(for: .leads)
        }
    }

    private func placeholder(for section: MacSection) -> some View {
        let state = section.emptyState
        return EmptyStateView(icon: state.icon, title: state.title, message: state.message)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Button {
                refreshToken += 1
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .help("Reload this section (⌘R)")
        }
    }
}

/// The sidebar's rows. `List(selection:)` on its own gives the standard Mac
/// behaviour: click to select, arrow keys to move, and the highlight follows.
private struct Sidebar: View {
    @Binding var section: MacSection?

    var body: some View {
        List(selection: $section) {
            ForEach(MacSection.allCases) { item in
                Label(item.title, systemImage: item.icon)
                    .tag(item)
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 280)
        .navigationTitle("LeadFinder")
    }
}
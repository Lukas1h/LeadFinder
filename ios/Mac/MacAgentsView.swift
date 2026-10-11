import SwiftUI

/// Agents: the same directory the phone shows — every agent, searchable by
/// name, brokerage or phone digits, filtered by relationship — as a Mac list.
///
/// It is the biggest screen in the app (~8,900 rows), so the filtering is the
/// same single pass over the array in a computed property rather than anything
/// per row, and the shared `AgentDirectoryRow` does the drawing.
struct MacAgentsView: View {
    @Environment(AppState.self) private var appState
    @Binding var selection: AgentsResponse.Row?

    @State private var query = ""
    @State private var filter: AgentFilter = .all

    var body: some View {
        Group {
            if let agents = appState.agents.value {
                directory(agents.agents)
            } else if appState.agents.error != nil {
                loadFailure
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .searchField(text: $query, prompt: "Name, brokerage or phone")
        .safeAreaInset(edge: .top) { filterBar }
        .task { await appState.agents.load() }
    }

    private func directory(_ all: [AgentsResponse.Row]) -> some View {
        let agents = filtered(all)

        return List(selection: $selection) {
            if agents.isEmpty {
                Text(query.isEmpty ? "No agents match this filter." : "Nothing matches “\(query)”.")
                    .font(.callout)
                    .foregroundStyle(Theme.tertiaryText)
            } else {
                ForEach(agents) { agent in
                    AgentDirectoryRow(agent: agent)
                        .tag(agent)
                }
            }
        }
        .listStyle(.inset)
        .contextMenu(forSelectionType: AgentsResponse.Row.self) { agents in
            // With no selection there is nobody to call, so the menu is empty.
            if let agent = agents.first {
                Button("Show Details", systemImage: "sidebar.right") { selection = agent }
                if let digits = phoneDigits(agent), let url = URL(string: "tel://\(digits)") {
                    Button("Call", systemImage: "phone") { Platform.open(url) }
                }
                if let email = agent.email?.nilIfBlank, let url = URL(string: "mailto:\(email)") {
                    Button("Email", systemImage: "envelope") { Platform.open(url) }
                }
            }
        }
    }

    /// One pass, in the server's order (by name, nulls last) — the order is
    /// already right and re-sorting it here would only risk disagreeing.
    private func filtered(_ all: [AgentsResponse.Row]) -> [AgentsResponse.Row] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let digits = trimmed.filter(\.isNumber)
        let isPhoneQuery = digits.count >= 3

        return all.filter { agent in
            guard filter.matches(agent.relationshipStatus) else { return false }
            guard !trimmed.isEmpty else { return true }

            if agent.displayName.localizedCaseInsensitiveContains(trimmed) { return true }
            if let brokerage = agent.brokerage, brokerage.localizedCaseInsensitiveContains(trimmed) { return true }
            // A number someone reads off a business card is typed with any
            // punctuation, so compare digits only — and only once there are
            // enough of them not to match half the directory.
            if isPhoneQuery {
                let phone = agent.phone?.filter(\.isNumber) ?? ""
                return !phone.isEmpty && phone.contains(digits)
            }
            return false
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(AgentFilter.allCases) { option in
                    Button {
                        filter = option
                    } label: {
                        Text(option.title)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(filter == option ? Theme.background : Theme.secondaryText)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 5)
                            .background(filter == option ? Theme.accent : Theme.card, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
        }
        .scrollIndicators(.hidden)
        .background(Theme.background)
    }

    private func phoneDigits(_ agent: AgentsResponse.Row) -> String? {
        agent.phone?.filter(\.isNumber).nilIfBlank
    }

    private var loadFailure: some View {
        VStack(spacing: 14) {
            EmptyStateView(icon: "wifi.exclamationmark", title: "Couldn't load the directory", message: appState.agents.error)
            Button("Try again") {
                Task { await appState.agents.load(force: true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The detail pane for an agent. `AgentDirectoryDetail` is shared with the
/// phone: who they are, their history, their listings and jobs, and the Call /
/// Text / Email buttons that go through the shared `MessageComposer` — so the
/// Mac's Text button opens the Messages compose window exactly as the iPhone's
/// opens the Messages sheet.
struct MacAgentDetailHost: View {
    @Binding var selection: AgentsResponse.Row?

    var body: some View {
        if let agent = selection {
            AgentDirectoryDetail(agent: agent, isInDetailColumn: true)
        } else {
            EmptyStateView(
                icon: "person.2",
                title: "No agent selected",
                message: "Pick an agent to call, text or email them."
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// Follow Up as a Mac pane: the shared board in the detail column, with the
/// agent sheet reachable from each row as it is on the phone.
struct MacFollowUpDetailHost: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ScrollView {
            FollowUpView()
        }
        .background(Theme.background)
        .task { await appState.followUp.load() }
    }
}
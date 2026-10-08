import SwiftUI

/// The agent directory: every agent, searchable by name, brokerage or phone
/// digits, working offline off the cached copy.
///
/// This is the biggest screen in the app — around 8,900 rows — so the filtering
/// is one pass over the array in a computed property, never per row, and the
/// list is lazy.
struct AgentsView: View {
    @Environment(AppState.self) private var appState
    @State private var query = ""
    @State private var filter: AgentFilter = .all

    var body: some View {
        NavigationStack {
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
            .navigationTitle("Agents")
            .navigationDestination(for: AgentsResponse.Row.self) { agent in
                AgentDirectoryDetail(agent: agent)
            }
            .refreshable { await appState.agents.load(force: true) }
            .task { await appState.agents.load() }
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Name, brokerage or phone"
            )
            .safeAreaInset(edge: .top) { filterBar }
        }
    }

    private func directory(_ all: [AgentsResponse.Row]) -> some View {
        let agents = filtered(all)

        return VStack(spacing: 0) {
            FreshnessBar(
                fetchedAt: appState.agents.fetchedAt,
                isRefreshing: appState.agents.isRefreshing,
                error: appState.agents.error
            )
            .padding(.horizontal, 16)
            .padding(.vertical, 6)

            if agents.isEmpty {
                EmptyStateView(
                    icon: "person.crop.circle.badge.questionmark",
                    title: "No agents match",
                    message: query.isEmpty ? "Try a different filter." : "Nothing matches “\(query)”."
                )
                Spacer(minLength: 0)
            } else {
                List(agents) { agent in
                    NavigationLink(value: agent) {
                        AgentDirectoryRow(agent: agent)
                    }
                    .listRowBackground(Theme.background)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
    }

    // MARK: - Filtering

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
                            .padding(.vertical, 7)
                            .background(
                                filter == option ? Theme.accent : Theme.card,
                                in: Capsule()
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
        .scrollIndicators(.hidden)
        .background(Theme.background)
    }

    private var loadFailure: some View {
        VStack(spacing: 14) {
            EmptyStateView(
                icon: "wifi.exclamationmark",
                title: "Couldn't load the directory",
                message: appState.agents.error
            )
            Button("Try again") {
                Task { await appState.agents.load(force: true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Which relationships the directory is showing. These are the statuses on the
/// wire; "Clients" is the two that mean work already happened.
enum AgentFilter: String, CaseIterable, Identifiable {
    case all
    case clients
    case interested
    case warm
    case declined
    case cold

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .clients: "Clients"
        case .interested: "Interested"
        case .warm: "Warm"
        case .declined: "Declined"
        case .cold: "Cold"
        }
    }

    func matches(_ status: String?) -> Bool {
        switch self {
        case .all: true
        case .clients: status == "regular" || status == "worked_once"
        default: status == rawValue
        }
    }
}

/// One agent in the directory. Mirrors the compact look of the web's agent row:
/// name, brokerage, phone, and the relationship badge on the right.
struct AgentDirectoryRow: View {
    let agent: AgentsResponse.Row

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(agent.displayName)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)

                if let brokerage = agent.brokerage?.nilIfBlank {
                    Text(brokerage)
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                }

                if let phone = agent.phone?.nilIfBlank {
                    Text(phone)
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)

            if let status = agent.relationshipStatus {
                BadgeChip(text: status.relationshipLabel, tint: status.relationshipTint)
            }
        }
        .padding(.vertical, 8)
        .frame(minHeight: 56)
    }
}

/// Read-only detail for one agent, built only from the directory's own copy.
/// `/agents/:id` (timeline, listings, bookings) is more than Phase 2 needs.
struct AgentDirectoryDetail: View {
    let agent: AgentsResponse.Row

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(agent.displayName)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Theme.primaryText)

                    if let brokerage = agent.brokerage?.nilIfBlank {
                        Text(brokerage)
                            .font(.subheadline)
                            .foregroundStyle(Theme.secondaryText)
                    }

                    if let status = agent.relationshipStatus {
                        BadgeChip(text: status.relationshipLabel, tint: status.relationshipTint)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .card()

                VStack(alignment: .leading, spacing: 10) {
                    if let phone = agent.phone?.nilIfBlank {
                        let digits = phone.filter(\.isNumber)
                        if !digits.isEmpty {
                            Link(destination: URL(string: "tel://\(digits)")!) {
                                Label(phone, systemImage: "phone")
                                    .font(.subheadline)
                            }
                        }
                    }

                    if let email = agent.email?.nilIfBlank {
                        Link(destination: URL(string: "mailto:\(email)")!) {
                            Label(email, systemImage: "envelope")
                                .font(.subheadline)
                                .lineLimit(1)
                        }
                    }

                    if let contacted = DateFormatting.parse(agent.lastContactedAt) {
                        Label(
                            "Last contact \(DateFormatting.relativeDay(DateFormatting.day.string(from: contacted)))",
                            systemImage: "clock.arrow.circlepath"
                        )
                        .font(.footnote)
                        .foregroundStyle(Theme.secondaryText)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .card()

                // What iOS caller ID will show for this number, so the label can
                // be sanity-checked before it turns up on a call screen.
                if let label = agent.callerLabel?.nilIfBlank {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("CALLER ID")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Theme.tertiaryText)
                            .kerning(0.6)
                        Text(label)
                            .font(.subheadline)
                            .foregroundStyle(Theme.primaryText)
                        if let number = agent.callerNumber {
                            Text("Matches +\(number)")
                                .font(.caption)
                                .foregroundStyle(Theme.tertiaryText)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .card()
                }
            }
            .padding(.vertical, 12)
        }
        .background(Theme.background)
        .navigationTitle(agent.displayName)
        .navigationBarTitleDisplayMode(.inline)
    }
}
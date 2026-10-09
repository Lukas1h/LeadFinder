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
    @State private var openAgent: AgentsResponse.Row?

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
            // Detail is a sheet, not a push: it's a look at one agent, not a
            // place you keep navigating from.
            .sheet(item: $openAgent) { agent in
                AgentDirectoryDetail(agent: agent)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .navigationDestination(for: FollowUpRoute.self) { _ in
                FollowUpView()
            }
            // Follow up lives here rather than as a tab of its own: it is a view
            // over agents, so it belongs under the directory.
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: FollowUpRoute()) {
                        Label("Follow up", systemImage: "arrow.triangle.2.circlepath")
                    }
                }
            }
            .task { await appState.agents.load() }
            .task {
                #if DEBUG
                guard DebugLaunchArguments.opensAgent else { return }
                for _ in 0..<60 {
                    if let first = appState.agents.value?.agents.first {
                        openAgent = first
                        return
                    }
                    try? await Task.sleep(for: .milliseconds(250))
                }
                #endif
            }
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
            ErrorBanner(
                message: appState.agents.error,
                onRetry: { Task { await appState.agents.load(force: true) } }
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
                    Button { openAgent = agent } label: {
                        AgentDirectoryRow(agent: agent)
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(Theme.background)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .refreshable { await appState.agents.load(force: true) }
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

/// One agent in the directory: the shared AgentRow with their brokerage.
struct AgentDirectoryRow: View {
    let agent: AgentsResponse.Row

    var body: some View {
        AgentRow(
            name: agent.displayName,
            phone: agent.phone?.nilIfBlank,
            subtitle: agent.brokerage?.nilIfBlank,
            relationshipStatus: agent.relationshipStatus
        )
    }
}

/// One agent in full: who they are, what you've done with them, and the listings
/// and bookings that hang off them.
///
/// Presented as a sheet rather than pushed: it's a look, not a place you navigate
/// away from. Their listings and bookings reuse the shared ListingRow and
/// BookingRow so an agent, a listing and a job look the same everywhere.
struct AgentDirectoryDetail: View {
    let agent: AgentsResponse.Row

    @State private var detail: AgentDetailResponse?
    @State private var loadError: String?
    @State private var openListing: Listing?
    @State private var openBooking: Booking?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    if let error = loadError {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(Theme.danger)
                    }
                    listings
                    bookings
                    timeline
                    callerID
                }
                .padding(.vertical, 12)
            }
            .background(Theme.background)
            .navigationTitle(agent.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { close() }
                }
            }
            .task { await load() }
            .sheet(item: $openListing) { listing in
                LeadListingSheet(listing: listing, agent: detail?.agent)
            }
            .sheet(item: $openBooking) { booking in
                BookingDetailView(booking: booking)
            }
        }
    }

    @Environment(\.dismiss) private var dismiss
    private func close() { dismiss() }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            AgentRow(
                name: agent.displayName,
                phone: agent.phone,
                subtitle: detail?.brokerage ?? agent.brokerage,
                relationshipStatus: agent.relationshipStatus
            )

            if let email = agent.email?.nilIfBlank {
                Link(destination: URL(string: "mailto:\(email)")!) {
                    Label(email, systemImage: "envelope")
                        .font(.footnote)
                        .lineLimit(1)
                }
            }

            if let phone = agent.phone?.nilIfBlank {
                let digits = phone.filter(\.isNumber)
                if !digits.isEmpty {
                    Link(destination: URL(string: "tel://\(digits)")!) {
                        Label(phone, systemImage: "phone")
                            .font(.footnote)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .padding(.horizontal, 16)
    }

    // MARK: - Listings and bookings

    @ViewBuilder
    private var listings: some View {
        let listings = detail?.listings ?? []
        if !listings.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                sectionTitle("Listings (\(listings.count))")
                ForEach(listings) { listing in
                    Button { openListing = listing } label: { ListingRow(listing: listing) }
                        .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder
    private var bookings: some View {
        let bookings = detail?.bookings ?? []
        if !bookings.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                sectionTitle("Bookings (\(bookings.count))")
                ForEach(bookings) { booking in
                    Button { openBooking = booking } label: { BookingRow(booking: booking) }
                        .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Timeline

    @ViewBuilder
    private var timeline: some View {
        let entries = detail?.timeline ?? []
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                sectionTitle("History")

                ForEach(entries) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(summary(entry))
                            .font(.subheadline)
                            .foregroundStyle(Theme.primaryText)
                        Text(when(entry))
                            .font(.caption2)
                            .foregroundStyle(Theme.tertiaryText)
                        if let note = entry.note?.nilIfBlank {
                            Text(note)
                                .font(.caption)
                                .foregroundStyle(Theme.secondaryText)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            .padding(.horizontal, 16)
        }
    }

    private func summary(_ entry: AgentDetailResponse.Entry) -> String {
        var parts: [String] = []

        switch entry.kind {
        case "send":
            parts.append(entry.channel == "email" ? "Emailed" : "Texted")
            if let preset = entry.presetName?.nilIfBlank { parts.append("“\(preset)”") }
            if let result = entry.result, result != "pending" { parts.append("· \(result.capitalized)") }
        default:
            parts.append(entry.kind.capitalized)
            if let channel = entry.channel?.nilIfBlank { parts.append("· \(channel)") }
        }

        if let address = entry.listingAddress?.nilIfBlank { parts.append("· \(address)") }
        return parts.joined(separator: " ")
    }

    private func when(_ entry: AgentDetailResponse.Entry) -> String {
        guard let at = entry.at, let date = DateFormatting.parse(at) else { return "" }
        return DateFormatting.dayTime.string(from: date)
    }

    // MARK: - Caller ID

    @ViewBuilder
    private var callerID: some View {
        if let label = agent.callerLabel?.nilIfBlank {
            VStack(alignment: .leading, spacing: 4) {
                sectionTitle("Caller ID")
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(Theme.primaryText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            .padding(.horizontal, 16)
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.caption2.weight(.bold))
            .foregroundStyle(Theme.tertiaryText)
            .kerning(0.6)
    }

    private func load() async {
        guard detail == nil else { return }
        do {
            detail = try await APIClient.shared.agentDetail(agent.id)
        } catch let apiError as APIError {
            loadError = apiError.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
    }
}

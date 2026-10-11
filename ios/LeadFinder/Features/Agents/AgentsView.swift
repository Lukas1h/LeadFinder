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
    /// What the opener knew. The loaded detail (and any edit) overrides it.
    private let initial: AgentsResponse.Row

    init(agent: AgentsResponse.Row) {
        initial = agent
    }

    private var agent: AgentsResponse.Row {
        guard let fresh = detail?.agent else { return initial }
        var row = initial
        row.name = fresh.name
        row.phone = fresh.phone
        row.email = fresh.email
        row.relationshipStatus = fresh.relationshipStatus
        row.brokerage = fresh.brokerage?.nilIfBlank ?? detail?.brokerage ?? initial.brokerage
        return row
    }

    @Environment(AppState.self) private var appState
    @State private var showEdit = false

    @State private var detail: AgentDetailResponse?
    @State private var loadError: String?
    @State private var openListing: Listing?
    @State private var openBooking: Booking?
    @State private var contactError: String?
    @State private var logSheet: LogRequest?
    /// Set when Call is tapped, so coming back from the phone call asks how it
    /// went — the web's "how did it go?" prompt.
    @State private var callTappedAt: Date?
    @State private var callStarted = false

    private struct LogRequest: Identifiable {
        let afterCall: Bool
        var id: Bool { afterCall }
    }

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
                ToolbarItem(placement: .confirmationAction) {
                    Button("Edit") { showEdit = true }
                        .disabled(detail == nil)
                }
            }
            .task { await load() }
            .sheet(isPresented: $showEdit) {
                if let current = detail?.agent {
                    EditAgentSheet(agent: current) { deleted in
                        Task {
                            if deleted {
                                await appState.agents.load(force: true)
                                dismiss()
                            } else {
                                await reload()
                                await appState.agents.load(force: true)
                            }
                        }
                    }
                }
            }
            .sheet(item: $openListing) { listing in
                LeadListingSheet(listing: listing, agent: detail?.agent)
            }
            .sheet(item: $openBooking) { booking in
                BookingDetailView(booking: booking)
            }
            .sheet(item: $logSheet) { request in
                LogInteractionSheet(agentId: agent.id, agentName: agent.displayName, afterCall: request.afterCall) {
                    Task { await reload() }
                }
            }
            // iOS asks "Call…?" first. Only leaving the app right after the tap
            // means a call was really placed; cancelling that alert never does.
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
                if let callTappedAt, Date().timeIntervalSince(callTappedAt) < 20 { callStarted = true }
                callTappedAt = nil
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
                guard callStarted else { return }
                callStarted = false
                logSheet = LogRequest(afterCall: true)
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

            contactButtons

            if let email {
                Text(email)
                    .font(.footnote)
                    .foregroundStyle(Theme.tertiaryText)
                    .lineLimit(1)
                    .textSelection(.enabled)
            }

            if let contactError {
                Text(contactError)
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .padding(.horizontal, 16)
    }

    // MARK: - Contact

    // The directory row may lack what the detail has (the follow-up board
    // opens this sheet without an email), so the loaded agent fills in.
    private var phoneDigits: String? {
        (agent.phone ?? detail?.agent.phone)?.filter(\.isNumber).nilIfBlank
    }

    private var email: String? {
        (agent.email ?? detail?.agent.email)?.nilIfBlank
    }

    /// Call, text, email — whichever the agent can be reached by.
    @ViewBuilder
    private var contactButtons: some View {
        if phoneDigits != nil || email != nil {
            HStack(spacing: 8) {
                if let digits = phoneDigits, let url = URL(string: "tel://\(digits)") {
                    Button {
                        callTappedAt = Date()
                        UIApplication.shared.open(url)
                    } label: { contactLabel("Call", "phone.fill") }
                        .buttonStyle(.plain)
                    Button { text(digits) } label: { contactLabel("Text", "message.fill", prominent: true) }
                        .buttonStyle(.plain)
                }
                if let email, let url = URL(string: "mailto:\(email)") {
                    Link(destination: url) { contactLabel("Email", "envelope.fill") }
                }
            }
        }
    }

    private func contactLabel(_ title: String, _ symbol: String, prominent: Bool = false) -> some View {
        Label(title, systemImage: symbol)
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(
                prominent ? Theme.accent : Theme.cardRaised,
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .foregroundStyle(prominent ? Theme.background : Theme.primaryText)
    }

    /// Opens Messages to this agent with nothing written. Only a text that
    /// actually went out is recorded, and then the timeline is refreshed.
    private func text(_ digits: String) {
        contactError = nil
        MessageComposer.present(recipients: [digits], body: "") { outcome in
            switch outcome {
            case .unavailable:
                contactError = "This iPhone can't send texts right now."
            case .cancelled:
                break
            case .sent:
                Task {
                    do {
                        try await APIClient.shared.confirmAgentTextSent(agentId: agent.id)
                        await reload()
                    } catch {
                        contactError = "The text went out, but recording it failed: "
                            + ((error as? APIError)?.errorDescription ?? error.localizedDescription)
                    }
                }
            }
        }
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
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                sectionTitle("History")
                Spacer(minLength: 0)
                Button {
                    logSheet = LogRequest(afterCall: false)
                } label: {
                    Label("Add interaction", systemImage: "plus")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 10)
                        .frame(height: 30)
                        .background(Theme.cardRaised, in: Capsule())
                        .foregroundStyle(Theme.primaryText)
                }
                .buttonStyle(.plain)
            }

            if entries.isEmpty, detail != nil {
                Text("Nothing logged yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.tertiaryText)
            }

            ForEach(entries) { entry in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: icon(entry))
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                        .frame(width: 18)
                        .padding(.top, 3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(summary(entry))
                            .font(.subheadline)
                            .foregroundStyle(Theme.primaryText)
                        if let note = (entry.note ?? entry.body)?.nilIfBlank {
                            Text(note)
                                .font(.caption)
                                .foregroundStyle(Theme.secondaryText)
                                .lineLimit(entry.kind == "queued" ? 1 : nil)
                        }
                        Text(detailLine(entry))
                            .font(.caption2)
                            .foregroundStyle(Theme.tertiaryText)
                    }
                    Spacer(minLength: 0)
                    if let badge = badge(entry) {
                        BadgeChip(text: badge)
                    }
                }
                .opacity(entry.kind == "queued" ? 0.7 : 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .padding(.horizontal, 16)
    }

    // The wording below is the web's (AgentDetailDialog.tsx): each row reads as
    // the thing that happened, not as the template that was used.

    private func summary(_ entry: AgentDetailResponse.Entry) -> String {
        let outbound = entry.direction != "inbound"
        switch entry.kind {
        case "send":
            let verb = entry.channel == "email" ? "Emailed them" : "Texted them"
            return entry.listingAddress?.nilIfBlank.map { "\(verb) about \($0)" } ?? verb
        case "queued":
            let what = entry.channel == "email" ? "Email queued" : "Text queued"
            return entry.listingAddress?.nilIfBlank.map { "\(what) about \($0)" } ?? what
        default:
            let base: String
            switch entry.channel {
            case "call": base = outbound ? "Called them" : "They called"
            case "text": base = outbound ? "Texted them" : "They texted"
            case "email": return outbound ? "Emailed them" : "They emailed"
            case "in_person": return "Met in person"
            default: return "Other"
            }
            guard let outcome = entry.outcome?.nilIfBlank else { return base }
            return "\(base) · \(outcome.replacingOccurrences(of: "_", with: " "))"
        }
    }

    private func detailLine(_ entry: AgentDetailResponse.Entry) -> String {
        var parts: [String] = []
        if entry.kind == "send" {
            if let preset = entry.presetName?.nilIfBlank { parts.append(preset) }
            if let type = entry.type?.nilIfBlank {
                parts.append(type == "follow_up" ? "Follow-up" : "Initial outreach")
            }
        }
        parts.append(when(entry))
        if entry.kind == "interaction", let address = entry.listingAddress?.nilIfBlank { parts.append(address) }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func icon(_ entry: AgentDetailResponse.Entry) -> String {
        if entry.kind == "queued" { return "clock" }
        switch entry.channel {
        case "call": return entry.direction == "inbound" ? "phone.arrow.down.left" : "phone"
        case "text", "sms": return "message"
        case "email": return "envelope"
        default: return "person.2"
        }
    }

    private func badge(_ entry: AgentDetailResponse.Entry) -> String? {
        if entry.kind == "queued" { return "Queued" }
        if entry.pending ?? false { return "Unconfirmed" }
        guard entry.kind == "send" else { return nil }
        if let result = entry.result, result != "pending" { return result.relationshipLabel }
        return entry.respondedAt != nil ? "Replied" : nil
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

    /// After something was logged: the timeline has a new row.
    private func reload() async {
        if let fresh = try? await APIClient.shared.agentDetail(agent.id) { detail = fresh }
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

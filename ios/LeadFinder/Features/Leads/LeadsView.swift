import SwiftUI

/// The full Leads list: same sections, order and badges as the web Leads page.
/// Read-only in Phase 2 — Text and Pass arrive with the texting phase.
struct LeadsView: View {
    @Environment(AppState.self) private var appState

    /// Sections the server marked collapsed (just "Unlikely matches") start
    /// closed, matching the web page.
    @State private var collapsed: Set<String> = []
    @State private var didSetInitialCollapse = false
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let leads = appState.leads.value {
                    leadsList(leads)
                } else if appState.leads.error != nil {
                    loadFailure
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(Theme.background)
            .navigationTitle("Leads")
            .navigationDestination(for: LeadsResponse.Group.self) { group in
                LeadDetailView(group: group)
            }
            .task {
                #if DEBUG
                // `-lead-detail` opens the first lead straight away, so the
                // detail screen can be screenshotted without tapping.
                if DebugLaunchArguments.opensLeadDetail,
                   let first = appState.leads.value?.sections.first?.groups.first {
                    path.append(first)
                }
                #endif
            }
            .refreshable { await appState.leads.load(force: true) }
            .task { await appState.leads.load() }
            .task {
                guard !didSetInitialCollapse else { return }
                didSetInitialCollapse = true
                collapsed = Set(
                    (appState.leads.value?.sections ?? [])
                        .filter(\.collapsed)
                        .map(\.key)
                )
            }
        }
    }

    private func leadsList(_ leads: LeadsResponse) -> some View {
        ScrollView {
            LazyVStack(spacing: 14, pinnedViews: []) {
                FreshnessBar(
                    fetchedAt: appState.leads.fetchedAt,
                    isRefreshing: appState.leads.isRefreshing,
                    error: appState.leads.error
                )
                .padding(.horizontal, 16)

                header(leads.counts)

                ForEach(leads.sections) { section in
                    sectionView(section)
                }

                if leads.sections.isEmpty {
                    EmptyStateView(
                        icon: "sparkles",
                        title: "No open leads",
                        message: "Nothing is waiting on you right now."
                    )
                }
            }
            .padding(.vertical, 12)
        }
    }

    private func header(_ counts: LeadsResponse.Counts) -> some View {
        HStack(spacing: 6) {
            Text("\(counts.agents) agents · \(counts.listings) listings")
            if counts.queued > 0 {
                Text("·")
                Text("\(counts.queued) queued").foregroundStyle(Theme.warning)
            }
            Spacer(minLength: 0)
        }
        .font(.footnote.weight(.medium))
        .foregroundStyle(Theme.secondaryText)
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private func sectionView(_ section: LeadsResponse.Section) -> some View {
        let isCollapsed = collapsed.contains(section.key)

        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.snappy(duration: 0.22)) {
                    if isCollapsed { collapsed.remove(section.key) } else { collapsed.insert(section.key) }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(section.label)
                        .font(.headline)
                        .foregroundStyle(Theme.primaryText)
                    Text("\(section.groups.count)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.tertiaryText)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Theme.cardRaised, in: Capsule())
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Theme.tertiaryText)
                        .rotationEffect(.degrees(isCollapsed ? -90 : 0))
                }
                .contentShape(Rectangle())
                .padding(.horizontal, 16)
                .padding(.vertical, 2)
            }
            .buttonStyle(.plain)

            if !isCollapsed {
                ForEach(section.groups) { group in
                    NavigationLink(value: group) {
                        LeadCard(group: group)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 16)
                }
            }
        }
    }

    private var loadFailure: some View {
        VStack(spacing: 14) {
            EmptyStateView(
                icon: "wifi.exclamationmark",
                title: "Couldn't load leads",
                message: appState.leads.error
            )
            Button("Try again") {
                Task { await appState.leads.load(force: true) }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
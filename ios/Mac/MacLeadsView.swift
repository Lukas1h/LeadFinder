import SwiftUI

/// Leads, as a Mac list: one row per agent group, with the contact sheet and
/// the lead detail reachable from the row rather than from a card you have to
/// scroll to.
///
/// The cards themselves (`LeadCard`) are a phone layout — a big photo, big
/// buttons, meant for one-handed scrolling. Here the photo is a thumbnail and
/// the actions are a context menu and a toolbar, which is what a Mac user
/// expects. The data, the badges and the actions are the same ones.
struct MacLeadsView: View {
    @Environment(AppState.self) private var appState
    /// The lead shown in the detail pane. Bound by the sidebar's host, so
    /// selecting a row fills the third column.
    @Binding var selection: LeadsResponse.Group?
    /// Called after something changes a lead, so the list reloads and the
    /// passed row disappears rather than lingering as a stale card.
    let onReload: () -> Void

    @State private var collapsed: Set<String> = []
    @State private var didSetInitialCollapse = false
    @State private var contact: LeadsResponse.Group?
    @State private var listingToOpen: Listing?

    var body: some View {
        Group {
            if let leads = appState.leads.value {
                list(leads)
            } else if appState.leads.error != nil {
                loadFailure
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .sheet(item: $contact) { group in
            ContactSheet(
                listingId: group.best.id,
                type: "initial_outreach",
                agentName: group.agentName ?? group.best.agentName,
                agentPhone: group.agentPhone ?? group.best.agentPhone,
                agentSubtitle: group.best.addressLine.nilIfBlank,
                agent: group.agent
            ) { onReload() }
        }
        .sheet(item: $listingToOpen) { listing in
            LeadListingSheet(listing: listing)
        }
        .task { await appState.leads.load() }
        .task {
            guard !didSetInitialCollapse else { return }
            didSetInitialCollapse = true
            collapsed = Set((appState.leads.value?.sections ?? []).filter(\.collapsed).map(\.key))
        }
    }

    private func list(_ leads: LeadsResponse) -> some View {
        List(selection: $selection) {
            Section {
                Text("\(leads.counts.agents) agents · \(leads.counts.listings) listings")
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
                if leads.counts.queued > 0 {
                    Text("\(leads.counts.queued) queued")
                        .font(.footnote)
                        .foregroundStyle(Theme.warning)
                }
            }

            ForEach(leads.sections) { section in
                Section {
                    if collapsed.contains(section.key) {
                        ForEach(section.groups) { row($0) }
                    }
                } header: {
                    Button {
                        withAnimation(.snappy(duration: 0.22)) {
                            if collapsed.contains(section.key) {
                                collapsed.remove(section.key)
                            } else {
                                collapsed.insert(section.key)
                            }
                        }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "chevron.right")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(Theme.tertiaryText)
                                .rotationEffect(.degrees(collapsed.contains(section.key) ? 0 : 90))
                            Text(section.label)
                            Text("\(section.groups.count)")
                                .foregroundStyle(Theme.tertiaryText)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .listStyle(.inset)
        .contextMenu(forSelectionType: LeadsResponse.Group.self) { groups in
            // Right-clicking several rows offers the actions that make sense for
            // all of them; with no selection there is nothing to act on.
            if let group = groups.first {
                Button {
                    contact = group
                } label: {
                    Label("Text \(firstName(of: group))…", systemImage: "message")
                }
                Button {
                    selection = group
                } label: {
                    Label("Show Details", systemImage: "sidebar.right")
                }
                Button {
                    listingToOpen = group.best
                } label: {
                    Label("Open Listing", systemImage: "photo")
                }
                Divider()
                Button(role: .destructive) {
                    Task { await pass(group) }
                } label: {
                    Label("Pass", systemImage: "xmark")
                }
            }
        } primaryAction: { groups in
            selection = groups.first
        }
    }

    private func row(_ group: LeadsResponse.Group) -> some View {
        HStack(spacing: 10) {
            thumb(group)
            VStack(alignment: .leading, spacing: 2) {
                Text(group.agentName ?? group.best.agentName ?? "Unknown agent")
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text(group.best.addressLine.nilIfBlank ?? "Unknown address")
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                if !group.cardBadges.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(group.cardBadges.prefix(3), id: \.kind) { badge in
                            BadgeChip(text: badge.label, tint: badge.badgeTint(photoScore: group.best.score))
                        }
                    }
                    .padding(.top, 1)
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 2) {
                Text(group.best.priceLine)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.secondaryText)
                if let contact = group.contactSummary {
                    Text(contact)
                        .font(.caption2)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
        }
        .padding(.vertical, 3)
    }

    private func thumb(_ group: LeadsResponse.Group) -> some View {
        Group {
            if let url = group.best.photos?.first {
                RemoteImage(photo: url, size: .card)
            } else {
                ZStack {
                    Theme.cardRaised
                    Text("No photo")
                        .font(.system(size: 8))
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private func firstName(of group: LeadsResponse.Group) -> String {
        let name = group.agentName ?? group.best.agentName ?? ""
        return name.split(separator: " ").first.map(String.init) ?? "agent"
    }

    private func pass(_ group: LeadsResponse.Group) async {
        do {
            try await APIClient.shared.setListingStatus(listingIds: group.listingIds, status: "passed")
            onReload()
        } catch {
            // Leave the row in place: a failed action shouldn't look like it
            // worked. The error surfaces on the next refresh.
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

/// The detail pane for Leads. `LeadDetailView` is a phone view — photos first,
/// then cards — but it is a plain scrolling column with no navigation of its
/// own, so it drops into the third column unchanged.
struct MacLeadDetailHost: View {
    @Binding var selection: LeadsResponse.Group?

    var body: some View {
        if let group = selection {
            LeadDetailView(group: group)
        } else {
            EmptyStateView(
                icon: "sparkles",
                title: "No lead selected",
                message: "Pick a lead to see its photos, price and agent."
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
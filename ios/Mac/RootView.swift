import SwiftUI

/// The window: the web's sidebar on the left, one page on the right.
///
/// Pages are the iPhone app's screens as they are. Each brings its own
/// `NavigationStack`, so a page keeps its own back button and title, and the
/// sidebar stays put like the web's.
struct RootView: View {
    @Environment(Navigator.self) private var navigator

    var body: some View {
        HStack(spacing: 0) {
            Sidebar()
                .frame(width: 208)

            Rectangle()
                .fill(Theme.hairline)
                .frame(width: 1)

            // The web caps its pages at max-w-3xl and centres them; a 1200pt
            // wide card is not easier to read.
            PageHost(page: navigator.page)
                .frame(maxWidth: 768)
                .frame(maxWidth: .infinity)
                .background(Theme.background)
        }
        .background(Theme.background)
        .tint(Theme.accent)
    }
}

/// One page at a time. Pages bring their own toolbar items, and the window has
/// one toolbar: keeping several alive at once makes AppKit reject the
/// duplicates and crash. Switching is still instant, because the data lives in
/// `AppState`'s cache, not in the page.
private struct PageHost: View {
    let page: Page

    var body: some View {
        content(page)
            .id(page)
    }

    @ViewBuilder
    private func content(_ page: Page) -> some View {
        switch page {
        case .leads: LeadsView()
        case .followUp: NavigationStack { FollowUpView() }
        case .agents: AgentsView()
        case .messaging: MessagesView()
        case .booked: NavigationStack { BookingsView() }
        case .schedule: ScheduleView()
        }
    }
}

private struct Sidebar: View {
    @Environment(Navigator.self) private var navigator
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 9) {
                Image(systemName: "camera.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.background)
                    .frame(width: 28, height: 28)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                Text("LeadFinder")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.primaryText)
            }
            .padding(.horizontal, 10)
            .padding(.top, 14)
            .padding(.bottom, 14)

            ForEach(Page.allCases) { page in
                SidebarRow(page: page, isSelected: navigator.page == page, badge: badge(for: page)) {
                    navigator.page = page
                }
            }

            Spacer(minLength: 0)

            if appState.leads.isRefreshing || appState.messages.isRefreshing {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text("Syncing")
                        .font(.caption2)
                        .foregroundStyle(Theme.tertiaryText)
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
            }
        }
        .padding(.horizontal, 8)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Theme.background)
    }

    /// Open work worth seeing from anywhere, as the web's header does for the
    /// queue.
    private func badge(for page: Page) -> String? {
        switch page {
        case .leads:
            let count = appState.leads.value?.counts.listings ?? 0
            return count > 0 ? "\(count)" : nil
        case .followUp:
            let count = appState.followUp.value?.groups.reduce(0) { $0 + $1.entries.count } ?? 0
            return count > 0 ? "\(count)" : nil
        default:
            return nil
        }
    }
}

private struct SidebarRow: View {
    let page: Page
    let isSelected: Bool
    let badge: String?
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: page.icon)
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 20)
                    .foregroundStyle(isSelected ? Theme.accent : Theme.secondaryText)
                Text(page.title)
                    .font(.system(size: 14, weight: isSelected ? .semibold : .medium))
                    .foregroundStyle(isSelected ? Theme.primaryText : Theme.secondaryText)
                Spacer(minLength: 0)
                if let badge {
                    Text(badge)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                isSelected ? Theme.cardRaised : hovering ? Theme.card : Color.clear,
                in: RoundedRectangle(cornerRadius: 9, style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

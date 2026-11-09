import SwiftUI

/// The "Create portfolio" quick action: the agent's page worked out the way
/// the builder fills it in (their name, area, brokerage, the area template's
/// listings and settings, else their nearest jobs), shown as a short summary.
/// "Send" makes the link and texts it (PortfolioTexter: the "Portfolio link"
/// template's first text, then its second with the link, logged in their
/// history). "Edit" opens the builder on the same page; its changes come
/// back here unsaved. Nothing is made or sent until "Send" is tapped.
struct PortfolioQuickSendView: View {
    let agent: PortfolioAgentMatch
    /// Called once the texts are recorded: `done` is true when both went, so
    /// the message screen can close too.
    var onSent: (_ note: String, _ done: Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft: PortfolioDraft?
    @State private var error: String?
    @State private var working = false
    @State private var editing = false
    /// Made on the first "Send"; a retry after a cancelled text reuses it
    /// (saved again first if it was edited in between).
    @State private var made: APIClient.SavedPortfolioLink?
    @State private var madeFrom: PortfolioContent?

    private var hasPhone: Bool { agent.phone?.nilIfBlank != nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let draft {
                        summary(draft)
                    } else if error == nil {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("Filling in their page…").font(.footnote).foregroundStyle(Theme.tertiaryText)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                    }
                    if let error {
                        Text(error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                }
                .padding(16)
            }
            .safeAreaInset(edge: .bottom) {
                if draft != nil { buttons }
            }
            .background(Theme.background)
            .navigationTitle("Create portfolio")
            .titleDisplay(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .task { await load() }
            .sheet(isPresented: $editing) {
                if let draft {
                    PortfolioBuilderView(start: .draft(draft), onDone: { self.draft = $0 })
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.background)
        .interactiveDismissDisabled(working)
    }

    // MARK: - Summary

    private func summary(_ d: PortfolioDraft) -> some View {
        let page = [
            d.afterSrc != nil ? "Before/after" : nil,
            d.showOffer ? "$50 off" : nil,
            d.showTourOfHomes ? "Tour of Homes" : nil,
            d.ogImage != nil ? "own preview image" : nil,
        ].compactMap { $0 }
        let listings = d.listings.map { $0.address.nilIfBlank ?? "No address" }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(agent.name?.nilIfBlank ?? d.firstName.nilIfBlank ?? "Their page")
                    .font(.headline)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Spacer(minLength: 8)
                BadgeChip(text: d.templateName ?? "No template", tint: d.templateName == nil ? Theme.tertiaryText : Theme.accent)
            }
            row("person", [d.firstName.nilIfBlank.map { "\u{201C}\($0)\u{201D}" }, d.brokerage.nilIfBlank].compactMap { $0 }.joined(separator: " · ").nilIfBlank ?? "No name or brokerage")
            row("mappin.and.ellipse", d.area.nilIfBlank ?? "No area")
            row("house", listings.isEmpty ? "No listings" : "\(listings.count) listing\(listings.count == 1 ? "" : "s"): \(listings.joined(separator: " · "))")
            row("checkmark.circle", page.isEmpty ? "No offer or Tour of Homes" : page.joined(separator: " · "))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func row(_ icon: String, _ text: String) -> some View {
        Label(text, systemImage: icon)
            .font(.footnote)
            .foregroundStyle(Theme.secondaryText)
            .lineLimit(2)
    }

    // MARK: - Buttons

    private var buttons: some View {
        VStack(spacing: 6) {
            HStack(spacing: 10) {
                Button { editing = true } label: {
                    Label("Edit", systemImage: "slider.horizontal.3")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .foregroundStyle(Theme.primaryText)
                }
                .buttonStyle(.plain)
                .frame(maxWidth: 120)
                .disabled(working)

                Button { Task { await send() } } label: {
                    HStack(spacing: 8) {
                        if working { ProgressView().controlSize(.small).tint(Theme.background) } else { Image(systemName: "paperplane.fill") }
                        Text("Send")
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .foregroundStyle(Theme.background)
                    .opacity(hasPhone ? 1 : 0.4)
                }
                .buttonStyle(.plain)
                .disabled(working || !hasPhone)
            }
            Text(hasPhone
                 ? "Texts the Portfolio link template's two messages, then logs it in their history."
                 : "No phone number on file for them.")
                .font(.caption)
                .foregroundStyle(Theme.tertiaryText)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(Theme.background)
    }

    // MARK: - Loading and sending

    private func load() async {
        guard draft == nil else { return }
        do {
            let prefill = try await APIClient.shared.portfolioPrefill(agentId: agent.id)
            draft = PortfolioDraft(prefill: prefill, agent: agent)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Makes the link (or saves the one already made, if edited since), then
    /// sends the two texts.
    private func send() async {
        guard let draft else { return }
        working = true
        error = nil
        defer { working = false }
        let content = draft.content
        do {
            if let made, let id = made.id {
                if madeFrom != content {
                    self.made = try await APIClient.shared.updatePortfolioLink(id: id, agentId: agent.id, content: content)
                    madeFrom = content
                }
            } else {
                made = try await APIClient.shared.createPortfolioLink(agentId: agent.id, content: content)
                madeFrom = content
            }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return
        }
        guard let saved = made, let id = saved.id else {
            error = "Link made (\(made?.url ?? "")) but the server is too old to text it from here."
            return
        }
        switch await PortfolioTexter.send(linkId: id) {
        case .sent:
            onSent("Portfolio link texted.", true)
            dismiss()
        case .firstOnly:
            onSent("Sent the first text; the link text wasn't sent and is on the clipboard.", false)
            dismiss()
        case .cancelled:
            error = "Not sent. The link is made (\(saved.url)); tap Send to text it."
        case .failed(let message):
            error = message
        }
    }
}

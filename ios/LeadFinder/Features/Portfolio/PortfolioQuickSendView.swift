import SwiftUI

/// The "Portfolio link" quick action: what the link would be, worked out the
/// way the builder fills it in (their name, area, brokerage, the area
/// template's listings and toggles, else the nearest jobs), as a short
/// summary. "Text portfolio link" makes the link and texts it
/// (PortfolioTexter); "Edit portfolio link" opens the full builder instead.
/// Nothing is made or sent until one of them is tapped.
struct PortfolioQuickSendView: View {
    let agent: PortfolioAgentMatch
    /// Called with a note for the message screen once the texts are recorded.
    var onTexted: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var prefill: PortfolioPrefill?
    @State private var error: String?
    @State private var working = false
    @State private var editing = false
    /// Made on the first tap; a retry after a cancelled text reuses it.
    @State private var made: APIClient.SavedPortfolioLink?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let prefill {
                        summary(prefill)
                        buttons
                    } else if error == nil {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("Working out their page…").font(.footnote).foregroundStyle(Theme.tertiaryText)
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
            .background(Theme.background)
            .navigationTitle("Portfolio link")
            .titleDisplay(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .task { await load() }
            .sheet(isPresented: $editing) {
                PortfolioBuilderView(start: .new(agent: agent), onTexted: { note in
                    editing = false
                    onTexted(note)
                    dismiss()
                })
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.background)
    }

    private func summary(_ p: PortfolioPrefill) -> some View {
        let t = p.template?.content
        let toggles = [
            (t?.showOffer ?? true) ? "$50 off" : nil,
            (t?.showTourOfHomes ?? true) ? "Tour of Homes" : nil,
            t?.ogImage != nil ? "own preview image" : nil,
        ].compactMap { $0 }
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(agent.name ?? p.firstName)
                    .font(.headline)
                    .foregroundStyle(Theme.primaryText)
                Spacer(minLength: 0)
                if let name = p.template?.name {
                    BadgeChip(text: name, tint: Theme.accent)
                }
            }
            row("mappin.and.ellipse", p.area.nilIfBlank ?? "No area")
            row("house", p.listings.isEmpty ? "No listings" : p.listings.map { $0.address.nilIfBlank ?? "No address" }.joined(separator: " · "))
            row("checkmark.circle", toggles.isEmpty ? "No offer or Tour of Homes" : toggles.joined(separator: " · "))
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

    private var buttons: some View {
        VStack(spacing: 10) {
            Button { Task { await textIt() } } label: {
                HStack(spacing: 8) {
                    if working { ProgressView().controlSize(.small).tint(Theme.background) } else { Image(systemName: "message.fill") }
                    Text("Text portfolio link")
                }
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .foregroundStyle(Theme.background)
            }
            .buttonStyle(.plain)
            .disabled(working || agent.phone?.nilIfBlank == nil)

            Button { editing = true } label: {
                Text("Edit portfolio link")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .foregroundStyle(Theme.primaryText)
            }
            .buttonStyle(.plain)
            .disabled(working)

            if agent.phone?.nilIfBlank == nil {
                Text("No phone number on file for them.").font(.caption).foregroundStyle(Theme.tertiaryText)
            }
        }
    }

    private func load() async {
        guard prefill == nil else { return }
        do {
            prefill = try await APIClient.shared.portfolioPrefill(agentId: agent.id)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// The same content the builder would save untouched, then the two texts.
    private func textIt() async {
        guard let p = prefill else { return }
        working = true
        error = nil
        defer { working = false }
        let t = p.template?.content
        let content = PortfolioContent(
            area: p.area.nilIfBlank,
            agentFirstName: p.firstName.nilIfBlank,
            brokerage: p.brokerage.nilIfBlank,
            video: t?.video ?? "summit",
            leadPhoto: t?.leadPhoto,
            showTourOfHomes: t?.showTourOfHomes ?? true,
            showOffer: t?.showOffer ?? true,
            beforeAfter: false,
            beforeSrc: nil,
            afterSrc: nil,
            listings: p.listings,
            ogImage: t?.ogImage
        )
        let saved: APIClient.SavedPortfolioLink
        if let made {
            saved = made
        } else {
            do {
                saved = try await APIClient.shared.createPortfolioLink(agentId: agent.id, content: content)
                made = saved
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
                return
            }
        }
        guard let id = saved.id else {
            error = "Link made (\(saved.url)) but the server is too old to text it from here."
            return
        }
        switch await PortfolioTexter.send(linkId: id) {
        case .sent:
            onTexted("Portfolio link texted.")
            dismiss()
        case .firstOnly:
            onTexted("Sent \u{201C}Thanks!\u{201D}; the link text wasn't sent and is on the clipboard.")
            dismiss()
        case .cancelled:
            error = "Not sent. The link is made (\(saved.url)); tap again to text it."
        case .failed(let message):
            error = message
        }
    }
}

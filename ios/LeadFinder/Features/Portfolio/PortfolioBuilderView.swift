import PhotosUI
import SwiftUI

/// Where the builder starts: a new link (maybe for an agent already picked,
/// as from their profile's "Create portfolio"), an existing one, or a page
/// that isn't saved yet (the Create portfolio quick action's), which is
/// edited in place and handed back rather than saved.
enum PortfolioBuilderStart: Identifiable {
    case new(agent: PortfolioAgentMatch?)
    case editing(linkId: String)
    case draft(PortfolioDraft)

    var id: String {
        switch self {
        case .new(let agent): "new-\(agent?.id ?? "")"
        case .editing(let linkId): "edit-\(linkId)"
        case .draft(let draft): "draft-\(draft.agent?.id ?? "")"
        }
    }
}

/// One agent page while it's being put together: everything the builder
/// edits, as one value, so it can be filled in one go (no fields popping in
/// one by one), handed between screens, and compared to spot unsaved edits.
struct PortfolioDraft: Hashable, Sendable {
    var agent: PortfolioAgentMatch?
    var firstName = ""
    var area = ""
    var brokerage = ""
    var listings: [PortfolioListing] = []
    var video = "summit"
    /// A key of the catalog's photos; blank = its first choice.
    var leadPhoto = ""
    var showTourOfHomes = true
    var showOffer = true
    var beforeSrc: String?
    var afterSrc: String?
    /// The link preview image, from an area template; nil = the lead photo.
    var ogImage: String?
    /// The area template it was filled in from, if any.
    var templateName: String?

    init(agent: PortfolioAgentMatch? = nil) {
        self.agent = agent
    }

    /// Filled in for an agent as the web builder does on picking them: their
    /// first name, area and brokerage, and the area template's listings and
    /// settings (else their nearest jobs and the defaults).
    init(prefill: PortfolioPrefill, agent: PortfolioAgentMatch) {
        self.agent = agent
        firstName = prefill.firstName
        area = prefill.area
        brokerage = prefill.brokerage
        listings = Self.unique(prefill.listings)
        let t = prefill.template?.content
        templateName = prefill.template?.name
        showTourOfHomes = t?.showTourOfHomes ?? true
        showOffer = t?.showOffer ?? true
        video = t?.video ?? "summit"
        leadPhoto = t?.leadPhoto ?? ""
        ogImage = t?.ogImage
    }

    init(saved: PortfolioEditResponse) {
        let c = saved.content
        agent = saved.agent
        firstName = c.agentFirstName ?? ""
        area = c.area ?? ""
        brokerage = c.brokerage ?? ""
        listings = Self.unique(c.listings ?? [])
        video = c.video ?? "summit"
        leadPhoto = c.leadPhoto ?? ""
        showTourOfHomes = c.showTourOfHomes ?? true
        showOffer = c.showOffer ?? true
        ogImage = c.ogImage
        if c.beforeAfter == true {
            beforeSrc = c.beforeSrc
            afterSrc = c.afterSrc
        }
    }

    var content: PortfolioContent {
        PortfolioContent(
            area: area.nilIfBlank,
            agentFirstName: firstName.nilIfBlank,
            brokerage: brokerage.nilIfBlank,
            video: video,
            leadPhoto: leadPhoto.nilIfBlank,
            showTourOfHomes: showTourOfHomes,
            showOffer: showOffer,
            // Only the after is needed: on its own it's shown against a dulled copy of itself.
            beforeAfter: afterSrc != nil,
            beforeSrc: afterSrc != nil ? beforeSrc : nil,
            afterSrc: afterSrc,
            listings: listings,
            ogImage: ogImage
        )
    }

    /// The listings are keyed by job in the form, so a job twice would confuse it.
    private static func unique(_ listings: [PortfolioListing]) -> [PortfolioListing] {
        var seen = Set<String>()
        return listings.filter { seen.insert($0.bookingId).inserted }
    }
}

/// The builder's fixed choices, fetched once per launch: they only change
/// with a deploy, and waiting on them every time the sheet opens was most of
/// its loading spinner.
@MainActor
enum PortfolioCatalogCache {
    private static var catalog: PortfolioCatalog?

    static func load() async throws -> PortfolioCatalog {
        if let catalog { return catalog }
        let fetched = try await APIClient.shared.portfolioCatalog()
        catalog = fetched
        return fetched
    }
}

/// Builds or edits one agent page: the web's PortfolioLinkBuilder. Picking an
/// agent fills in their first name, area, brokerage and Lukas's nearest
/// finished jobs as listings, all editable. Saving only writes the link:
/// nothing is sent to anyone. Editing saves in place (same URL, same activity).
/// A `.draft` start saves nothing: "Done" hands the page back (`onDone`).
struct PortfolioBuilderView: View {
    let start: PortfolioBuilderStart
    var onSaved: () -> Void = {}
    /// Set with a `.draft` start: called with the edited page on "Done".
    var onDone: ((PortfolioDraft) -> Void)? = nil

    @Environment(\.dismiss) private var dismiss

    @State private var linkId: String?
    @State private var draft = PortfolioDraft()
    /// The page as it was opened, so a swipe down can't throw edits away.
    @State private var initial = PortfolioDraft()
    @State private var query = ""
    @State private var suggestions: [PortfolioAgentMatch] = []

    @State private var catalog: PortfolioCatalog?
    @State private var loading = true
    @State private var loadingAgent = false
    @State private var saving = false
    @State private var error: String?
    @State private var result: APIClient.SavedPortfolioLink?
    @State private var copied = false
    @State private var texting = false
    @State private var textNote: String?

    @State private var jobQuery = ""
    @State private var jobResults: [PortfolioListing] = []
    @State private var beforePick: PhotosPickerItem?
    @State private var afterPick: PhotosPickerItem?
    @State private var uploading: Side?
    @State private var showListingEditor = false

    private enum Side { case before, after }

    private var editing: Bool { linkId != nil }
    private var isDraft: Bool { onDone != nil }

    var body: some View {
        NavigationStack {
            Group {
                if let result {
                    resultView(result)
                } else if loading {
                    VStack(spacing: 10) {
                        ProgressView()
                        if case .new(let agent?) = start {
                            Text("Filling in \(agent.name?.nilIfBlank ?? "their") page…")
                                .font(.footnote)
                                .foregroundStyle(Theme.tertiaryText)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    form
                }
            }
            .background(Theme.background)
            .navigationTitle(isDraft ? "Edit portfolio" : editing ? "Edit link" : "New link")
            .titleDisplay(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(result == nil ? "Cancel" : "Done") { dismiss() }
                }
                if result == nil, !loading {
                    ToolbarItem(placement: .confirmationAction) {
                        if saving {
                            ProgressView()
                        } else {
                            Button(isDraft ? "Done" : editing ? "Save" : "Create") { Task { await save() } }
                                .fontWeight(.semibold)
                                .disabled(loadingAgent || uploading != nil)
                        }
                    }
                }
            }
            .sheet(isPresented: $showListingEditor) {
                if let agent = draft.agent {
                    ListingPhotoEditorSheet(agent: agent) { before, after in
                        draft.beforeSrc = before
                        draft.afterSrc = after
                        showListingEditor = false
                    }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
        .interactiveDismissDisabled(result == nil && !loading && draft != initial)
        .task { await begin() }
    }

    // MARK: - Form

    private var form: some View {
        Form {
            agentSection
            if let templateName = draft.templateName, linkId == nil {
                Section {
                    Label("Filled in from the \u{201C}\(templateName)\u{201D} area template.", systemImage: "square.stack")
                        .font(.footnote)
                        .foregroundStyle(Theme.secondaryText)
                }
                .listRowBackground(Theme.card)
            }
            Section {
                field("First name", $draft.firstName, "Sarah")
                field("Area", $draft.area, "Eugene")
                field("Brokerage", $draft.brokerage, "")
            } header: {
                Text("About them")
            } footer: {
                Text("First name is the \u{201C}Thanks for taking a look, ___\u{201D} sign-off (blank hides it). Area is \u{201C}Real estate photo & video in ___\u{201D}. Brokerage is only in the prefilled \u{201C}Book a shoot\u{201D} text.")
            }
            .listRowBackground(Theme.card)

            beforeAfterSection
            listingsSection
            videoSection
            leadPhotoSection

            Section {
                Toggle("Show \u{201C}Featured in the Eugene Tour of Homes\u{201D}", isOn: $draft.showTourOfHomes)
                Toggle("Show the $50-off first shoot offer", isOn: $draft.showOffer)
            }
            .listRowBackground(Theme.card)

            if let error {
                Section { Text(error).font(.caption).foregroundStyle(Theme.danger) }
                    .listRowBackground(Theme.card)
            }
        }
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .tint(Theme.accent)
    }

    private func field(_ title: String, _ text: Binding<String>, _ prompt: String) -> some View {
        HStack {
            Text(title)
            Spacer(minLength: 12)
            TextField(prompt, text: text)
                .multilineTextAlignment(.trailing)
                .autocorrectionDisabled()
        }
    }

    // MARK: Agent

    private var agentSection: some View {
        Section {
            if let agent = draft.agent {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(agent.name?.nilIfBlank ?? "Unknown agent").font(.headline)
                        if let line = agent.phone?.nilIfBlank ?? agent.email?.nilIfBlank {
                            Text(line).font(.caption).foregroundStyle(Theme.secondaryText)
                        }
                    }
                    Spacer()
                    // The quick action's page is for the agent the message went to.
                    if !isDraft {
                        Button {
                            draft.agent = nil
                            query = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.tertiaryText)
                        }
                        .buttonStyle(.plain)
                    }
                }
                if loadingAgent {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Filling in from their profile…").font(.caption).foregroundStyle(Theme.secondaryText)
                    }
                }
            } else {
                TextField("Start typing a name", text: $query)
                    .autocorrectionDisabled()
                ForEach(suggestions) { match in
                    Button { Task { await pick(match) } } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(match.name?.nilIfBlank ?? "Unknown agent").foregroundStyle(Theme.primaryText)
                            Text(match.phone?.nilIfBlank ?? match.email?.nilIfBlank ?? "No contact info saved")
                                .font(.caption)
                                .foregroundStyle(Theme.secondaryText)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        } header: {
            Text("Agent")
        } footer: {
            if draft.agent == nil { Text("Optional, but it's what fills in the rest, and lets you see who opened it.") }
        }
        .listRowBackground(Theme.card)
        .task(id: query) { await searchAgents() }
    }

    private func searchAgents() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard draft.agent == nil, text.count >= 2 else {
            suggestions = []
            return
        }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        let found = (try? await APIClient.shared.searchPortfolioAgents(text)) ?? []
        guard !Task.isCancelled else { return }
        suggestions = found
    }

    /// Picking an agent replaces the page with theirs, as the web does.
    private func pick(_ match: PortfolioAgentMatch) async {
        draft.agent = match
        suggestions = []
        query = ""
        loadingAgent = true
        defer { loadingAgent = false }
        await fill(for: match)
    }

    /// Their page in one assignment, so the form changes once rather than
    /// field by field.
    private func fill(for match: PortfolioAgentMatch) async {
        do {
            let prefill = try await APIClient.shared.portfolioPrefill(agentId: match.id)
            var filled = PortfolioDraft(prefill: prefill, agent: match)
            if filled.leadPhoto.isEmpty { filled.leadPhoto = catalog?.leadPhotoChoices.first?.key ?? "" }
            // Photos already put on the page stay.
            filled.beforeSrc = draft.beforeSrc
            filled.afterSrc = draft.afterSrc
            draft = filled
        } catch {
            self.error = "Couldn't load that agent's details."
        }
    }

    // MARK: Before / after

    private var beforeAfterSection: some View {
        Section {
            HStack(spacing: 10) {
                imageSlot("Before", src: $draft.beforeSrc, pick: $beforePick, side: .before)
                imageSlot("After", src: $draft.afterSrc, pick: $afterPick, side: .after)
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))

            Button { showListingEditor = true } label: {
                Label("Edit a photo from their listing", systemImage: "wand.and.stars")
            }
            .disabled(draft.agent == nil)
        } header: {
            Text("Before / after")
        } footer: {
            Text(draft.agent == nil
                 ? "Leads the page when there's an after photo, with the video under it. Pick an agent first to edit one of their listing photos."
                 : "Leads the page when there's an after photo, with the video under it; without one, the video is the hero. No before photo = the after shown dulled.")
        }
        .listRowBackground(Theme.card)
        .onChange(of: beforePick) { Task { await upload(beforePick, side: .before) } }
        .onChange(of: afterPick) { Task { await upload(afterPick, side: .after) } }
    }

    /// A fixed-size tile either way, so picking, uploading or clearing a
    /// photo never changes the row's height.
    private func imageSlot(_ label: String, src: Binding<String?>, pick: Binding<PhotosPickerItem?>, side: Side) -> some View {
        ZStack(alignment: .topLeading) {
            if let url = PortfolioSite.imageURL(src.wrappedValue) {
                RemoteImage(photo: url.absoluteString, size: .card)
                    .frame(maxWidth: .infinity)
                    .frame(height: 110)
                    .clipped()
                    .overlay(alignment: .topTrailing) {
                        Button { src.wrappedValue = nil } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.white, .black.opacity(0.55))
                                .font(.title3)
                                .padding(5)
                        }
                        .buttonStyle(.plain)
                    }
                Text(label)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 4))
                    .foregroundStyle(.white)
                    .padding(6)
            } else {
                PhotosPicker(selection: pick, matching: .images) {
                    VStack(spacing: 4) {
                        if uploading == side {
                            ProgressView()
                            Text("Uploading…").font(.caption)
                        } else {
                            Image(systemName: "photo.badge.plus").font(.title3)
                            Text("\(label) photo").font(.caption)
                        }
                    }
                    .foregroundStyle(Theme.secondaryText)
                    .frame(maxWidth: .infinity)
                    .frame(height: 110)
                    .background(Theme.cardRaised)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(uploading != nil)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 110)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border, lineWidth: 0.5))
    }

    /// A photo from the library, shrunk to about 2400px JPEG, uploaded as the
    /// page's image.
    private func upload(_ item: PhotosPickerItem?, side: Side) async {
        guard let item else { return }
        uploading = side
        error = nil
        defer {
            uploading = nil
            if side == .before { beforePick = nil } else { afterPick = nil }
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self),
                  let jpeg = await PortfolioImages.jpeg(from: data)
            else {
                error = "Couldn't read that photo."
                return
            }
            let path = try await APIClient.shared.uploadPortfolioImage(jpeg: jpeg)
            if side == .before { draft.beforeSrc = path } else { draft.afterSrc = path }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: Listings

    private var listingsSection: some View {
        Section {
            // By job, not by position: removing one by index while its row
            // was still on screen read past the end of the array.
            ForEach($draft.listings) { $listing in
                DisclosureGroup {
                    listingFields($listing)
                    Button("Remove listing", role: .destructive) {
                        let id = listing.id
                        withAnimation { draft.listings.removeAll { $0.id == id } }
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(listing.address.nilIfBlank ?? "No address").font(.subheadline.weight(.medium))
                        Text([listing.status, listing.city, listing.price].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
            }
            .onDelete { draft.listings.remove(atOffsets: $0) }
            TextField("Add a job by address or city", text: $jobQuery)
                .autocorrectionDisabled()
            ForEach(jobResults.filter { job in !draft.listings.contains { $0.bookingId == job.bookingId } }) { job in
                Button {
                    withAnimation { draft.listings.append(job) }
                    jobQuery = ""
                    jobResults = []
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(job.address.nilIfBlank ?? "No address").foregroundStyle(Theme.primaryText)
                        Text([job.city, job.price].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "))
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text("Recent listings")
        } footer: {
            Text("Your finished jobs; none = the section is hidden. Each card's photos are 10 from across that job's gallery, front exterior first. Swipe one to remove it.")
        }
        .listRowBackground(Theme.card)
        .task(id: jobQuery) {
            let text = jobQuery.trimmingCharacters(in: .whitespaces)
            guard text.count >= 2 else {
                jobResults = []
                return
            }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            let found = (try? await APIClient.shared.searchPortfolioJobs(text)) ?? []
            guard !Task.isCancelled else { return }
            jobResults = found
        }
    }

    @ViewBuilder
    private func listingFields(_ listing: Binding<PortfolioListing>) -> some View {
        field("Address", listing.address, "")
        field("City", listing.city, "")
        field("Badge", listing.status, "Just listed")
        field("Price", listing.price, "")
        field("Beds", listing.beds, "")
        field("Baths", listing.baths, "")
        field("Sqft", listing.sqft, "")
        field("Type", listing.type, "")
        field("Listing agent", listing.agent, "")
        field("Brokerage", listing.brokerage, "")
    }

    // MARK: Video and lead photo

    private var videoSection: some View {
        Section("Video") {
            Picker("Video", selection: $draft.video) {
                ForEach(catalog?.videos ?? []) { Text($0.title).tag($0.key) }
            }
        }
        .listRowBackground(Theme.card)
    }

    /// A plain grid rather than a lazy one: a lazy grid inside a Form row
    /// can't size itself up front, so the row grew as photos arrived and the
    /// whole form jumped.
    private var leadPhotoSection: some View {
        let choices = catalog?.leadPhotoChoices ?? []
        let rows = stride(from: 0, to: choices.count, by: 3).map { Array(choices[$0..<min($0 + 3, choices.count)]) }
        return Section {
            Grid(horizontalSpacing: 6, verticalSpacing: 6) {
                ForEach(rows, id: \.first?.key) { row in
                    GridRow {
                        ForEach(row) { photo in leadPhotoTile(photo) }
                        // Keep a short last row's tiles the same width.
                        ForEach(row.count..<3, id: \.self) { _ in Color.clear.aspectRatio(3 / 2, contentMode: .fit) }
                    }
                }
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
        } header: {
            Text("Lead photo (first in the grid)")
        }
        .listRowBackground(Theme.card)
    }

    private func leadPhotoTile(_ photo: PortfolioCatalog.Photo) -> some View {
        let selected = draft.leadPhoto == photo.key
        return Button { draft.leadPhoto = photo.key } label: {
            Color.clear
                .aspectRatio(3 / 2, contentMode: .fit)
                .overlay { RemoteImage(photo: photo.src, size: .card) }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(selected ? Theme.accent : .clear, lineWidth: 3)
                )
                .opacity(selected ? 1 : 0.7)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(photo.alt)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: - Loading and saving

    /// Everything is fetched before the form shows, so it appears filled in
    /// rather than empty and then rearranging itself.
    private func begin() async {
        guard loading else { return }
        do {
            catalog = try await PortfolioCatalogCache.load()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }

        switch start {
        case .new(let preset):
            if let preset {
                draft = PortfolioDraft(agent: preset)
                await fill(for: preset)
            }
        case .editing(let id):
            do {
                let existing = try await APIClient.shared.portfolioLinkForEdit(id)
                linkId = existing.linkId
                draft = PortfolioDraft(saved: existing)
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        case .draft(let given):
            draft = given
        }
        if draft.leadPhoto.isEmpty { draft.leadPhoto = catalog?.leadPhotoChoices.first?.key ?? "" }
        initial = draft
        loading = false
    }

    private func save() async {
        if let onDone {
            onDone(draft)
            dismiss()
            return
        }
        saving = true
        error = nil
        defer { saving = false }
        do {
            let saved: APIClient.SavedPortfolioLink
            if let linkId {
                saved = try await APIClient.shared.updatePortfolioLink(id: linkId, agentId: draft.agent?.id, content: draft.content)
            } else {
                saved = try await APIClient.shared.createPortfolioLink(agentId: draft.agent?.id, content: draft.content)
            }
            initial = draft
            withAnimation(.easeInOut(duration: 0.2)) { result = saved }
            onSaved()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Result

    private func resultView(_ saved: APIClient.SavedPortfolioLink) -> some View {
        let agent = draft.agent
        return VStack(alignment: .leading, spacing: 14) {
            Text("\(editing ? "Saved" : "Link ready")\(agent?.name.flatMap { " for \($0)" } ?? ""):")
                .font(.headline)
                .foregroundStyle(Theme.primaryText)
            Text(saved.url)
                .font(.callout.monospaced())
                .foregroundStyle(Theme.primaryText)
                .textSelection(.enabled)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack(spacing: 10) {
                Button {
                    Platform.copy(saved.url)
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .frame(maxWidth: .infinity)
                }
                if let url = URL(string: saved.url) {
                    ShareLink(item: url) {
                        Label("Share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                    }
                }
                Button {
                    if let url = PortfolioSite.previewURL(saved.url) { Platform.open(url) }
                } label: {
                    Label("Preview", systemImage: "eye").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.bordered)
            if let id = saved.id, let agent, agent.phone?.nilIfBlank != nil {
                Button { Task { await textIt(id) } } label: {
                    HStack(spacing: 8) {
                        if texting { ProgressView().controlSize(.small) } else { Image(systemName: "message.fill") }
                        Text("Text it to \(agent.name?.split(separator: " ").first.map(String.init) ?? "them")")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(texting)
                Text("Sends the Portfolio link template's two texts, then logs it in their history.")
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
            }
            if let textNote {
                Text(textNote).font(.footnote).foregroundStyle(Theme.positive)
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(Theme.danger)
            }
            Text("Creating or saving a link sends nothing to anyone.")
                .font(.caption)
                .foregroundStyle(Theme.tertiaryText)
            Spacer()
        }
        .padding(20)
    }

    private func textIt(_ linkId: String) async {
        texting = true
        error = nil
        defer { texting = false }
        switch await PortfolioTexter.send(linkId: linkId) {
        case .sent:
            textNote = "Portfolio link texted."
        case .firstOnly:
            textNote = "Sent the first text; the link text wasn't sent and is on the clipboard."
        case .cancelled:
            break
        case .failed(let message):
            error = message
        }
    }
}

// MARK: - Images

enum PortfolioImages {
    /// About 2400px on the long side at JPEG 0.86, as the web builder shrinks
    /// an upload: phone photos are 5 to 15 MB, and the server takes 8.
    static func jpeg(from data: Data, maxPixel: CGFloat = 2400) async -> Data? {
        await Task.detached(priority: .userInitiated) {
            guard let image = PlatformImage.downsampling(data, maxPixel: maxPixel) else { return nil }
            return image.encodedJPEG(quality: 0.86)
        }.value
    }

    static func dataURL(_ jpeg: Data) -> String {
        "data:image/jpeg;base64,\(jpeg.base64EncodedString())"
    }
}

// MARK: - Edit a photo from their listing

/// Their listings' photos in the existing photo editor; a finished edit comes
/// back as the page's before/after through "Use as before/after".
private struct ListingPhotoEditorSheet: View {
    let agent: PortfolioAgentMatch
    var onUse: (_ beforeSrc: String, _ afterSrc: String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var groups: [PortfolioListingPhotosResponse.Group]?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let groups {
                    PhotoEditorView(
                        photoGroups: groups,
                        useLabel: "Use as before/after",
                        onUse: { source, edit in
                            // The original: a listing photo goes by URL (the
                            // server fetches it at full size); a library photo
                            // as the JPEG that was sent for editing.
                            let before: String
                            switch source {
                            case .url(let url): before = url
                            case .jpeg(let data): before = PortfolioImages.dataURL(data)
                            }
                            guard let shrunk = await PortfolioImages.jpeg(from: edit) else {
                                throw APIError.decoding("Couldn't read the edited photo")
                            }
                            let saved = try await APIClient.shared.saveBeforeAfter(before: before, after: PortfolioImages.dataURL(shrunk))
                            onUse(saved.beforeSrc, saved.afterSrc)
                        }
                    )
                } else if let error {
                    EmptyStateView(icon: "wifi.exclamationmark", title: "Couldn't load their listings", message: error)
                } else {
                    VStack(spacing: 10) {
                        ProgressView()
                        Text("Loading their listings…").font(.subheadline).foregroundStyle(Theme.secondaryText)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(Theme.background)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .task {
                do {
                    groups = try await APIClient.shared.portfolioListingPhotos(agentId: agent.id)
                } catch {
                    self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
    }
}

import PhotosUI
import SwiftUI

/// Where the builder starts: a new link (maybe for an agent already picked,
/// as from their profile's "Create portfolio"), or an existing one.
enum PortfolioBuilderStart: Identifiable {
    case new(agent: PortfolioAgentMatch?)
    case editing(linkId: String)

    var id: String {
        switch self {
        case .new(let agent): "new-\(agent?.id ?? "")"
        case .editing(let linkId): "edit-\(linkId)"
        }
    }
}

/// Builds or edits one agent page: the web's PortfolioLinkBuilder. Picking an
/// agent fills in their first name, area, brokerage and Lukas's nearest
/// finished jobs as listings, all editable. Saving only writes the link:
/// nothing is sent to anyone. Editing saves in place (same URL, same activity).
struct PortfolioBuilderView: View {
    let start: PortfolioBuilderStart
    var onSaved: () -> Void = {}

    @Environment(\.dismiss) private var dismiss

    @State private var linkId: String?
    @State private var agent: PortfolioAgentMatch?
    @State private var query = ""
    @State private var suggestions: [PortfolioAgentMatch] = []
    @State private var firstName = ""
    @State private var area = ""
    @State private var brokerage = ""
    @State private var listings: [PortfolioListing] = []
    @State private var video = "summit"
    @State private var leadPhoto = ""
    @State private var showTourOfHomes = true
    @State private var showOffer = true
    @State private var beforeSrc: String?
    @State private var afterSrc: String?
    @State private var ogImage: String?
    @State private var templateName: String?

    @State private var catalog: PortfolioCatalog?
    @State private var loading = true
    @State private var loadingAgent = false
    @State private var saving = false
    @State private var error: String?
    @State private var result: APIClient.SavedPortfolioLink?
    @State private var copied = false

    @State private var jobQuery = ""
    @State private var jobResults: [PortfolioListing] = []
    @State private var beforePick: PhotosPickerItem?
    @State private var afterPick: PhotosPickerItem?
    @State private var uploading: Side?
    @State private var showListingEditor = false

    private enum Side { case before, after }

    private var editing: Bool { linkId != nil }

    var body: some View {
        NavigationStack {
            Group {
                if let result {
                    resultView(result)
                } else if loading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    form
                }
            }
            .background(Theme.background)
            .navigationTitle(editing ? "Edit link" : "New link")
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
                            Button(editing ? "Save" : "Create") { Task { await save() } }
                                .fontWeight(.semibold)
                                .disabled(loadingAgent || uploading != nil)
                        }
                    }
                }
            }
            .sheet(isPresented: $showListingEditor) {
                if let agent {
                    ListingPhotoEditorSheet(agent: agent) { before, after in
                        beforeSrc = before
                        afterSrc = after
                        showListingEditor = false
                    }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
        .task { await begin() }
    }

    // MARK: - Form

    private var form: some View {
        Form {
            agentSection
            if let templateName, linkId == nil {
                Section {
                    Text("Using the \u{201C}\(templateName)\u{201D} area template.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(Theme.card)
            }
            Section {
                field("First name", $firstName, "Sarah")
                field("Area", $area, "Eugene")
                field("Brokerage", $brokerage, "")
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
                Toggle("Show \u{201C}Featured in the Eugene Tour of Homes\u{201D}", isOn: $showTourOfHomes)
                Toggle("Show the $50-off first shoot offer", isOn: $showOffer)
            }
            .listRowBackground(Theme.card)

            if let error {
                Section { Text(error).font(.caption).foregroundStyle(Theme.danger) }
                    .listRowBackground(Theme.card)
            }
        }
        .scrollContentBackground(.hidden)
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
            if let agent {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(agent.name?.nilIfBlank ?? "Unknown agent").font(.headline)
                        if let line = agent.phone?.nilIfBlank ?? agent.email?.nilIfBlank {
                            Text(line).font(.caption).foregroundStyle(Theme.secondaryText)
                        }
                    }
                    Spacer()
                    Button {
                        self.agent = nil
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.tertiaryText)
                    }
                    .buttonStyle(.plain)
                }
                if loadingAgent {
                    Text("Filling in from their profile…").font(.caption).foregroundStyle(Theme.secondaryText)
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
                    }
                    .buttonStyle(.plain)
                }
            }
        } header: {
            Text("Agent")
        } footer: {
            if agent == nil { Text("Optional, but it's what fills in the rest, and lets you see who opened it.") }
        }
        .listRowBackground(Theme.card)
        .task(id: query) { await searchAgents() }
    }

    private func searchAgents() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard agent == nil, text.count >= 2 else {
            suggestions = []
            return
        }
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        suggestions = (try? await APIClient.shared.searchPortfolioAgents(text)) ?? []
    }

    /// Picking an agent replaces the text fields and listings with theirs, as the web does.
    private func pick(_ match: PortfolioAgentMatch) async {
        agent = match
        suggestions = []
        query = ""
        loadingAgent = true
        defer { loadingAgent = false }
        do {
            let prefill = try await APIClient.shared.portfolioPrefill(agentId: match.id)
            firstName = prefill.firstName
            area = prefill.area
            brokerage = prefill.brokerage
            listings = prefill.listings
            // The area template's settings, else back to the defaults.
            let t = prefill.template?.content
            templateName = prefill.template?.name
            showTourOfHomes = t?.showTourOfHomes ?? true
            showOffer = t?.showOffer ?? true
            video = t?.video ?? "summit"
            leadPhoto = t?.leadPhoto ?? catalog?.leadPhotoChoices.first?.key ?? ""
            ogImage = t?.ogImage
        } catch {
            self.error = "Couldn't load that agent's details."
        }
    }

    // MARK: Before / after

    private var beforeAfterSection: some View {
        Section {
            HStack(spacing: 10) {
                imageSlot("Before", src: $beforeSrc, pick: $beforePick, side: .before)
                    .frame(maxWidth: .infinity)
                imageSlot("After", src: $afterSrc, pick: $afterPick, side: .after)
                    .frame(maxWidth: .infinity)
            }
            .frame(maxWidth: .infinity)
            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))

            Button { showListingEditor = true } label: {
                Label("Edit a photo from their listing", systemImage: "wand.and.stars")
            }
            .disabled(agent == nil)
        } header: {
            Text("Before / after")
        } footer: {
            Text(agent == nil
                 ? "Leads the page when there's an after photo, with the video under it. Pick an agent first to edit one of their listing photos."
                 : "Leads the page when there's an after photo, with the video under it; without one, the video is the hero. No before photo = the after shown dulled.")
        }
        .listRowBackground(Theme.card)
        .onChange(of: beforePick) { Task { await upload(beforePick, side: .before) } }
        .onChange(of: afterPick) { Task { await upload(afterPick, side: .after) } }
    }

    private func imageSlot(_ label: String, src: Binding<String?>, pick: Binding<PhotosPickerItem?>, side: Side) -> some View {
        ZStack(alignment: .topLeading) {
            if let url = PortfolioSite.imageURL(src.wrappedValue) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    ProgressView()
                }
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
                }
                .buttonStyle(.plain)
                .disabled(uploading != nil)
            }
        }
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
            if side == .before { beforeSrc = path } else { afterSrc = path }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: Listings

    private var listingsSection: some View {
        Section {
            ForEach(listings.indices, id: \.self) { index in
                DisclosureGroup {
                    listingFields($listings[index])
                    Button("Remove listing", role: .destructive) { listings.remove(at: index) }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(listings[index].address.nilIfBlank ?? "No address").font(.subheadline.weight(.medium))
                        Text([listings[index].status, listings[index].city, listings[index].price].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
            }
            TextField("Add a job by address or city", text: $jobQuery)
                .autocorrectionDisabled()
            ForEach(jobResults.filter { job in !listings.contains { $0.bookingId == job.bookingId } }) { job in
                Button {
                    listings.append(job)
                    jobQuery = ""
                    jobResults = []
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(job.address.nilIfBlank ?? "No address").foregroundStyle(Theme.primaryText)
                        Text([job.city, job.price].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "))
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text("Recent listings")
        } footer: {
            Text("Your finished jobs; none = the section is hidden. Each card's photos are 10 from across that job's gallery, front exterior first.")
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
            jobResults = (try? await APIClient.shared.searchPortfolioJobs(text)) ?? []
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
            Picker("Video", selection: $video) {
                ForEach(catalog?.videos ?? []) { Text($0.title).tag($0.key) }
            }
        }
        .listRowBackground(Theme.card)
    }

    private var leadPhotoSection: some View {
        Section {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                ForEach(catalog?.leadPhotoChoices ?? []) { photo in
                    Button { leadPhoto = photo.key } label: {
                        AsyncImage(url: URL(string: photo.src)) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Theme.cardRaised
                        }
                        .frame(maxWidth: .infinity)
                        .aspectRatio(3 / 2, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .strokeBorder(leadPhoto == photo.key ? Theme.accent : .clear, lineWidth: 3)
                        )
                        .opacity(leadPhoto == photo.key ? 1 : 0.7)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(photo.alt)
                }
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
        } header: {
            Text("Lead photo (first in the grid)")
        }
        .listRowBackground(Theme.card)
    }

    // MARK: - Loading and saving

    private func begin() async {
        defer { loading = false }
        do {
            catalog = try await APIClient.shared.portfolioCatalog()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        leadPhoto = catalog?.leadPhotoChoices.first?.key ?? ""

        switch start {
        case .new(let preset):
            if let preset {
                loading = false
                await pick(preset)
            }
        case .editing(let id):
            do {
                let existing = try await APIClient.shared.portfolioLinkForEdit(id)
                linkId = existing.linkId
                agent = existing.agent
                let c = existing.content
                firstName = c.agentFirstName ?? ""
                area = c.area ?? ""
                brokerage = c.brokerage ?? ""
                listings = c.listings ?? []
                video = c.video ?? "summit"
                leadPhoto = c.leadPhoto ?? leadPhoto
                showTourOfHomes = c.showTourOfHomes ?? true
                showOffer = c.showOffer ?? true
                ogImage = c.ogImage
                if c.beforeAfter == true {
                    beforeSrc = c.beforeSrc
                    afterSrc = c.afterSrc
                }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        let content = PortfolioContent(
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
        do {
            if let linkId {
                result = try await APIClient.shared.updatePortfolioLink(id: linkId, agentId: agent?.id, content: content)
            } else {
                result = try await APIClient.shared.createPortfolioLink(agentId: agent?.id, content: content)
            }
            onSaved()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Result

    private func resultView(_ saved: APIClient.SavedPortfolioLink) -> some View {
        VStack(alignment: .leading, spacing: 14) {
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
            Text("Creating or saving a link sends nothing to anyone.")
                .font(.caption)
                .foregroundStyle(Theme.tertiaryText)
            Spacer()
        }
        .padding(20)
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

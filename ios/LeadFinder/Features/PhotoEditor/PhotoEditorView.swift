import SwiftUI
import PhotosUI
import ImageIO
import UniformTypeIdentifiers

/// The web's /photo-editor on the phone: find a listing (or pick photos from
/// the library), choose which photos to edit, run a preset, compare before and
/// after, and save the lot. Opened from the Leads tab's toolbar, or from a
/// lead with that listing already loaded.
struct PhotoEditorView: View {
    /// When opened from a listing, its photos load straight away.
    var listingId: String?
    /// A preset to start on (Follow up's "twilight gift" opens on its own).
    var initialPresetId: String?
    /// Set by the portfolio builder: pick from these listing groups (an
    /// agent's own listings) instead of searching, and offer `useLabel` on
    /// every finished edit, calling `onUse` with the original and the edit.
    var photoGroups: [PortfolioListingPhotosResponse.Group]?
    var useLabel: String?
    var onUse: ((APIClient.EditSource, Data) async throws -> Void)?

    @State private var listing: ListingHeader?
    @State private var photos: [EditorPhoto] = []
    @State private var selected: Set<String> = []
    @State private var presets: [APIClient.PhotoPreset] = []
    @State private var presetId = ""
    @State private var customPrompt = ""
    @State private var edits: [String: EditState] = [:]
    @State private var query = ""
    @State private var results: [APIClient.EditorListing] = []
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var exportFiles: [String: URL] = [:]
    @State private var error: String?
    @State private var groupIndex = 0
    /// The photo whose "use" is in flight.
    @State private var usingId: String?

    /// At once: each edit takes 10–25 s, and more in parallel only meets
    /// Gemini's rate limit sooner. Same as the web page.
    private static let concurrency = 3
    private static let customId = "custom"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ErrorBanner(message: error, onRetry: nil)
                sourceSection
                if !photos.isEmpty {
                    photoGrid
                    presetSection
                }
                if !editedPhotos.isEmpty { editsSection }
            }
            .padding(16)
        }
        .background(Theme.background)
        .navigationTitle("Photo editor")
        .titleDisplay(.inline)
        .task { await loadPresets() }
        .task { if let listingId { await loadListing(listingId) } }
        .task { if photoGroups != nil { loadGroup(0) } }
        .task(id: query) { await search() }
        .onChange(of: pickerItems) { Task { await addPicked() } }
    }

    // MARK: - Source

    @ViewBuilder
    private var sourceSection: some View {
        if let groups = photoGroups {
            groupSection(groups)
        } else {
            searchSection
        }
    }

    /// An agent's own listings, newest first: one menu, then its photos.
    private func groupSection(_ groups: [PortfolioListingPhotosResponse.Group]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if groups.isEmpty {
                Text("No listings with photos on file for them. Upload a before/after instead.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.secondaryText)
            } else {
                Picker("Listing", selection: $groupIndex) {
                    ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
                        Text("\(group.label) (\(group.photos.count))").tag(index)
                    }
                }
                .pickerStyle(.menu)
                .onChange(of: groupIndex) { loadGroup(groupIndex) }
                .card()
            }
        }
    }

    private func loadGroup(_ index: Int) {
        guard let groups = photoGroups, groups.indices.contains(index) else { return }
        let group = groups[index]
        listing = ListingHeader(address: group.label, detail: nil)
        photos = group.photos.enumerated().map { number, url in
            EditorPhoto(id: "group\(index)-\(number)", source: .url(url), name: "\(number + 1)")
        }
        selected = []
        edits = [:]
        exportFiles = [:]
        error = nil
    }

    private var searchSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.tertiaryText)
                TextField("Find a listing by address, city, or agent", text: $query)
                    .autocorrectionDisabled()
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
            .card()

            if !results.isEmpty {
                VStack(spacing: 0) {
                    ForEach(results) { result in
                        Button {
                            query = ""
                            results = []
                            Task { await loadListing(result.id) }
                        } label: {
                            searchRow(result)
                        }
                        .buttonStyle(.plain)
                        if result.id != results.last?.id { Divider().overlay(Theme.hairline) }
                    }
                }
                .card(padding: 0)
            }

            PhotosPicker(selection: $pickerItems, matching: .images) {
                Label("Pick photos from the library", systemImage: "photo.badge.plus")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            if let listing {
                VStack(alignment: .leading, spacing: 2) {
                    Text(listing.address).font(.headline).foregroundStyle(Theme.primaryText)
                    if let detail = listing.detail {
                        Text(detail).font(.caption).foregroundStyle(Theme.secondaryText)
                    }
                }
            }
        }
    }

    private func searchRow(_ result: APIClient.EditorListing) -> some View {
        HStack(spacing: 10) {
            Group {
                if let thumb = result.thumb {
                    RemoteImage(photo: thumb, size: .card)
                } else {
                    Theme.cardRaised
                }
            }
            .frame(width: 44, height: 44)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 2) {
                Text(result.address?.nilIfBlank ?? "No address")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text([result.city, result.agentName, result.score.map { "score \($0)/10" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    // MARK: - Photos

    private var photoGrid: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Photos").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.primaryText)
                Text("\(selected.count) of \(photos.count) selected").font(.caption).foregroundStyle(Theme.secondaryText)
                Spacer()
                Button(selected.count == photos.count ? "Clear" : "Select all") {
                    selected = selected.count == photos.count ? [] : Set(photos.map(\.id))
                }
                .font(.caption.weight(.medium))
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                ForEach(photos) { photo in
                    let on = selected.contains(photo.id)
                    Button {
                        if on { selected.remove(photo.id) } else { selected.insert(photo.id) }
                    } label: {
                        photo.thumbnail
                            .frame(maxWidth: .infinity)
                            .aspectRatio(4 / 3, contentMode: .fit)
                            .clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .strokeBorder(on ? Theme.accent : .clear, lineWidth: 2.5)
                            )
                            .overlay(alignment: .topTrailing) {
                                if on {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(.white, Theme.accent)
                                        .padding(4)
                                }
                            }
                            .opacity(on ? 1 : 0.65)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var presetSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("Preset", selection: $presetId) {
                ForEach(presets) { Text($0.label).tag($0.id) }
                Text("Custom prompt").tag(Self.customId)
            }
            .pickerStyle(.menu)

            Text(presetId == Self.customId
                 ? "Describe the edit. Every edit is also told not to add, remove, or invent anything."
                 : presets.first { $0.id == presetId }?.description ?? "")
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)

            if presetId == Self.customId {
                TextField("e.g. Brighten the room, blue sky, straighten the verticals", text: $customPrompt, axis: .vertical)
                    .lineLimit(2...5)
                    .card()
            }

            Button {
                run(photos.filter { selected.contains($0.id) })
            } label: {
                Label("Edit \(selected.count) photo\(selected.count == 1 ? "" : "s")", systemImage: "wand.and.stars")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
            .disabled(selected.isEmpty || presetId.isEmpty)
        }
        .card()
    }

    // MARK: - Edits

    private var editedPhotos: [EditorPhoto] { photos.filter { edits[$0.id] != nil } }

    private var doneCount: Int {
        edits.values.filter { if case .done = $0 { true } else { false } }.count
    }

    private var editsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Edits").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.primaryText)
                Text("\(doneCount) done").font(.caption).foregroundStyle(Theme.secondaryText)
                Spacer()
                let files = editedPhotos.compactMap { exportFiles[$0.id] }
                if !files.isEmpty {
                    ShareLink(items: files) {
                        Label("Save all (\(files.count))", systemImage: "square.and.arrow.down")
                            .font(.caption.weight(.semibold))
                    }
                }
            }
            Text("Check each one before using it: the model redraws the photo and can still change details.")
                .font(.caption)
                .foregroundStyle(Theme.tertiaryText)

            ForEach(editedPhotos) { photo in
                editCard(photo)
            }
        }
    }

    @ViewBuilder
    private func editCard(_ photo: EditorPhoto) -> some View {
        let state = edits[photo.id]
        VStack(alignment: .leading, spacing: 8) {
            switch state {
            case .done(let data, _):
                if let after = PlatformImage(data: data) {
                    BeforeAfterView(before: photo.thumbnail, after: after)
                }
            case .failed(let message, _):
                placeholder(photo) { Text(message).font(.caption).foregroundStyle(.red).multilineTextAlignment(.center) }
            default:
                placeholder(photo) {
                    HStack(spacing: 6) { ProgressView(); Text("Editing…").font(.caption) }
                        .foregroundStyle(Theme.primaryText)
                }
            }

            HStack {
                Text(state?.label ?? "").font(.caption).foregroundStyle(Theme.secondaryText)
                Spacer()
                Button { run([photo]) } label: { Label("Redo", systemImage: "arrow.counterclockwise") }
                    .disabled(state?.isWorking == true)
                if let file = exportFiles[photo.id] {
                    ShareLink(item: file) { Image(systemName: "square.and.arrow.up") }
                }
                if let onUse, let useLabel, case .done(let data, _) = state {
                    Button {
                        Task { await use(photo, edit: data, with: onUse) }
                    } label: {
                        if usingId == photo.id {
                            ProgressView()
                        } else {
                            Label(useLabel, systemImage: "checkmark.circle.fill")
                        }
                    }
                    .disabled(usingId != nil)
                    .foregroundStyle(Theme.accent)
                }
                Button(role: .destructive) {
                    edits[photo.id] = nil
                    exportFiles[photo.id] = nil
                } label: { Image(systemName: "xmark") }
                    .disabled(state?.isWorking == true)
            }
            .font(.caption.weight(.medium))
            .buttonStyle(.borderless)
        }
        .card()
    }

    private func placeholder<Overlay: View>(_ photo: EditorPhoto, @ViewBuilder overlay: () -> Overlay) -> some View {
        photo.thumbnail
            .frame(maxWidth: .infinity)
            .aspectRatio(4 / 3, contentMode: .fit)
            .clipped()
            .opacity(0.35)
            .overlay { overlay().padding() }
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Actions

    private func loadPresets() async {
        do {
            presets = try await APIClient.shared.photoPresets()
            if presetId.isEmpty {
                presetId = presets.first { $0.id == initialPresetId }?.id ?? presets.first?.id ?? Self.customId
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadListing(_ id: String) async {
        do {
            let detail = try await APIClient.shared.listingDetail(id)
            let found = detail.listing
            listing = ListingHeader(
                address: found.address?.nilIfBlank ?? "Listing",
                detail: [found.city, found.agentName, found.score.map { "photo score \($0)/10" }]
                    .compactMap { $0?.nilIfBlank }
                    .joined(separator: " · ")
                    .nilIfBlank
            )
            photos = (found.photos ?? []).enumerated().map { index, url in
                EditorPhoto(id: "\(id)-\(index)", source: .url(url), name: "\(index + 1)")
            }
            selected = []
            edits = [:]
            exportFiles = [:]
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard text.count >= 2 else {
            results = []
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        results = (try? await APIClient.shared.searchEditorListings(text)) ?? []
    }

    private func addPicked() async {
        let items = pickerItems
        guard !items.isEmpty else { return }
        pickerItems = []
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let jpeg = await Task.detached(operation: { Self.shrinkToJPEG(data) }).value
            else { continue }
            let photo = EditorPhoto(id: "upload-\(UUID().uuidString)", source: .jpeg(jpeg), name: "upload-\(photos.count + 1)")
            photos.append(photo)
            selected.insert(photo.id)
        }
    }

    private func run(_ targets: [EditorPhoto]) {
        guard !targets.isEmpty else { return }
        let isCustom = presetId == Self.customId
        let prompt = isCustom ? customPrompt.trimmingCharacters(in: .whitespacesAndNewlines) : nil
        if isCustom && (prompt ?? "").isEmpty {
            error = "Write a prompt first"
            return
        }
        let presetId = isCustom ? nil : self.presetId
        let label = isCustom ? "Custom" : presets.first { $0.id == self.presetId }?.label ?? "Edit"
        for photo in targets {
            edits[photo.id] = .working(label: label)
            exportFiles[photo.id] = nil
        }
        let jobs = targets.map { EditJob(id: $0.id, source: $0.source, file: fileName($0)) }
        let edit: @Sendable (EditJob) async -> EditOutcome = { job in
            do {
                let data = try await APIClient.shared.editPhoto(job.source, presetId: presetId, prompt: prompt)
                return EditOutcome(job: job, data: data, failure: nil)
            } catch {
                return EditOutcome(job: job, data: nil, failure: error.localizedDescription)
            }
        }

        Task {
            await withTaskGroup(of: EditOutcome.self) { group in
                var pending = jobs[...]
                for _ in 0..<Self.concurrency {
                    guard let job = pending.popFirst() else { break }
                    group.addTask { await edit(job) }
                }
                for await outcome in group {
                    if let data = outcome.data {
                        edits[outcome.job.id] = .done(data, label: label)
                        exportFiles[outcome.job.id] = Self.writeExport(data, name: outcome.job.file)
                    } else {
                        edits[outcome.job.id] = .failed(outcome.failure ?? "Edit failed", label: label)
                    }
                    if let next = pending.popFirst() {
                        group.addTask { await edit(next) }
                    }
                }
            }
        }
    }

    private func use(_ photo: EditorPhoto, edit: Data, with onUse: (APIClient.EditSource, Data) async throws -> Void) async {
        usingId = photo.id
        defer { usingId = nil }
        do {
            try await onUse(photo.source, edit)
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func fileName(_ photo: EditorPhoto) -> String {
        let base = (listing?.address ?? "photo")
            .lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return "\(base.isEmpty ? "photo" : base)-\(photo.name).jpg"
    }

    /// A file the share sheet can save to Photos or Files, named after the listing.
    private static func writeExport(_ data: Data, name: String) -> URL? {
        let folder = FileManager.default.temporaryDirectory.appending(path: "photo-editor", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: name)
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    /// Library photos are shrunk to 2048 px JPEG before sending: a phone's
    /// 4000 px original would pass the server's 4.5 MB request limit.
    nonisolated private static func shrinkToJPEG(_ data: Data, maxPixel: Int = 2048) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }
}

// MARK: - Model

private struct EditJob: Sendable {
    let id: String
    let source: APIClient.EditSource
    let file: String
}

private struct EditOutcome: Sendable {
    let job: EditJob
    let data: Data?
    let failure: String?
}

private struct ListingHeader {
    let address: String
    let detail: String?
}

private struct EditorPhoto: Identifiable {
    let id: String
    let source: APIClient.EditSource
    /// Numbers the saved file: "1", "2", … for a listing's photos.
    let name: String

    @ViewBuilder
    var thumbnail: some View {
        switch source {
        case .url(let url):
            RemoteImage(photo: url, size: .card)
        case .jpeg(let data):
            if let image = PlatformImage(data: data) {
                image.swiftUIImage.resizable().scaledToFill()
            } else {
                Theme.cardRaised
            }
        }
    }
}

private enum EditState {
    case working(label: String)
    case done(Data, label: String)
    case failed(String, label: String)

    var label: String {
        switch self {
        case .working(let label), .done(_, let label), .failed(_, let label): label
        }
    }

    var isWorking: Bool {
        if case .working = self { true } else { false }
    }
}

/// Original and edit in the same frame, with a slider choosing how much of
/// each shows. A slider rather than dragging on the photo itself, which would
/// fight the screen's scrolling.
private struct BeforeAfterView<Before: View>: View {
    let before: Before
    let after: PlatformImage
    @State private var position = 0.5

    var body: some View {
        VStack(spacing: 6) {
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    after.swiftUIImage
                        .resizable()
                        .scaledToFill()
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .clipped()
                    before
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .clipped()
                        .mask(alignment: .leading) {
                            Rectangle().frame(width: geometry.size.width * position)
                        }
                    Rectangle()
                        .fill(.white)
                        .frame(width: 2)
                        .offset(x: geometry.size.width * position - 1)
                }
                .overlay(alignment: .topLeading) { tag("Before") }
                .overlay(alignment: .topTrailing) { tag("After") }
            }
            .aspectRatio(4 / 3, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            Slider(value: $position, in: 0...1)
                .tint(Theme.accent)
        }
    }

    private func tag(_ text: String) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 4))
            .padding(6)
    }
}

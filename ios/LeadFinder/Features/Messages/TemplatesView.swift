import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Every template, grouped the way the web's Messaging page groups them: texts
/// then emails, initial outreach then follow-ups. Tap one to edit it.
struct TemplatesView: View {
    @State private var presets: [PresetSummary]?
    @State private var error: String?

    private static let groups: [(channel: String, type: String, title: String)] = [
        ("sms", "initial_outreach", "Texts · Initial outreach"),
        ("sms", "follow_up", "Texts · Follow-up"),
        ("email", "initial_outreach", "Emails · Initial outreach"),
        ("email", "follow_up", "Emails · Follow-up"),
    ]

    var body: some View {
        Group {
            if let presets {
                list(presets)
            } else if let error {
                VStack(spacing: 14) {
                    EmptyStateView(icon: "wifi.exclamationmark", title: "Couldn't load templates", message: error)
                    Button("Try again") { Task { await load() } }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .navigationTitle("Templates")
        .titleDisplay(.inline)
        .task { await load() }
    }

    private func list(_ presets: [PresetSummary]) -> some View {
        List {
            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(Theme.danger)
                    .listRowBackground(Theme.card)
            }
            ForEach(Self.groups, id: \.title) { group in
                let rows = presets.filter { $0.channel == group.channel && $0.type == group.type }
                if !rows.isEmpty {
                    Section(group.title) {
                        ForEach(rows) { preset in
                            NavigationLink {
                                TemplateEditor(preset: preset, all: presets) { await load() }
                            } label: {
                                TemplateRow(preset: preset)
                            }
                            .listRowBackground(Theme.card)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .refreshable { await load() }
    }

    private func load() async {
        do {
            presets = try await APIClient.shared.presets()
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

private struct TemplateRow: View {
    let preset: PresetSummary

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(preset.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(preset.enabled ? Theme.primaryText : Theme.tertiaryText)
                    .lineLimit(1)
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if !preset.enabled {
                BadgeChip(text: "Off", tint: Theme.tertiaryText)
            } else if preset.quickActionOnly {
                BadgeChip(text: "Quick action", tint: Theme.accent)
            }
        }
    }

    private var summary: String {
        var parts: [String] = []
        if preset.aiGenerated {
            parts.append("AI draft")
        } else {
            let on = preset.variants.filter(\.enabled).count
            parts.append(on == preset.variants.count ? Self.count(on, "variant") : "\(on) of \(preset.variants.count) variants on")
        }
        if !preset.attachments.isEmpty { parts.append(Self.count(preset.attachments.count, "file")) }
        if !preset.quickActionPresetIds.isEmpty {
            parts.append(Self.count(preset.quickActionPresetIds.count, "quick action"))
        }
        return parts.joined(separator: " · ")
    }

    private static func count(_ n: Int, _ noun: String) -> String {
        "\(n) \(noun)\(n == 1 ? "" : "s")"
    }
}

/// One template: its name, whether it's on, the wording of each variant, the
/// second message, its quick actions and its attachments.
///
/// The wording and settings are saved together with Save. Attachments are
/// their own requests, so adding or removing one happens straight away.
struct TemplateEditor: View {
    let preset: PresetSummary
    let all: [PresetSummary]
    /// Reloads the list behind this screen.
    let onChange: () async -> Void

    @Environment(\.dismiss) private var dismiss

    private struct VariantDraft: Identifiable, Equatable {
        /// The server's id, or a local one for a variant not yet saved.
        var id: String
        var isNew = false
        var label: String
        var subject: String
        var body: String
        var enabled: Bool
    }

    @State private var name: String
    @State private var enabled: Bool
    @State private var secondMessage: String
    @State private var quickActionIds: [String]
    @State private var variants: [VariantDraft]
    @State private var attachments: [PresetAttachment]

    @State private var isReordering = false
    @State private var isSaving = false
    @State private var error: String?
    @State private var pickedPhotos: [PhotosPickerItem] = []
    @State private var importingFiles = false
    @State private var uploadStatus: String?

    init(preset: PresetSummary, all: [PresetSummary], onChange: @escaping () async -> Void) {
        self.preset = preset
        self.all = all
        self.onChange = onChange
        _name = State(initialValue: preset.name)
        _enabled = State(initialValue: preset.enabled)
        _secondMessage = State(initialValue: preset.secondMessage ?? "")
        _quickActionIds = State(initialValue: preset.quickActionPresetIds)
        _variants = State(initialValue: preset.variants.map(Self.draft))
        _attachments = State(initialValue: preset.attachments)
    }

    private static func draft(_ variant: PresetSummary.Variant) -> VariantDraft {
        VariantDraft(
            id: variant.id,
            label: variant.label,
            subject: variant.subject ?? "",
            body: variant.body,
            enabled: variant.enabled
        )
    }

    private var isEmail: Bool { preset.channel == "email" }

    var body: some View {
        Form {
            if let error {
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.danger)
                }
                .listRowBackground(Theme.card)
            }

            Section {
                TextField("Name", text: $name)
                Toggle("Enabled", isOn: $enabled)
            } footer: {
                if preset.quickActionOnly {
                    Text("Only ever a quick action: it's offered on a sent message once it's switched on, never in a send dialog.")
                }
            }
            .listRowBackground(Theme.card)

            if !preset.aiGenerated {
                ForEach($variants) { $variant in
                    Section(variant.isNew ? "New variant" : "Variant \(variant.label)") {
                        TextField("Label", text: $variant.label)
                        if isEmail {
                            TextField("Subject", text: $variant.subject)
                        }
                        TextField("Message", text: $variant.body, axis: .vertical)
                            .lineLimit(3...14)
                        if variant.isNew {
                            Button("Remove", role: .destructive) {
                                variants.removeAll { $0.id == variant.id }
                            }
                        } else {
                            Toggle("In the rotation", isOn: $variant.enabled)
                        }
                    }
                    .listRowBackground(Theme.card)
                }

                Section {
                    Button {
                        variants.append(VariantDraft(
                            id: UUID().uuidString,
                            isNew: true,
                            label: Self.nextLabel(after: variants.map(\.label)),
                            subject: "",
                            body: "",
                            enabled: true
                        ))
                    } label: {
                        Label("Add variant", systemImage: "plus")
                    }
                } footer: {
                    Text("{agent_name}, {address} and {city} are filled in for each agent and listing.")
                }
                .listRowBackground(Theme.card)
            }

            if !isEmail {
                if !preset.quickActionOnly {
                    Section {
                        TextField("None", text: $secondMessage, axis: .vertical)
                            .lineLimit(2...8)
                    } header: {
                        Text("Second message")
                    } footer: {
                        Text("Opens as a second text straight after the first is sent.")
                    }
                    .listRowBackground(Theme.card)
                }

                quickActionsSection
            }

            attachmentsSection
        }
        .reorderMode($isReordering)
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .tint(Theme.accent)
        .navigationTitle(preset.name)
        .titleDisplay(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if isSaving {
                    ProgressView().controlSize(.small)
                } else {
                    Button("Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(!canSave)
                }
            }
        }
        .onChange(of: pickedPhotos) { _, items in
            guard !items.isEmpty else { return }
            pickedPhotos = []
            Task { await addPhotos(items) }
        }
        .fileImporter(isPresented: $importingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): Task { await addFiles(urls) }
            case .failure(let failure): error = failure.localizedDescription
            }
        }
    }

    /// "A", "B" → "C"; anything else gets the count.
    private static func nextLabel(after labels: [String]) -> String {
        let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ").map(String.init)
        return letters.first { !labels.contains($0) } ?? "\(labels.count + 1)"
    }

    // MARK: - Quick actions

    /// What this template can offer, by the web's rule. Never itself.
    private var eligible: [PresetSummary] {
        all.filter { $0.id != preset.id && $0.canBeQuickAction }
    }

    private var quickActionsSection: some View {
        Section {
            ForEach(quickActionIds, id: \.self) { id in
                let other = all.first { $0.id == id }
                HStack(spacing: 8) {
                    Image(systemName: other?.channel == "email" ? "envelope" : "message")
                        .foregroundStyle(Theme.accent)
                        .frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(other?.name ?? "Removed template")
                            .foregroundStyle(Theme.primaryText)
                        // Still listed so it can be taken off, but the server
                        // leaves it out of a message's buttons.
                        if let other, !other.canBeQuickAction {
                            Text(other.enabled ? "Can't be a quick action" : "Switched off: hidden until it's on")
                                .font(.caption)
                                .foregroundStyle(Theme.tertiaryText)
                        }
                    }
                }
            }
            .onMove { quickActionIds.move(fromOffsets: $0, toOffset: $1) }
            .onDelete { quickActionIds.remove(atOffsets: $0) }

            ForEach(eligible.filter { !quickActionIds.contains($0.id) }) { other in
                Button {
                    quickActionIds.append(other.id)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "plus.circle")
                            .frame(width: 22)
                        Text(other.name)
                        Spacer(minLength: 0)
                        Text(other.channel == "email" ? "Email" : "Text")
                            .font(.caption)
                            .foregroundStyle(Theme.tertiaryText)
                    }
                }
            }
        } header: {
            HStack {
                Text("Quick actions")
                Spacer()
                if quickActionIds.count > 1 {
                    Button(isReordering ? "Done" : "Reorder") {
                        withAnimation { isReordering.toggle() }
                    }
                    .font(.caption)
                    .textCase(nil)
                }
            }
        } footer: {
            Text("The buttons on a message sent from this template, in this order.")
        }
        .listRowBackground(Theme.card)
    }

    // MARK: - Attachments

    private var attachmentsSection: some View {
        Section {
            ForEach(attachments) { attachment in
                HStack(spacing: 8) {
                    Image(systemName: attachment.symbol)
                        .foregroundStyle(Theme.accent)
                        .frame(width: 22)
                    Text(attachment.filename)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if let size = attachment.size {
                        Text(Int64(size).formatted(.byteCount(style: .file)))
                            .font(.caption)
                            .foregroundStyle(Theme.tertiaryText)
                    }
                }
                .deleteDisabled(uploadStatus != nil)
            }
            .onDelete { offsets in
                let removed = offsets.map { attachments[$0] }
                Task { await remove(removed) }
            }

            if let uploadStatus {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text(uploadStatus)
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                }
            } else {
                PhotosPicker(selection: $pickedPhotos, maxSelectionCount: 10, matching: .images) {
                    Label("Add photos", systemImage: "photo.on.rectangle")
                }
                Button {
                    importingFiles = true
                } label: {
                    Label("Add files", systemImage: "folder")
                }
            }
        } header: {
            Text("Attachments")
        } footer: {
            Text(isEmail
                ? "Sent with the email. Photos are shrunk to fit; other files can be 4 MB at most."
                : "Put in the text with the message. Photos are shrunk to fit; other files can be 4 MB at most.")
        }
        .listRowBackground(Theme.card)
    }

    private func addPhotos(_ items: [PhotosPickerItem]) async {
        error = nil
        defer { uploadStatus = nil }
        // Numbered on from what's there, so two batches don't share names.
        var number = attachments.count { $0.filename.hasPrefix("Photo ") } + 1
        for (index, item) in items.enumerated() {
            uploadStatus = "Adding photo \(index + 1) of \(items.count)…"
            do {
                guard let original = try await item.loadTransferable(type: Data.self) else {
                    error = "Couldn't read one of the photos."
                    continue
                }
                guard let jpeg = await AttachmentPrep.jpeg(from: original) else {
                    error = "One of the photos couldn't be made small enough to send."
                    continue
                }
                attachments = try await APIClient.shared.uploadAttachment(
                    presetId: preset.id,
                    data: jpeg,
                    contentType: "image/jpeg",
                    filename: "Photo \(number).jpg"
                )
                number += 1
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
        await onChange()
    }

    private func addFiles(_ urls: [URL]) async {
        error = nil
        defer { uploadStatus = nil }
        for (index, url) in urls.enumerated() {
            uploadStatus = urls.count == 1 ? "Adding \(url.lastPathComponent)…" : "Adding file \(index + 1) of \(urls.count)…"
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                var data = try Data(contentsOf: url)
                var filename = url.lastPathComponent
                let type = UTType(filenameExtension: url.pathExtension)
                var contentType = type?.preferredMIMEType ?? "application/octet-stream"

                // A photo from Files gets the same treatment as one from Photos
                // when it's too big to send as it is.
                if data.count > AttachmentPrep.maxBytes, type?.conforms(to: .image) == true {
                    guard let jpeg = await AttachmentPrep.jpeg(from: data) else {
                        error = "\(filename) couldn't be made small enough to send."
                        continue
                    }
                    data = jpeg
                    filename = url.deletingPathExtension().lastPathComponent + ".jpg"
                    contentType = "image/jpeg"
                }
                guard data.count <= AttachmentPrep.maxBytes else {
                    error = "\(filename) is over 4 MB."
                    continue
                }
                attachments = try await APIClient.shared.uploadAttachment(
                    presetId: preset.id,
                    data: data,
                    contentType: contentType,
                    filename: filename
                )
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
        await onChange()
    }

    private func remove(_ removed: [PresetAttachment]) async {
        error = nil
        for attachment in removed {
            do {
                try await APIClient.shared.deleteAttachment(presetId: preset.id, attachmentId: attachment.id)
                attachments.removeAll { $0.id == attachment.id }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
        await onChange()
    }

    // MARK: - Saving

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && variants.allSatisfy {
                !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    && !$0.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
    }

    /// Sends only what changed: one PATCH for the template if any of its own
    /// fields moved, and one request per variant that was edited or added.
    private func save() async {
        isSaving = true
        error = nil
        defer { isSaving = false }

        do {
            var patch = APIClient.PresetPatch()
            if name != preset.name { patch.name = name }
            if enabled != preset.enabled { patch.enabled = enabled }
            if secondMessage != (preset.secondMessage ?? "") { patch.secondMessage = secondMessage }
            if quickActionIds != preset.quickActionPresetIds { patch.quickActionPresetIds = quickActionIds }
            if patch.name != nil || patch.enabled != nil || patch.secondMessage != nil || patch.quickActionPresetIds != nil {
                _ = try await APIClient.shared.patchPreset(id: preset.id, patch)
            }

            for variant in variants {
                let subject = isEmail ? variant.subject : nil
                if variant.isNew {
                    try await APIClient.shared.createVariant(
                        presetId: preset.id,
                        label: variant.label,
                        body: variant.body,
                        subject: subject
                    )
                } else if let original = preset.variants.first(where: { $0.id == variant.id }),
                          Self.draft(original) != variant {
                    try await APIClient.shared.updateVariant(
                        id: variant.id,
                        label: variant.label,
                        body: variant.body,
                        subject: subject,
                        enabled: variant.enabled
                    )
                }
            }

            await onChange()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

/// Gets a photo under the server's attachment limit.
enum AttachmentPrep {
    /// The server's cap, one file per request.
    static let maxBytes = 4 * 1024 * 1024

    /// A JPEG of the photo, about 2048 px on its long edge and under 4 MB.
    /// Returns nil when the data isn't an image.
    static func jpeg(from data: Data) async -> Data? {
        await Task.detached(priority: .userInitiated) { shrink(data) }.value
    }

    private static func shrink(_ data: Data) -> Data? {
        guard let image = PlatformImage(data: data) else { return nil }
        // A little under the cap, so there's no arguing over a few bytes.
        let limit = maxBytes - 200_000

        for longEdge in [2048.0, 1600.0, 1280.0] {
            let resized = image.resized(longEdge: longEdge)
            for quality in [0.85, 0.7, 0.55] {
                if let jpeg = resized.encodedJPEG(quality: quality), jpeg.count <= limit {
                    return jpeg
                }
            }
        }
        return nil
    }
}

extension PresetAttachment {
    private var type: UTType? {
        contentType.flatMap { UTType(mimeType: $0) }
            ?? UTType(filenameExtension: (filename as NSString).pathExtension)
    }

    /// What `MFMessageComposeViewController.addAttachmentData` wants.
    var typeIdentifier: String {
        (type ?? .data).identifier
    }

    var symbol: String {
        guard let type else { return "doc" }
        if type.conforms(to: .image) { return "photo" }
        if type.conforms(to: .vCard) { return "person.crop.rectangle" }
        if type.conforms(to: .pdf) { return "doc.richtext" }
        return "doc"
    }
}

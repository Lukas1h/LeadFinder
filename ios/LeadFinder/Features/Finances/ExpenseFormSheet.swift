import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// What the expense form starts from: blank, prefilled from a booking, or an
/// expense being edited. Mirrors the web's `ExpenseDraft` (ExpenseDialog.tsx).
struct ExpenseDraft: Identifiable {
    var id = UUID()
    var expense: Expense?
    var date = FinanceFormat.today
    var bookingId: String?
    var tripId: String?
    /// Open the camera as soon as the form appears: the "photo a receipt" path.
    var startWithCamera = false

    static func editing(_ expense: Expense) -> ExpenseDraft {
        ExpenseDraft(expense: expense, date: expense.date, bookingId: expense.bookingId, tripId: expense.tripId)
    }
}

/// Adds or edits an expense, the web's ExpenseDialog. The fast path from the
/// phone: take a photo, it's shrunk and read (`POST /finances/receipts/read`),
/// the form fills itself in, Lukas checks it and saves, then the same photo is
/// uploaded as the expense's receipt. Nothing is saved until Save.
///
/// The category sets the usual deduction from `/finances/link-options`, which
/// can be changed; the categories themselves come from there too.
struct ExpenseFormSheet: View {
    let draft: ExpenseDraft
    var onSaved: () -> Void = {}

    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var date: Date
    @State private var amount: String
    @State private var description: String
    @State private var vendor: String
    @State private var category: String
    @State private var deductiblePercent: Int
    @State private var gallons: String
    @State private var pricePerGallon: String
    @State private var yearly: Bool
    @State private var paidPersonally: Bool
    @State private var bookingId: String?
    @State private var tripId: String?
    @State private var notes: String

    /// The receipt picked in this form, already shrunk; uploaded after Save.
    @State private var receipt: ReceiptFile?
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var showCamera = false
    @State private var importingPDF = false
    @State private var showReceipt = false
    @State private var busy: Busy?
    @State private var readNote: String?
    @State private var error: String?
    @State private var confirmDelete = false

    private enum Busy { case reading, saving, deleting }

    init(draft: ExpenseDraft, onSaved: @escaping () -> Void = {}) {
        self.draft = draft
        self.onSaved = onSaved
        let e = draft.expense
        _date = State(initialValue: FinanceFormat.date(draft.date) ?? Date())
        _amount = State(initialValue: e.map { String(format: "%.2f", $0.amount) } ?? "")
        _description = State(initialValue: e?.description ?? "")
        _vendor = State(initialValue: e?.vendor ?? "")
        _category = State(initialValue: e?.category ?? "other")
        _deductiblePercent = State(initialValue: e?.deductiblePercent ?? 100)
        _gallons = State(initialValue: e?.gallons.map { Self.number($0) } ?? "")
        _pricePerGallon = State(initialValue: e?.pricePerGallon.map { Self.number($0) } ?? "")
        _yearly = State(initialValue: (e?.spreadMonths ?? 1) > 1)
        _paidPersonally = State(initialValue: e?.paidPersonally ?? false)
        _bookingId = State(initialValue: draft.bookingId)
        _tripId = State(initialValue: draft.tripId)
        _notes = State(initialValue: e?.notes ?? "")
    }

    private var isEditing: Bool { draft.expense != nil }
    private var options: FinanceLinkOptions? { appState.financeLinkOptions.value }
    private var categoryInfo: FinanceLinkOptions.ExpenseCategory? { options?.expenseCategory(category) }

    var body: some View {
        NavigationStack {
            Form {
                receiptSection

                Section {
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    HStack {
                        Text("Amount")
                        Spacer()
                        TextField("$0.00", text: $amount)
                            .keyboard(.decimal)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 120)
                    }
                    TextField("What it was (Drone motor arm)", text: $description)
                    TextField("Where (Amazon)", text: $vendor)
                }
                .listRowBackground(Theme.card)

                Section {
                    Picker("Category", selection: $category) {
                        ForEach(options?.expenseCategories ?? [], id: \.value) { c in
                            Text(c.label).tag(c.value)
                        }
                        if options == nil { Text(category.capitalized).tag(category) }
                    }
                    .onChange(of: category) { _, value in
                        if let usual = options?.expenseCategory(value)?.deductible { deductiblePercent = usual }
                    }
                    Picker("Tax deductible", selection: $deductiblePercent) {
                        Text("100%").tag(100)
                        Text("50%").tag(50)
                        Text("Not deductible").tag(0)
                    }
                    if category == "gas" {
                        numberRow("Gallons", $gallons)
                        numberRow("Price per gallon", $pricePerGallon)
                    }
                } footer: {
                    if let hint = categoryInfo?.hint?.nilIfBlank { Text(hint) }
                }
                .listRowBackground(Theme.card)

                Section {
                    Toggle("Yearly charge (spread over 12 months)", isOn: $yearly)
                    Toggle("Paid on a personal card", isOn: $paidPersonally)
                }
                .listRowBackground(Theme.card)

                Section("Linked to") {
                    Picker("For a job", selection: $bookingId) {
                        Text("None").tag(String?.none)
                        ForEach(bookingChoices) { b in
                            Text(Self.optionLabel(b)).tag(Optional(b.id))
                        }
                    }
                    Picker("On a trip", selection: $tripId) {
                        Text("None").tag(String?.none)
                        ForEach(nearbyTrips) { t in
                            Text("\(FinanceFormat.dayLabel(t.date)) · \(t.purpose)").tag(Optional(t.id))
                        }
                    }
                }
                .listRowBackground(Theme.card)

                Section("Notes") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(2...)
                }
                .listRowBackground(Theme.card)

                if let error {
                    Section { Text(error).font(.caption).foregroundStyle(Theme.danger) }
                        .listRowBackground(Theme.card)
                }

                if isEditing {
                    Section {
                        Button("Delete expense", role: .destructive) { confirmDelete = true }
                    } footer: {
                        Text("Deletes its receipt too.")
                    }
                    .listRowBackground(Theme.card)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.accent)
            .navigationTitle(isEditing ? "Edit expense" : "Add an expense")
            .titleDisplay(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if busy == .saving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .fontWeight(.semibold)
                            .disabled(busy != nil || !canSave)
                    }
                }
            }
            .confirmationDialog("Delete this expense?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await delete() } }
            }
            .onChange(of: pickedPhoto) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) {
                        await usePhoto(data)
                    }
                    pickedPhoto = nil
                }
            }
            .fileImporter(isPresented: $importingPDF, allowedContentTypes: [.pdf]) { result in
                guard case .success(let url) = result else { return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url) else {
                    error = "Couldn't open that file."
                    return
                }
                Task { await useFile(ReceiptFile(data: data, contentType: "application/pdf", filename: url.lastPathComponent)) }
            }
            .sheet(isPresented: $showReceipt) {
                if let expense = draft.expense { ReceiptViewer(expense: expense) }
            }
            #if os(iOS)
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { data in
                    Task { await usePhoto(data) }
                }
                .ignoresSafeArea()
            }
            #endif
            .task {
                await appState.financeLinkOptions.load()
                #if os(iOS)
                if draft.startWithCamera, receipt == nil {
                    if CameraPicker.isAvailable { showCamera = true }
                }
                #endif
            }
        }
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
    }

    // MARK: - Receipt

    @ViewBuilder
    private var receiptSection: some View {
        Section {
            if let receipt {
                HStack(spacing: 12) {
                    if let image = receipt.thumbnail {
                        image.swiftUIImage
                            .resizable()
                            .scaledToFill()
                            .frame(width: 52, height: 52)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    } else {
                        Image(systemName: "doc.richtext")
                            .font(.title2)
                            .frame(width: 52, height: 52)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(busy == .reading ? "Reading the receipt…" : "Receipt attached")
                            .font(.subheadline.weight(.medium))
                        Text(readNote ?? "Uploaded when you save.")
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    Spacer(minLength: 0)
                    if busy == .reading { ProgressView() }
                }
                if busy != .reading {
                    Button {
                        Task { await read(receipt) }
                    } label: {
                        Label("Read it again", systemImage: "text.viewfinder")
                    }
                }
            } else if let expense = draft.expense, expense.hasReceipt {
                Button {
                    showReceipt = true
                } label: {
                    Label(
                        expense.receiptNumber.map { "View receipt #\($0)" } ?? "View receipt",
                        systemImage: "doc.text.magnifyingglass"
                    )
                }
            }

            pickButtons
        } header: {
            Text("Receipt")
        } footer: {
            if !isEditing && receipt == nil {
                Text("Photograph the receipt and it fills itself in.")
            }
        }
        .listRowBackground(Theme.card)
    }

    @ViewBuilder
    private var pickButtons: some View {
        let replacing = receipt != nil || draft.expense?.hasReceipt == true
        #if os(iOS)
        if CameraPicker.isAvailable {
            Button {
                showCamera = true
            } label: {
                Label(replacing ? "Take a new photo" : "Take a photo", systemImage: "camera")
            }
            .disabled(busy != nil)
        }
        #endif
        PhotosPicker(selection: $pickedPhoto, matching: .images) {
            Label(replacing ? "Choose a different photo" : "Choose a photo", systemImage: "photo.on.rectangle")
        }
        .disabled(busy != nil)
        Button {
            importingPDF = true
        } label: {
            Label("Attach a PDF", systemImage: "doc")
        }
        .disabled(busy != nil)
    }

    private func usePhoto(_ original: Data) async {
        guard let jpeg = await ReceiptPrep.jpeg(from: original) else {
            error = "Couldn't read that photo."
            return
        }
        await useFile(ReceiptFile(data: jpeg, contentType: "image/jpeg", filename: "receipt.jpg"))
    }

    /// A new expense is read straight away; an edit only when asked, so a
    /// replaced receipt doesn't overwrite what was already checked.
    private func useFile(_ file: ReceiptFile) async {
        error = nil
        readNote = nil
        receipt = file
        if !isEditing { await read(file) }
    }

    private func read(_ file: ReceiptFile) async {
        busy = .reading
        defer { busy = nil }
        do {
            let r = try await APIClient.shared.readReceipt(data: file.data, contentType: file.contentType)
            if let day = r.date, let parsed = FinanceFormat.date(day) { date = parsed }
            if let value = r.amount { amount = String(format: "%.2f", value) }
            if let value = r.vendor?.nilIfBlank { vendor = value }
            if let value = r.description?.nilIfBlank { description = value }
            if let value = r.category, options?.expenseCategory(value) != nil || options == nil {
                category = value
                if let usual = options?.expenseCategory(value)?.deductible { deductiblePercent = usual }
            }
            if let value = r.gallons { gallons = Self.number(value) }
            if let value = r.pricePerGallon { pricePerGallon = Self.number(value) }
            readNote = "Filled in from the receipt. Check it, then save."
        } catch {
            readNote = "Couldn't read it; fill it in by hand."
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Pickers

    /// Every job, the one linked first so it can't fall off the list.
    private var bookingChoices: [FinanceLinkOptions.BookingOption] {
        let all = options?.bookings ?? []
        guard let bookingId, !all.contains(where: { $0.id == bookingId }) else { return all }
        return [FinanceLinkOptions.BookingOption(id: bookingId, label: "This job", date: nil)] + all
    }

    /// Trips within four days of the expense, plus whichever is linked: the
    /// web's `nearbyTrips`.
    private var nearbyTrips: [FinanceLinkOptions.TripOption] {
        let day = FinanceFormat.day(date)
        return (options?.trips ?? []).filter { t in
            t.id == tripId || (FinanceFormat.daysApart(t.date, day).map { $0 <= 4 } ?? false)
        }
    }

    private static func optionLabel(_ b: FinanceLinkOptions.BookingOption) -> String {
        if let date = b.date { return "\(FinanceFormat.dayLabel(date)) · \(b.label)" }
        return b.label
    }

    private func numberRow(_ title: String, _ value: Binding<String>) -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField("—", text: value)
                .keyboard(.decimal)
                .multilineTextAlignment(.trailing)
                .frame(width: 100)
        }
    }

    // MARK: - Save

    private var canSave: Bool {
        Self.parse(amount) != nil && description.nilIfBlank != nil
    }

    private func save() async {
        guard let value = Self.parse(amount) else { return }
        busy = .saving
        error = nil
        defer { busy = nil }

        let input = APIClient.ExpenseInput(
            date: FinanceFormat.day(date),
            amount: value,
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            category: category,
            vendor: vendor.nilIfBlank,
            deductiblePercent: deductiblePercent,
            gallons: category == "gas" ? Self.parse(gallons) : nil,
            pricePerGallon: category == "gas" ? Self.parse(pricePerGallon) : nil,
            paidPersonally: paidPersonally,
            spreadMonths: yearly ? 12 : 1,
            bookingId: bookingId,
            tripId: tripId,
            notes: notes.nilIfBlank
        )

        let saved: Expense
        do {
            if let existing = draft.expense {
                saved = try await APIClient.shared.updateExpense(id: existing.id, input)
            } else {
                saved = try await APIClient.shared.createExpense(input)
            }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            return
        }

        // Saved; now the same file goes up as its receipt.
        if let receipt {
            do {
                try await APIClient.shared.uploadReceipt(
                    expenseId: saved.id,
                    data: receipt.data,
                    contentType: receipt.contentType,
                    filename: receipt.filename
                )
            } catch {
                await appState.reloadFinances()
                self.error = "The expense is saved, but the receipt didn't upload: "
                    + ((error as? APIError)?.errorDescription ?? error.localizedDescription)
                    + ". Open it again to attach the receipt."
                return
            }
        }

        await appState.reloadFinances()
        onSaved()
        dismiss()
    }

    private func delete() async {
        guard let expense = draft.expense else { return }
        busy = .deleting
        defer { busy = nil }
        do {
            try await APIClient.shared.deleteExpense(id: expense.id)
            await appState.reloadFinances()
            onSaved()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// "71.09", "$71.09" or "71,09" all read as 71.09.
    static func parse(_ text: String) -> Double? {
        let cleaned = text
            .replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: ",", with: ".")
            .trimmingCharacters(in: .whitespaces)
        guard let value = Double(cleaned), value.isFinite, value >= 0 else { return nil }
        return value
    }

    private static func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...3)).grouping(.never))
    }
}

// MARK: - The receipt file

/// A receipt picked in the form: bytes ready to upload as they are.
struct ReceiptFile {
    let data: Data
    let contentType: String
    let filename: String?

    var thumbnail: PlatformImage? {
        contentType.hasPrefix("image/") ? PlatformImage.downsampling(data, maxPixel: 200) : nil
    }
}

enum ReceiptPrep {
    /// About 1800px on the long side at JPEG 0.8, as the spec asks: plenty to
    /// read, and well under Vercel's 4.5 MB body limit.
    static func jpeg(from data: Data) async -> Data? {
        await Task.detached(priority: .userInitiated) {
            guard let image = PlatformImage.downsampling(data, maxPixel: 1800) else { return nil }
            return image.encodedJPEG(quality: 0.8)
        }.value
    }
}

/// The receipt on file, loaded through the API client (the route wants the
/// bearer token, so it can't be a plain URL).
struct ReceiptViewer: View {
    let expense: Expense

    @Environment(\.dismiss) private var dismiss
    @State private var image: PlatformImage?
    @State private var fileURL: URL?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let image {
                    ScrollView([.vertical, .horizontal]) {
                        image.swiftUIImage
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: .infinity)
                    }
                } else if let fileURL {
                    VStack(spacing: 14) {
                        EmptyStateView(icon: "doc.richtext", title: "PDF receipt")
                        ShareLink(item: fileURL) { Label("Open or share", systemImage: "square.and.arrow.up") }
                    }
                } else if let error {
                    EmptyStateView(icon: "exclamationmark.triangle", title: "Couldn't load the receipt", message: error)
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.background)
            .navigationTitle(expense.receiptNumber.map { "Receipt #\($0)" } ?? "Receipt")
            .titleDisplay(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            let (data, type) = try await APIClient.shared.receiptData(expenseId: expense.id)
            if type?.contains("pdf") == true {
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("Receipt \(expense.receiptNumber.map(String.init) ?? expense.id).pdf")
                try data.write(to: url, options: .atomic)
                fileURL = url
            } else if let decoded = PlatformImage.downsampling(data, maxPixel: 2400) {
                image = decoded
            } else {
                error = "Not an image or a PDF."
            }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

#if os(iOS)
/// The camera, for photographing a receipt. SwiftUI has no camera view of its
/// own, so this wraps `UIImagePickerController`.
struct CameraPicker: UIViewControllerRepresentable {
    var onPhoto: (Data) -> Void

    @Environment(\.dismiss) private var dismiss

    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker

        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            // Full quality here; ReceiptPrep shrinks it once, off the main thread.
            if let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.95) {
                parent.onPhoto(data)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
#endif

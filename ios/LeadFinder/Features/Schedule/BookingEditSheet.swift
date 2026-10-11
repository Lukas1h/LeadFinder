import SwiftUI

/// Add a booking, or edit / delete an existing one — the web's booking form.
///
/// A new booking here is a job with no tracked listing behind it (a cold call,
/// a referral), so it needs a city. A booking that's tied to a listing takes
/// its address from that listing, so those fields aren't offered.
struct BookingEditSheet: View {
    /// Nil to add a new booking.
    let booking: Booking?
    /// Called after a save (`false`) or a delete (`true`).
    var onDone: (_ deleted: Bool) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var address: String
    @State private var city: String
    @State private var state: String
    @State private var contactName: String
    @State private var contactPhone: String
    @State private var hasDate: Bool
    @State private var jobDate: Date
    @State private var lockbox: String
    @State private var notes: String
    @State private var invoiceNote: String
    @State private var items: [ItemRow]
    @State private var driveHours: String
    @State private var editingHours: String
    @State private var shootingHours: String
    @State private var logisticsHours: String
    @State private var additionalCosts: String
    @State private var isSaving = false
    @State private var confirmDelete = false
    @State private var error: String?

    private struct ItemRow: Identifiable {
        let id = UUID()
        var description: String
        var amount: String
    }

    init(booking: Booking? = nil, onDone: @escaping (Bool) -> Void) {
        self.booking = booking
        self.onDone = onDone
        _address = State(initialValue: booking?.address ?? "")
        _city = State(initialValue: booking?.city ?? "")
        _state = State(initialValue: booking?.state ?? "OR")
        _contactName = State(initialValue: booking?.contactName ?? "")
        _contactPhone = State(initialValue: booking?.contactPhone ?? "")
        let existing = DateFormatting.parse(booking?.jobDate)
        _hasDate = State(initialValue: booking == nil || existing != nil)
        _jobDate = State(initialValue: existing ?? Self.defaultDate())
        _lockbox = State(initialValue: booking?.lockboxCode ?? "")
        _notes = State(initialValue: booking?.notes ?? "")
        _invoiceNote = State(initialValue: booking?.invoiceNote ?? "")
        _items = State(initialValue: (booking?.lineItems ?? []).map {
            ItemRow(description: $0.description, amount: String($0.amount))
        })
        _driveHours = State(initialValue: Self.text(booking?.driveHours))
        _editingHours = State(initialValue: Self.text(booking?.editingHours))
        _shootingHours = State(initialValue: Self.text(booking?.shootingHours))
        _logisticsHours = State(initialValue: Self.text(booking?.logisticsHours))
        _additionalCosts = State(initialValue: booking?.additionalCosts.map(String.init) ?? "")
    }

    private var hasListing: Bool { booking?.listingId != nil }
    private var isCompleted: Bool { booking?.completedAt != nil }

    var body: some View {
        NavigationStack {
            Form {
                if !hasListing {
                    Section("Where") {
                        TextField("Street address", text: $address)
                            .contentType(.streetAddress)
                        TextField("City", text: $city)
                        TextField("State", text: $state)
                            .autocapitalization(.characters)
                    }
                    .listRowBackground(Theme.card)
                }

                Section("When") {
                    Toggle("Has a date", isOn: $hasDate.animation())
                    if hasDate {
                        DatePicker("Job", selection: $jobDate)
                    }
                    TextField("Lockbox code", text: $lockbox)
                }
                .listRowBackground(Theme.card)

                Section {
                    TextField("Name", text: $contactName)
                        .contentType(.name)
                    TextField("Phone", text: $contactPhone)
                        .keyboard(.phone)
                        .contentType(.phone)
                } header: {
                    Text("Contact")
                } footer: {
                    Text("Matched to an agent by phone number.")
                }
                .listRowBackground(Theme.card)

                Section("Line items") {
                    ForEach($items) { $item in
                        HStack(spacing: 10) {
                            TextField("Description", text: $item.description)
                            TextField("$", text: $item.amount)
                                .keyboard(.number)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 80)
                        }
                    }
                    .onDelete { items.remove(atOffsets: $0) }

                    Button {
                        items.append(ItemRow(description: "", amount: ""))
                    } label: {
                        Label("Add line item", systemImage: "plus")
                    }
                    if !items.isEmpty {
                        HStack {
                            Text("Total").foregroundStyle(Theme.secondaryText)
                            Spacer()
                            Text(total.currencyString).fontWeight(.semibold)
                        }
                    }
                }
                .listRowBackground(Theme.card)

                Section("Notes") {
                    TextField("Internal notes (never on the invoice)", text: $notes, axis: .vertical)
                        .lineLimit(2...)
                    TextField("Note for the invoice", text: $invoiceNote, axis: .vertical)
                        .lineLimit(2...)
                }
                .listRowBackground(Theme.card)

                if isCompleted {
                    Section("Time & costs") {
                        decimalField("Drive hours", $driveHours)
                        decimalField("Editing hours", $editingHours)
                        decimalField("Shooting hours", $shootingHours)
                        decimalField("Logistics hours", $logisticsHours)
                        decimalField("Additional costs ($)", $additionalCosts)
                    }
                    .listRowBackground(Theme.card)
                }

                if let error {
                    Section { Text(error).font(.caption).foregroundStyle(Theme.danger) }
                        .listRowBackground(Theme.card)
                }

                if booking != nil {
                    Section {
                        Button("Delete booking", role: .destructive) { confirmDelete = true }
                    } footer: {
                        Text("Removes the job and its line items.")
                    }
                    .listRowBackground(Theme.card)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.accent)
            .navigationTitle(booking == nil ? "New booking" : "Edit booking")
            .titleDisplay(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(isSaving)
                }
            }
            .confirmationDialog("Delete this booking?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete booking", role: .destructive) { Task { await delete() } }
                Button("Keep it", role: .cancel) {}
            } message: {
                Text("This can't be undone.")
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
    }

    private func decimalField(_ title: String, _ value: Binding<String>) -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField("—", text: value)
                .keyboard(.decimal)
                .multilineTextAlignment(.trailing)
                .frame(width: 90)
        }
    }

    private var total: Int {
        items.reduce(0) { $0 + (Int($1.amount) ?? 0) }
    }

    // MARK: - Actions

    private func save() async {
        if booking == nil, city.nilIfBlank == nil {
            error = "Enter at least a city for a booking with no linked listing"
            return
        }
        isSaving = true
        error = nil
        defer { isSaving = false }

        let edit = APIClient.BookingEdit(
            address: hasListing ? nil : address,
            city: hasListing ? nil : city,
            state: hasListing ? nil : state,
            contactName: contactName,
            contactPhone: contactPhone,
            jobDate: hasDate ? jobDate.formatted(.iso8601) : nil,
            lockboxCode: lockbox,
            notes: notes,
            invoiceNote: invoiceNote,
            lineItems: items
                .filter { $0.description.nilIfBlank != nil }
                .map { .init(description: $0.description, amount: Int($0.amount) ?? 0) },
            driveHours: isCompleted ? Double(driveHours) : nil,
            editingHours: isCompleted ? Double(editingHours) : nil,
            shootingHours: isCompleted ? Double(shootingHours) : nil,
            logisticsHours: isCompleted ? Double(logisticsHours) : nil,
            additionalCosts: isCompleted ? Int(additionalCosts) : nil
        )
        do {
            if let booking {
                try await APIClient.shared.updateBooking(id: booking.id, edit)
            } else {
                try await APIClient.shared.createBooking(edit)
            }
            onDone(false)
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func delete() async {
        guard let booking else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await APIClient.shared.deleteBooking(id: booking.id)
            onDone(true)
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Helpers

    private static func text(_ value: Double?) -> String {
        guard let value else { return "" }
        return value == value.rounded() ? String(Int(value)) : String(value)
    }

    /// Tomorrow at 10, a sensible start for a new job.
    private static func defaultDate() -> Date {
        let calendar = Calendar.current
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        return calendar.date(bySettingHour: 10, minute: 0, second: 0, of: tomorrow) ?? tomorrow
    }
}

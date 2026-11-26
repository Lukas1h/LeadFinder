import SwiftUI

/// Who shoots the job when it isn't Lukas (Portland jobs go to a subcontracted
/// photographer) and what they're owed. "Paid <name>" logs the pay as a
/// Subcontractors expense on the job, so profit, Profit First and the 1099
/// total pick it up.
struct BookingShooterSection: View {
    let booking: Booking
    /// Reloads the booking screen, the bookings list and the schedule.
    var onChange: () async -> Void

    @State private var showSheet = false
    @State private var isWorking = false
    @State private var error: String?
    @State private var showEditorSheet = false

    var body: some View {
        Group {
            if let shooter = booking.shooter {
                card(shooter)
            } else {
                addRow
            }
        }
        .sheet(isPresented: $showSheet) {
            ShooterSheet(booking: booking) { await onChange() }
        }
        .sheet(isPresented: $showEditorSheet) {
            EditorSheet(booking: booking) { await onChange() }
        }
    }

    // MARK: - No shooter

    private var addRow: some View {
        Button { showSheet = true } label: {
            HStack(spacing: 8) {
                Image(systemName: "person.badge.plus")
                Text("Add shooter")
                Spacer(minLength: 0)
            }
            .font(.subheadline)
            .foregroundStyle(Theme.tertiaryText)
            .padding(.horizontal, 4)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Shooter on the job

    private func card(_ shooter: BookingShooter) -> some View {
        let shot = booking.currentStage.index >= BookingStage.editing.index
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("SHOOTER")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Theme.tertiaryText)
                    .kerning(0.6)
                Spacer(minLength: 0)
                Button("Change") { showSheet = true }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.accent)
                    .buttonStyle(.plain)
            }

            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: "camera.fill")
                    .font(.subheadline)
                    .foregroundStyle(Theme.tertiaryText)
                Text(headline(shooter))
                    .font(.headline)
                    .foregroundStyle(Theme.primaryText)
                Spacer(minLength: 8)
                stateChip(shooter, shot: shot)
            }

            if shot && shooter.pay != nil {
                if shooter.paid {
                    Button {
                        Task { await run { try await APIClient.shared.setShooterPaid(bookingId: booking.id, paid: false) } }
                    } label: {
                        Label("Mark unpaid", systemImage: "arrow.uturn.backward")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 40)
                            .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .foregroundStyle(Theme.primaryText)
                    }
                    .buttonStyle(.plain)
                } else {
                    Button {
                        Task { await run { try await APIClient.shared.setShooterPaid(bookingId: booking.id, paid: true) } }
                    } label: {
                        Label("Paid \(shooter.name)", systemImage: "dollarsign.circle.fill")
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .foregroundStyle(Theme.background)
                    }
                    .buttonStyle(.plain)
                    Text("Logs \(BookingFormat.price(shooter.pay ?? 0)) as a Subcontractors expense on this job.")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }

            Divider().overlay(Theme.cardRaised)

            if showsEditor(shooter) {
                editorBlock(shooter, shot: shot)
            } else {
                Button { showEditorSheet = true } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "person.badge.plus")
                        Text("Add editor")
                        Spacer(minLength: 0)
                    }
                    .font(.subheadline)
                    .foregroundStyle(Theme.tertiaryText)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            if let error {
                Text(error).font(.caption).foregroundStyle(Theme.danger)
            }
        }
        .disabled(isWorking)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func headline(_ shooter: BookingShooter) -> String {
        if let pay = shooter.pay { return "\(shooter.name) · \(BookingFormat.price(pay))" }
        return shooter.name
    }

    // MARK: - Photo editor

    /// Hidden for flambient at its $0 default with nobody named; "Add editor" instead.
    private func showsEditor(_ shooter: BookingShooter) -> Bool {
        let cost = shooter.editorCost ?? 0
        let isDefault = shooter.editorCostIsDefault ?? true
        let named = !(shooter.editorName ?? "").trimmingCharacters(in: .whitespaces).isEmpty
        if named { return true }
        if shooter.editorCost == nil && shooter.style == nil { return false }
        return !(isDefault && cost == 0)
    }

    private func editorName(_ shooter: BookingShooter) -> String {
        let name = (shooter.editorName ?? "").trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? "Photo editor" : name
    }

    private func editorBlock(_ shooter: BookingShooter, shot: Bool) -> some View {
        let cost = shooter.editorCost ?? 0
        let isDefault = shooter.editorCostIsDefault ?? true
        let paid = shooter.editorPaid ?? false
        let name = editorName(shooter)
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("EDITOR")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Theme.tertiaryText)
                    .kerning(0.6)
                Spacer(minLength: 0)
                Button("Change") { showEditorSheet = true }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.accent)
                    .buttonStyle(.plain)
            }

            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: "wand.and.stars")
                    .font(.subheadline)
                    .foregroundStyle(Theme.tertiaryText)
                Text("\(name) · $\(Self.money(cost))")
                    .font(.headline)
                    .foregroundStyle(Theme.primaryText)
                if isDefault {
                    Text("default")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                }
                Spacer(minLength: 8)
                if paid {
                    BadgeChip(text: "Paid \(ShooterFormat.day(shooter.editorPaidAt))", tint: Theme.emerald)
                } else if !shot {
                    BadgeChip(text: "Not shot yet", tint: Theme.secondaryText)
                } else {
                    BadgeChip(text: "Owed $\(Self.money(cost))", tint: Theme.amber, filled: true)
                }
            }

            if shot && cost > 0 {
                if paid {
                    Button {
                        Task { await run { try await APIClient.shared.setEditorPaid(bookingId: booking.id, paid: false) } }
                    } label: {
                        Label("Mark unpaid", systemImage: "arrow.uturn.backward")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 40)
                            .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .foregroundStyle(Theme.primaryText)
                    }
                    .buttonStyle(.plain)
                } else {
                    Button {
                        Task { await run { try await APIClient.shared.setEditorPaid(bookingId: booking.id, paid: true) } }
                    } label: {
                        Label("Paid \(name)", systemImage: "dollarsign.circle.fill")
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .foregroundStyle(Theme.background)
                    }
                    .buttonStyle(.plain)
                    Text("Logs $\(Self.money(cost)) as a Subcontractors expense on this job.")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
        }
    }

    fileprivate static func money(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.2f", value)
    }

    @ViewBuilder
    private func stateChip(_ shooter: BookingShooter, shot: Bool) -> some View {
        if shooter.paid {
            BadgeChip(text: "Paid \(ShooterFormat.day(shooter.paidAt))", tint: Theme.emerald)
        } else if !shot {
            BadgeChip(text: "Not shot yet", tint: Theme.secondaryText)
        } else if let pay = shooter.pay {
            BadgeChip(text: "Owed \(BookingFormat.price(pay))", tint: Theme.amber, filled: true)
        } else {
            BadgeChip(text: "No pay set", tint: Theme.amber)
        }
    }

    private func run(_ work: () async throws -> Void) async {
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            try await work()
            await onChange()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Set / change / clear

/// Name (with the shooters already on file as quick picks) and agreed pay.
private struct ShooterSheet: View {
    let booking: Booking
    var onSaved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var pay: String
    @State private var options: [ShooterOption] = []
    @State private var saving = false
    @State private var error: String?

    init(booking: Booking, onSaved: @escaping () async -> Void) {
        self.booking = booking
        self.onSaved = onSaved
        _name = State(initialValue: booking.shooter?.name ?? "")
        _pay = State(initialValue: booking.shooter?.pay.map(String.init) ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name (Elijah)", text: $name)
                    if !options.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(options) { option in
                                    let selected = option.name.caseInsensitiveCompare(name.trimmingCharacters(in: .whitespaces)) == .orderedSame
                                    Button { name = option.name } label: {
                                        Text(option.name)
                                            .font(.subheadline.weight(.medium))
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 6)
                                            .background(selected ? Theme.accent : Theme.accent.opacity(0.15), in: Capsule())
                                            .foregroundStyle(selected ? Theme.background : Theme.accent)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Shooter")
                }

                Section {
                    HStack {
                        Text("$").foregroundStyle(Theme.secondaryText)
                        TextField("150", text: $pay)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                    }
                } header: {
                    Text("Agreed pay")
                } footer: {
                    Text("Whole dollars. Logged as a Subcontractors expense when you mark them paid.")
                }

                if booking.shooter != nil {
                    Section {
                        Button("Remove shooter", role: .destructive) {
                            Task { await save(name: "", pay: nil) }
                        }
                    }
                }

                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger) }
                }
            }
            .navigationTitle(booking.shooter == nil ? "Add shooter" : "Shooter")
            .titleDisplay(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save(name: trimmedName, pay: Int(pay.filter(\.isNumber))) }
                    }
                    .disabled(trimmedName.isEmpty || saving)
                }
            }
            .disabled(saving)
            .task { options = (try? await APIClient.shared.shooters()) ?? [] }
        }
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func save(name: String, pay: Int?) async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await APIClient.shared.setBookingShooter(id: booking.id, name: name, pay: pay)
            await onSaved()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Photo editor sheet

/// Name (with past editors as quick picks) and cost; blank cost = the default.
private struct EditorSheet: View {
    let booking: Booking
    var onSaved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var cost: String
    @State private var options: [String] = []
    @State private var saving = false
    @State private var error: String?

    init(booking: Booking, onSaved: @escaping () async -> Void) {
        self.booking = booking
        self.onSaved = onSaved
        _name = State(initialValue: booking.shooter?.editorName ?? "")
        let s = booking.shooter
        let initialCost = (s?.editorCostIsDefault ?? true) ? "" : (s?.editorCost).map(BookingShooterSection.money) ?? ""
        _cost = State(initialValue: initialCost)
    }

    private var hasEditor: Bool {
        let s = booking.shooter
        return !(s?.editorName ?? "").isEmpty || !(s?.editorCostIsDefault ?? true)
    }

    private var defaultCost: String { booking.shooter?.style == "flambient" ? "0" : "18" }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                    if !options.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(options, id: \.self) { option in
                                    let selected = option.caseInsensitiveCompare(trimmedName) == .orderedSame
                                    Button { name = option } label: {
                                        Text(option)
                                            .font(.subheadline.weight(.medium))
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 6)
                                            .background(selected ? Theme.accent : Theme.accent.opacity(0.15), in: Capsule())
                                            .foregroundStyle(selected ? Theme.background : Theme.accent)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Editor")
                }

                Section {
                    HStack {
                        Text("$").foregroundStyle(Theme.secondaryText)
                        TextField(defaultCost, text: $cost)
                            #if os(iOS)
                            .keyboardType(.decimalPad)
                            #endif
                    }
                } header: {
                    Text("Cost")
                } footer: {
                    Text("Leave blank for the default ($18 HDR, $0 flambient). Logged as an expense when you mark them paid.")
                }

                if hasEditor {
                    Section {
                        Button("Remove editor", role: .destructive) {
                            Task { await save(name: "", cost: nil) }
                        }
                    }
                }

                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger) }
                }
            }
            .navigationTitle(hasEditor ? "Editor" : "Add editor")
            .titleDisplay(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let raw = cost.trimmingCharacters(in: .whitespaces)
                        let value = raw.isEmpty ? nil : Double(raw.filter { $0.isNumber || $0 == "." })
                        Task { await save(name: trimmedName, cost: value) }
                    }
                    .disabled(saving)
                }
            }
            .disabled(saving)
            .task { options = (try? await APIClient.shared.editors()) ?? [] }
        }
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func save(name: String, cost: Double?) async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await APIClient.shared.setBookingEditor(id: booking.id, name: name, cost: cost)
            await onSaved()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Chip for rows and cards

/// "Elijah shoots", or amber "owes $150" once shot and unpaid.
struct ShooterChip: View {
    let booking: Booking

    var body: some View {
        if let shooter = booking.shooter {
            let shot = booking.currentStage.index >= BookingStage.editing.index
            if shot, !shooter.paid, let pay = shooter.pay {
                BadgeChip(text: "Owe \(shooter.name) \(BookingFormat.price(pay))", tint: Theme.amber, filled: true)
            } else {
                BadgeChip(text: "\(shooter.name) shoots", tint: Theme.violet, icon: "camera.fill")
            }
        }
    }
}

enum ShooterFormat {
    /// "YYYY-MM-DD" -> "Nov 13".
    static func day(_ raw: String?) -> String {
        guard let raw, let date = FinanceFormat.date(raw) else { return raw ?? "" }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}

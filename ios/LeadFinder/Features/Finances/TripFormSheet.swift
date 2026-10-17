import SwiftUI

/// What the trip form starts from: blank, prefilled from a booking ("Log the
/// trip"), or a trip being edited. Mirrors the web's `TripDraft`.
struct TripDraft: Identifiable {
    var id = UUID()
    var trip: Trip?
    var date = FinanceFormat.today
    var purpose = ""
    var stops = ""
    var bookingIds: [String] = []

    static func editing(_ trip: Trip) -> TripDraft {
        TripDraft(trip: trip, date: trip.date, purpose: trip.purpose, stops: trip.stops ?? "", bookingIds: trip.bookingIds)
    }
}

/// Logs or edits a drive, one line of the mileage log: the web's TripDialog.
/// Miles can come from the route estimate (home, the stops, home, on real
/// roads) and then be corrected. Linking the jobs it was for is what splits
/// its gas and drive time onto them.
struct TripFormSheet: View {
    let draft: TripDraft
    var onSaved: () -> Void = {}

    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var date: Date
    @State private var category: String
    @State private var purpose: String
    @State private var stops: String
    @State private var miles: String
    @State private var driveHours: String
    /// The miles text the route estimate produced; the trip counts as
    /// estimated only while the field still says that.
    @State private var estimatedMiles: String?
    @State private var notes: String
    @State private var bookingIds: [String]

    @State private var busy: Busy?
    @State private var estimateNote: String?
    @State private var error: String?
    @State private var confirmDelete = false

    private enum Busy { case estimating, saving, deleting }

    init(draft: TripDraft, onSaved: @escaping () -> Void = {}) {
        self.draft = draft
        self.onSaved = onSaved
        let t = draft.trip
        _date = State(initialValue: FinanceFormat.date(draft.date) ?? Date())
        _category = State(initialValue: t?.category ?? "shoot")
        _purpose = State(initialValue: draft.purpose)
        _stops = State(initialValue: draft.stops)
        let milesText = t.map { Self.number($0.miles) } ?? ""
        _miles = State(initialValue: milesText)
        _driveHours = State(initialValue: Self.hoursText(t?.driveMinutes))
        _estimatedMiles = State(initialValue: t?.milesEstimated == true ? milesText : nil)
        _notes = State(initialValue: t?.notes ?? "")
        _bookingIds = State(initialValue: draft.bookingIds)
    }

    private var isEditing: Bool { draft.trip != nil }
    private var milesEstimated: Bool { estimatedMiles != nil && estimatedMiles == miles }
    private var options: FinanceLinkOptions? { appState.financeLinkOptions.value }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    Picker("Kind", selection: $category) {
                        ForEach(options?.tripCategories ?? [], id: \.value) { c in
                            Text(c.label).tag(c.value)
                        }
                        if options == nil { Text(category.capitalized).tag(category) }
                    }
                    TextField("What it was for (Shoot for January Finch, Klamath Falls)", text: $purpose, axis: .vertical)
                        .lineLimit(1...3)
                }
                .listRowBackground(Theme.card)

                Section {
                    TextField("111 Hunter Ct, Klamath Falls, OR", text: $stops, axis: .vertical)
                        .lineLimit(2...6)
                    Button {
                        Task { await estimate() }
                    } label: {
                        HStack {
                            Label(
                                busy == .estimating ? "Finding the route…" : "Estimate miles from the route",
                                systemImage: "point.topleft.down.to.point.bottomright.curvepath"
                            )
                            if busy == .estimating {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(busy != nil || stops.nilIfBlank == nil)
                } header: {
                    Text("Stops, one per line")
                } footer: {
                    Text(estimateNote ?? "Starts and ends at home.")
                }
                .listRowBackground(Theme.card)

                Section {
                    HStack {
                        Text("Miles, round trip")
                        Spacer()
                        TextField("0", text: $miles)
                            .keyboard(.decimal)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 90)
                    }
                    HStack {
                        Text("Drive time (hours)")
                        Spacer()
                        TextField("hrs", text: $driveHours)
                            .keyboard(.decimal)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 90)
                    }
                } footer: {
                    if milesEstimated { Text("Miles from the route estimate.") }
                }
                .listRowBackground(Theme.card)

                Section("Jobs it was for") {
                    if nearbyBookings.isEmpty {
                        Text(options == nil ? "Loading…" : "No bookings within a few days of this date.")
                            .font(.subheadline)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    ForEach(nearbyBookings) { b in
                        Toggle(isOn: linked(b.id)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(b.label).lineLimit(1)
                                if let day = b.date {
                                    Text(FinanceFormat.dayLabel(day))
                                        .font(.caption)
                                        .foregroundStyle(Theme.secondaryText)
                                }
                            }
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
                        Button("Delete trip", role: .destructive) { confirmDelete = true }
                    }
                    .listRowBackground(Theme.card)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.accent)
            .navigationTitle(isEditing ? "Edit trip" : "Log a trip")
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
            .confirmationDialog("Delete this trip?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await delete() } }
            }
            .task { await appState.financeLinkOptions.load() }
        }
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
    }

    /// Jobs within four days of the trip, plus whatever's already linked: the
    /// web's `nearbyBookings`.
    private var nearbyBookings: [FinanceLinkOptions.BookingOption] {
        let day = FinanceFormat.day(date)
        let all = options?.bookings ?? []
        var shown = all.filter { b in
            if bookingIds.contains(b.id) { return true }
            guard let d = b.date else { return false }
            return (FinanceFormat.daysApart(d, day) ?? 99) <= 4
        }
        // Linked from a booking the options don't list (an old one): keep it visible.
        for id in bookingIds where !shown.contains(where: { $0.id == id }) {
            shown.insert(FinanceLinkOptions.BookingOption(id: id, label: "This job", date: nil), at: 0)
        }
        return shown
    }

    private func linked(_ id: String) -> Binding<Bool> {
        Binding(
            get: { bookingIds.contains(id) },
            set: { on in
                if on {
                    if !bookingIds.contains(id) { bookingIds.append(id) }
                } else {
                    bookingIds.removeAll { $0 == id }
                }
            }
        )
    }

    private func estimate() async {
        busy = .estimating
        error = nil
        estimateNote = nil
        defer { busy = nil }
        do {
            let lines = stops.split(whereSeparator: \.isNewline).map(String.init)
            let route = try await APIClient.shared.estimateRoute(stops: lines)
            miles = Self.number(route.miles)
            estimatedMiles = miles
            if let minutes = route.driveMinutes { driveHours = Self.hoursText(minutes) }
            estimateNote = route.approximate.isEmpty
                ? "Home, the stops, then home: \(FinanceFormat.miles(route.miles)) by road."
                : "Routed to the town for: \(route.approximate.joined(separator: "; "))."
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private var canSave: Bool {
        purpose.nilIfBlank != nil && ExpenseFormSheet.parse(miles) != nil
    }

    private func save() async {
        guard let value = ExpenseFormSheet.parse(miles) else { return }
        busy = .saving
        error = nil
        defer { busy = nil }
        let hours = ExpenseFormSheet.parse(driveHours)
        let input = APIClient.TripInput(
            date: FinanceFormat.day(date),
            purpose: purpose.trimmingCharacters(in: .whitespacesAndNewlines),
            category: category,
            miles: value,
            stops: stops.nilIfBlank,
            driveMinutes: hours.map { $0 * 60 },
            milesEstimated: milesEstimated,
            notes: notes.nilIfBlank,
            bookingIds: bookingIds
        )
        do {
            if let trip = draft.trip {
                try await APIClient.shared.updateTrip(id: trip.id, input)
            } else {
                try await APIClient.shared.createTrip(input)
            }
            await appState.reloadFinances()
            onSaved()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func delete() async {
        guard let trip = draft.trip else { return }
        busy = .deleting
        defer { busy = nil }
        do {
            try await APIClient.shared.deleteTrip(id: trip.id)
            await appState.reloadFinances()
            onSaved()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private static func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...1)).grouping(.never))
    }

    /// Minutes as hours, to two places: 181 -> "3.02".
    private static func hoursText(_ minutes: Double?) -> String {
        guard let minutes else { return "" }
        return (minutes / 60).formatted(.number.precision(.fractionLength(0...2)).grouping(.never))
    }
}

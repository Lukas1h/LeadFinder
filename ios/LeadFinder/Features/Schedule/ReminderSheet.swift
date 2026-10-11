import SwiftUI

/// Add a reminder, or edit / tick off / delete an existing one — the web's
/// reminder dialog. Only title and day are required; a start time and a length
/// are optional, and a length only means something with a start time.
struct ReminderSheet: View {
    /// Nil to add a new reminder.
    let existing: ScheduleResponse.Item?
    var onChanged: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var date: Date
    @State private var hasTime: Bool
    @State private var time: Date
    @State private var duration: Int
    @State private var notes: String
    @State private var isSaving = false
    @State private var confirmDelete = false
    @State private var error: String?

    private static let durations = [0, 15, 30, 45, 60, 90, 120, 180]

    init(existing: ScheduleResponse.Item? = nil, onChanged: @escaping () -> Void) {
        self.existing = existing
        self.onChanged = onChanged
        _title = State(initialValue: existing?.title ?? "")
        _date = State(initialValue: DateFormatting.parseDay(existing?.date) ?? Date())
        _hasTime = State(initialValue: existing?.time != nil)
        _time = State(initialValue: Self.parseTime(existing?.time) ?? Self.defaultTime())
        _duration = State(initialValue: existing?.durationMinutes ?? 0)
        _notes = State(initialValue: existing?.notes ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What needs doing?", text: $title)
                }
                .listRowBackground(Theme.card)

                Section {
                    DatePicker("Day", selection: $date, displayedComponents: .date)
                    Toggle("Specific time", isOn: $hasTime.animation())
                    if hasTime {
                        DatePicker("Starts", selection: $time, displayedComponents: .hourAndMinute)
                        Picker("Length", selection: $duration) {
                            ForEach(Self.durations, id: \.self) { minutes in
                                Text(Self.durationLabel(minutes)).tag(minutes)
                            }
                        }
                    }
                }
                .listRowBackground(Theme.card)

                Section("Notes") {
                    TextField("Optional", text: $notes, axis: .vertical)
                        .lineLimit(2...)
                }
                .listRowBackground(Theme.card)

                if let error {
                    Section { Text(error).font(.caption).foregroundStyle(Theme.danger) }
                        .listRowBackground(Theme.card)
                }

                if existing?.reminderId != nil {
                    Section {
                        Button("Delete reminder", role: .destructive) { confirmDelete = true }
                    }
                    .listRowBackground(Theme.card)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.accent)
            .navigationTitle(existing == nil ? "New reminder" : "Reminder")
            .titleDisplay(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(title.nilIfBlank == nil || isSaving)
                }
            }
            .confirmationDialog("Delete this reminder?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await delete() } }
                Button("Keep it", role: .cancel) {}
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
    }

    // MARK: - Actions

    private func save() async {
        guard let title = title.nilIfBlank else { return }
        isSaving = true
        error = nil
        defer { isSaving = false }

        let input = APIClient.ReminderInput(
            title: title,
            date: Self.dayFormatter.string(from: date),
            time: hasTime ? Self.timeFormatter.string(from: time) : nil,
            durationMinutes: hasTime && duration > 0 ? duration : nil,
            notes: notes.nilIfBlank,
            // Editing keeps what the reminder was attached to.
            agentId: existing?.agent?.id,
            bookingId: existing?.bookingId
        )
        do {
            if let id = existing?.reminderId {
                try await APIClient.shared.updateReminder(id: id, input)
            } else {
                try await APIClient.shared.createReminder(input)
            }
            onChanged()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func delete() async {
        guard let id = existing?.reminderId else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await APIClient.shared.deleteReminder(id: id)
            onChanged()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Formatting

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private static func parseTime(_ string: String?) -> Date? {
        guard let string else { return nil }
        return timeFormatter.date(from: string)
    }

    /// The next whole hour, so a new reminder with a time starts somewhere sensible.
    private static func defaultTime() -> Date {
        let calendar = Calendar.current
        let hour = calendar.component(.hour, from: Date()) + 1
        return calendar.date(bySettingHour: min(hour, 23), minute: 0, second: 0, of: Date()) ?? Date()
    }

    private static func durationLabel(_ minutes: Int) -> String {
        if minutes == 0 { return "No length" }
        if minutes < 60 { return "\(minutes) min" }
        let hours = Double(minutes) / 60
        return hours == hours.rounded() ? "\(Int(hours)) hr" : "\(hours.formatted()) hr"
    }
}

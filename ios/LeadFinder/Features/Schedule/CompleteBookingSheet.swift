import SwiftUI

/// Finishing a job: the web's completion dialog, hours only (drive time and
/// costs come from the job's trips and expenses since 2026-10-16). Every figure is optional —
/// blank means "not recorded", which keeps the per-hour stats honest about a
/// missing number rather than counting it as zero.
struct CompleteBookingSheet: View {
    let booking: Booking
    var onDone: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var shootingHours = ""
    @State private var editingHours = ""
    @State private var logisticsHours = ""
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    field("Shooting hours", $shootingHours)
                    field("Editing hours", $editingHours)
                    field("Logistics hours", $logisticsHours)
                } header: {
                    Text("Hours")
                } footer: {
                    Text("All optional. Leave one blank if you didn't track it. Driving and costs come from the trip and expenses logged for the job.")
                }
                .listRowBackground(Theme.card)

                if let error {
                    Section { Text(error).font(.caption).foregroundStyle(Theme.danger) }
                        .listRowBackground(Theme.card)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.accent)
            .navigationTitle("Complete job")
            .titleDisplay(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Complete") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(isSaving)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
    }

    private func field(_ title: String, _ value: Binding<String>) -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField("—", text: value)
                .keyboard(.decimal)
                .multilineTextAlignment(.trailing)
                .frame(width: 90)
        }
    }

    private func save() async {
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            try await APIClient.shared.completeBooking(
                id: booking.id,
                editingHours: Double(editingHours),
                shootingHours: Double(shootingHours),
                logisticsHours: Double(logisticsHours)
            )
            onDone()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

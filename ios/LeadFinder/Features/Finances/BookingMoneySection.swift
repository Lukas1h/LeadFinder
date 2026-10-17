import SwiftUI

/// The booking's time and money, the web's BookingMoney: hours, its trip
/// (miles, drive time, gas), expenses charged to it, and what it made. "Log
/// the trip" and "Add an expense" open the forms prefilled and linked to this
/// job; a trip already logged that day can be joined instead ("Same drive as…").
///
/// Profit and per hour are the Jobs report's numbers for this booking. Until
/// the job is in that report (it isn't shot yet), profit is the server's
/// `total − additionalCosts`, which is the same sum.
struct BookingMoneySection: View {
    let booking: Booking
    var onChange: () async -> Void

    @Environment(AppState.self) private var appState
    @State private var tripDraft: TripDraft?
    @State private var expenseDraft: ExpenseDraft?
    @State private var joining: String?
    @State private var error: String?

    private var costs: BookingCosts? { booking.costs }
    private var hasTrip: Bool { !(costs?.trips.isEmpty ?? true) }
    private var hasCosts: Bool { hasTrip || !(costs?.expenseItems.isEmpty ?? true) }
    private var job: FinanceJobsReport.Job? {
        appState.financeJobs.value?.jobs.first { $0.bookingId == booking.id }
    }

    /// The job's day, Pacific, for prefilling the forms.
    private var day: String {
        DateFormatting.parse(booking.jobDate).map(FinanceFormat.day) ?? FinanceFormat.today
    }

    private var recordedHours: [(String, Double)] {
        [("Shooting", booking.shootingHours), ("Editing", booking.editingHours), ("Logistics", booking.logisticsHours)]
            .compactMap { label, value in value.map { (label, $0) } }
    }

    /// Trips logged the same day that this job isn't on yet.
    private var sameDayTrips: [FinanceLinkOptions.TripOption] {
        guard !hasTrip else { return [] }
        return (appState.financeLinkOptions.value?.trips ?? [])
            .filter { $0.date == day && !$0.bookingIds.contains(booking.id) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("TIME & MONEY", systemImage: "clock")
                .font(.caption2.weight(.bold))
                .foregroundStyle(Theme.tertiaryText)
                .kerning(0.6)

            ForEach(recordedHours, id: \.0) { label, value in
                row(label, FinanceFormat.hours(value))
            }
            if let drive = booking.driveHours, drive > 0 {
                row("Driving", FinanceFormat.hours(drive))
            }

            ForEach(costs?.trips ?? []) { trip in
                HStack(spacing: 6) {
                    Image(systemName: "car")
                        .font(.caption)
                    Text("\(FinanceFormat.dayLabel(trip.date)) · \(FinanceFormat.miles(trip.miles))\(Self.split(trip.jobs))")
                        .font(.subheadline)
                        .lineLimit(1)
                }
                .foregroundStyle(Theme.secondaryText)
            }
            if hasTrip, let costs {
                row("Gas", "−\(FinanceFormat.money(costs.gas))")
            }
            ForEach(costs?.expenseItems ?? []) { item in
                row(item.description, "−\(FinanceFormat.money(item.amount))")
            }

            if hasCosts || !recordedHours.isEmpty {
                Rectangle().fill(Theme.hairline).frame(height: 1)
                row("Profit", FinanceFormat.dollars(job?.profit ?? Double(booking.total - (booking.additionalCosts ?? 0))), bold: true)
                if let perHour = job?.perHour {
                    row("Per hour", FinanceFormat.perHour(perHour), bold: true)
                }
                if hasTrip, let costs {
                    Text("Mileage deduction \(FinanceFormat.money(costs.mileageDeduction)) (\(FinanceFormat.miles(costs.miles)))")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }

            ForEach(sameDayTrips) { trip in
                HStack(spacing: 10) {
                    Text("Same drive as \(trip.purpose)? (\(FinanceFormat.miles(trip.miles)))")
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(2)
                    Spacer(minLength: 6)
                    Button {
                        Task { await join(trip.id) }
                    } label: {
                        if joining == trip.id { ProgressView() } else { Text("Add to it") }
                    }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.bordered)
                    .disabled(joining != nil)
                }
            }

            if let error {
                Text(error).font(.caption).foregroundStyle(Theme.danger)
            }

            HStack(spacing: 8) {
                if !hasTrip {
                    pill("Log the trip", "car") { tripDraft = prefilledTrip }
                }
                pill("Add an expense", "receipt") {
                    expenseDraft = ExpenseDraft(date: day, bookingId: booking.id)
                }
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .sheet(item: $tripDraft) { TripFormSheet(draft: $0) { Task { await onChange() } } }
        .sheet(item: $expenseDraft) { ExpenseFormSheet(draft: $0) { Task { await onChange() } } }
        .task {
            await appState.financeJobs.load()
            if !hasTrip { await appState.financeLinkOptions.load() }
        }
    }

    /// "Shoot for <contact>, <address>", the address as the stop, this job linked.
    private var prefilledTrip: TripDraft {
        let location = booking.addressLine
        var purpose = "Shoot"
        if let name = booking.contactName?.nilIfBlank { purpose += " for \(name)" }
        if !location.isEmpty { purpose += ", \(location)" }
        return TripDraft(date: day, purpose: purpose, stops: location, bookingIds: [booking.id])
    }

    private func join(_ tripId: String) async {
        joining = tripId
        error = nil
        defer { joining = nil }
        do {
            try await APIClient.shared.addBookingToTrip(tripId: tripId, bookingId: booking.id)
            await appState.reloadFinances()
            await onChange()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// ", split with 1 other job".
    private static func split(_ jobs: Int) -> String {
        guard jobs > 1 else { return "" }
        return ", split with \(jobs - 1) other job\(jobs > 2 ? "s" : "")"
    }

    private func row(_ label: String, _ value: String, bold: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .font(bold ? .subheadline.weight(.semibold) : .subheadline)
                .foregroundStyle(bold ? Theme.primaryText : Theme.secondaryText)
                .lineLimit(1)
            Spacer(minLength: 12)
            Text(value)
                .font(bold ? .subheadline.weight(.semibold) : .subheadline.weight(.medium))
                .foregroundStyle(Theme.primaryText)
        }
    }

    private func pill(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Theme.accent.opacity(0.18), in: Capsule())
                .foregroundStyle(Theme.accent)
        }
        .buttonStyle(.plain)
    }
}

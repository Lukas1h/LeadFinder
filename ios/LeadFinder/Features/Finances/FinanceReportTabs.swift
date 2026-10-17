import SwiftUI

// The read-only Finances tabs: Overview, Jobs and Taxes, laid out as the web's
// src/app/finances pages. Numbers are the server's, shown as they come.

private let twoColumns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

/// A card with a title over a grid of StatTiles, the web's Card + Stat grid.
private struct StatCard<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.primaryText)
            LazyVGrid(columns: twoColumns, spacing: 14) { content }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }
}

private func footnote(_ text: String) -> some View {
    Text(text)
        .font(.caption)
        .foregroundStyle(Theme.tertiaryText)
        .fixedSize(horizontal: false, vertical: true)
}

private func mpgText(_ value: Double) -> String {
    value.formatted(.number.precision(.fractionLength(0...1)))
}

// MARK: - Overview

/// This month and this year, month by month, and where the money went.
struct FinanceOverviewTab: View {
    let report: FinanceOverview

    var body: some View {
        let month = report.thisMonth
        let year = report.yearToDate

        VStack(alignment: .leading, spacing: 14) {
            StatCard(title: "\(FinanceFormat.monthLabel(report.month, withYear: false)) so far") {
                StatTile("Revenue", FinanceFormat.dollars(month.revenue), "\(month.jobs) jobs")
                StatTile("Costs", FinanceFormat.dollars(month.costs), "\(FinanceFormat.dollars(month.gas)) of it gas")
                StatTile("Real profit", FinanceFormat.dollars(month.profit), "revenue − gas − expenses")
                StatTile("Per hour", FinanceFormat.perHour(month.perHour), "\(Int(month.hours.rounded())) h worked")
            }

            StatCard(title: "\(String(report.year)) so far") {
                StatTile("Revenue", FinanceFormat.dollars(year.revenue), "\(year.jobs) jobs")
                StatTile("Costs", FinanceFormat.dollars(year.costs), "\(FinanceFormat.dollars(year.gas)) of it gas")
                StatTile("Real profit", FinanceFormat.dollars(year.profit), year.perHour.map { FinanceFormat.perHour($0) } ?? "")
                StatTile("Tax on it (est.)", FinanceFormat.dollars(report.yearTaxOwed), "set aside, see Taxes")
            }

            months

            footnote("Gas is business miles at \(mpgText(report.mpg)) mpg and the latest fill-up's price, not the gas receipts (those also cover personal driving). Yearly subscriptions are spread over their 12 months. Deductions are the mileage deduction plus deductible expenses as paid.")

            if !report.spend.isEmpty { spend }
        }
    }

    private var months: some View {
        let shown = report.months.filter { $0.revenue != 0 || $0.costs != 0 }
        return VStack(alignment: .leading, spacing: 0) {
            Text("By month")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.primaryText)
                .padding(.bottom, 8)
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, m in
                if index > 0 { Divider().overlay(Theme.hairline) }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(FinanceFormat.monthLabel(m.month))
                            .font(.subheadline)
                            .foregroundStyle(Theme.primaryText)
                        Spacer()
                        Text(FinanceFormat.dollars(m.profit))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(m.profit < 0 ? Theme.danger : Theme.primaryText)
                    }
                    Text([
                        "\(FinanceFormat.dollars(m.revenue)) revenue",
                        "\(FinanceFormat.dollars(m.gas)) gas",
                        "\(FinanceFormat.dollars(m.costs - m.gas)) other",
                        FinanceFormat.perHour(m.perHour),
                    ].joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                    Text("\(FinanceFormat.miles(m.miles)) · \(FinanceFormat.dollars(m.mileageDeduction + m.deductibleExpenses)) deductions")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                }
                .padding(.vertical, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }

    private var spend: some View {
        let biggest = max(report.spend.first?.amount ?? 1, 1)
        return VStack(alignment: .leading, spacing: 10) {
            Text("Where the money went in \(String(report.year))")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.primaryText)
            ForEach(report.spend) { row in
                HStack(spacing: 10) {
                    Text(row.label)
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                        .frame(width: 112, alignment: .leading)
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Theme.cardRaised)
                            Capsule()
                                .fill(Theme.primaryText.opacity(0.7))
                                .frame(width: max(4, proxy.size.width * row.amount / biggest))
                        }
                    }
                    .frame(height: 8)
                    Text(FinanceFormat.dollars(row.amount))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Theme.primaryText)
                        .frame(width: 56, alignment: .trailing)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }
}

// MARK: - Jobs

/// What each shot job really made, and the days with several jobs on one drive.
struct FinanceJobsTab: View {
    let report: FinanceJobsReport
    var onOpenBooking: (String) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !report.multiJobDays.isEmpty {
                Text("Days with several jobs")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                ForEach(report.multiJobDays) { day in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("\(FinanceFormat.dayLabel(day.date)) · \(day.purpose)")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Theme.primaryText)
                                .lineLimit(2)
                            Spacer(minLength: 8)
                            Text(FinanceFormat.dollars(day.profit))
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Theme.primaryText)
                        }
                        Text(day.jobs.map(\.label).joined(separator: " + "))
                            .font(.caption)
                            .foregroundStyle(Theme.tertiaryText)
                        Text(
                            "\(FinanceFormat.dollars(day.revenue)) revenue − \(FinanceFormat.dollars(day.gas)) gas"
                                + (day.expenses > 0 ? " − \(FinanceFormat.dollars(day.expenses)) expenses" : "")
                                + " · \(FinanceFormat.miles(day.miles)) · \(FinanceFormat.hours(day.hours)) · \(FinanceFormat.perHour(day.perHour))"
                        )
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card(padding: 14)
                }
            }

            if report.jobs.isEmpty {
                EmptyStateView(icon: "camera", title: "No jobs shot yet")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(report.jobs.enumerated()), id: \.element.id) { index, job in
                        if index > 0 { Divider().overlay(Theme.hairline) }
                        Button { onOpenBooking(job.bookingId) } label: { row(job) }
                            .buttonStyle(.plain)
                    }
                }
                .card(padding: 0)
            }

            footnote("A trip's miles, gas and drive time are split across its jobs by revenue. \"W/ car wear\" charges the IRS rate per mile (gas plus the car's upkeep and depreciation) instead of just gas. Hours are the shooting, editing and logistics recorded on the booking plus its share of the drive.")
        }
    }

    private func row(_ job: FinanceJobsReport.Job) -> some View {
        let hasTrip = !job.tripIds.isEmpty
        let place = [job.date.map(FinanceFormat.dayLabel), job.city.flatMap { $0 != job.label ? $0 : nil }]
            .compactMap { $0 }
            .joined(separator: " · ")

        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(job.label)
                    .font(.subheadline)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(FinanceFormat.dollars(job.profit))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(job.profit < 0 ? Theme.danger : Theme.primaryText)
            }
            HStack(alignment: .firstTextBaseline) {
                Text(place)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                Spacer(minLength: 8)
                if hasTrip {
                    Text("\(FinanceFormat.dollars(job.profitAfterCarWear)) w/ car wear")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                }
            }
            Text([
                "\(FinanceFormat.dollars(job.revenue)) revenue",
                hasTrip ? "\(FinanceFormat.dollars(job.gas)) gas" : "no trip",
                job.expenses > 0 ? "\(FinanceFormat.dollars(job.expenses)) expenses" : nil,
                job.hours > 0 ? FinanceFormat.hours(job.hours) : nil,
                FinanceFormat.perHour(job.perHour),
                hasTrip ? FinanceFormat.miles(job.miles) : nil,
            ].compactMap { $0 }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(Theme.tertiaryText)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

// MARK: - Taxes

/// The year the way the tax return sees it, the estimate on it, and the two
/// settings it rests on.
struct FinanceTaxesTab: View {
    let report: TaxReport

    @Environment(AppState.self) private var appState
    @State private var mpg = ""
    @State private var wages = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        let tax = report.tax

        VStack(alignment: .leading, spacing: 14) {
            StatCard(title: "\(String(report.year)) so far, the way the tax return sees it") {
                StatTile("Revenue", FinanceFormat.dollars(report.revenue), "")
                StatTile("Deductible expenses", "−\(FinanceFormat.dollars(report.deductibleExpenses))", "")
                StatTile("Mileage deduction", "−\(FinanceFormat.dollars(report.mileageDeduction))", FinanceFormat.miles(report.miles))
                StatTile("Taxable profit", FinanceFormat.dollars(report.taxableProfit), "")
            }

            VStack(alignment: .leading, spacing: 12) {
                Text("What the business owes on that (estimate)")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                LazyVGrid(columns: twoColumns, spacing: 14) {
                    StatTile("Self-employment", FinanceFormat.dollars(tax.selfEmployment), "")
                    StatTile("Federal income", FinanceFormat.dollars(tax.federal), "")
                    StatTile("Oregon", FinanceFormat.dollars(tax.oregon), "")
                    StatTile(
                        "Total to set aside",
                        FinanceFormat.dollars(tax.total),
                        report.effectiveRate.map { "\(FinanceFormat.percent($0)) of profit" } ?? ""
                    )
                }
                Divider().overlay(Theme.cardRaised)
                LazyVGrid(columns: twoColumns, spacing: 14) {
                    StatTile("Deductions saved you", FinanceFormat.dollars(report.saved), "\(FinanceFormat.dollars(report.savedByMileage)) from mileage")
                    StatTile("Next dollar of profit", FinanceFormat.percent(report.marginalRate), "goes to tax")
                    StatTile("A $100 deduction", FinanceFormat.dollars(report.marginalRate * 100), "saved")
                }
                footnote("A planning estimate, not tax advice: single filer, standard deduction, \(FinanceFormat.dollars(report.otherWagesYearly)) a year of W-2 wages from other jobs, 2026 federal and Oregon brackets, self-employment tax and the 20% business income deduction. It counts what the business adds on top of the wages, whose tax is already withheld. If the business owes $1,000 or more for the year, the IRS expects quarterly estimated payments.")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card(padding: 14)

            settings
        }
        .onAppear(perform: fill)
        .onChange(of: report.settings) { fill() }
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Settings")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.primaryText)
            field("Car MPG", $mpg)
            field("Other wages a month ($)", $wages)
            HStack {
                if let error {
                    Text(error).font(.caption).foregroundStyle(Theme.danger)
                }
                Spacer()
                Button {
                    Task { await save() }
                } label: {
                    if saving { ProgressView() } else { Text("Save").fontWeight(.semibold) }
                }
                .disabled(saving || !changed || ExpenseFormSheet.parse(mpg) == nil || ExpenseFormSheet.parse(wages) == nil)
            }
            footnote("MPG prices each trip's gas. The wages from other jobs set which tax bracket the business's profit lands in.")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }

    private func field(_ title: String, _ value: Binding<String>) -> some View {
        HStack {
            Text(title)
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryText)
            Spacer()
            TextField("—", text: value)
                .keyboard(.decimal)
                .multilineTextAlignment(.trailing)
                .frame(width: 90)
        }
    }

    private var changed: Bool {
        ExpenseFormSheet.parse(mpg) != report.settings.mpg || ExpenseFormSheet.parse(wages) != report.settings.otherWagesMonthly
    }

    private func fill() {
        mpg = mpgText(report.settings.mpg)
        wages = report.settings.otherWagesMonthly.formatted(.number.precision(.fractionLength(0...2)).grouping(.never))
    }

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await APIClient.shared.updateFinanceSettings(mpg: ExpenseFormSheet.parse(mpg), otherWagesMonthly: ExpenseFormSheet.parse(wages))
            await appState.reloadFinances()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

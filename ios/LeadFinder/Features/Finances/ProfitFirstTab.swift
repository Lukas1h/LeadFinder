import SwiftUI

// Profit First, as the web's /finances/profit-first: every dollar collected
// (cash basis, when paid), minus subcontractors, is split into Profit, Owner's
// pay, Tax and OpEx. The money moves on allocation days, the 10th and 25th.

private let twoColumns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

struct ProfitFirstTab: View {
    let report: ProfitFirstReport

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            nextAllocation
            period(report.thisQuarter, title: "This quarter")
            period(report.yearToDate, title: "Year to date", showsTax: true)
            if !report.months.isEmpty { months }
            ProfitFirstPercentsEditor(percents: report.percents)
            Text("Cash basis: a job counts when it's paid, not when it's shot. Subcontractors come off the top before the split.")
                .font(.caption)
                .foregroundStyle(Theme.tertiaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Next allocation

    private var nextAllocation: some View {
        let since = report.sinceLastAllocation
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("Move on \(Self.day(report.nextAllocationDate))")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                Spacer()
                Text("since \(Self.day(report.lastAllocationDate))")
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("Collected")
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                Text(FinanceFormat.dollars(since.collected))
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)
                Text(collectedSub(since))
                    .font(.caption2)
                    .foregroundStyle(Theme.tertiaryText)
            }
            Divider().overlay(Theme.hairline)
            LazyVGrid(columns: twoColumns, spacing: 14) {
                ForEach(PfAccount.allCases) { account in
                    StatTile(
                        account.label,
                        FinanceFormat.dollars(account.amount(in: since.allocations)),
                        "\(Self.percent(account.percent(in: report.percents))) of real revenue"
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }

    private func collectedSub(_ p: PfPeriod) -> String {
        var parts = ["\(p.jobs) paid job\(p.jobs == 1 ? "" : "s")"]
        if p.subcontractors > 0 {
            parts.append("\(FinanceFormat.dollars(p.subcontractors)) subcontractors")
            parts.append("\(FinanceFormat.dollars(p.realRevenue)) real revenue")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: - Quarter / year

    private func period(_ p: PfPeriod, title: String, showsTax: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.primaryText)
            LazyVGrid(columns: twoColumns, spacing: 14) {
                StatTile("Collected", FinanceFormat.dollars(p.collected), "\(p.jobs) paid job\(p.jobs == 1 ? "" : "s")")
                StatTile(
                    "Real revenue",
                    FinanceFormat.dollars(p.realRevenue),
                    p.subcontractors > 0 ? "\(FinanceFormat.dollars(p.subcontractors)) subcontractors" : "no subcontractors"
                )
                ForEach(PfAccount.allCases) { account in
                    StatTile(
                        account.label,
                        FinanceFormat.dollars(account.amount(in: p.allocations)),
                        Self.percent(account.percent(in: report.percents))
                    )
                }
            }
            Divider().overlay(Theme.hairline)
            opexBar(p)
            if showsTax { taxLine(p) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }

    private func opexBar(_ p: PfPeriod) -> some View {
        let allotment = p.allocations.opex
        let over = p.opexSpent > allotment
        let fraction = allotment > 0 ? min(p.opexSpent / allotment, 1) : (p.opexSpent > 0 ? 1 : 0)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("OpEx spent")
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                Spacer()
                Text("\(FinanceFormat.dollars(p.opexSpent)) of \(FinanceFormat.dollars(allotment))")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(over ? Theme.danger : Theme.primaryText)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.cardRaised)
                    Capsule()
                        .fill(over ? Theme.danger : Theme.accent)
                        .frame(width: proxy.size.width * fraction)
                }
            }
            .frame(height: 8)
            Text(over
                 ? "\(FinanceFormat.dollars(p.opexSpent - allotment)) over the allotment"
                 : "\(FinanceFormat.dollars(p.opexLeft)) left")
                .font(.caption2)
                .foregroundStyle(over ? Theme.danger : Theme.tertiaryText)
        }
        .accessibilityElement(children: .combine)
    }

    private func taxLine(_ p: PfPeriod) -> some View {
        let short = report.taxOwedYtd - p.allocations.tax
        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text("Tax set aside")
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                Spacer()
                Text("\(FinanceFormat.dollars(p.allocations.tax)) vs \(FinanceFormat.dollars(report.taxOwedYtd)) estimated owed")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(short > 0 ? Theme.warning : Theme.primaryText)
            }
            if short > 0 {
                Text("\(FinanceFormat.dollars(short)) short of the estimate")
                    .font(.caption2)
                    .foregroundStyle(Theme.warning)
            }
        }
    }

    // MARK: - Months

    private var months: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("By month")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.primaryText)
                .padding(.bottom, 8)
            ForEach(Array(report.months.enumerated()), id: \.element.start) { index, m in
                if index > 0 { Divider().overlay(Theme.hairline) }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(m.label)
                            .font(.subheadline)
                            .foregroundStyle(Theme.primaryText)
                        Spacer()
                        Text(FinanceFormat.dollars(m.collected))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.primaryText)
                    }
                    Text(PfAccount.allCases
                        .map { "\($0.shortLabel) \(FinanceFormat.dollars($0.amount(in: m.allocations)))" }
                        .joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                    Text(monthDetail(m))
                        .font(.caption)
                        .foregroundStyle(m.opexLeft < 0 ? Theme.danger : Theme.tertiaryText)
                }
                .padding(.vertical, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }

    private func monthDetail(_ m: PfPeriod) -> String {
        var parts = ["\(m.jobs) job\(m.jobs == 1 ? "" : "s")"]
        if m.subcontractors > 0 { parts.append("\(FinanceFormat.dollars(m.subcontractors)) subs") }
        parts.append("OpEx \(FinanceFormat.dollars(m.opexSpent)) of \(FinanceFormat.dollars(m.allocations.opex))")
        return parts.joined(separator: " · ")
    }

    // MARK: - Formatting

    /// "2026-11-25" -> "Nov 25".
    static func day(_ iso: String) -> String {
        guard let date = FinanceFormat.date(iso) else { return iso }
        var style = Date.FormatStyle.dateTime.month(.abbreviated).day()
        style.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return date.formatted(style)
    }

    /// Whole percents: 5 -> "5%", 12.5 -> "12.5%".
    static func percent(_ value: Double) -> String {
        "\(value.formatted(.number.precision(.fractionLength(0...1))))%"
    }
}

// MARK: - Percentages

/// The four split percentages. They must add up to 100 before Save is allowed.
private struct ProfitFirstPercentsEditor: View {
    let percents: ProfitFirstPercents

    @Environment(AppState.self) private var appState
    @State private var profit = ""
    @State private var ownerPay = ""
    @State private var tax = ""
    @State private var opex = ""
    @State private var isSaving = false
    @State private var error: String?
    @State private var saved = false

    private var values: [Double?] { [profit, ownerPay, tax, opex].map { Double($0.trimmingCharacters(in: .whitespaces)) } }
    private var total: Double { values.reduce(0) { $0 + ($1 ?? 0) } }
    private var isValid: Bool { values.allSatisfy { $0 != nil && $0! >= 0 } && abs(total - 100) < 0.001 }
    private var isChanged: Bool {
        values != [percents.profit, percents.ownerPay, percents.tax, percents.opex].map { Optional($0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Percentages")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.primaryText)
            field("Profit", $profit)
            field("Owner's pay", $ownerPay)
            field("Tax", $tax)
            field("OpEx", $opex)
            Divider().overlay(Theme.hairline)
            HStack {
                Text("Total")
                    .font(.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                Spacer()
                Text(ProfitFirstTab.percent(total))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(abs(total - 100) < 0.001 ? Theme.primaryText : Theme.danger)
            }
            if abs(total - 100) >= 0.001 {
                Text("Must add up to 100%.")
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
            }
            if let error {
                Text(error).font(.caption).foregroundStyle(Theme.danger)
            }
            Button {
                Task { await save() }
            } label: {
                Text(saved && !isChanged ? "Saved" : "Save")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
            .foregroundStyle(Theme.background)
            .disabled(!isValid || !isChanged || isSaving)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
        .onAppear(perform: fill)
        .onChange(of: percents.profit) { fill() }
        .onChange(of: percents.ownerPay) { fill() }
        .onChange(of: percents.tax) { fill() }
        .onChange(of: percents.opex) { fill() }
    }

    private func field(_ title: String, _ value: Binding<String>) -> some View {
        HStack {
            Text(title)
                .font(.subheadline)
                .foregroundStyle(Theme.primaryText)
            Spacer()
            TextField("0", text: value)
                .keyboard(.decimal)
                .multilineTextAlignment(.trailing)
                .frame(width: 70)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            Text("%")
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryText)
        }
    }

    private func fill() {
        profit = Self.text(percents.profit)
        ownerPay = Self.text(percents.ownerPay)
        tax = Self.text(percents.tax)
        opex = Self.text(percents.opex)
    }

    private static func text(_ v: Double) -> String {
        v.formatted(.number.precision(.fractionLength(0...2)).grouping(.never))
    }

    private func save() async {
        guard isValid, let p = values[0], let o = values[1], let t = values[2], let x = values[3] else { return }
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            try await APIClient.shared.updateProfitFirstPercents(
                ProfitFirstPercents(profit: p, ownerPay: o, tax: t, opex: x)
            )
            saved = true
            await appState.profitFirst.load(force: true)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

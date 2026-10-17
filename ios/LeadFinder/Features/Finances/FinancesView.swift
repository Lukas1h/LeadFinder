import SwiftUI

/// Pushed onto a NavigationStack to open Finances (from Home's money card).
struct FinancesRoute: Hashable {
    var tab: FinanceTab = .overview
}

/// The web's five Finances tabs, in its order.
enum FinanceTab: String, CaseIterable, Identifiable, Hashable {
    case overview, jobs, expenses, mileage, taxes

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: "Overview"
        case .jobs: "Jobs"
        case .expenses: "Expenses"
        case .mileage: "Mileage"
        case .taxes: "Taxes"
        }
    }
}

/// Finances: what the business made, where the money went, the mileage log and
/// the tax estimate — the web's /finances pages. Every number comes from the
/// server's finance reports as it is; this screen only lays them out.
///
/// The + button is the fast path from the phone: photograph a receipt, or log
/// a drive.
struct FinancesView: View {
    @State var tab: FinanceTab = .overview

    @Environment(AppState.self) private var appState
    @State private var expenseDraft: ExpenseDraft?
    @State private var tripDraft: TripDraft?
    @State private var openBooking: Booking?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Picker("Tab", selection: $tab) {
                    ForEach(FinanceTab.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)

                ErrorBanner(message: error, onRetry: { Task { await reload() } })

                content
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.background)
        .refreshable { await reload() }
        .navigationTitle("Finances")
        .titleDisplay(.inline)
        .toolbar {
            ToolbarItem(placement: .trailingBar) {
                Menu {
                    #if os(iOS)
                    if CameraPicker.isAvailable {
                        Button {
                            expenseDraft = ExpenseDraft(startWithCamera: true)
                        } label: {
                            Label("Photo a receipt", systemImage: "camera")
                        }
                    }
                    #endif
                    Button {
                        expenseDraft = ExpenseDraft()
                    } label: {
                        Label("Add an expense", systemImage: "receipt")
                    }
                    Button {
                        tripDraft = TripDraft()
                    } label: {
                        Label("Log a trip", systemImage: "car")
                    }
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(item: $expenseDraft) { ExpenseFormSheet(draft: $0) }
        .sheet(item: $tripDraft) { TripFormSheet(draft: $0) }
        .sheet(item: $openBooking) { booking in
            BookingDetailView(booking: booking)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .task(id: tab) { await load(tab) }
        #if DEBUG
        .task {
            switch DebugLaunchArguments.financeForm {
            case "expense": expenseDraft = ExpenseDraft()
            case "trip": tripDraft = TripDraft()
            default: break
            }
        }
        #endif
    }

    @ViewBuilder
    private var content: some View {
        switch tab {
        case .overview:
            if let report = appState.finances.value {
                FinanceOverviewTab(report: report)
            } else {
                placeholder
            }
        case .jobs:
            if let report = appState.financeJobs.value {
                FinanceJobsTab(report: report, onOpenBooking: open)
            } else {
                placeholder
            }
        case .expenses:
            if let response = appState.financeExpenses.value {
                FinanceExpensesTab(
                    expenses: response.expenses,
                    options: appState.financeLinkOptions.value,
                    onAdd: { expenseDraft = ExpenseDraft() },
                    onOpen: { expenseDraft = .editing($0) }
                )
            } else {
                placeholder
            }
        case .mileage:
            if let report = appState.financeTrips.value {
                FinanceMileageTab(
                    report: report,
                    options: appState.financeLinkOptions.value,
                    onAdd: { tripDraft = TripDraft() },
                    onOpen: { tripDraft = .editing($0) }
                )
            } else {
                placeholder
            }
        case .taxes:
            if let report = appState.financeTaxes.value {
                FinanceTaxesTab(report: report)
            } else {
                placeholder
            }
        }
    }

    @ViewBuilder
    private var placeholder: some View {
        if let error {
            EmptyStateView(icon: "wifi.exclamationmark", title: "Couldn't load", message: error)
        } else {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 60)
        }
    }

    private var error: String? {
        switch tab {
        case .overview: appState.finances.error
        case .jobs: appState.financeJobs.error
        case .expenses: appState.financeExpenses.error
        case .mileage: appState.financeTrips.error
        case .taxes: appState.financeTaxes.error
        }
    }

    private func load(_ tab: FinanceTab) async {
        switch tab {
        case .overview: await appState.finances.load()
        case .jobs: await appState.financeJobs.load()
        case .expenses:
            await appState.financeExpenses.load()
            await appState.financeLinkOptions.load()
        case .mileage:
            await appState.financeTrips.load()
            await appState.financeLinkOptions.load()
        case .taxes: await appState.financeTaxes.load()
        }
    }

    private func reload() async {
        await appState.reloadFinances()
    }

    /// A job row opens its booking, from the bookings feed.
    private func open(_ bookingId: String) {
        Task {
            if let booking = try? await APIClient.shared.bookingDetail(bookingId) {
                openBooking = booking
            }
        }
    }
}

// MARK: - Expenses

/// Every expense by month, newest first; tap one to edit it. The web's
/// ExpenseList, including its month subtotals.
struct FinanceExpensesTab: View {
    let expenses: [Expense]
    let options: FinanceLinkOptions?
    var onAdd: () -> Void
    var onOpen: (Expense) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("\(expenses.count) expenses · \(FinanceFormat.money(expenses.reduce(0) { $0 + $1.amount })) all time")
                    .font(.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                Spacer()
                Button(action: onAdd) {
                    Label("Add", systemImage: "plus")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .foregroundStyle(Theme.background)
            }

            if expenses.isEmpty {
                EmptyStateView(icon: "receipt", title: "No expenses yet", message: "Tap + and photograph a receipt.")
            }

            ForEach(Self.byMonth(expenses), id: \.month) { group in
                let business = group.rows.filter { $0.category != "personal" }
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(FinanceFormat.monthLabel(group.month))
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.primaryText)
                        Spacer()
                        Text("\(FinanceFormat.money(business.reduce(0) { $0 + $1.amount })) · \(FinanceFormat.money(group.rows.reduce(0) { $0 + $1.deductibleAmount })) deductible")
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    VStack(spacing: 0) {
                        ForEach(Array(group.rows.enumerated()), id: \.element.id) { index, expense in
                            if index > 0 { Divider().overlay(Theme.hairline) }
                            Button { onOpen(expense) } label: { row(expense) }
                                .buttonStyle(.plain)
                        }
                    }
                    .card(padding: 0)
                }
            }
        }
    }

    private func row(_ e: Expense) -> some View {
        HStack(spacing: 12) {
            Text(FinanceFormat.dayLabel(e.date))
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
                .frame(width: 46, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(e.description)
                    .font(.subheadline)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text(detail(e))
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            if e.hasReceipt {
                Image(systemName: "paperclip")
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
            }
            VStack(alignment: .trailing, spacing: 2) {
                Text(FinanceFormat.money(e.amount))
                    .font(.subheadline)
                    .foregroundStyle(Theme.primaryText)
                Text(e.deductiblePercent == 100 ? "deductible" : e.deductiblePercent == 0 ? "not deductible" : "\(e.deductiblePercent)% deductible")
                    .font(.caption2)
                    .foregroundStyle(Theme.tertiaryText)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    private func detail(_ e: Expense) -> String {
        var parts = [options?.expenseCategory(e.category)?.label ?? e.category.capitalized]
        if let vendor = e.vendor?.nilIfBlank { parts.append(vendor) }
        if e.spreadMonths > 1 { parts.append("yearly") }
        if e.paidPersonally { parts.append("personal card") }
        return parts.joined(separator: " · ")
    }

    private static func byMonth(_ expenses: [Expense]) -> [(month: String, rows: [Expense])] {
        var order: [String] = []
        var groups: [String: [Expense]] = [:]
        for e in expenses {
            let month = String(e.date.prefix(7))
            if groups[month] == nil { order.append(month) }
            groups[month, default: []].append(e)
        }
        return order.map { ($0, groups[$0] ?? []) }
    }
}

// MARK: - Mileage

/// The mileage log by month; tap a trip to edit it. The web's TripList.
struct FinanceMileageTab: View {
    let report: MileageReport
    let options: FinanceLinkOptions?
    var onAdd: () -> Void
    var onOpen: (Trip) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("\(String(report.year)) mileage")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.primaryText)
                    Spacer()
                    Button(action: onAdd) {
                        Label("Log trip", systemImage: "plus")
                            .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .foregroundStyle(Theme.background)
                }
                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                    spacing: 14
                ) {
                    StatTile(
                        "Business miles",
                        Int(report.yearMiles.rounded()).formatted(.number.grouping(.automatic)),
                        "\(report.yearTrips) trips"
                    )
                    StatTile("Deduction", FinanceFormat.dollars(report.yearDeduction), "IRS rate")
                    StatTile("Gas it burned", FinanceFormat.dollars(report.yearGas), "at \(Self.mpg(report.mpg)) mpg")
                }
            }
            .card(padding: 14)

            ForEach(Self.byMonth(report.trips), id: \.month) { group in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(FinanceFormat.monthLabel(group.month))
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.primaryText)
                        Spacer()
                        Text("\(FinanceFormat.miles(group.rows.reduce(0) { $0 + $1.miles })) · \(FinanceFormat.dollars(group.rows.reduce(0) { $0 + $1.deduction })) deduction")
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    VStack(spacing: 0) {
                        ForEach(Array(group.rows.enumerated()), id: \.element.id) { index, trip in
                            if index > 0 { Divider().overlay(Theme.hairline) }
                            Button { onOpen(trip) } label: { row(trip) }
                                .buttonStyle(.plain)
                        }
                    }
                    .card(padding: 0)
                }
            }

            Text("* miles from the route estimate. Gas is the miles at \(Self.mpg(report.mpg)) mpg and the price on the latest gas receipt before the trip. The deduction is the IRS rate for the trip's date (72.5¢ a mile through June 2026, 76¢ from July).")
                .font(.caption)
                .foregroundStyle(Theme.tertiaryText)
        }
    }

    private func row(_ t: Trip) -> some View {
        HStack(spacing: 12) {
            Text(FinanceFormat.dayLabel(t.date))
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
                .frame(width: 46, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(t.purpose)
                    .font(.subheadline)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                Text(detail(t))
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(FinanceFormat.miles(t.miles))\(t.milesEstimated ? "*" : "")")
                    .font(.subheadline)
                    .foregroundStyle(Theme.primaryText)
                Text("\(FinanceFormat.money(t.gas)) gas · \(FinanceFormat.dollars(t.deduction))")
                    .font(.caption2)
                    .foregroundStyle(Theme.tertiaryText)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    private func detail(_ t: Trip) -> String {
        var parts = [options?.tripCategoryLabel(t.category) ?? t.category.capitalized]
        if let minutes = t.driveMinutes, minutes > 0 { parts.append("\(FinanceFormat.hours(minutes / 60)) driving") }
        if !t.jobLabels.isEmpty { parts.append(t.jobLabels.joined(separator: " + ")) }
        return parts.joined(separator: " · ")
    }

    private static func mpg(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...1)))
    }

    private static func byMonth(_ trips: [Trip]) -> [(month: String, rows: [Trip])] {
        var order: [String] = []
        var groups: [String: [Trip]] = [:]
        for t in trips {
            let month = String(t.date.prefix(7))
            if groups[month] == nil { order.append(month) }
            groups[month, default: []].append(t)
        }
        return order.map { ($0, groups[$0] ?? []) }
    }
}

import Foundation

// The Finances API (docs/ios-backend-spec.md, "Finances (added 2026-10-16)").
// Every number is computed on the server by src/lib/finance/reports.ts, the
// same functions the web's Finances pages render, so these are shown as they
// come and never recomputed here. Money is dollars (floats), dates are
// "YYYY-MM-DD" Pacific wall-clock strings, months "YYYY-MM".

// MARK: - GET /finances

struct FinanceOverview: Codable, Sendable {
    struct Period: Codable, Sendable, Hashable {
        var revenue: Double
        var jobs: Int
        var costs: Double
        var gas: Double
        var profit: Double
        var hours: Double
        var perHour: Double?
        var miles: Double
    }

    struct Month: Codable, Sendable, Hashable, Identifiable {
        var month: String
        var revenue: Double
        var jobs: Int
        var miles: Double
        var gas: Double
        var gasBought: Double?
        var costsByCategory: [String: Double]?
        var costs: Double
        var profit: Double
        var hours: Double
        var perHour: Double?
        var mileageDeduction: Double
        var deductibleExpenses: Double

        var id: String { month }
    }

    struct Spend: Codable, Sendable, Hashable, Identifiable {
        var category: String
        var label: String
        var amount: Double

        var id: String { category }
    }

    var month: String
    var year: Int
    var thisMonth: Period
    var yearToDate: Period
    var yearTaxOwed: Double
    /// Newest first.
    var months: [Month]
    /// This year's costs by category, biggest first.
    var spend: [Spend]
    var mpg: Double
}

// MARK: - GET /finances/jobs

struct FinanceJobsReport: Codable, Sendable {
    struct Job: Codable, Sendable, Hashable, Identifiable {
        var bookingId: String
        var label: String
        var city: String?
        var date: String?
        var revenue: Double
        var gas: Double
        var expenses: Double
        var profit: Double
        /// Charges the IRS rate per mile instead of just gas.
        var profitAfterCarWear: Double
        var hours: Double
        var perHour: Double?
        var miles: Double
        var driveHours: Double
        var mileageDeduction: Double
        var tripIds: [String]

        var id: String { bookingId }
    }

    struct MultiJobDay: Codable, Sendable, Hashable, Identifiable {
        struct LinkedJob: Codable, Sendable, Hashable {
            var bookingId: String
            var label: String
        }

        var tripId: String
        var date: String
        var purpose: String
        var jobs: [LinkedJob]
        var miles: Double
        var revenue: Double
        var gas: Double
        var expenses: Double
        var hours: Double
        var profit: Double
        var perHour: Double?

        var id: String { tripId }
    }

    /// Shot jobs, newest first.
    var jobs: [Job]
    var multiJobDays: [MultiJobDay]
}

// MARK: - GET /finances/trips

struct MileageReport: Codable, Sendable {
    var year: Int
    var mpg: Double
    var yearMiles: Double
    var yearTrips: Int
    var yearDeduction: Double
    var yearGas: Double
    /// Newest first.
    var trips: [Trip]
}

struct Trip: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var date: String
    var purpose: String
    var category: String
    /// One stop per line, home excluded.
    var stops: String?
    var miles: Double
    var driveMinutes: Double?
    var milesEstimated: Bool
    var notes: String?
    var bookingIds: [String]
    var jobLabels: [String]
    var gallons: Double?
    var pricePerGallon: Double?
    var gas: Double
    var rate: Double
    var deduction: Double
}

// MARK: - GET /finances/expenses

struct ExpensesResponse: Codable, Sendable {
    /// Newest first.
    var expenses: [Expense]
}

struct Expense: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var date: String
    var amount: Double
    var vendor: String?
    var description: String
    var category: String
    var deductiblePercent: Int
    var deductibleAmount: Double
    var gallons: Double?
    var pricePerGallon: Double?
    var paidPersonally: Bool
    /// 12 is a yearly charge, spread over its months ("Yearly").
    var spreadMonths: Int
    var bookingId: String?
    var tripId: String?
    var receiptNumber: Int?
    var notes: String?
    var hasReceipt: Bool
    var receiptPath: String?
    var createdAt: String?
}

// MARK: - GET /finances/taxes

struct TaxReport: Codable, Sendable {
    struct Tax: Codable, Sendable {
        var selfEmployment: Double
        var federal: Double
        var oregon: Double
        var total: Double
    }

    var year: Int
    var revenue: Double
    var deductibleExpenses: Double
    var mileageDeduction: Double
    var miles: Double
    var taxableProfit: Double
    var otherWagesYearly: Double
    var tax: Tax
    var effectiveRate: Double?
    var deductions: Double
    var saved: Double
    var savedByMileage: Double
    /// The tax on the next dollar of profit.
    var marginalRate: Double
    var settings: FinanceSettings
}

struct FinanceSettings: Codable, Sendable, Hashable {
    var mpg: Double
    var otherWagesMonthly: Double
}

// MARK: - GET /finances/link-options

struct FinanceLinkOptions: Codable, Sendable {
    struct BookingOption: Codable, Sendable, Hashable, Identifiable {
        var id: String
        var label: String
        var date: String?
    }

    struct TripOption: Codable, Sendable, Hashable, Identifiable {
        var id: String
        var date: String
        var purpose: String
        var miles: Double
        var bookingIds: [String]
    }

    struct ExpenseCategory: Codable, Sendable, Hashable, Identifiable {
        var value: String
        var label: String
        /// The deduction this category usually gets: 100, 50 or 0.
        var deductible: Int
        var hint: String?

        var id: String { value }
    }

    struct TripCategory: Codable, Sendable, Hashable, Identifiable {
        var value: String
        var label: String

        var id: String { value }
    }

    var bookings: [BookingOption]
    var trips: [TripOption]
    var expenseCategories: [ExpenseCategory]
    var tripCategories: [TripCategory]

    func expenseCategory(_ value: String) -> ExpenseCategory? {
        expenseCategories.first { $0.value == value }
    }

    func tripCategoryLabel(_ value: String) -> String {
        tripCategories.first { $0.value == value }?.label ?? value.capitalized
    }
}

// MARK: - Writes

/// POST /finances/receipts/read: what Gemini read off the receipt. Any of it
/// may be missing.
struct ReceiptReading: Codable, Sendable {
    var date: String?
    var amount: Double?
    var vendor: String?
    var description: String?
    var category: String?
    var gallons: Double?
    var pricePerGallon: Double?
}

/// POST /finances/trips/estimate: home, the stops, home, on real roads.
struct RouteEstimate: Codable, Sendable {
    var miles: Double
    var driveMinutes: Double?
    /// Stops that could only be routed to their town.
    var approximate: [String]
}

// MARK: - Booking costs

/// `bookingJson.costs`: what the booking's "Time & money" section shows.
struct BookingCosts: Codable, Sendable, Hashable {
    struct TripShare: Codable, Sendable, Hashable, Identifiable {
        var id: String
        var date: String
        var purpose: String
        var miles: Double
        var driveMinutes: Double?
        /// How many jobs the trip is split across.
        var jobs: Int
    }

    struct ExpenseItem: Codable, Sendable, Hashable, Identifiable {
        var id: String
        var date: String
        var description: String
        var amount: Double
        var deductiblePercent: Int
    }

    var miles: Double
    var gas: Double
    var expenses: Double
    var mileageDeduction: Double
    var trips: [TripShare]
    var expenseItems: [ExpenseItem]
}

// MARK: - Formatting

enum FinanceFormat {
    /// Whole dollars: "$1,354", "-$48".
    static func dollars(_ value: Double) -> String {
        value.rounded().formatted(.currency(code: "USD").precision(.fractionLength(0)).grouping(.automatic))
    }

    /// Dollars and cents: "$71.09".
    static func money(_ value: Double) -> String {
        value.formatted(.currency(code: "USD").precision(.fractionLength(2)).grouping(.automatic))
    }

    /// "$36/hr", or "—" when no hours were recorded.
    static func perHour(_ value: Double?) -> String {
        value.map { "\(dollars($0))/hr" } ?? "\u{2014}"
    }

    static func miles(_ value: Double) -> String {
        "\(Int(value.rounded()).formatted(.number.grouping(.automatic))) mi"
    }

    static func hours(_ value: Double) -> String {
        "\(value.formatted(.number.precision(.fractionLength(0...1)))) h"
    }

    static func percent(_ value: Double) -> String {
        "\((value * 1000).rounded() / 10)%".replacingOccurrences(of: ".0%", with: "%")
    }

    private static let pacific = TimeZone(identifier: "America/Los_Angeles")!

    private static let dayParser: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = pacific
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// "2026-10-15" -> a Date at Pacific midnight, for date pickers.
    static func date(_ day: String) -> Date? { dayParser.date(from: String(day.prefix(10))) }

    /// A Date -> "2026-10-15" in Pacific time, what the API takes.
    static func day(_ date: Date) -> String { dayParser.string(from: date) }

    /// Today, Pacific.
    static var today: String { day(Date()) }

    /// "Oct 15".
    static func dayLabel(_ day: String) -> String {
        guard let date = date(day) else { return day }
        var style = Date.FormatStyle.dateTime.month(.abbreviated).day()
        style.timeZone = pacific
        return date.formatted(style)
    }

    /// "2026-10" -> "October 2026", or "October" with `withYear: false`.
    static func monthLabel(_ month: String, withYear: Bool = true) -> String {
        guard let date = date("\(month.prefix(7))-01") else { return month }
        var style = withYear ? Date.FormatStyle.dateTime.month(.wide).year() : Date.FormatStyle.dateTime.month(.wide)
        style.timeZone = pacific
        return date.formatted(style)
    }

    /// "Oct" for a "YYYY-MM", for chart axes.
    static func shortMonth(_ month: String) -> String {
        guard let date = date("\(month.prefix(7))-01") else { return month }
        var style = Date.FormatStyle.dateTime.month(.abbreviated)
        style.timeZone = pacific
        return date.formatted(style)
    }

    /// Days between two "YYYY-MM-DD" strings, ignoring order.
    static func daysApart(_ a: String, _ b: String) -> Int? {
        guard let x = date(a), let y = date(b) else { return nil }
        return abs(Calendar(identifier: .gregorian).dateComponents([.day], from: x, to: y).day ?? 0)
    }
}

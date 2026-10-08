import Foundation

/// Dates arrive from the API as ISO-8601 strings. Nothing in the app works with
/// `Date` directly for wire data — the server's ISO strings are kept and parsed
/// on demand, so a stale field can't silently shift a booking's day.
///
/// Parsed leniently: Postgres timestamps come through with fractional seconds of
/// varying length, and calendar days arrive as a bare `YYYY-MM-DD`.
enum DateFormatting {
    // The two ISO8601 formatters need `nonisolated(unsafe)`: they aren't
    // Sendable in this SDK even though reading them from several threads is
    // fine, and rebuilding one per list row would be wasteful. DateFormatter is
    // already Sendable, so those need no annotation.

    nonisolated(unsafe) private static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    nonisolated(unsafe) private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    /// A bare `YYYY-MM-DD` is a calendar day, not an instant: parsed in the
    /// phone's local zone so "today" matches the day Lukas sees.
    static let day: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static let monthDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter
    }()

    static let dayTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE d MMM · h:mm a"
        return formatter
    }()

    static let time: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter
    }()

    static let weekday: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMM d"
        return formatter
    }()

    static func parse(_ string: String?) -> Date? {
        guard let string else { return nil }
        return withFraction.date(from: string)
            ?? plain.date(from: string)
            ?? day.date(from: string)
    }

    /// A calendar day, or nil. Used for `GET /schedule`'s `date` field.
    static func parseDay(_ string: String?) -> Date? {
        guard let string else { return nil }
        return day.date(from: string)
    }

    static func isToday(_ dayString: String?) -> Bool {
        guard let day = parseDay(dayString) else { return false }
        return Calendar.current.isDateInToday(day)
    }

    static func isPastDay(_ dayString: String?) -> Bool {
        guard let day = parseDay(dayString) else { return false }
        return day < Calendar.current.startOfDay(for: Date())
    }

    /// "Today", "Tomorrow", "Oct 12", with today's weekday name.
    static func relativeDay(_ dayString: String?) -> String {
        guard let date = parseDay(dayString) else { return "" }
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInTomorrow(date) { return "Tomorrow" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        if calendar.isDate(date, equalTo: Date(), toGranularity: .year) {
            return date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
        }
        return monthDay.string(from: date)
    }

    /// "Oct 12" or, for today, the weekday — used for reminder rows.
    static func shortDay(_ dayString: String?) -> String {
        guard let date = parseDay(dayString) else { return "" }
        return Calendar.current.isDateInToday(date)
            ? date.formatted(.dateTime.weekday(.abbreviated))
            : monthDay.string(from: date)
    }

    static func relative(_ isoString: String?) -> String {
        guard let date = parse(isoString) else { return "" }
        let seconds = Date().timeIntervalSince(date)
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h ago" }
        if seconds < 604_800 { return "\(Int(seconds / 86_400))d ago" }
        return monthDay.string(from: date)
    }
}
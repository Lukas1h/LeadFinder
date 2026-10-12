import Foundation
import UserNotifications

/// Local notifications for reminders and bookings.
///
/// They're scheduled on the device from what the app last synced, so they fire
/// with no server, no push and no network. The cost of that: the schedule is
/// only as fresh as the last time the app was opened (or refreshed in the
/// background), so a booking added on the web shows up here once the app has
/// synced it.
///
///  - A reminder fires at its time, or at `allDayHour` on its day when it has
///    none. Done reminders are left out.
///  - A booking fires at `allDayHour` on the day, then again `leadMinutes`
///    before he has to leave: the shoot time less the drive time.
///
/// Every sync rebuilds the whole set, so edits, completions and deletions can't
/// leave a stale alert behind.
@MainActor
enum AppNotifications {
    /// When "today" alerts go off: the morning of the day.
    static let allDayHour = 8
    /// How long before leaving the "leave soon" alert fires.
    static let leadMinutes = 15

    private static let reminderPrefix = "lf.reminder."
    private static let bookingPrefix = "lf.booking."
    /// iOS keeps at most 64 pending local notifications; the soonest win.
    private static let limit = 60

    private static var center: UNUserNotificationCenter { .current() }

    /// Shows alerts as banners while the app is open, rather than swallowing them.
    static func configure() {
        center.delegate = ForegroundPresenter.shared
    }

    /// Rebuilds the pending notifications from the latest data. Whichever of
    /// the two is nil is left as it was, so a failed load doesn't wipe it.
    static func sync(schedule: ScheduleResponse?, bookings: BookingsResponse?) async {
        guard await isAllowed() else { return }

        var wanted: [UNNotificationRequest] = []
        var stale: [String] = []
        let now = Date()

        if let schedule {
            stale += await pending(withPrefix: reminderPrefix)
            wanted += reminderRequests(schedule.items, now: now)
        }
        if let bookings {
            stale += await pending(withPrefix: bookingPrefix)
            wanted += bookingRequests(bookings.upcoming, now: now)
        }

        // Replaced by identifier below; this clears the ones that no longer exist.
        center.removePendingNotificationRequests(withIdentifiers: stale)

        let soonest = wanted
            .compactMap { request -> (UNNotificationRequest, Date)? in
                guard let trigger = request.trigger as? UNCalendarNotificationTrigger,
                      let date = trigger.nextTriggerDate()
                else { return nil }
                return (request, date)
            }
            .sorted { $0.1 < $1.1 }
            .prefix(limit)

        for (request, _) in soonest {
            try? await center.add(request)
        }
    }

    // MARK: - Permission

    /// Asks the first time, then only reports. A "no" is respected silently.
    private static func isAllowed() async -> Bool {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .notDetermined:
            return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        default:
            return false
        }
    }

    private static func pending(withPrefix prefix: String) async -> [String] {
        await center.pendingNotificationRequests()
            .map(\.identifier)
            .filter { $0.hasPrefix(prefix) }
    }

    // MARK: - Reminders

    private static func reminderRequests(_ items: [ScheduleResponse.Item], now: Date) -> [UNNotificationRequest] {
        items.compactMap { item in
            guard item.kind == "reminder", !item.done, let id = item.reminderId,
                  let fire = fireDate(day: item.date, time: item.time),
                  fire > now
            else { return nil }

            let content = UNMutableNotificationContent()
            content.title = item.title
            if let subtitle = item.subtitle?.nilIfBlank ?? item.notes?.nilIfBlank {
                content.body = subtitle
            }
            content.sound = .default
            content.threadIdentifier = "reminders"
            return request("\(reminderPrefix)\(id)", content, at: fire)
        }
    }

    /// "2026-10-12" and an optional "16:00", in the device's calendar. A
    /// reminder with no time is an all-day one, shown the morning of.
    private static func fireDate(day: String, time: String?) -> Date? {
        let dayParts = day.split(separator: "-").compactMap { Int($0) }
        guard dayParts.count == 3 else { return nil }

        var components = DateComponents()
        components.year = dayParts[0]
        components.month = dayParts[1]
        components.day = dayParts[2]

        let timeParts = time?.split(separator: ":").compactMap { Int($0) } ?? []
        if timeParts.count >= 2 {
            components.hour = timeParts[0]
            components.minute = timeParts[1]
        } else {
            components.hour = allDayHour
            components.minute = 0
        }
        return Calendar.current.date(from: components)
    }

    // MARK: - Bookings

    private static func bookingRequests(_ bookings: [Booking], now: Date) -> [UNNotificationRequest] {
        var requests: [UNNotificationRequest] = []

        for booking in bookings where booking.completedAt == nil {
            guard let job = DateFormatting.parse(booking.jobDate) else { continue }
            let time = DateFormatting.time.string(from: job)
            let place = booking.addressLine.nilIfBlank ?? "the shoot"
            let who = booking.contactName?.nilIfBlank

            // The morning of.
            if let morning = Calendar.current.date(
                bySettingHour: allDayHour, minute: 0, second: 0, of: job
            ), morning > now, morning < job {
                let content = UNMutableNotificationContent()
                content.title = "Shoot today at \(time)"
                content.body = [place, who].compactMap { $0 }.joined(separator: " · ")
                content.sound = .default
                content.threadIdentifier = "bookings"
                requests.append(request("\(bookingPrefix)day.\(booking.id)", content, at: morning))
            }

            // Fifteen minutes before he has to leave: the shoot less the drive.
            if let drive = booking.driveTime.flatMap(driveMinutes) {
                let leave = job.addingTimeInterval(-Double(drive) * 60)
                let alert = leave.addingTimeInterval(-Double(leadMinutes) * 60)
                if alert > now {
                    let content = UNMutableNotificationContent()
                    content.title = "Leave in \(leadMinutes) minutes"
                    content.body = "\(place) at \(time) · \(booking.driveTime?.nilIfBlank ?? "")"
                        .trimmingCharacters(in: .whitespaces)
                    content.sound = .default
                    content.interruptionLevel = .timeSensitive
                    content.threadIdentifier = "bookings"
                    requests.append(request("\(bookingPrefix)leave.\(booking.id)", content, at: alert))
                }
            }
        }
        return requests
    }

    /// "~10 min drive" → 10, "~2h 45m drive" → 165, "~1h drive" → 60.
    static func driveMinutes(_ text: String) -> Int? {
        func number(before unit: String) -> Int? {
            guard let range = text.range(of: #"(\d+)\s*"# + unit, options: .regularExpression) else { return nil }
            return Int(text[range].filter(\.isNumber))
        }
        let hours = number(before: "h")
        let minutes = number(before: "m")
        guard hours != nil || minutes != nil else { return nil }
        return (hours ?? 0) * 60 + (minutes ?? 0)
    }

    // MARK: - Building

    private static func request(_ id: String, _ content: UNMutableNotificationContent, at date: Date) -> UNNotificationRequest {
        let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        return UNNotificationRequest(identifier: id, content: content, trigger: trigger)
    }
}

/// Lets alerts show as banners while the app is in the foreground.
private final class ForegroundPresenter: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let shared = ForegroundPresenter()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}

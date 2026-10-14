import Foundation
import SwiftUI

#if os(iOS)
import Contacts
import ContactsUI
import QuickLook
import UIKit
#else
import AppKit
#endif

/// Hands a contact or a calendar event to the system's own "add" screen.
///
/// The web does this with a plain link to a `.vcf` / `.ics` and lets Safari
/// show its Add Contact / Add to Calendar sheet. A native app has to ask
/// for that sheet itself: Contacts' new-contact screen for a person, and
/// QuickLook's preview (which offers Add to Calendar) for an event. Neither
/// needs any permission, because the user does the saving.
@MainActor
enum FileHandoff {
    // MARK: - Contact

    /// The new-contact screen, filled in. The name is split like the web's
    /// vCard route does: the last word is the family name.
    static func saveContact(name: String?, phone: String?, email: String?) {
        let full = name?.nilIfBlank ?? "Unknown Agent"
        let words = full.split(separator: " ").map(String.init)
        let family = words.count > 1 ? words[words.count - 1] : ""
        let given = words.count > 1 ? words.dropLast().joined(separator: " ") : (words.first ?? full)

        #if os(iOS)
        let contact = CNMutableContact()
        contact.givenName = given
        contact.familyName = family
        if let phone = phone?.nilIfBlank {
            contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone))]
        }
        if let email = email?.nilIfBlank {
            contact.emailAddresses = [CNLabeledValue(label: CNLabelWork, value: email as NSString)]
        }

        guard let top = topViewController() else { return }
        let controller = CNContactViewController(forNewContact: contact)
        let delegate = NewContactDelegate()
        controller.delegate = delegate
        // Weak on the controller, so held here until the screen closes.
        NewContactDelegate.current = delegate
        let navigation = UINavigationController(rootViewController: controller)
        top.present(navigation, animated: true)
        #else
        func escaped(_ value: String) -> String {
            value.replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: ",", with: "\\,")
                .replacingOccurrences(of: ";", with: "\\;")
                .replacingOccurrences(of: "\n", with: "\\n")
        }
        var lines = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            "FN:\(escaped(full))",
            "N:\(escaped(family));\(escaped(given));;;",
        ]
        if let phone = phone?.nilIfBlank { lines.append("TEL;TYPE=CELL:\(phone)") }
        if let email = email?.nilIfBlank { lines.append("EMAIL:\(escaped(email))") }
        lines += ["END:VCARD", ""]
        open(lines.joined(separator: "\r\n"), filename: "\(slug(full)).vcf")
        #endif
    }

    // MARK: - Calendar

    /// The event as an `.ics`, shown in the system's preview with its
    /// "Add to Calendar" button. The UID is the booking's, so adding it again
    /// after a change updates the event instead of duplicating it.
    static func addToCalendar(_ booking: Booking) -> Bool {
        guard let ics = CalendarFile.ics(for: booking) else { return false }
        return open(ics, filename: "booking-\(booking.id.prefix(8)).ics")
    }

    // MARK: - Plumbing

    @discardableResult
    private static func open(_ text: String, filename: String) -> Bool {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            return false
        }

        #if os(iOS)
        guard let top = topViewController() else { return false }
        let source = PreviewSource(url: url)
        PreviewSource.current = source
        let preview = QLPreviewController()
        preview.dataSource = source
        top.present(preview, animated: true)
        return true
        #else
        return NSWorkspace.shared.open(url)
        #endif
    }

    private static func slug(_ text: String) -> String {
        text.components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: "-")
    }

    #if os(iOS)
    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var top = scene?.keyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
    #endif
}

#if os(iOS)
@MainActor
private final class NewContactDelegate: NSObject, CNContactViewControllerDelegate {
    static var current: NewContactDelegate?

    nonisolated func contactViewController(_ viewController: CNContactViewController, didCompleteWith contact: CNContact?) {
        MainActor.assumeIsolated {
            viewController.navigationController?.dismiss(animated: true)
            Self.current = nil
        }
    }
}

@MainActor
private final class PreviewSource: NSObject, QLPreviewControllerDataSource {
    static var current: PreviewSource?
    let url: URL

    init(url: URL) { self.url = url }

    nonisolated func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

    nonisolated func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem {
        MainActor.assumeIsolated { url as NSURL }
    }
}
#endif

/// The web's booking calendar route (`/api/bookings/:id/calendar`), built on
/// the device: same title, place, duration, notes and Apple travel time.
enum CalendarFile {
    /// Used when no shooting hours have been recorded yet, as on the web.
    private static let defaultHours = 2.0

    static func ics(for booking: Booking) -> String? {
        guard let start = DateFormatting.parse(booking.jobDate) else { return nil }
        let end = start.addingTimeInterval((booking.shootingHours ?? defaultHours) * 3600)
        let city = booking.city?.nilIfBlank
        let location = booking.addressLine

        var notes: [String] = []
        let contact = [booking.contactName?.nilIfBlank, booking.contactPhone?.nilIfBlank]
            .compactMap { $0 }.joined(separator: " \u{00B7} ")
        if !contact.isEmpty { notes.append("Contact: \(contact)") }
        if let lockbox = booking.lockboxCode?.nilIfBlank { notes.append("Lockbox: \(lockbox)") }
        for item in booking.lineItems {
            notes.append("\(item.description): $\(item.amount.formatted(.number.grouping(.automatic)))")
        }
        if let text = booking.notes?.nilIfBlank { notes.append("\n\(text)") }

        var lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//LeadFinder//Bookings//EN",
            "BEGIN:VEVENT",
            "UID:booking-\(booking.id)@leadfinder",
            "DTSTAMP:\(stamp(Date()))",
            "DTSTART:\(stamp(start))",
            "DTEND:\(stamp(end))",
            "SUMMARY:\(escape(city.map { "Shoot in \($0)" } ?? "Shoot"))",
        ]
        // Apple's own extension: what Calendar reads as the event's travel time.
        if let drive = booking.driveTime.flatMap({ AppNotifications.driveMinutes($0) }) {
            lines.append("X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT\(drive)M")
        }
        if !location.isEmpty { lines.append("LOCATION:\(escape(location))") }
        if !notes.isEmpty { lines.append("DESCRIPTION:\(escape(notes.joined(separator: "\n")))") }
        lines += ["END:VEVENT", "END:VCALENDAR", ""]
        return lines.joined(separator: "\r\n")
    }

    /// UTC basic format, e.g. 20260924T175000Z.
    private static func stamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        return formatter.string(from: date)
    }

    /// RFC 5545 TEXT escaping.
    private static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: ";", with: "\\;")
            .replacingOccurrences(of: ",", with: "\\,")
            .replacingOccurrences(of: "\r\n", with: "\\n")
            .replacingOccurrences(of: "\n", with: "\\n")
    }
}

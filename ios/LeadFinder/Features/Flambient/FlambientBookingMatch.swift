import Foundation

/// Works out which of the app's bookings a card's session belongs to, so the
/// import screen can suggest the address instead of making Lukas retype it
/// while driving.
///
/// The Mac sends its own guess (`RemoteSession.suggestedAddress`), but it only
/// knows what it has been told; the phone has the whole bookings cache, so it
/// matches on the shoot's date here and shows the booking's address as the
/// shoot name — Flambient names the shoot's folder after it.
///
/// Deliberately pure: no UI, no state, no networking, so the matching rule can
/// be reasoned about (and tested) on its own.
enum FlambientBookingMatch {
    // MARK: - Input

    /// Every booking in a `/bookings` response, in one list.
    ///
    /// `upcoming` already contains the `tentative` and `scheduled` sections, so
    /// those are not added again; the ids are de-duplicated anyway in case the
    /// server grows another overlapping section.
    static func allBookings(in response: BookingsResponse) -> [Booking] {
        var seen = Set<String>()
        return (response.upcoming
            + (response.editing ?? [])
            + response.waitingForPayment
            + response.completed)
            .filter { seen.insert($0.id).inserted }
    }

    // MARK: - Matching

    /// Bookings on the same local calendar day as `session.start`, closest
    /// time first. Empty when the card's session doesn't line up with anything
    /// booked, which is the normal case for a personal shoot.
    ///
    /// Tentative bookings are left out: their `jobDate` is a placeholder, and a
    /// wrong address pre-filled into the import field is worse than an empty one.
    static func candidates(
        for session: RemoteSession,
        in response: BookingsResponse,
        calendar: Calendar = .current
    ) -> [Booking] {
        candidates(for: session, in: allBookings(in: response), calendar: calendar)
    }

    static func candidates(
        for session: RemoteSession,
        in bookings: [Booking],
        calendar: Calendar = .current
    ) -> [Booking] {
        let day = calendar.startOfDay(for: session.start)
        return bookings
            .compactMap { booking -> (booking: Booking, at: Date)? in
                guard booking.dateTentative != true,
                      let at = DateFormatting.parse(booking.jobDate),
                      calendar.isDate(at, inSameDayAs: day)
                else { return nil }
                return (booking, at)
            }
            .sorted { left, right in
                let leftGap = abs(left.at.timeIntervalSince(session.start))
                let rightGap = abs(right.at.timeIntervalSince(session.start))
                // A booking with no time of day parses to midnight, so ties are
                // common on a bare date; the id keeps the order stable.
                if leftGap == rightGap { return left.booking.id < right.booking.id }
                return leftGap < rightGap
            }
            .map(\.booking)
    }

    /// The booking to suggest, or nil to leave the address field for typing.
    static func bestMatch(
        for session: RemoteSession,
        in response: BookingsResponse,
        calendar: Calendar = .current
    ) -> Booking? {
        candidates(for: session, in: response, calendar: calendar).first
    }

    // MARK: - Naming

    /// The name to import the shoot under: the booking's street address, which
    /// is what Flambient uses for the shoot's folder and what the phone shows
    /// in its list of shoots.
    static func shootName(for booking: Booking) -> String {
        booking.address?.nilIfBlank ?? booking.addressLine.nilIfBlank ?? booking.id
    }
}

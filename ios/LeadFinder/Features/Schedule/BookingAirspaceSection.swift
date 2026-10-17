import SwiftUI

/// The booking detail's drone airspace note, the port of the web's
/// `src/app/booked/AirspaceSection.tsx`.
///
/// Loud only when the spot needs ATC authorization (Part 107.41: LAANC, or a
/// DroneZone request where the airport doesn't offer LAANC) — then the summary,
/// the facility map's ceiling, whether LAANC is offered, and where to file.
/// Uncontrolled is one muted line. Nothing at all without a street address,
/// which is also when the server never checked: a city alone would only check
/// the town centre, and a false all-clear is worse than no answer.
struct BookingAirspaceSection: View {
    let booking: Booking
    /// Re-runs the check on the server and returns nil, or why it couldn't.
    var onRecheck: () async -> String?

    @State private var isChecking = false
    @State private var error: String?

    var body: some View {
        if booking.address?.nilIfBlank != nil {
            if let check = booking.airspace, check.status == "controlled" {
                controlled(check)
            } else {
                quiet(booking.airspace?.summary ?? notCheckedText)
            }
        }
    }

    // MARK: - Controlled

    /// Class B, C, D or a Class E surface area: amber, because he can't just fly.
    private func controlled(_ check: AirspaceCheck) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.subheadline)
                    .padding(.top, 1)
                Text(check.summary)
                    .font(.subheadline.weight(.medium))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(Theme.warning)

            let figures = figures(check)
            if !figures.isEmpty {
                Text(figures.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(Theme.warning.opacity(0.8))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 22)
            }

            HStack(spacing: 14) {
                link("FAA DroneZone", url: Self.droneZoneURL)
                link("About LAANC", url: Self.laancInfoURL)
                Spacer(minLength: 0)
                checkAgain(tint: Theme.warning)
            }
            .padding(.leading, 22)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Theme.warning.opacity(0.40), lineWidth: 0.5)
        )
    }

    /// "FAA map ceiling 400 ft · LAANC available at Portland Intl (PDX)": the
    /// numbers behind the summary. Empty when the map says nothing useful.
    private func figures(_ check: AirspaceCheck) -> [String] {
        var parts: [String] = []
        if let ceiling = check.ceilingFt {
            parts.append("FAA map ceiling \(Int(ceiling)) ft")
        }
        let airport = check.airport.map { "\($0.name) (\($0.id))" }
        if check.laanc == true {
            parts.append(airport.map { "LAANC available at \($0)" } ?? "LAANC available")
        }
        if check.laanc == false {
            parts.append(airport.map { "No LAANC at \($0)" } ?? "No LAANC")
        }
        return parts
    }

    // MARK: - Quiet

    /// Uncontrolled, not checked yet, or a check that failed: one muted line
    /// with the way to fix it.
    private func quiet(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "airplane")
                    .font(.caption)
                    .padding(.top, 2)
                Text(text)
                    .font(.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                checkAgain(tint: Theme.secondaryText)
            }
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Checked-at with no result means the check ran and failed.
    private var notCheckedText: String {
        booking.airspaceCheckedAt?.nilIfBlank != nil
            ? "Couldn't check the drone airspace."
            : "Drone airspace not checked yet."
    }

    // MARK: - Pieces

    private func link(_ title: String, url: URL) -> some View {
        Link(destination: url) {
            Text(title)
                .font(.caption.weight(.medium))
                .underline(true, pattern: .solid)
        }
    }

    /// The web's "Check again": reruns the check even when the address hasn't
    /// changed — an airport can start or stop offering LAANC.
    private func checkAgain(tint: Color) -> some View {
        Button {
            Task {
                isChecking = true
                error = nil
                error = await onRecheck()
                isChecking = false
            }
        } label: {
            HStack(spacing: 4) {
                if isChecking {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: "arrow.clockwise").font(.caption)
                }
                Text(isChecking ? "Checking…" : "Check again")
                    .font(.caption.weight(.medium))
            }
            .foregroundStyle(tint)
        }
        .buttonStyle(.plain)
        .disabled(isChecking)
    }

    /// The FAA's own pages: DroneZone for the requests LAANC can't do, and how
    /// LAANC works.
    private static let droneZoneURL = URL(string: "https://faadronezone-access.faa.gov/")!
    private static let laancInfoURL = URL(string: "https://www.faa.gov/uas/getting_started/laanc")!
}
import SwiftUI

/// The drone airspace at the address, as one more line of the booking's header
/// — the port of the web's `src/app/booked/AirspaceSection.tsx`, which puts its
/// note under the drive time too.
///
/// Amber when the spot needs ATC authorization before the drone flies (Part
/// 107.41: LAANC, or a DroneZone request where the airport doesn't offer it),
/// muted when it doesn't. Nothing at all without a street address: the server
/// never checks a city on its own, and a false all-clear is worse than no
/// answer.
struct BookingAirspaceNote: View {
    let booking: Booking
    /// Re-runs the check on the server and returns nil, or why it couldn't.
    var onRecheck: () async -> String?

    @State private var isChecking = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            summaryLine(check?.summary ?? notCheckedText)

            if let check, check.status == "controlled" {
                if !figures(check).isEmpty {
                    Text(figures(check).joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Theme.warning.opacity(0.75))
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.leading, 22)
                }

                HStack(spacing: 14) {
                    link("FAA DroneZone", url: Self.droneZoneURL)
                    link("About LAANC", url: Self.laancInfoURL)
                }
                .padding(.leading, 22)
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

    // MARK: - Pieces

    /// The same shape as the job date and drive time above it: an icon and a
    /// line of text, amber only when there's something to act on, with the
    /// check-again button at the end of the line as the web has it.
    private func summaryLine(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: isControlled ? "exclamationmark.triangle.fill" : "airplane")
                .font(.subheadline)
            Text(text)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            checkAgain
        }
        .foregroundStyle(isControlled ? Theme.warning : Theme.secondaryText)
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

    /// The web's "Check again", as an icon at the end of the line: reruns the
    /// check even when the address hasn't changed — an airport can start or
    /// stop offering LAANC.
    private var checkAgain: some View {
        Button {
            Task {
                isChecking = true
                error = nil
                error = await onRecheck()
                isChecking = false
            }
        } label: {
            Group {
                if isChecking {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: "arrow.clockwise")
                }
            }
            .font(.caption)
            .foregroundStyle(Theme.accent)
        }
        .buttonStyle(.plain)
        .disabled(isChecking)
        .accessibilityLabel("Check the drone airspace again")
    }

    private func link(_ title: String, url: URL) -> some View {
        Link(destination: url) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.accent)
        }
    }

    // MARK: - Data

    private var check: AirspaceCheck? { booking.airspace }
    private var isControlled: Bool { check?.status == "controlled" }

    /// Checked-at with no result means the check ran and failed.
    private var notCheckedText: String {
        booking.airspaceCheckedAt?.nilIfBlank != nil
            ? "Couldn't check the drone airspace."
            : "Drone airspace not checked yet."
    }

    /// The FAA's own pages: DroneZone for the requests LAANC can't do, and how
    /// LAANC works.
    private static let droneZoneURL = URL(string: "https://faadronezone-access.faa.gov/")!
    private static let laancInfoURL = URL(string: "https://www.faa.gov/uas/getting_started/laanc")!
}
import SwiftUI

/// Dark theme close to the web app. Big rows and one-handed reach, per the plan.
///
/// The accent hues are the Tailwind 400 steps the web uses in dark mode, so a
/// badge that is green on the Leads page is the same green here. The ramp the
/// web builds for relationship status (badges.tsx, RELATIONSHIP_BADGE_STYLES)
/// is reproduced exactly rather than invented, for the same reason.
enum Theme {
    /// The web app's background.
    static let background = Color(red: 0x11 / 255, green: 0x11 / 255, blue: 0x16 / 255)
    static let card = Color(red: 0x1a / 255, green: 0x1a / 255, blue: 0x21 / 255)
    static let cardRaised = Color(red: 0x21 / 255, green: 0x21 / 255, blue: 0x2a / 255)
    static let border = Color.white.opacity(0.10)
    static let hairline = Color.white.opacity(0.06)

    static let primaryText = Color(white: 0.96)
    static let secondaryText = Color(white: 0.62)
    static let tertiaryText = Color(white: 0.42)

    // Tailwind 400 steps, the dark-mode badge text colour on the web.
    static let emerald = Color(red: 0x34 / 255, green: 0xd3 / 255, blue: 0x99 / 255)
    static let violet = Color(red: 0xa7 / 255, green: 0x8b / 255, blue: 0xfa / 255)
    static let orange = Color(red: 0xfb / 255, green: 0x92 / 255, blue: 0x3c / 255)
    static let amber = Color(red: 0xfb / 255, green: 0xbf / 255, blue: 0x24 / 255)
    static let red = Color(red: 0xf8 / 255, green: 0x71 / 255, blue: 0x71 / 255)
    static let rose = Color(red: 0xfb / 255, green: 0x71 / 255, blue: 0x85 / 255)
    static let slate = Color(red: 0x94 / 255, green: 0xa3 / 255, blue: 0xb8 / 255)
    static let sky = Color(red: 0x38 / 255, green: 0xbd / 255, blue: 0xf8 / 255)

    static let accent = emerald
    static let positive = emerald
    static let warning = amber
    static let danger = red
}

/// Badge tint by kind, matching the badges on the web Leads page
/// (`src/app/badges.tsx`). The server sends the wording; only the colour is
/// ours, and it has to agree with the web or the two apps stop matching.
extension LeadBadge {
    var tint: Color {
        switch kind {
        case "new": Theme.emerald
        case "comingSoon": Theme.violet
        case "priceCut": Theme.orange
        case "fewPhotos": Theme.red
        case "builder": Theme.tertiaryText
        case "declined": Theme.amber
        // Photo score is tiered, so its colour needs the score. Without one,
        // muted is the safe middle of the ramp rather than a wrong bright end.
        case "photoScore": Theme.tertiaryText
        default: Theme.secondaryText
        }
    }

    /// Photo score is the one badge whose colour depends on more than its kind,
    /// so callers that have the listing's score should use this.
    func badgeTint(photoScore: Int?) -> Color {
        kind == "photoScore" ? Theme.photoScoreTint(photoScore) : tint
    }
}

extension Theme {
    /// Mirrors `photoScoreTier` in `src/lib/leadBadges.ts`: poor is red,
    /// amateur amber, good and pro recede into muted. The score, not the
    /// wording, picks the colour so a reworded label can't pick the wrong one.
    static func photoScoreTint(_ score: Int?) -> Color {
        guard let score else { return tertiaryText }
        if score <= 3 { return red }
        if score <= 5 { return amber }
        return tertiaryText
    }
}

extension String {
    /// The API sends "" for empty text in several places; treating it as nil
    /// keeps "Unknown agent" from rendering as an empty row.
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// "interested" -> "Interested", for relationship statuses.
    var relationshipLabel: String {
        split(separator: "_").map { $0.capitalized }.joined(separator: " ")
    }

    /// The web's warmth ramp: rose warm, amber interested, violet worked once,
    /// emerald regular, with slate cold as the neutral baseline and red for the
    /// one genuinely negative state. See RELATIONSHIP_BADGE_STYLES in badges.tsx.
    var relationshipTint: Color {
        switch self {
        case "warm": Theme.rose
        case "interested": Theme.amber
        case "worked_once": Theme.violet
        case "regular": Theme.emerald
        case "declined": Theme.red
        default: Theme.slate
        }
    }
}
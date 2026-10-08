import SwiftUI

/// Small pill used for lead badges and relationship statuses.
struct BadgeChip: View {
    let text: String
    var tint: Color = Theme.secondaryText
    var filled: Bool = false

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(filled ? tint.opacity(0.22) : tint.opacity(0.13), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.28), lineWidth: 0.5))
            .foregroundStyle(tint)
    }
}

/// The app's card container.
struct CardBackground: ViewModifier {
    var padding: CGFloat = 12

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Theme.border, lineWidth: 0.5)
            )
    }
}

extension View {
    func card(padding: CGFloat = 12) -> some View {
        modifier(CardBackground(padding: padding))
    }
}

/// "As of 2 min ago" line, so stale data is never mistaken for live data.
struct FreshnessBar: View {
    let fetchedAt: Date?
    let isRefreshing: Bool
    var error: String?

    var body: some View {
        HStack(spacing: 6) {
            if isRefreshing {
                ProgressView().controlSize(.mini)
                Text("Updating…")
            } else {
                Image(systemName: "clock.arrow.circlepath")
                Text(label)
            }
            Spacer(minLength: 0)
            if let error {
                Text(error)
                    .foregroundStyle(Theme.danger)
                    .lineLimit(1)
            }
        }
        .font(.caption2)
        .foregroundStyle(Theme.tertiaryText)
    }

    private var label: String {
        guard let fetchedAt else { return "Never synced" }
        let seconds = Date().timeIntervalSince(fetchedAt)
        if seconds < 60 { return "Updated just now" }
        if seconds < 3600 { return "Updated \(Int(seconds / 60)) min ago" }
        if seconds < 86_400 { return "Updated \(Int(seconds / 3600)) hr ago" }
        return "Updated \(DateFormatting.monthDay.string(from: fetchedAt))"
    }
}

/// Full-screen placeholder for a screen with nothing to show yet.
struct EmptyStateView: View {
    let icon: String
    let title: String
    var message: String?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Theme.tertiaryText)
            Text(title)
                .font(.headline)
                .foregroundStyle(Theme.secondaryText)
            if let message {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(Theme.tertiaryText)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 44)
        .padding(.horizontal, 32)
    }
}

/// Shown instead of the tabs when `Secrets.xcconfig` is missing.
struct SetupRequiredView: View {
    let error: String?

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "wrench.and.screwdriver")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(Theme.tertiaryText)
            Text("LeadFinder isn't configured yet")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.primaryText)
                .multilineTextAlignment(.center)
            Text(Self.instructions)
                .font(.footnote)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.leading)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
    }

    private static let instructions = """
    1. Copy ios/Config/Secrets.example.xcconfig to ios/Config/Secrets.xcconfig
    2. Put MOBILE_API_SECRET from the repo's .env.local into it
    3. Run ios/generate.sh to regenerate the Xcode project
    4. Build again
    """
}
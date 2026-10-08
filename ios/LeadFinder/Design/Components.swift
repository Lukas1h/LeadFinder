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

/// Only ever shown when something has gone wrong.
///
/// The freshness label it replaces ("Updated 2 min ago" / "Updating…") was
/// noise: every screen refetches in the background, so the line was describing
/// the app's own plumbing rather than anything Lukas could act on. Data that is
/// merely stale is fine — it's the last known good copy, and the screen says so
/// by simply looking normal. A failure that leaves the cache unusable is worth
/// interrupting for.
struct ErrorBanner: View {
    /// Nil when the last refresh worked, which is the normal case.
    let message: String?
    var onRetry: (() -> Void)?

    var body: some View {
        if let message {
            banner(message)
        }
    }

    private func banner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.warning)
            Text(message)
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let onRetry {
                Button("Retry", action: onRetry)
                    .font(.caption.weight(.semibold))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.warning.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// An error worth the whole screen: nothing cached to fall back on.
struct FullErrorView: View {
    let title: String
    let message: String?
    var onRetry: (() -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            EmptyStateView(icon: "wifi.exclamationmark", title: title, message: message)
            if let onRetry {
                Button("Try again", action: onRetry)
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 24)
    }
}

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
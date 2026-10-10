import MessageUI
import UIKit

/// The native Messages sheet (`MFMessageComposeViewController`), the only way
/// this app can send a text.
///
/// The app never sends anything itself: it fills in the recipient and body,
/// and the composer is the user's to read and send. `.sent` is the one signal
/// that a message actually went out, and it's what tells us to record it — so
/// there's no "did you send that?" prompt like the web has to ask.
///
/// Presented from UIKit on top of whatever is showing, not through a SwiftUI
/// `.sheet`: wrapped in a sheet, the composer came up as a blank grey page.
@MainActor
final class MessageComposer: NSObject, MFMessageComposeViewControllerDelegate {
    enum Outcome {
        case sent
        /// The user closed the sheet without sending. Nothing is recorded.
        case cancelled
        /// Messages isn't set up for this device or can't send text.
        case unavailable
    }

    /// The delegate is weak, so the open composer keeps itself alive here.
    private static var current: MessageComposer?

    private let onFinish: (Outcome) -> Void
    private var finished = false

    private init(onFinish: @escaping (Outcome) -> Void) {
        self.onFinish = onFinish
    }

    static func present(recipients: [String], body: String, onFinish: @escaping (Outcome) -> Void) {
        guard MFMessageComposeViewController.canSendText(), let top = topViewController() else {
            onFinish(.unavailable)
            return
        }
        let composer = MessageComposer(onFinish: onFinish)
        let controller = MFMessageComposeViewController()
        controller.messageComposeDelegate = composer
        // Set before presentation; MessageUI ignores changes made after.
        controller.recipients = recipients
        controller.body = body
        current = composer
        top.present(controller, animated: true)
    }

    /// `present`, awaited: returns once the sheet has been sent or closed.
    static func present(recipients: [String], body: String) async -> Outcome {
        await withCheckedContinuation { continuation in
            present(recipients: recipients, body: body) { continuation.resume(returning: $0) }
        }
    }

    nonisolated func messageComposeViewController(
        _ controller: MFMessageComposeViewController,
        didFinishWith result: MessageComposeResult
    ) {
        MainActor.assumeIsolated {
            // The delegate can fire more than once; only the first counts.
            guard !finished else { return }
            finished = true
            Self.current = nil
            let outcome: Outcome = result == .sent ? .sent : .cancelled
            // Reported once the sheet is fully gone, so the caller can put up
            // the next one (a preset's second message) straight away. Presenting
            // while this one is still animating out silently does nothing.
            let finish = onFinish
            controller.dismiss(animated: true) { finish(outcome) }
        }
    }

    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var top = scene?.keyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

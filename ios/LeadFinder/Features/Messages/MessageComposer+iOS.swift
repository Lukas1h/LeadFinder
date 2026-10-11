#if os(iOS)

import MessageUI
import UIKit

/// The native Messages sheet (`MFMessageComposeViewController`), the only way
/// the iPhone app can send a text.
///
/// The app never sends anything itself: it fills in the recipient and body,
/// and the composer is the user's to read and send. `.sent` is the one signal
/// that a message actually went out, and it's what tells us to record it — so
/// there's no "did you send that?" prompt like the web has to ask.
///
/// Presented from UIKit on top of whatever is showing, not through a SwiftUI
/// `.sheet`: wrapped in a sheet, the composer came up as a blank grey page.
@MainActor
final class MessageComposerIOS: NSObject, MFMessageComposeViewControllerDelegate {
    typealias Outcome = MessageComposer.Outcome
    typealias Attachment = MessageComposer.Attachment

    /// The delegate is weak, so the open composer keeps itself alive here.
    private static var current: MessageComposerIOS?

    private let onFinish: (Outcome) -> Void
    private var finished = false

    private init(onFinish: @escaping (Outcome) -> Void) {
        self.onFinish = onFinish
    }

    static var isAvailable: Bool {
        MFMessageComposeViewController.canSendText()
    }

    static func present(
        recipients: [String],
        body: String,
        attachments: [Attachment] = [],
        onFinish: @escaping (Outcome) -> Void
    ) {
        guard MFMessageComposeViewController.canSendText(), let top = topViewController() else {
            onFinish(.unavailable)
            return
        }
        // A message whose files were silently dropped isn't the one that was
        // asked for, so don't open it at all.
        if !attachments.isEmpty, !MFMessageComposeViewController.canSendAttachments() {
            onFinish(.unavailable)
            return
        }
        let composer = MessageComposerIOS(onFinish: onFinish)
        let controller = MFMessageComposeViewController()
        controller.messageComposeDelegate = composer
        // Set before presentation; MessageUI ignores changes made after.
        controller.recipients = recipients
        controller.body = body
        for attachment in attachments {
            controller.addAttachmentData(
                attachment.data,
                typeIdentifier: attachment.typeIdentifier,
                filename: attachment.filename
            )
        }
        current = composer
        top.present(controller, animated: true)
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

#endif
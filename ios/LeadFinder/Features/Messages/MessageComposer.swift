import MessageUI
import SwiftUI

/// The native Messages sheet (`MFMessageComposeViewController`), the only way
/// this app can send a text.
///
/// The app never sends anything itself: it fills in the recipient and body,
/// and the composer is the user's to read and send. `.sent` is the one signal
/// that a message actually went out, and it's what tells us to record it — so
/// there's no "did you send that?" prompt like the web has to ask.
struct MessageComposer: UIViewControllerRepresentable {
    let recipients: [String]
    let body: String
    /// Copied to the clipboard on send when the preset has a second message, so
    /// a follow-up text can be pasted straight after.
    let secondMessage: String?
    let onFinish: (Outcome) -> Void

    enum Outcome {
        case sent
        /// The user closed the sheet without sending. Nothing is recorded.
        case cancelled
        /// Messages isn't set up for this device or can't send text.
        case unavailable
    }

    func makeUIViewController(context: Context) -> MFMessageComposeViewController {
        let controller = MFMessageComposeViewController()
        controller.messageComposeDelegate = context.coordinator
        // Recipients and body are properties, set before the controller is
        // presented; MessageUI ignores changes made after presentation.
        controller.recipients = recipients
        controller.body = body
        return controller
    }

    func updateUIViewController(_ controller: MFMessageComposeViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    final class Coordinator: NSObject, MFMessageComposeViewControllerDelegate {
        private let onFinish: (Outcome) -> Void
        private var finished = false

        init(onFinish: @escaping (Outcome) -> Void) {
            self.onFinish = onFinish
        }

        func messageComposeViewController(
            _ controller: MFMessageComposeViewController,
            didFinishWith result: MessageComposeResult
        ) {
            // The delegate can fire more than once; only the first counts.
            guard !finished else { return }
            finished = true

            switch result {
            case .sent:
                onFinish(.sent)
            case .cancelled, .failed:
                onFinish(.cancelled)
            @unknown default:
                onFinish(.cancelled)
            }
        }
    }
}

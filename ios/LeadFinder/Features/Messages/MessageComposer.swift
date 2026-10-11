import Foundation

/// The shared shape of "put this text in front of the user so they can send it".
///
/// Both platforms fill in the recipient and the message and then hand over to
/// the system's own composer. Nothing is ever sent from inside this app: the
/// composer window is the user's to read and send, and what comes back decides
/// whether anything is recorded.
///
/// iOS uses `MFMessageComposeViewController` (see `MessageComposer+iOS.swift`);
/// the Mac uses the Messages share sheet (see `MessageComposer+macOS.swift`).
@MainActor
enum MessageComposer {
    enum Outcome {
        /// The user sent it. The only outcome that records anything.
        case sent
        /// The composer was closed without sending. Nothing is recorded.
        case cancelled
        /// There is no way to compose on this machine right now.
        case unavailable
    }

    /// A file to put in the message: a vCard, a photo, a price sheet.
    struct Attachment: Sendable {
        var data: Data
        /// A uniform type identifier, e.g. "public.vcard" or "public.jpeg".
        /// iOS needs it to tell MessageUI what the file is; the Mac goes by
        /// the filename's extension, so this is only used there to check the
        /// file can be written at all.
        var typeIdentifier: String
        var filename: String
    }

    /// Shows the system composer with everything filled in, and calls back when
    /// it has been sent or dismissed.
    static func present(
        recipients: [String],
        body: String,
        attachments: [Attachment] = [],
        onFinish: @escaping (Outcome) -> Void
    ) {
        #if os(iOS)
        MessageComposerIOS.present(recipients: recipients, body: body, attachments: attachments, onFinish: onFinish)
        #else
        MessageComposerMac.present(recipients: recipients, body: body, attachments: attachments, onFinish: onFinish)
        #endif
    }

    /// `present`, awaited: returns once the composer has been sent or closed.
    static func present(
        recipients: [String],
        body: String,
        attachments: [Attachment] = []
    ) async -> Outcome {
        await withCheckedContinuation { continuation in
            present(recipients: recipients, body: body, attachments: attachments) { outcome in
                continuation.resume(returning: outcome)
            }
        }
    }

    /// Whether this machine can open a composer at all. Used to disable the
    /// send buttons rather than failing after the tap.
    static var isAvailable: Bool {
        #if os(iOS)
        return MessageComposerIOS.isAvailable
        #else
        return MessageComposerMac.isAvailable
        #endif
    }
}
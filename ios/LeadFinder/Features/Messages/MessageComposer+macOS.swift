#if os(macOS)

import AppKit
import Foundation

/// The Mac's text composer: the Messages share sheet
/// (`NSSharingService(named: .composeMessage)`).
///
/// The app fills in the recipient and the message and hands over to Messages.
/// Nothing is sent from inside this app — the compose window is the user's to
/// read and send, exactly as on the iPhone.
///
/// **On whether `.sent` can be trusted here.** Unlike
/// `MFMessageComposeViewController`, which reports its result explicitly, the
/// share sheet's `didShareItems` callback is known to be inconsistent about
/// telling a send from a dismissal, and there is no way to ask it which it was.
/// Guessing wrong in either direction writes bad data: a false `.sent` records
/// a text to an agent that never went out, and a false `.cancelled` silently
/// drops one that did.
///
/// So this does not guess. Whichever way the delegate reports — or even if it
/// never does — the user is asked "Did you send it?" once the window is gone,
/// and only their answer decides. The callback is used solely as "the sheet has
/// closed", which is the one thing it does report reliably, with a timeout
/// behind it in case it doesn't report at all.
///
/// The confirmation is an `NSAlert` rather than a SwiftUI alert because the
/// composer is driven from an async call site with no view to hang state off,
/// and an app-modal alert is what a Mac user expects at this point anyway.
@MainActor
final class MessageComposerMac: NSObject, NSSharingServiceDelegate {
    typealias Outcome = MessageComposer.Outcome
    typealias Attachment = MessageComposer.Attachment

    /// `NSSharingService` holds its delegate weakly, so the open sheet's
    /// coordinator keeps itself alive here.
    private static var current: MessageComposerMac?

    private let onFinish: (Outcome) -> Void
    private var finished = false
    /// The folder this message's attachment files were written into, removed
    /// once the outcome is known.
    private var scratchFolder: URL?

    private init(onFinish: @escaping (Outcome) -> Void) {
        self.onFinish = onFinish
    }

    static var isAvailable: Bool {
        NSSharingService(named: .composeMessage) != nil
    }

    static func present(
        recipients: [String],
        body: String,
        attachments: [Attachment] = [],
        onFinish: @escaping (Outcome) -> Void
    ) {
        guard let service = NSSharingService(named: .composeMessage) else {
            onFinish(.unavailable)
            return
        }

        let coordinator = MessageComposerMac(onFinish: onFinish)
        // A message whose files were silently dropped isn't the one that was
        // asked for, so don't open it at all.
        var items: [Any] = [body]
        do {
            let files = try coordinator.writeToDisk(attachments)
            items.append(contentsOf: files)
        } catch {
            onFinish(.unavailable)
            return
        }

        guard service.canPerform(withItems: items) else {
            coordinator.cleanUp()
            onFinish(.unavailable)
            return
        }

        current = coordinator
        service.delegate = coordinator
        service.recipients = recipients
        service.perform(withItems: items)

        // Backstop: if the delegate never reports back, the sheet still closed
        // and the user is still owed an answer. Without this the caller would
        // wait forever and the send would go unrecorded.
        coordinator.armTimeout()
    }

    // MARK: - Attachments

    /// The share sheet takes file URLs, not bytes, so the attachment data is
    /// written to a scratch folder under its real filename first — Messages
    /// shows the file name to the recipient, and a file called `attachment`
    /// would be worse than useless.
    private func writeToDisk(_ attachments: [Attachment]) throws -> [URL] {
        guard !attachments.isEmpty else { return [] }
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("LeadFinderComposer", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        scratchFolder = folder

        return try attachments.map { attachment in
            let file = folder.appendingPathComponent(Self.safeFilename(attachment.filename))
            try attachment.data.write(to: file, options: .atomic)
            return file
        }
    }

    /// A filename is whatever the server stored, and it goes straight onto a
    /// path here. Anything that could climb out of the scratch folder is
    /// replaced rather than trusted.
    private static func safeFilename(_ name: String) -> String {
        let last = name.split(separator: "/").last.map(String.init) ?? "attachment"
        let cleaned = last.trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty || cleaned == "." || cleaned == ".." ? "attachment" : cleaned
    }

    private func cleanUp() {
        if let scratchFolder {
            try? FileManager.default.removeItem(at: scratchFolder)
        }
        scratchFolder = nil
    }

    // MARK: - Finishing

    private func armTimeout() {
        Task { [weak self] in
            // Long enough that nobody is asked while they are still writing
            // the message, short enough that a sheet which never reported back
            // doesn't leave the caller hanging.
            try? await Task.sleep(for: .seconds(60 * 30))
            guard !Task.isCancelled else { return }
            self?.finish()
        }
    }

    private func finish() {
        // The delegate can fire more than once; only the first counts.
        guard !finished else { return }
        finished = true
        Self.current = nil

        let sent = Self.confirmSend()

        // Clear the scratch folder only once the user has answered: Messages
        // may still be reading the attachment while the alert is up.
        cleanUp()
        onFinish(sent ? .sent : .cancelled)
    }

    /// "Did you send it?" — the same question the web asks, and the reason the
    /// Mac records a text only when the user says so. No means no: the listing
    /// and the agent's history must be left exactly as they were.
    private static func confirmSend() -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Did you send the message?"
        alert.informativeText = "Nothing is recorded in LeadFinder until you say it went out."
        // "No" is the default: pressing Return must never record a send.
        alert.addButton(withTitle: "No, I didn't send it")
        alert.addButton(withTitle: "Yes, I sent it")
        return alert.runModal() == .alertSecondButtonReturn
    }

    // MARK: - NSSharingServiceDelegate

    /// Both callbacks mean the same thing here — the sheet is gone — so both
    /// ask the user rather than claiming a result.
    nonisolated func sharingService(_ sharingService: NSSharingService, didShareItems items: [Any]) {
        MainActor.assumeIsolated { finish() }
    }

    nonisolated func sharingService(
        _ sharingService: NSSharingService,
        didFailToShareItems items: [Any],
        error: any Error
    ) {
        MainActor.assumeIsolated { finish() }
    }
}

#endif
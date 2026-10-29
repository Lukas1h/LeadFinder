import Foundation

/// Texts a saved portfolio link to its agent the way the web's "Text it" does:
/// the "Portfolio link" template's body ("Thanks!"), then its second message
/// with the link, each in its own Messages sheet. Once the first is sent it's
/// recorded on the server (recordPortfolioLinkText: one send in their history,
/// their last message marked replied), so replies are attributed like any
/// other template's.
enum PortfolioTexter {
    enum Outcome {
        case sent
        /// The first text went but the second didn't; its text is on the clipboard.
        case firstOnly
        case cancelled
        case failed(String)
    }

    @MainActor
    static func send(linkId: String) async -> Outcome {
        let texts: APIClient.PortfolioLinkTexts
        do {
            texts = try await APIClient.shared.portfolioLinkTexts(linkId: linkId)
        } catch {
            return .failed((error as? APIError)?.errorDescription ?? error.localizedDescription)
        }
        let digits = texts.phone.filter { $0.isNumber || $0 == "+" }

        switch await MessageComposer.present(recipients: [digits], body: texts.first) {
        case .cancelled: return .cancelled
        case .unavailable: return .failed("This device can't send texts.")
        case .sent: break
        }

        var secondSent = true
        if let second = texts.second?.nilIfBlank {
            secondSent = await MessageComposer.present(recipients: [digits], body: second) == .sent
            if !secondSent { Platform.copy(second) }
        }

        do {
            try await APIClient.shared.recordPortfolioLinkText(linkId: linkId)
        } catch {
            return .failed("The text was sent, but recording it failed: \((error as? APIError)?.errorDescription ?? error.localizedDescription)")
        }
        return secondSent ? .sent : .firstOnly
    }
}

#if os(iOS)

import Foundation
import MultipeerConnectivity
import Observation
import Security
import UIKit

// MARK: - Keychain

/// The pairing token, kept per Mac in the keychain rather than UserDefaults:
/// the token is the only thing standing between a stranger's phone and Lukas's
/// cards, so it goes where the system keeps secrets.
///
/// `service` is this app's Flambient namespace; `account` is the Mac's display
/// name, so pairing with two Macs (a laptop and a studio desktop) doesn't have
/// them overwrite each other.
enum FlambientKeychain {
    static let service = "art.lukashahn.LeadFinder.flambient"

    static func token(for mac: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: mac,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Saves a token, or forgets the Mac's token when `token` is nil.
    static func setToken(_ token: String?, for mac: String) {
        removeToken(for: mac)
        guard let token, let data = token.data(using: .utf8) else { return }
        let attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: mac,
            kSecValueData as String: data,
            // Readable after the first unlock, so a reconnect while driving
            // doesn't need the phone unlocked again, but never leaves the device.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        _ = SecItemAdd(attributes as CFDictionary, nil)
    }

    private static func removeToken(for mac: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: mac,
        ]
        _ = SecItemDelete(query as CFDictionary)
    }
}

// MARK: - Peer hand-off

/// `MCPeerID` is immutable and safe to pass between threads, but the SDK
/// predates `Sendable` and doesn't mark it. This box is how a peer crosses from
/// MultipeerConnectivity's callback queue to the main actor without a warning.
private struct PeerBox: @unchecked Sendable {
    let peer: MCPeerID
}

/// `MCSessionState` as something `Sendable`, so the delegate callbacks only
/// ever carry value types across the actor boundary.
private enum SessionChange: Sendable {
    case connecting
    case connected
    case notConnected

    init(_ state: MCSessionState) {
        switch state {
        case .connecting: self = .connecting
        case .connected: self = .connected
        case .notConnected: self = .notConnected
        @unknown default: self = .notConnected
        }
    }
}

// MARK: - Link

/// The phone's half of the Flambient link: finds the photographer's Mac over
/// peer-to-peer Wi-Fi and Bluetooth (no network needed), pairs with it once,
/// and carries commands and status both ways.
///
/// One shared instance is enough — the Mac is a single device and the link is
/// just transport; the Flambient screen reads `connection`, `status` and
/// `nearbyMacs` and calls the command methods. `start()`/`stop()` follow the
/// scene phase (`handleScenePhase` in `FlambientScene.swift`).
@MainActor
@Observable
final class FlambientLink: NSObject {
    /// How far along the phone is with the Mac it is talking to.
    enum Connection: Equatable, Sendable {
        case idle
        /// Looking for a Mac; nothing found yet.
        case browsing
        /// Invitation sent (a saved token, or a code being tried).
        case connecting(String)
        case connected(String)
        /// Found the Mac, but it needs the 6-digit code from Flambient.
        case needsPairing(String)
        case failed(String)

        /// The Mac this state is about, for a title or a retry button.
        var macName: String? {
            switch self {
            case .connecting(let mac), .connected(let mac), .needsPairing(let mac), .failed(let mac):
                mac
            case .idle, .browsing:
                nil
            }
        }

        var isConnected: Bool {
            if case .connected = self { return true }
            return false
        }
    }

    /// The app has one Mac and one link; the Flambient screen uses this.
    static let shared = FlambientLink()

    /// Macs advertising the same protocol version, alphabetically.
    private(set) var nearbyMacs: [String] = []
    private(set) var connection: Connection = .idle
    private(set) var status: RemoteStatus?
    private(set) var lastStatusAt: Date?
    /// Angles with thumbnails, by shoot path, filled by `.shootDetail`.
    private(set) var shootDetails: [String: RemoteShootDetail] = [:]
    private(set) var lastError: String?
    /// The Mac paired last, so the app prefers it when several are around.
    private(set) var pairedMac: String?

    @ObservationIgnored private let peerID: MCPeerID
    @ObservationIgnored private let mcSession: MCSession
    @ObservationIgnored private let browser: MCNearbyServiceBrowser
    /// Found peers by display name. Not observable: the UI reads `nearbyMacs`
    /// and the peer objects are only needed to invite.
    @ObservationIgnored private var peers: [String: MCPeerID] = [:]
    @ObservationIgnored private var isActive = false
    /// The Mac invited or connected; commands go here and nowhere else.
    @ObservationIgnored private var activeMac: String?
    @ObservationIgnored private var pendingInvite: PendingInvite?
    @ObservationIgnored private var inviteTimeout: Task<Void, Never>?
    @ObservationIgnored private var retryTask: Task<Void, Never>?
    @ObservationIgnored private var retryAttempt = 0
    /// The Mac has answered this session (`.paired`, `.status` or a shoot), so
    /// a drop is a network hiccup, not a refused token.
    @ObservationIgnored private var didHandshake = false
    /// Macs that refused the saved token: don't auto-invite them again until a
    /// code pair succeeds. Otherwise a reset Mac is retried every few seconds.
    @ObservationIgnored private var declinedMacs: Set<String> = []

    private struct PendingInvite {
        let mac: String
        /// True for an automatic re-invitation carrying the saved token;
        /// false for a first pairing with a code.
        let usedToken: Bool
    }

    private static let peerDefaultsKey = "flambient.peerID"
    private static let pairedMacDefaultsKey = "flambient.pairedMac"
    /// 1 s, 2 s, 5 s, then every 10 s, for as long as the app is open.
    private static let retryDelays: [Duration] = [.seconds(1), .seconds(2), .seconds(5), .seconds(10)]
    /// How long to wait for the Mac to accept before deciding it said no. The
    /// invitation itself times out at 30 s, so this sits just past it.
    private static let inviteWait = Duration.seconds(35)

    override init() {
        let peer = Self.persistedPeer()
        peerID = peer
        mcSession = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
        browser = MCNearbyServiceBrowser(peer: peer, serviceType: RemoteProtocol.serviceType)
        super.init()
        mcSession.delegate = self
        browser.delegate = self
        pairedMac = UserDefaults.standard.string(forKey: Self.pairedMacDefaultsKey)
    }

    // MARK: - Lifecycle

    /// Start browsing. Call when the app becomes active.
    func start() {
        if !isActive {
            isActive = true
            retryAttempt = 0
            browser.startBrowsingForPeers()
            if connection == .idle { connection = .browsing }
        }
        // Back from the background with the Mac still in our peer table: pick
        // up without waiting for the browser to find it again.
        if !connection.isConnected, pendingInvite == nil, let mac = preferredMac {
            inviteIfPossible(mac: mac)
        }
    }

    /// Stop browsing and drop the session. Call when the app goes away; iOS
    /// suspends both the browser and the session in the background anyway.
    func stop() {
        isActive = false
        retryTask?.cancel()
        retryTask = nil
        inviteTimeout?.cancel()
        inviteTimeout = nil
        pendingInvite = nil
        retryAttempt = 0
        activeMac = nil
        browser.stopBrowsingForPeers()
        mcSession.disconnect()
        peers = [:]
        nearbyMacs = []
        connection = .idle
    }

    // MARK: - Pairing

    /// Pair with the Mac showing `code` in Flambient's settings. The Mac answers
    /// `.paired(token)` when the code matches, and the token is kept for next time.
    func pair(mac: String, code: String) {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            lastError = "Enter the 6-digit code Flambient shows on your Mac."
            return
        }
        guard let peer = peers[mac] else {
            lastError = "\(mac) isn't nearby any more. Make sure Flambient is open."
            connection = .failed(mac)
            return
        }

        retryAttempt = 0
        retryTask?.cancel()
        retryTask = nil
        inviteTimeout?.cancel()
        inviteTimeout = nil
        pendingInvite = nil
        // A fresh invitation needs a clean session; the old peer's `.notConnected`
        // callback lands after `activeMac` has moved on, so it is ignored.
        activeMac = nil
        mcSession.disconnect()

        declinedMacs.remove(mac)
        invite(peer, mac: mac, token: nil, code: trimmed)
    }

    // MARK: - Commands

    /// Sends a command to the connected Mac. Failures land in `lastError`
    /// rather than being thrown: the UI shouldn't have to await every tap.
    func send(_ command: RemoteCommand) {
        guard let peer = activePeer else {
            lastError = "Not connected to your Mac."
            return
        }
        do {
            let data = try RemoteProtocol.encode(command)
            try mcSession.send(data, toPeers: [peer], with: .reliable)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func refresh() {
        send(.refresh)
    }

    /// Imports a card's session into a new shoot. `address` names the shoot
    /// folder; `bookingId` links the LeadFinder booking when the phone picked
    /// one (see `FlambientBookingMatch`).
    func importSession(card cardID: String, session sessionID: Date, address: String, bookingId: String? = nil) {
        send(.importSession(cardID: cardID, sessionID: sessionID, address: address, bookingId: bookingId))
    }

    func cancelImport(importID: String) {
        send(.cancelImport(importID: importID))
    }

    func ejectCard(cardID: String) {
        send(.ejectCard(cardID: cardID))
    }

    func planShoot(path: String) {
        send(.planShoot(path: path))
    }

    /// Ask for a shoot's angles and thumbnails; the answer arrives in
    /// `shootDetails[path]`.
    func requestShootDetail(path: String) {
        send(.shootDetail(path: path))
    }

    func setStayAwake(_ stayAwake: Bool) {
        send(.setStayAwake(stayAwake))
    }

    func setAutoImport(_ autoImport: Bool) {
        send(.setAutoImport(autoImport))
    }

    // MARK: - Discovery

    /// The Mac to try first: the one paired before, else the first around.
    private var preferredMac: String? {
        if let pairedMac, peers[pairedMac] != nil { return pairedMac }
        return nearbyMacs.first
    }

    private var activePeer: MCPeerID? {
        guard let activeMac else { return nil }
        return mcSession.connectedPeers.first { $0.displayName == activeMac }
    }

    private func peerFound(_ peer: MCPeerID, info: [String: String]?) {
        // A Mac running a different protocol version can't be talked to; hide
        // it rather than offering a connection that will fail halfway.
        guard info?["v"] == String(RemoteProtocol.version) else { return }
        let mac = peer.displayName
        peers[mac] = peer
        if !nearbyMacs.contains(mac) {
            nearbyMacs.append(mac)
            nearbyMacs.sort()
        }
        inviteIfPossible(mac: mac)
    }

    private func peerLost(_ mac: String) {
        peers[mac] = nil
        nearbyMacs.removeAll { $0 == mac }

        if let pending = pendingInvite, pending.mac == mac {
            // Not a refusal: the Mac stopped advertising (asleep, Flambient
            // closed). Nothing to pair against until it comes back.
            pendingInvite = nil
            inviteTimeout?.cancel()
            inviteTimeout = nil
            connection = isActive ? .browsing : .idle
            lastError = "Lost \(mac). Make sure Flambient is open on your Mac."
            return
        }

        // A session outlives advertising: keep it, only the peer list changed.
        guard !connection.isConnected else { return }
        guard connection.macName == mac else { return }
        if activeMac == mac { activeMac = nil }
        connection = isActive ? .browsing : .idle
        if isActive, let next = preferredMac {
            inviteIfPossible(mac: next)
        }
    }

    private func inviteIfPossible(mac: String) {
        guard isActive, let peer = peers[mac], pendingInvite == nil else { return }
        guard !connection.isConnected else { return }
        // Stick to the Mac paired before when it is around: a second Mac (a
        // studio desktop, a stranger's) shouldn't steal the connection.
        if let pairedMac, mac != pairedMac, peers[pairedMac] != nil { return }
        if declinedMacs.contains(mac) {
            if connection != .needsPairing(mac) { connection = .needsPairing(mac) }
            return
        }
        if case .connecting = connection { return }
        // Don't yank the pairing prompt away from a Mac the photographer is
        // already typing a code for.
        if case .needsPairing(let other) = connection, other != mac { return }

        guard let token = FlambientKeychain.token(for: mac) else {
            if connection != .needsPairing(mac) { connection = .needsPairing(mac) }
            return
        }
        invite(peer, mac: mac, token: token)
    }

    private func invite(_ peer: MCPeerID, mac: String, token: String? = nil, code: String? = nil) {
        let hello = RemoteHello(
            version: RemoteProtocol.version,
            deviceName: UIDevice.current.name,
            token: token,
            code: code
        )
        guard let context = try? RemoteProtocol.encode(hello) else {
            lastError = "Couldn't prepare the pairing request."
            connection = .failed(mac)
            return
        }

        pendingInvite = PendingInvite(mac: mac, usedToken: token != nil)
        didHandshake = false
        activeMac = mac
        lastError = nil
        connection = .connecting(mac)
        browser.invitePeer(peer, to: mcSession, withContext: context, timeout: 30)
        startInviteTimeout(mac: mac)
    }

    private func startInviteTimeout(mac: String) {
        inviteTimeout?.cancel()
        inviteTimeout = Task { @MainActor [weak self] in
            try? await Task.sleep(for: Self.inviteWait)
            guard !Task.isCancelled else { return }
            self?.inviteTimedOut(mac: mac)
        }
    }

    private func inviteTimedOut(mac: String) {
        inviteTimeout = nil
        guard pendingInvite?.mac == mac else { return }
        // Connected but not yet talking: the handshake timeout is the session's
        // business (an `.error` or a drop), not the invitation's.
        guard !connection.isConnected else { return }
        inviteFailed(mac: mac, reason: "\(mac) didn't answer. Make sure Flambient is open.")
    }

    private func inviteFailed(mac: String, reason: String) {
        let usedToken = pendingInvite?.usedToken ?? false
        pendingInvite = nil
        inviteTimeout?.cancel()
        inviteTimeout = nil

        if usedToken {
            // Flambient no longer knows this phone (reset, reinstalled, or a
            // new Mac): ask for the code instead of retrying the token forever.
            declinedMacs.insert(mac)
            connection = .needsPairing(mac)
            lastError = "\(mac) needs to be paired again."
        } else {
            connection = .failed(reason)
            lastError = reason
        }
    }

    private func browsingFailed(_ message: String) {
        lastError = message
        if !connection.isConnected { connection = .failed(message) }
        // Let a later `start()` (scene phase, a Retry button) try again.
        isActive = false
    }

    // MARK: - Session

    private func sessionStateChanged(_ change: SessionChange, mac: String) {
        switch change {
        case .connected:
            activeMac = mac
            retryAttempt = 0
            retryTask?.cancel()
            retryTask = nil
            if pendingInvite?.mac == mac {
                pendingInvite = nil
                inviteTimeout?.cancel()
                inviteTimeout = nil
            }
            if connection != .connected(mac) { connection = .connected(mac) }
            // Either the token was accepted or the code matched; ask for a
            // fresh status so the screen fills in immediately.
            send(.refresh)

        case .connecting:
            guard activeMac == nil || activeMac == mac else { return }
            if activeMac == nil { activeMac = mac }
            if !connection.isConnected, connection != .connecting(mac) {
                connection = .connecting(mac)
            }

        case .notConnected:
            peerDisconnected(mac)
        }
    }

    private func peerDisconnected(_ mac: String) {
        guard activeMac == mac || connection.macName == mac else { return }

        if pendingInvite?.mac == mac {
            // The Mac turned the invitation down.
            inviteFailed(mac: mac, reason: "\(mac) turned down the connection. Check the code in Flambient.")
            return
        }

        let hadToken = FlambientKeychain.token(for: mac) != nil
        if hadToken, !didHandshake {
            // Connected with the saved token, then dropped before saying hello:
            // Flambient has forgotten (or never trusted) this phone.
            declinedMacs.insert(mac)
            connection = .needsPairing(mac)
            lastError = "\(mac) needs to be paired again."
            activeMac = nil
            return
        }

        activeMac = mac
        connection = isActive ? .browsing : .idle
        if isActive { scheduleReconnect(mac) }
    }

    // MARK: - Reconnect

    private func scheduleReconnect(_ mac: String) {
        retryTask?.cancel()
        let delay = Self.retryDelays[min(retryAttempt, Self.retryDelays.count - 1)]
        retryAttempt += 1
        retryTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.attemptReconnect(mac)
        }
    }

    private func attemptReconnect(_ mac: String) {
        retryTask = nil
        guard isActive, !connection.isConnected else { return }
        guard peers[mac] != nil else {
            // The browser will call `peerFound` (and invite) when it's back.
            activeMac = mac
            connection = .browsing
            return
        }
        if declinedMacs.contains(mac) || FlambientKeychain.token(for: mac) == nil {
            connection = .needsPairing(mac)
            return
        }
        inviteIfPossible(mac: mac)
    }

    // MARK: - Incoming events

    private func handle(_ event: RemoteEvent, from mac: String) {
        switch event {
        case .paired(let token, let macName):
            didHandshake = true
            // The Mac names itself in the event; the keychain key is normally
            // the same as its peer name, but store both when they differ so the
            // next connection finds the token whichever one it looks up.
            FlambientKeychain.setToken(token, for: macName)
            if macName != mac { FlambientKeychain.setToken(token, for: mac) }
            UserDefaults.standard.set(mac, forKey: Self.pairedMacDefaultsKey)
            pairedMac = mac
            declinedMacs.remove(mac)
            declinedMacs.remove(macName)
            if pendingInvite?.mac == mac {
                pendingInvite = nil
                inviteTimeout?.cancel()
                inviteTimeout = nil
            }
            retryAttempt = 0
            lastError = nil
            if connection != .connected(mac) { connection = .connected(mac) }
            send(.refresh)

        case .status(let newStatus):
            didHandshake = true
            status = newStatus
            lastStatusAt = Date()
            if pendingInvite?.mac == mac {
                pendingInvite = nil
                inviteTimeout?.cancel()
                inviteTimeout = nil
            }
            if connection != .connected(mac) { connection = .connected(mac) }

        case .shootDetail(let detail):
            didHandshake = true
            shootDetails[detail.path] = detail

        case .error(let message):
            lastError = message
            // An error before the Mac ever said hello usually means it refused
            // the saved token and is about to drop us.
            let refusedToken = !didHandshake
                && (pendingInvite?.usedToken ?? (FlambientKeychain.token(for: mac) != nil))
            if refusedToken {
                declinedMacs.insert(mac)
                pendingInvite = nil
                inviteTimeout?.cancel()
                inviteTimeout = nil
                connection = .needsPairing(mac)
            }
        }
    }

    // MARK: - Peer identity

    /// The peer ID survives relaunches so the Mac can recognise the phone;
    /// a renamed phone (Settings › General › About) starts a new one.
    private static func persistedPeer() -> MCPeerID {
        let name = UIDevice.current.name
        if let data = UserDefaults.standard.data(forKey: peerDefaultsKey),
           let saved = try? NSKeyedUnarchiver.unarchivedObject(ofClass: MCPeerID.self, from: data),
           saved.displayName == name {
            return saved
        }
        let peer = MCPeerID(displayName: name)
        if let data = try? NSKeyedArchiver.archivedData(withRootObject: peer, requiringSecureCoding: true) {
            UserDefaults.standard.set(data, forKey: peerDefaultsKey)
        }
        return peer
    }
}

// MARK: - Delegates
//
// MultipeerConnectivity makes no promise about which queue its callbacks run
// on, so each one hops to the main actor with value types only. `MCPeerID` and
// `MCSession` never cross the boundary themselves.

extension FlambientLink: MCNearbyServiceBrowserDelegate {
    nonisolated func browser(
        _ browser: MCNearbyServiceBrowser,
        foundPeer peerID: MCPeerID,
        withDiscoveryInfo info: [String: String]?
    ) {
        let peer = PeerBox(peer: peerID)
        let info = info
        Task { @MainActor [weak self] in
            self?.peerFound(peer.peer, info: info)
        }
    }

    nonisolated func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        let mac = peerID.displayName
        Task { @MainActor [weak self] in
            self?.peerLost(mac)
        }
    }

    nonisolated func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: any Error) {
        let message = error.localizedDescription
        Task { @MainActor [weak self] in
            self?.browsingFailed(message)
        }
    }
}

extension FlambientLink: MCSessionDelegate {
    nonisolated func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        let mac = peerID.displayName
        let change = SessionChange(state)
        Task { @MainActor [weak self] in
            self?.sessionStateChanged(change, mac: mac)
        }
    }

    nonisolated func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        // Decoded off the main actor: a shoot's thumbnails arrive in one go and
        // there's no reason to make the UI wait for them.
        guard let event = try? RemoteProtocol.decode(RemoteEvent.self, from: data) else { return }
        let mac = peerID.displayName
        Task { @MainActor [weak self] in
            self?.handle(event, from: mac)
        }
    }

    nonisolated func session(
        _ session: MCSession,
        didReceive stream: InputStream,
        withName streamName: String,
        fromPeer peerID: MCPeerID
    ) {
        // Commands and events are all small JSON payloads; there are no streams
        // or resources in this protocol.
    }

    nonisolated func session(
        _ session: MCSession,
        didStartReceivingResourceWithName resourceName: String,
        fromPeer peerID: MCPeerID,
        with progress: Progress
    ) {
        // See above: nothing in the protocol sends a resource.
    }

    nonisolated func session(
        _ session: MCSession,
        didFinishReceivingResourceWithName resourceName: String,
        fromPeer peerID: MCPeerID,
        at localURL: URL?,
        withError error: (any Error)?
    ) {
        // See above: nothing in the protocol sends a resource.
    }
}

#endif

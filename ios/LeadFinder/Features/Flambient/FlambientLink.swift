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

    /// Which transport is carrying commands right now. Wi-Fi wins whenever it
    /// is up; Multipeer is the fallback and the only transport that pairs.
    enum Transport: Equatable, Sendable {
        case none
        case wifi
        case peerToPeer
    }

    /// The app has one Mac and one link; the Flambient screen uses this.
    static let shared = FlambientLink()

    /// Macs advertising the same protocol version, alphabetically.
    private(set) var nearbyMacs: [String] = []
    private(set) var connection: Connection = .idle
    private(set) var transport: Transport = .none
    private(set) var status: RemoteStatus?
    private(set) var lastStatusAt: Date?
    /// Angles with thumbnails, by shoot path, filled by `.shootDetail`.
    private(set) var shootDetails: [String: RemoteShootDetail] = [:]
    /// Thumbnails of sessions still on a card, by `sessionKey(card:session:)`.
    private(set) var sessionPreviews: [String: RemoteSessionPreview] = [:]
    /// Screen-size JPEGs of photos on a card, by path; only the most recent few are kept.
    private(set) var cardPhotos: [String: Data] = [:]
    @ObservationIgnored private var cardPhotoOrder: [String] = []
    @ObservationIgnored private var previewsAsked: [String: Int] = [:]

    // MARK: v2: the open shoot, for cull and edit

    /// The session of every shoot the Mac has opened for this phone, by path.
    private(set) var shootSessions: [String: RemoteShootSession] = [:]
    /// The cull items of a shoot, by path. Re-sent whole after a merge or split.
    private(set) var cullLists: [String: RemoteCullList] = [:]
    /// Screen-size frames of a shoot, by path then file name. Only the most
    /// recent are kept: a shoot is hundreds of megabytes of JPEGs otherwise,
    /// and `.photo` again is one small command, so an evicted frame reloads.
    private(set) var photos: [String: [String: Data]] = [:]
    @ObservationIgnored private var photoOrder: [PhotoKey] = []
    /// The current state of an angle (manifest slice, resolved layers, look),
    /// by angle id. The Mac pushes a fresh one after every change.
    private(set) var angleStates: [String: RemoteAngleState] = [:]
    /// An angle's decoded layers for rendering on the phone, by angle id, with
    /// the `inputsKey` they belong to: `RemoteAngleState.inputsKey` moving means
    /// this copy is stale and `.angleInputs` needs asking again.
    private(set) var angleInputs: [String: (inputsKey: String, data: Data)] = [:]
    /// What undo and redo can do, by shoot path.
    private(set) var undoStates: [String: RemoteUndoState] = [:]
    /// The cull item the Mac's last undo or redo touched, to jump the screen to.
    private(set) var cullFocus: (path: String, item: String)?
    /// Rises on every `.cullFocus`. The same item can be focused twice in a row
    /// (undoing two decisions on it), so consumers watch this, not `cullFocus`.
    private(set) var cullFocusTick = 0
    /// The last `seq` handed out by `nextSeq()`.
    @ObservationIgnored private var lastSeq = 0

    private(set) var lastError: String?
    /// The Mac paired last, so the app prefers it when several are around.
    private(set) var pairedMac: String?

    @ObservationIgnored private let peerID: MCPeerID
    @ObservationIgnored private let mcSession: MCSession
    @ObservationIgnored private let browser: MCNearbyServiceBrowser
    /// The same-Wi-Fi link, run alongside Multipeer: faster on a shared network,
    /// still just a transport to this object and the screens.
    @ObservationIgnored private let wifi = FlambientWifiLink()
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

    /// One entry in `photoOrder`: the cache key of a frame, kept as its two
    /// halves so eviction can drop the file from `photos` and tidy the shoot.
    private struct PhotoKey {
        let path: String
        let file: String
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
        wifi.pairedMac = pairedMac
        wifi.onFrame = { [weak self] frame, mac in
            self?.receivedWifi(frame, from: mac)
        }
        wifi.onConnected = { [weak self] mac in
            self?.wifiConnected(mac)
        }
        wifi.onDisconnected = { [weak self] mac in
            self?.wifiDisconnected(mac)
        }
        wifi.onRejected = { [weak self] mac, reason in
            self?.wifiRejected(mac, reason: reason)
        }
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
        wifi.pairedMac = pairedMac
        wifi.start()
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
        wifi.stop()
        peers = [:]
        nearbyMacs = []
        connection = .idle
        transport = .none
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
        wifi.allow(mac)
        invite(peer, mac: mac, token: nil, code: trimmed)
    }

    // MARK: - Commands

    /// Sends a command to the connected Mac. Failures land in `lastError`
    /// rather than being thrown: the UI shouldn't have to await every tap.
    ///
    /// Wi-Fi carries it whenever that link is up; Multipeer is the fallback,
    /// including the moment a Wi-Fi link drops and hasn't reconnected.
    func send(_ command: RemoteCommand) {
        if transport == .wifi, wifi.send(command) { return }
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

    static func sessionKey(card: String, session: Date) -> String {
        "\(card)|\(session.timeIntervalSince1970)"
    }

    /// Ask for a card session's thumbnails (first and last at `limit` 2, an even spread above);
    /// the answer lands in `sessionPreviews`. Asking again for no more than was asked is a no-op.
    func requestSessionPreview(card cardID: String, session sessionID: Date, limit: Int) {
        let key = Self.sessionKey(card: cardID, session: sessionID)
        guard (previewsAsked[key] ?? 0) < limit, connection.isConnected else { return }
        previewsAsked[key] = limit
        send(.sessionPreview(cardID: cardID, sessionID: sessionID, limit: limit))
    }

    /// Ask for one card photo at screen size; the answer lands in `cardPhotos[path]`.
    func requestCardPhoto(card cardID: String, path: String) {
        guard cardPhotos[path] == nil else { return }
        send(.cardPhoto(cardID: cardID, path: path))
    }

    // MARK: - v2: cull and edit
    //
    // These only work over Wi-Fi. The Mac answers a v2 command that needs a
    // body (`.photo`, `.angleInputs`, and the edit commands' answers) over
    // Multipeer with `.error("Needs Wi-Fi")`, because Multipeer's frames carry
    // JSON and nothing else. Sending is not blocked: the link picks the
    // transport as it always does, so the screens get the Mac's own message
    // instead of a silence.
    //
    // The Mac answers each of these with an event (`shootSessions`,
    // `cullLists`, `photos`, `angleStates`, `angleInputs`, `undoStates`) rather
    // than returning it, so a command is fire-and-forget like `refresh()`.

    /// Open a shoot for culling and editing; the answer lands in `shootSessions[path]`.
    func openShoot(path: String) {
        send(.openShoot(path: path))
    }

    /// Release the Mac's headless session for a shoot; call when the screen goes away.
    func closeShoot(path: String) {
        send(.closeShoot(path: path))
    }

    /// Ask for the cull items; the answer lands in `cullLists[path]`.
    func requestCullList(path: String) {
        send(.cullList(path: path))
    }

    /// Pass (true) or reject (false) one cull item (`RemoteCullItem.id`). The Mac
    /// answers with a fresh `.cullList` only when the list itself changes.
    func cullDecide(path: String, item: String, passed: Bool) {
        send(.cullDecide(path: path, item: item, passed: passed))
    }

    /// Merge an item with the next one; the Mac re-sends the whole `.cullList`.
    func cullMerge(path: String, item: String) {
        send(.cullMerge(path: path, item: item))
    }

    /// Split an item before `at` (a frame file name); also a fresh `.cullList`.
    func cullSplit(path: String, item: String, at: String) {
        send(.cullSplit(path: path, item: item, at: at))
    }

    /// Ask for one frame at screen size (JPEG body); the answer lands in `photos[path]?[file]`.
    func requestPhoto(path: String, file: String) {
        send(.photo(path: path, file: file))
    }

    /// Undo the last change to the shoot; the Mac pushes `.undoState`, the events
    /// the change touched, and a `.cullFocus` when it was a cull decision.
    func undo(path: String) {
        send(.undo(path: path))
    }

    func redo(path: String) {
        send(.redo(path: path))
    }

    /// Ask for one angle's state; the answer lands in `angleStates[angle]`.
    func requestAngleState(path: String, angle: String) {
        send(.angleState(path: path, angle: angle))
    }

    /// Ask for one angle's decoded layers (payload in the body); the answer lands
    /// in `angleInputs[angle]`.
    func requestAngleInputs(path: String, angle: String) {
        send(.angleInputs(path: path, angle: angle))
    }

    /// The `seq` to stamp on the next edit command (`setLayer`, `setMask`,
    /// `setShapes`, `setAngleLook`, `setLayersVisible`, `resetLayer`). It rises
    /// with every command the phone sends, so the Mac can say which of them its
    /// `.angleState` already reflects (`appliedSeq`) and the phone can ignore
    /// echoes of changes it has already drawn.
    func nextSeq() -> Int {
        lastSeq += 1
        return lastSeq
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
            // Wi-Fi is the preferred transport; only claim Multipeer when the
            // Wi-Fi link isn't already carrying this Mac.
            if wifi.connectedMac == nil { transport = .peerToPeer }
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
        // Multipeer dropping is not the link dropping while Wi-Fi still carries
        // the Mac; that link has its own reconnect and tells us when it goes.
        if wifi.connectedMac == mac { return }
        // Requests in flight are lost with the link; let the screens ask again once it's back.
        previewsAsked = sessionPreviews.mapValues(\.frames.count)

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

    // MARK: - Wi-Fi transport

    /// A whole frame from the Wi-Fi link: decode the header and pass the body
    /// through untouched, so binary payloads can ride along later.
    private func receivedWifi(_ frame: WireFrame, from mac: String) {
        guard let event = try? RemoteProtocol.decode(RemoteEvent.self, from: frame.header) else { return }
        handle(event, from: mac, body: frame.body)
    }

    private func wifiConnected(_ mac: String) {
        // The handshake proved the token, so this Mac is the one to show and
        // the one commands go to, even if Multipeer hasn't caught up yet.
        retryAttempt = 0
        retryTask?.cancel()
        retryTask = nil
        pendingInvite = nil
        inviteTimeout?.cancel()
        inviteTimeout = nil
        activeMac = mac
        transport = .wifi
        lastError = nil
        if connection != .connected(mac) { connection = .connected(mac) }
        wifi.send(.refresh)
    }

    private func wifiDisconnected(_ mac: String) {
        guard transport == .wifi else { return }
        // Multipeer may still (or again) have the Mac; otherwise the normal
        // browsing/reconnect path takes over from here.
        if activePeer != nil {
            transport = .peerToPeer
        } else {
            transport = .none
            if connection.isConnected {
                connection = isActive ? .browsing : .idle
            }
        }
    }

    private func wifiRejected(_ mac: String, reason: String) {
        lastError = reason
    }

    // MARK: - Incoming events

    /// `body` is the frame's binary payload: v2's `.photo` (a JPEG) and
    /// `.angleInputs` (the `RemoteInputs` payload) carry their bytes here rather
    /// than inside the JSON. Empty for every other event.
    private func handle(_ event: RemoteEvent, from mac: String, body: Data = Data()) {
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
            // Pairing happened over Multipeer, but it also unlocks Wi-Fi: the
            // link can now find this Mac by the token and by its TXT name.
            wifi.pairedMac = mac
            wifi.allow(mac)
            wifi.allow(macName)
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

        case .sessionPreview(let preview):
            didHandshake = true
            let key = Self.sessionKey(card: preview.cardID, session: preview.sessionID)
            // A row's 2-frame answer can arrive after the grid's bigger one; keep the bigger.
            if (sessionPreviews[key]?.frames.count ?? 0) <= preview.frames.count {
                sessionPreviews[key] = preview
            }

        case .cardPhoto(let photo):
            didHandshake = true
            guard let image = photo.image else { break }
            cardPhotos[photo.path] = image
            cardPhotoOrder.removeAll { $0 == photo.path }
            cardPhotoOrder.append(photo.path)
            while cardPhotoOrder.count > 30 { cardPhotos[cardPhotoOrder.removeFirst()] = nil }

        // MARK: v2
        //
        // Stored whatever it is about, like the v1 events above: the Mac is the
        // only writer and a stray shoot is cheaper to keep than to argue about.

        case .shootSession(let session):
            didHandshake = true
            shootSessions[session.path] = session

        case .cullList(let list):
            didHandshake = true
            cullLists[list.path] = list

        case .photo(let path, let file):
            didHandshake = true
            let key = PhotoKey(path: path, file: file)
            photos[path, default: [:]][file] = body
            photoOrder.removeAll { $0.path == path && $0.file == file }
            photoOrder.append(key)
            while photoOrder.count > 30 {
                let old = photoOrder.removeFirst()
                photos[old.path]?[old.file] = nil
                if photos[old.path]?.isEmpty == true { photos[old.path] = nil }
            }

        case .angleState(let state):
            didHandshake = true
            angleStates[state.angle.id] = state

        case .angleInputs(_, let angle, let inputsKey):
            didHandshake = true
            angleInputs[angle] = (inputsKey, body)

        case .undoState(let state):
            didHandshake = true
            undoStates[state.path] = state

        case .cullFocus(let path, let item):
            didHandshake = true
            cullFocus = (path, item)
            cullFocusTick += 1

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

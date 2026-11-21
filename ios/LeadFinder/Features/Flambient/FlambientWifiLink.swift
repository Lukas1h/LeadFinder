#if os(iOS)

import Foundation
import Network
import UIKit

/// `NWConnection` callbacks run on Network's own queue, so only these plain
/// values cross to the main actor. The framework types themselves don't.
private enum ConnectionChange: Sendable {
    case ready
    case waiting
    case failed
    case cancelled
    case other

    init(_ state: NWConnection.State) {
        switch state {
        case .ready: self = .ready
        case .waiting: self = .waiting
        case .failed: self = .failed
        case .cancelled: self = .cancelled
        default: self = .other
        }
    }
}

/// A Mac found in Bonjour, reduced to the two things the link needs: the name
/// the Keychain token is filed under, and where to connect.
private struct FoundMac: Sendable {
    let mac: String
    let endpoint: NWEndpoint
}

/// The same-Wi-Fi transport: finds Flambient on the shared local network over
/// Bonjour and carries commands and events over TCP. `RemoteWire` owns the
/// frame format; this class owns finding, handshaking and reconnecting.
///
/// FlambientLink runs this alongside MultipeerConnectivity and prefers it when
/// it is up: a joined network is faster and steadier than peer-to-peer Wi-Fi
/// for the big payloads (thumbnails, layer planes). Pairing still happens over
/// Multipeer; this link only ever presents a token the phone already has.
@MainActor
final class FlambientWifiLink {
    /// The Mac the link is talking to right now, nil until `.accepted`.
    private(set) var connectedMac: String?
    /// The last refusal from a Mac, for the screens to show.
    private(set) var lastError: String?
    /// The Mac paired over Multipeer; the link stays away from other Macs when
    /// this is set, so a second Mac can't take the connection.
    var pairedMac: String? {
        didSet {
            guard oldValue != pairedMac else { return }
            if let mac = connectedMac, mac != pairedMac {
                dropConnection()
            }
            retryAttempt = 0
            connectToFoundMac()
        }
    }

    /// A whole frame from the Mac after the handshake: the JSON header (a
    /// `RemoteEvent`) plus its body, which stays empty until binary payloads
    /// travel as separate frames.
    var onFrame: ((WireFrame, String) -> Void)?
    /// The handshake finished; commands can go over Wi-Fi.
    var onConnected: ((String) -> Void)?
    /// A live Wi-Fi link dropped; fall back to Multipeer.
    var onDisconnected: ((String) -> Void)?
    /// The Mac refused the token; `reason` is the Mac's own words.
    var onRejected: ((String, String) -> Void)?

    private enum Phase {
        case idle
        /// Connected, waiting for the Mac's challenge.
        case awaitingChallenge
        /// Said hello, waiting for `.accepted` or `.rejected`.
        case awaitingAccept
        /// Normal traffic.
        case streaming
    }

    private let queue = DispatchQueue(label: "art.lukashahn.leadfinder.flambient-wifi")
    private var browser: NWBrowser?
    private var connection: NWConnection?
    private var parser = WireParser()
    private var phase: Phase = .idle
    private var isActive = false
    /// The Mac and address of the current (or last) attempt, kept across drops
    /// so a reconnect doesn't have to wait for Bonjour to find it again.
    private var mac: String?
    private var endpoint: NWEndpoint?
    /// Macs advertising right now, by the name in their TXT record.
    private var found: [String: NWEndpoint] = [:]
    /// Macs that refused the saved token; not retried until a pairing lands.
    private var declined: Set<String> = []
    private var retryTask: Task<Void, Never>?
    private var retryAttempt = 0
    private var handshakeTask: Task<Void, Never>?

    /// 1 s, 2 s, 5 s, then every 10 s, for as long as the app is in front.
    private static let retryDelays: [Duration] = [.seconds(1), .seconds(2), .seconds(5), .seconds(10)]
    /// The Mac answers the challenge immediately; this catches a listener that
    /// accepted the socket but never got as far as the handshake.
    private static let handshakeWait = Duration.seconds(10)

    deinit {
        browser?.cancel()
        connection?.cancel()
        retryTask?.cancel()
        handshakeTask?.cancel()
    }

    // MARK: - Lifecycle

    /// Start browsing. Call when the app becomes active.
    func start() {
        isActive = true
        startBrowserIfNeeded()
        if connection == nil { connectToFoundMac() }
    }

    /// Stop browsing and drop the link. Call when the app goes away; iOS
    /// suspends the socket in the background anyway.
    func stop() {
        isActive = false
        retryTask?.cancel()
        retryTask = nil
        retryAttempt = 0
        handshakeTask?.cancel()
        handshakeTask = nil
        browser?.cancel()
        browser = nil
        dropConnection()
        found = [:]
        mac = nil
        endpoint = nil
    }

    /// A pairing just succeeded, so a Mac that refused an old token is trusted
    /// again. Also points the link at the newly paired Mac.
    func allow(_ mac: String) {
        declined.remove(mac)
        retryAttempt = 0
        connectToFoundMac()
    }

    // MARK: - Commands

    /// Sends one command over Wi-Fi. False means the caller should use Multipeer
    /// (no link, or this frame couldn't be prepared).
    @discardableResult
    func send(_ command: RemoteCommand) -> Bool {
        guard connectedMac != nil, let connection else { return false }
        guard let data = try? RemoteWire.frame(command) else { return false }
        connection.send(content: data, completion: .contentProcessed { _ in })
        return true
    }

    // MARK: - Handshake

    /// The one handshake decision worth testing on its own: answer the Mac's
    /// challenge with a hello that proves the token without sending it.
    static func reply(to challenge: WireHandshake, token: String, deviceName: String) -> WireHandshake {
        guard case .challenge(let nonce, _, let version) = challenge else {
            return .rejected(reason: "Flambient didn't start with a challenge.")
        }
        guard version == RemoteWire.version else {
            return .rejected(reason: "Flambient on your Mac needs an update before it can use Wi-Fi.")
        }
        return .hello(
            deviceName: deviceName,
            tokenID: RemoteWire.tokenID(token),
            proof: RemoteWire.proof(token: token, nonce: nonce),
            version: RemoteWire.version
        )
    }

    // MARK: - Discovery

    private func startBrowserIfNeeded() {
        guard browser == nil else { return }
        let params = NWParameters.tcp
        params.includePeerToPeer = false
        let browser = NWBrowser(
            for: .bonjourWithTXTRecord(type: RemoteWire.serviceType, domain: nil),
            using: params
        )
        browser.stateUpdateHandler = { [weak self] state in
            guard case .failed = state else { return }
            Task { @MainActor [weak self] in self?.browserFailed() }
        }
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            // Pull the plain values out on the browser's queue; NWTXTRecord and
            // NWEndpoint never need to reach the main actor's caller.
            let macs = results.compactMap(Self.foundMac)
            Task { @MainActor [weak self] in self?.resultsChanged(macs) }
        }
        self.browser = browser
        browser.start(queue: queue)
    }

    nonisolated private static func foundMac(_ result: NWBrowser.Result) -> FoundMac? {
        let mac: String?
        if case .bonjour(let txt) = result.metadata, let name = txt[RemoteWire.txtMacName], !name.isEmpty {
            mac = name
        } else if case .service(let name, _, _, _) = result.endpoint {
            mac = name
        } else {
            mac = nil
        }
        guard let mac else { return nil }
        return FoundMac(mac: mac, endpoint: result.endpoint)
    }

    private func resultsChanged(_ macs: [FoundMac]) {
        found = Dictionary(macs.map { ($0.mac, $0.endpoint) }, uniquingKeysWith: { first, _ in first })
        connectToFoundMac()
    }

    private func browserFailed() {
        // Let `start()` (a scene phase, a retry) build a fresh browser; the
        // existing connection, if any, is still usable.
        browser?.cancel()
        browser = nil
    }

    private func connectToFoundMac() {
        guard isActive, connection == nil else { return }
        let candidates = found.filter { mac, _ in
            guard !declined.contains(mac) else { return false }
            guard FlambientKeychain.token(for: mac) != nil else { return false }
            if let pairedMac { return mac == pairedMac }
            return true
        }
        guard let (mac, endpoint) = candidates.first else { return }
        open(endpoint, mac: mac)
    }

    // MARK: - Connection

    private func open(_ endpoint: NWEndpoint, mac: String) {
        self.mac = mac
        self.endpoint = endpoint
        parser = WireParser()
        phase = .awaitingChallenge

        let params = NWParameters.tcp
        params.includePeerToPeer = false
        let connection = NWConnection(to: endpoint, using: params)
        self.connection = connection
        connection.stateUpdateHandler = { [weak self] state in
            let change = ConnectionChange(state)
            Task { @MainActor [weak self] in
                self?.stateChanged(change, mac: mac, connection: connection)
            }
        }
        connection.start(queue: queue)
        receive(on: connection, mac: mac)
    }

    private func stateChanged(_ change: ConnectionChange, mac: String, connection: NWConnection) {
        // A drop from a connection that has already been replaced is not news.
        guard self.connection === connection else { return }
        switch change {
        case .ready:
            break
        case .waiting, .failed, .cancelled:
            lost(mac: mac)
        case .other:
            break
        }
    }

    /// The socket went away. If it had reached `.accepted`, tell the caller so
    /// it can fall back to Multipeer; then retry with backoff.
    private func lost(mac: String) {
        guard self.mac == mac else { return }
        let wasConnected = connectedMac == mac
        dropConnection()
        if wasConnected {
            connectedMac = nil
            onDisconnected?(mac)
        }
        scheduleRetry()
    }

    private func dropConnection() {
        handshakeTask?.cancel()
        handshakeTask = nil
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        connection = nil
        phase = .idle
        parser = WireParser()
        if connectedMac != nil { connectedMac = nil }
    }

    // MARK: - Retry

    private func scheduleRetry() {
        retryTask?.cancel()
        retryTask = nil
        guard isActive, connection == nil, let mac else { return }
        guard !declined.contains(mac) else { return }
        let delay = Self.retryDelays[min(retryAttempt, Self.retryDelays.count - 1)]
        retryAttempt += 1
        retryTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.retry()
        }
    }

    private func retry() {
        retryTask = nil
        guard isActive, connection == nil, let mac else { return }
        guard !declined.contains(mac) else { return }
        guard FlambientKeychain.token(for: mac) != nil else { return }
        // The Mac may have moved; prefer the address Bonjour has now.
        guard let target = found[mac] ?? endpoint else { return }
        open(target, mac: mac)
    }

    // MARK: - Incoming frames

    private func receive(on connection: NWConnection, mac: String) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, isComplete, error in
            Task { @MainActor [weak self] in
                self?.received(data, isComplete: isComplete, error: error, mac: mac, connection: connection)
            }
        }
    }

    private func received(_ data: Data?, isComplete: Bool, error: NWError?, mac: String, connection: NWConnection) {
        guard self.connection === connection else { return }
        if let data, !data.isEmpty {
            do {
                for frame in try parser.append(data) {
                    // A frame can close the link (a refusal); stop reading the
                    // rest of this chunk if it did.
                    guard self.connection === connection else { return }
                    handle(frame, mac: mac)
                }
            } catch {
                lost(mac: mac)
                return
            }
        }
        if error != nil {
            lost(mac: mac)
            return
        }
        if isComplete {
            lost(mac: mac)
            return
        }
        // A refusal inside the chunk closes the link; don't arm another read.
        guard self.connection === connection else { return }
        receive(on: connection, mac: mac)
    }

    private func handle(_ frame: WireFrame, mac: String) {
        switch phase {
        case .idle:
            break

        case .awaitingChallenge:
            guard let handshake = try? RemoteProtocol.decode(WireHandshake.self, from: frame.header) else {
                lost(mac: mac)
                return
            }
            switch handshake {
            case .challenge:
                guard let token = FlambientKeychain.token(for: mac) else {
                    lost(mac: mac)
                    return
                }
                let hello = Self.reply(to: handshake, token: token, deviceName: UIDevice.current.name)
                guard case .hello = hello, let data = try? RemoteWire.frame(hello) else {
                    refused(mac: mac, reason: "This Mac isn't compatible with this version of LeadFinder.")
                    return
                }
                phase = .awaitingAccept
                connection?.send(content: data, completion: .contentProcessed { _ in })
                startHandshakeTimeout(mac: mac)
            case .rejected(let reason):
                refused(mac: mac, reason: reason)
            default:
                lost(mac: mac)
            }

        case .awaitingAccept:
            guard let handshake = try? RemoteProtocol.decode(WireHandshake.self, from: frame.header) else {
                lost(mac: mac)
                return
            }
            switch handshake {
            case .accepted:
                accepted(mac: mac)
            case .rejected(let reason):
                refused(mac: mac, reason: reason)
            default:
                lost(mac: mac)
            }

        case .streaming:
            // Decode here so only real events reach FlambientLink; the body
            // rides along untouched for the binary payloads to come.
            guard (try? RemoteProtocol.decode(RemoteEvent.self, from: frame.header)) != nil else { return }
            onFrame?(WireFrame(header: frame.header, body: frame.body), mac)
        }
    }

    private func accepted(mac: String) {
        handshakeTask?.cancel()
        handshakeTask = nil
        guard connectedMac != mac else { return }
        phase = .streaming
        declined.remove(mac)
        retryAttempt = 0
        lastError = nil
        connectedMac = mac
        onConnected?(mac)
    }

    private func refused(mac: String, reason: String) {
        // The token is no good on this Mac until the photographer pairs again;
        // don't knock every few seconds like Multipeer does.
        declined.insert(mac)
        lastError = reason
        dropConnection()
        onRejected?(mac, reason)
    }

    private func startHandshakeTimeout(mac: String) {
        handshakeTask?.cancel()
        handshakeTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: Self.handshakeWait)
            guard !Task.isCancelled else { return }
            self?.handshakeTimedOut(mac: mac)
        }
    }

    private func handshakeTimedOut(mac: String) {
        handshakeTask = nil
        guard connectedMac != mac else { return }
        lost(mac: mac)
    }
}

#endif

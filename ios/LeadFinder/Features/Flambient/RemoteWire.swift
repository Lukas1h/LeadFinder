import CryptoKit
import Foundation

// The same-Wi-Fi transport between Flambient (Mac) and LeadFinder (iPhone). Multipeer stays for
// backpack mode (no network); on a shared network the phone talks TCP to the Mac directly, which is
// faster and steadier for the big payloads culling and editing send (frames, layer planes).
//
// THIS FILE IS SHARED VERBATIM with LeadFinder's iOS app
// (~/Developer/LeadFinder/ios/LeadFinder/Features/Flambient/RemoteWire.swift).
// Change both copies together.
//
// Wire format: a stream of frames. Each frame is
//   UInt32 big-endian header length H, UInt32 big-endian body length B, H bytes header, B bytes body.
// The header is JSON (a `WireHandshake` during the handshake, then a `RemoteCommand` from the phone or
// a `RemoteEvent` from the Mac). The body is raw bytes attached to that message (images, layer
// planes) so they never go through base64; empty for most messages.
//
// Handshake (pairing itself still happens over Multipeer, with the 6-digit code):
//   1. Mac → phone  `.challenge(nonce:macName:version:)`
//   2. phone → Mac  `.hello(deviceName:tokenID:proof:version:)`
//        tokenID = `RemoteWire.tokenID(token)`, proof = `RemoteWire.proof(token:nonce:)`
//      The token itself never crosses the network.
//   3. Mac → phone  `.accepted` and then normal `RemoteEvent`s (a `.status` straight away), or
//                   `.rejected(reason:)` and the Mac closes the connection.

enum RemoteWire {
    /// Bonjour type for the TCP listener. iOS needs it in NSBonjourServices.
    static let serviceType = "_flambient-wifi._tcp"
    /// TXT record key holding the Mac's name, the same name the phone keys its Keychain token by.
    static let txtMacName = "mac"
    static let version = 2
    /// Refuse anything bigger: a corrupt length must not make us allocate gigabytes.
    static let maxHeader = 8 << 20
    static let maxBody = 512 << 20

    static func frame(header: Data, body: Data = Data()) -> Data {
        var out = Data(capacity: 8 + header.count + body.count)
        var h = UInt32(header.count).bigEndian
        var b = UInt32(body.count).bigEndian
        withUnsafeBytes(of: &h) { out.append(contentsOf: $0) }
        withUnsafeBytes(of: &b) { out.append(contentsOf: $0) }
        out.append(header)
        out.append(body)
        return out
    }

    static func frame<T: Encodable>(_ value: T, body: Data = Data()) throws -> Data {
        frame(header: try RemoteProtocol.encode(value), body: body)
    }

    /// Short public name for a token, so the Mac can find which paired phone is knocking.
    static func tokenID(_ token: String) -> String {
        SHA256.hash(data: Data(("id:" + token).utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
    }

    /// HMAC-SHA256 of the nonce, keyed by the token; base64.
    static func proof(token: String, nonce: String) -> String {
        let mac = HMAC<SHA256>.authenticationCode(for: Data(nonce.utf8), using: SymmetricKey(data: Data(token.utf8)))
        return Data(mac).base64EncodedString()
    }

    static func verify(proof: String, token: String, nonce: String) -> Bool {
        guard let given = Data(base64Encoded: proof) else { return false }
        return HMAC<SHA256>.isValidAuthenticationCode(given, authenticating: Data(nonce.utf8),
                                                      using: SymmetricKey(data: Data(token.utf8)))
    }

    static func newNonce() -> String {
        var bytes = [UInt8](repeating: 0, count: 24)
        for i in bytes.indices { bytes[i] = UInt8.random(in: 0...255) }
        return Data(bytes).base64EncodedString()
    }
}

enum WireHandshake: Codable, Sendable, Equatable {
    case challenge(nonce: String, macName: String, version: Int)
    case hello(deviceName: String, tokenID: String, proof: String, version: Int)
    case accepted
    case rejected(reason: String)
}

/// One received frame.
struct WireFrame: Sendable, Equatable {
    var header: Data
    var body: Data
}

/// Turns arbitrary chunks off a TCP stream into whole frames.
struct WireParser: Sendable {
    enum Failure: Error, Equatable { case tooLarge }

    private var buffer = Data()

    init() {}

    /// Feed bytes as they arrive; returns every frame now complete, in order.
    mutating func append(_ chunk: Data) throws -> [WireFrame] {
        buffer.append(chunk)
        var frames: [WireFrame] = []
        while buffer.count >= 8 {
            let start = buffer.startIndex
            let h = Int(Self.readUInt32(buffer, at: start))
            let b = Int(Self.readUInt32(buffer, at: start + 4))
            guard h <= RemoteWire.maxHeader, b <= RemoteWire.maxBody else { throw Failure.tooLarge }
            guard buffer.count >= 8 + h + b else { break }
            let header = Data(buffer[(start + 8)..<(start + 8 + h)])
            let body = Data(buffer[(start + 8 + h)..<(start + 8 + h + b)])
            frames.append(WireFrame(header: header, body: body))
            buffer = Data(buffer[(start + 8 + h + b)...])
        }
        return frames
    }

    private static func readUInt32(_ d: Data, at i: Data.Index) -> UInt32 {
        (UInt32(d[i]) << 24) | (UInt32(d[i + 1]) << 16) | (UInt32(d[i + 2]) << 8) | UInt32(d[i + 3])
    }
}

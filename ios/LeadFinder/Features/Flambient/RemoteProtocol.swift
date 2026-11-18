import Foundation

// The messages Flambient (Mac) and LeadFinder (iPhone) exchange over MultipeerConnectivity.
// MultipeerConnectivity runs over peer-to-peer Wi-Fi and Bluetooth, so the two find each other
// with no network at all: the Mac can sit lid-closed in a backpack with Wi-Fi on but not joined.
//
// THIS FILE IS SHARED VERBATIM with LeadFinder's iOS app
// (~/Developer/LeadFinder/ios/LeadFinder/Features/Flambient/RemoteProtocol.swift).
// Change both copies together and bump `RemoteProtocol.version` on any incompatible change.

enum RemoteProtocol {
    /// Bonjour service type: ≤ 15 chars, lowercase letters, digits and hyphens.
    /// iOS needs `_flambient-link._tcp` and `_flambient-link._udp` in NSBonjourServices.
    static let serviceType = "flambient-link"
    static let version = 1

    static func encode<T: Encodable>(_ value: T) throws -> Data {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return try e.encode(value)
    }

    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return try d.decode(type, from: data)
    }
}

// MARK: Pairing

/// Sent as the invitation's context when the phone invites the Mac. The Mac accepts only a known
/// token (paired before) or the 6-digit code it currently shows; on a code match it answers with
/// `.paired(token)` and the phone keeps the token for next time.
struct RemoteHello: Codable, Sendable {
    var version: Int = RemoteProtocol.version
    var deviceName: String
    /// Stored after a successful pairing; nil on the first connection.
    var token: String?
    /// The code shown in Flambient's settings, typed on the phone; only for first pairing.
    var code: String?
}

// MARK: Phone → Mac

enum RemoteCommand: Codable, Sendable {
    /// Send a fresh `.status` (the Mac also pushes one on every change and every few seconds).
    case refresh
    /// Import a session from a card into a new shoot. `address` names the shoot folder (as typed in
    /// Flambient's import field); `bookingId` links the LeadFinder booking, when the phone picked one.
    case importSession(cardID: String, sessionID: Date, address: String, bookingId: String?)
    case cancelImport(importID: String)
    case ejectCard(cardID: String)
    /// Plan (group into angles) a shoot that hasn't been planned yet.
    case planShoot(path: String)
    /// Ask for a shoot's angles with small thumbnails; answered with `.shootDetail`.
    case shootDetail(path: String)
    /// Thumbnails of a session still on a card, before importing; answered with `.sessionPreview`.
    /// `limit` caps the photos sent: 2 is just the first and last (a list row), more is an even
    /// spread across the session from first to last (the preview grid).
    case sessionPreview(cardID: String, sessionID: Date, limit: Int)
    /// One photo on a card at screen size (the `id` of a `RemoteCardFrame`); answered with `.cardPhoto`.
    case cardPhoto(cardID: String, path: String)
    /// Keep the Mac awake with the lid closed (true) or let it sleep normally (false).
    case setStayAwake(Bool)
    /// Turn automatic import of inserted cards on or off.
    case setAutoImport(Bool)
}

// MARK: Mac → Phone

enum RemoteEvent: Codable, Sendable {
    /// Pairing succeeded: keep this token for later connections.
    case paired(token: String, macName: String)
    case status(RemoteStatus)
    case shootDetail(RemoteShootDetail)
    case sessionPreview(RemoteSessionPreview)
    case cardPhoto(RemoteCardPhoto)
    /// A command failed; `message` is for a person to read.
    case error(message: String)
}

struct RemoteStatus: Codable, Sendable, Equatable {
    var macName: String
    var sent: Date
    /// 0…1, nil on a desktop Mac.
    var battery: Double?
    var charging: Bool?
    /// "nominal", "fair", "serious", "critical" (ProcessInfo.ThermalState).
    var thermal: String
    /// The Mac is held awake with the lid closed right now.
    var stayingAwake: Bool
    /// The one-time admin setup that lets Flambient keep a lid-closed Mac awake is done.
    var stayAwakeReady: Bool
    var autoImport: Bool
    /// Why automatic work paused (low battery, too hot), nil when it isn't paused.
    var pausedReason: String?
    var cards: [RemoteCard]
    var imports: [RemoteImport]
    /// Newest first; the most recent ~20.
    var shoots: [RemoteShoot]
}

struct RemoteCard: Codable, Sendable, Equatable, Identifiable {
    /// The volume's path, stable while it's mounted.
    var id: String
    var name: String
    var isScanning: Bool
    var sessions: [RemoteSession]
}

struct RemoteSession: Codable, Sendable, Equatable, Identifiable {
    var id: Date
    var start: Date
    var end: Date
    var photos: Int
    var videos: Int
    /// Already imported into a shoot (by name), so the phone can grey it out.
    var importedAs: String?
    /// The LeadFinder booking matched by date, when exactly one matches.
    var suggestedAddress: String?
    var suggestedBookingId: String?
}

struct RemoteImport: Codable, Sendable, Equatable, Identifiable {
    var id: String
    var shootName: String
    /// "importing", "planning", "done", "failed", "cancelled".
    var state: String
    /// 0…1.
    var progress: Double
    var detail: String?
}

struct RemoteShoot: Codable, Sendable, Equatable, Identifiable {
    /// Full path on the Mac; used as the id in commands.
    var id: String
    var name: String
    var date: Date?
    /// ShootStage in words ("Imported", "Culled", "Edited", …).
    var stage: String
    var angles: Int?
    var photos: Int
    var planned: Bool
}

struct RemoteShootDetail: Codable, Sendable {
    var path: String
    var name: String
    var angles: [RemoteAngle]
}

struct RemoteAngle: Codable, Sendable, Identifiable {
    var id: String
    /// JPEG, about 240 px on the long side, of the angle's ambient frame.
    var thumbnail: Data?
    var frames: Int
    var flashes: Int
    var isHDR: Bool
    var flags: [String]
}

// MARK: Card previews

struct RemoteSessionPreview: Codable, Sendable, Equatable {
    var cardID: String
    var sessionID: Date
    /// Photos in the session (the frames are a sample of these).
    var photoCount: Int
    /// In capture order; the session's first and last photo are always included.
    var frames: [RemoteCardFrame]
}

struct RemoteCardFrame: Codable, Sendable, Equatable, Identifiable {
    /// The file's path on the card; what `.cardPhoto` asks for.
    var id: String
    var name: String
    var date: Date?
    /// MediaKind raw value: "camera", "drone" or "video".
    var kind: String
    /// 0-based position among the session's photos.
    var index: Int
    /// JPEG, about 240 px on the long side, from the raw's embedded preview.
    var thumbnail: Data?
}

struct RemoteCardPhoto: Codable, Sendable, Equatable {
    var cardID: String
    var path: String
    /// JPEG, about 1280 px on the long side; nil when the file has no readable preview.
    var image: Data?
}

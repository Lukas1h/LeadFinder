import FlambientCore
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
    static let version = 2

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

    // MARK: v2: cull and edit a shoot from the phone (same Wi-Fi). `path` is `RemoteShoot.id`.
    // Every change runs through the same ShootModel call the Mac UI makes, so undo, saving,
    // learning and PSD builds behave exactly as on the Mac.

    /// Start working on a shoot; answered with `.shootSession`, then `.cullList` / `.angleState`s
    /// as asked. The Mac keeps the shoot open for the phone until `.closeShoot` or disconnect.
    case openShoot(path: String)
    case closeShoot(path: String)
    /// Answered with `.cullList`.
    case cullList(path: String)
    /// Pass (true) or reject (false) one cull item (`RemoteCullItem.id`).
    case cullDecide(path: String, item: String, passed: Bool)
    /// Merge an item with the next one; split one before frame `at` (a file name). Answered with a
    /// fresh `.cullList`.
    case cullMerge(path: String, item: String)
    case cullSplit(path: String, item: String, at: String)
    /// One frame of a shoot at screen size (≈1600 px JPEG); answered with `.photo`, bytes in the body.
    case photo(path: String, file: String)
    case undo(path: String)
    case redo(path: String)
    /// The current state of one angle; answered with `.angleState`.
    case angleState(path: String, angle: String)
    /// The decoded layers of an angle for rendering on the phone; answered with `.angleInputs`,
    /// payload in the body.
    case angleInputs(path: String, angle: String)
    /// A whole LayerEdit for one layer. `phase` nil is one discrete step (an eye tap, a blend pick);
    /// a drag is begin, change… (≤ ~10 per second), end — one undo step. `seq` rises with every
    /// command the phone sends, so it can tell its own echoes from other changes.
    case setLayer(path: String, angle: String, layer: String, edit: LayerEdit, phase: RemoteGesture?, seq: Int)
    /// Whole, Keep Left, Keep Right or a fresh gradient: as the Mac's mask buttons (gradient width
    /// from the Mac's recipe).
    case setMask(path: String, angle: String, layer: String, preset: RemoteMaskPreset, seq: Int)
    /// A layer's polygons, the whole list each time (nil clears them). Adding or deleting a point is
    /// `phase` nil; dragging a point is a gesture.
    case setShapes(path: String, angle: String, layer: String, shapes: [[MaskPoint]]?, phase: RemoteGesture?, seq: Int)
    /// The angle's own look (exposure, highlights…).
    case setAngleLook(path: String, angle: String, look: Look, phase: RemoteGesture?, seq: Int)
    /// Show or hide several layers in one step (all flashes, solo).
    case setLayersVisible(path: String, angle: String, layers: [String], visible: Bool, seq: Int)
    /// Reset one layer, or every layer of the angle when `layer` is nil.
    case resetLayer(path: String, angle: String, layer: String?, seq: Int)
}

enum RemoteGesture: String, Codable, Sendable {
    case begin, change, end
}

enum RemoteMaskPreset: String, Codable, Sendable, CaseIterable {
    case whole, keepLeft, keepRight, gradient
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

    // MARK: v2
    case shootSession(RemoteShootSession)
    case cullList(RemoteCullList)
    /// A frame as JPEG; the bytes are the frame body (Wi-Fi only).
    case photo(path: String, file: String)
    /// Pushed after every change to the angle, from the phone or the Mac, and on request.
    case angleState(RemoteAngleState)
    /// The angle's decoded layers; the bytes (`RemoteInputs` format) are the frame body.
    case angleInputs(path: String, angle: String, inputsKey: String)
    /// Pushed after every undoable change, undo and redo.
    case undoState(RemoteUndoState)
    /// After an undo or redo in cull: the item that changed, to show it.
    case cullFocus(path: String, item: String)
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

// MARK: v2: cull and edit

struct RemoteShootSession: Codable, Sendable {
    var path: String
    var name: String
    /// ShootStage in words.
    var stage: String
    /// Angle ids in order (stable across merge and split).
    var angles: [String]
    /// What the engine needs besides the angle itself to compose exactly as the Mac does.
    var recipe: Recipe
    var calibration: ExposureCalibration?
    var undo: RemoteUndoState
}

struct RemoteCullList: Codable, Sendable {
    var path: String
    var items: [RemoteCullItem]
}

struct RemoteCullItem: Codable, Sendable, Identifiable, Equatable {
    /// The first frame's file name: stays the same when angles renumber.
    var id: String
    /// "angle" or "drone".
    var kind: String
    /// The AnglePlan id for an angle (what edit commands take), nil for a drone shot.
    var angle: String?
    var title: String
    var detail: String
    var passed: Bool
    /// File names in judging order (the first is the one to judge); `.photo` loads each.
    var frames: [String]
    var warnings: [String]
    /// JPEG, about 240 px on the long side, of the first frame.
    var thumbnail: Data?
}

struct RemoteAngleState: Codable, Sendable {
    var path: String
    var angle: AnglePlan
    var layers: ResolvedLayers
    var look: Look.Resolved
    /// Changes when the angle's decoded inputs change (frames, flash/window roles): fetch
    /// `.angleInputs` again when it differs from the one the phone holds.
    var inputsKey: String
    /// The highest phone `seq` the Mac had applied when this was sent.
    var appliedSeq: Int
    /// Rises with every change to the shoot.
    var revision: Int
}

struct RemoteUndoState: Codable, Sendable, Equatable {
    var path: String
    var canUndo: Bool
    var canRedo: Bool
    var undoName: String?
    var redoName: String?
}

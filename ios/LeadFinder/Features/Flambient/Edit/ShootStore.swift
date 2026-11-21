import SwiftUI
import UIKit

/// One cull decision unit: a bracket group (or a single frame) the Mac would
/// turn into an angle. The phone only ever shows what the Mac sends.
struct CullCard: Identifiable, Equatable {
    var id: String
    var title: String
    var detail: String
    var passed: Bool
    /// File names, in shooting order. `photo(_:)` loads one.
    var frames: [String]
    var warnings: [String]
    var thumbnail: UIImage?
    var angleID: String?
}

/// A layer of the angle's composite, as far as the phone can edit it.
struct PhoneLayer: Identifiable, Equatable {
    enum Kind: String, Equatable { case ambient, flash, flashColor, window, ambientBlend }
    enum Blend: String, CaseIterable, Equatable { case lighten, normal, screen, darken, color }
    /// Points are normalized 0...1 in image space, y down.
    enum Mask: Equatable {
        case whole, keepLeft, keepRight
        case gradient(from: CGPoint, to: CGPoint)
        case polygon([[CGPoint]])
    }

    var id: String
    var name: String
    var kind: Kind
    var visible: Bool
    /// Stops, -3...3.
    var exposure: Double
    /// 0...1.
    var opacity: Double
    var blend: Blend
    var mask: Mask
}

enum MaskPreset: String, CaseIterable { case whole, keepLeft, keepRight, gradient }

/// Slider and handle edits come as a began/changed/ended run so the backend
/// can coalesce them into one undo step; taps are `discrete`.
enum EditPhase { case began, changed, ended, discrete }

/// The state and actions the Cull and Edit screens use. The backend is a set
/// of closures so the real Wi-Fi link can be wired in without touching views;
/// with no backend set, every action edits local state (the mock behaviour).
@Observable @MainActor
final class ShootStore {
    var shootName: String
    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }
    var undoName: String? { undoStack.last?.name }
    var redoName: String? { redoStack.last?.name }

    // Cull
    var cullItems: [CullCard]
    /// Item the cull screen should jump to, set after an undo/redo. One-shot:
    /// the screen clears it once it has jumped, so a later undo can point at
    /// the same item again.
    var cullFocus: String?

    // Edit
    var angles: [String]
    var currentAngle: String?
    var preview: CGImage?
    var isLoadingAngle = false
    var showBefore = false {
        didSet { if showBefore != oldValue { rerender() } }
    }
    var layers: [PhoneLayer]
    var selectedLayer: String?
    var angleExposure: Double = 0
    var highlights: Double = 0

    /// Hooks for a real backend. Nil means "mock: handle locally".
    struct Backend {
        var photo: (@MainActor (String) async -> UIImage?)?
        var undo: (@MainActor () -> Void)?
        var redo: (@MainActor () -> Void)?
        var selectAngle: (@MainActor (String) -> Void)?
    }
    var backend = Backend()

    init(shootName: String, cullItems: [CullCard], angles: [String], layers: [PhoneLayer]) {
        self.shootName = shootName
        self.cullItems = cullItems
        self.angles = angles
        self.layers = layers
        self.currentAngle = angles.first
        self.selectedLayer = layers.first?.id
    }

    // MARK: Undo (mock: whole-state snapshots)

    private struct Snapshot {
        var name: String
        var cull: [CullCard]
        var layers: [PhoneLayer]
        var angleExposure: Double
        var highlights: Double
        var focus: String?
    }
    private var undoStack: [Snapshot] = []
    private var redoStack: [Snapshot] = []
    /// Snapshot taken at `.began`, pushed at `.ended`, so a drag is one step.
    @ObservationIgnored private var pending: Snapshot?

    private func snapshot(_ name: String, focus: String? = nil) -> Snapshot {
        Snapshot(name: name, cull: cullItems, layers: layers, angleExposure: angleExposure, highlights: highlights, focus: focus)
    }

    private func record(_ name: String, _ phase: EditPhase, focus: String? = nil) {
        switch phase {
        case .began: pending = snapshot(name, focus: focus)
        case .changed: if pending == nil { pending = snapshot(name, focus: focus) }
        case .ended:
            undoStack.append(pending ?? snapshot(name, focus: focus)); pending = nil; redoStack = []
        case .discrete:
            undoStack.append(snapshot(name, focus: focus)); redoStack = []
        }
    }

    private func restore(_ s: Snapshot) {
        cullItems = s.cull; layers = s.layers; angleExposure = s.angleExposure; highlights = s.highlights
        cullFocus = s.focus
        rerender()
    }

    func undo() {
        if let u = backend.undo { return u() }
        guard let s = undoStack.popLast() else { return }
        var cur = snapshot(s.name, focus: s.focus)
        cur.name = s.name
        redoStack.append(cur)
        restore(s)
    }

    func redo() {
        if let r = backend.redo { return r() }
        guard let s = redoStack.popLast() else { return }
        undoStack.append(snapshot(s.name, focus: s.focus))
        restore(s)
    }

    // MARK: Cull

    func photo(_ file: String) async -> UIImage? {
        if let p = backend.photo { return await p(file) }
        try? await Task.sleep(for: .milliseconds(60))
        let hue = Double(abs(file.hashValue % 360)) / 360
        return Self.placeholder(hue: hue, label: file)
    }

    func decide(_ id: String, passed: Bool) {
        guard let i = cullItems.firstIndex(where: { $0.id == id }), cullItems[i].passed != passed else { return }
        record(passed ? "Pass" : "Reject", .discrete, focus: id)
        cullItems[i].passed = passed
    }

    func merge(_ id: String) {
        guard let i = cullItems.firstIndex(where: { $0.id == id }), i + 1 < cullItems.count else { return }
        record("Merge", .discrete, focus: id)
        let next = cullItems.remove(at: i + 1)
        cullItems[i].frames += next.frames
        cullItems[i].detail = "\(cullItems[i].frames.count) frames"
    }

    func split(_ id: String, at file: String) {
        guard let i = cullItems.firstIndex(where: { $0.id == id }),
              let f = cullItems[i].frames.firstIndex(of: file), f > 0 else { return }
        record("Split", .discrete, focus: id)
        var tail = cullItems[i]
        tail.id = id + "-" + file
        tail.frames = Array(cullItems[i].frames[f...])
        tail.detail = "\(tail.frames.count) frames"
        tail.angleID = nil
        cullItems[i].frames = Array(cullItems[i].frames[..<f])
        cullItems[i].detail = "\(cullItems[i].frames.count) frames"
        cullItems.insert(tail, at: i + 1)
    }

    // MARK: Edit

    func select(angle: String) {
        guard angle != currentAngle else { return }
        currentAngle = angle
        if let s = backend.selectAngle { return s(angle) }
        isLoadingAngle = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            guard currentAngle == angle else { return }
            isLoadingAngle = false
            rerender()
        }
    }

    private func edit(_ id: String, _ name: String, _ phase: EditPhase, _ change: (inout PhoneLayer) -> Void) {
        guard let i = layers.firstIndex(where: { $0.id == id }) else { return }
        record(name, phase)
        change(&layers[i])
        rerender()
    }

    func setVisible(_ layer: String, _ v: Bool) { edit(layer, v ? "Show Layer" : "Hide Layer", .discrete) { $0.visible = v } }

    func solo(_ layer: String?) {
        record("Solo", .discrete)
        for i in layers.indices { layers[i].visible = layer == nil || layers[i].id == layer }
        rerender()
    }

    func setExposure(_ layer: String, _ v: Double, _ phase: EditPhase) { edit(layer, "Exposure", phase) { $0.exposure = v } }
    func setOpacity(_ layer: String, _ v: Double, _ phase: EditPhase) { edit(layer, "Opacity", phase) { $0.opacity = v } }
    func setBlend(_ layer: String, _ b: PhoneLayer.Blend) { edit(layer, "Blend", .discrete) { $0.blend = b } }

    func setMaskPreset(_ layer: String, _ p: MaskPreset) {
        edit(layer, "Mask", .discrete) {
            switch p {
            case .whole: $0.mask = .whole
            case .keepLeft: $0.mask = .keepLeft
            case .keepRight: $0.mask = .keepRight
            case .gradient: $0.mask = .gradient(from: CGPoint(x: 0.5, y: 0.25), to: CGPoint(x: 0.5, y: 0.75))
            }
        }
    }

    func setGradient(_ layer: String, from: CGPoint, to: CGPoint, _ phase: EditPhase) {
        edit(layer, "Gradient", phase) { $0.mask = .gradient(from: from, to: to) }
    }

    func setShapes(_ layer: String, _ shapes: [[CGPoint]], _ phase: EditPhase) {
        edit(layer, "Mask Shape", phase) { $0.mask = .polygon(shapes) }
    }

    func resetLayer(_ layer: String?) {
        record("Reset", .discrete)
        for i in layers.indices where layer == nil || layers[i].id == layer {
            layers[i].exposure = 0; layers[i].opacity = 1; layers[i].mask = .whole; layers[i].visible = true
        }
        if layer == nil { angleExposure = 0; highlights = 0 }
        rerender()
    }

    func setAngleExposure(_ v: Double, _ phase: EditPhase) { record("Angle Exposure", phase); angleExposure = v; rerender() }
    func setHighlights(_ v: Double, _ phase: EditPhase) { record("Highlights", phase); highlights = v; rerender() }

    // MARK: Mock rendering

    /// Cheap stand-in for the Mac's render: tint by angle, brighten by look.
    private func rerender() {
        guard backend.selectAngle == nil else { return }
        let idx = Double(angles.firstIndex(of: currentAngle ?? "") ?? 0)
        let flash = layers.filter { $0.kind != .ambient && $0.visible }.map { $0.opacity * pow(2, $0.exposure) }.reduce(0, +)
        let bright = showBefore ? 0.35 : min(1, 0.35 + 0.15 * flash) * pow(2, angleExposure / 2)
        preview = Self.placeholder(hue: (idx * 0.13).truncatingRemainder(dividingBy: 1), label: currentAngle ?? "", brightness: bright)?.cgImage
    }

    static func placeholder(hue: Double, label: String, brightness: Double = 0.6) -> UIImage? {
        let size = CGSize(width: 1200, height: 800)
        let r = UIGraphicsImageRenderer(size: size, format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }())
        return r.image { ctx in
            let c = ctx.cgContext
            let top = UIColor(hue: hue, saturation: 0.25, brightness: min(1, brightness + 0.25), alpha: 1)
            let bottom = UIColor(hue: hue, saturation: 0.35, brightness: brightness * 0.5, alpha: 1)
            let g = CGGradient(colorsSpace: nil, colors: [top.cgColor, bottom.cgColor] as CFArray, locations: [0, 1])!
            c.drawLinearGradient(g, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
            // A "window" so masks have something to aim at.
            UIColor(white: min(1, brightness + 0.4), alpha: 1).setFill()
            c.fill(CGRect(x: 760, y: 180, width: 260, height: 300))
            UIColor(white: 0, alpha: 0.35).setFill()
            c.fill(CGRect(x: 0, y: 600, width: size.width, height: 200))
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 44, weight: .semibold), .foregroundColor: UIColor(white: 1, alpha: 0.6)]
            (label as NSString).draw(at: CGPoint(x: 40, y: 40), withAttributes: attrs)
        }
    }

    static func mock() -> ShootStore {
        let items: [CullCard] = (1...14).map { n in
            let frames = (0..<(n % 4 == 0 ? 1 : 3)).map { String(format: "DSC_%04d.ARW", n * 10 + $0) }
            var warnings: [String] = []
            if n == 3 { warnings.append("Person in frame") }
            if n == 6 { warnings = ["Blurry", "Missing ambient"] }
            return CullCard(id: "c\(n)", title: "Angle \(n)", detail: "\(frames.count) frames", passed: n != 5,
                            frames: frames, warnings: warnings,
                            thumbnail: placeholder(hue: Double(n) * 0.07, label: "\(n)", brightness: 0.5),
                            angleID: "a\(n)")
        }
        let layers = [
            PhoneLayer(id: "amb", name: "Ambient", kind: .ambient, visible: true, exposure: 0, opacity: 1, blend: .normal, mask: .whole),
            PhoneLayer(id: "f1", name: "Flash 1", kind: .flash, visible: true, exposure: 0, opacity: 1, blend: .lighten, mask: .whole),
            PhoneLayer(id: "f2", name: "Flash 2", kind: .flash, visible: true, exposure: -0.5, opacity: 0.8, blend: .lighten, mask: .keepLeft),
            PhoneLayer(id: "fc", name: "Flash Color", kind: .flashColor, visible: true, exposure: 0, opacity: 0.6, blend: .color, mask: .whole),
            PhoneLayer(id: "w", name: "Window", kind: .window, visible: true, exposure: 0, opacity: 1, blend: .normal,
                       mask: .polygon([[CGPoint(x: 0.63, y: 0.22), CGPoint(x: 0.85, y: 0.22), CGPoint(x: 0.85, y: 0.6), CGPoint(x: 0.63, y: 0.6)]])),
            PhoneLayer(id: "ab", name: "Ambient Blend", kind: .ambientBlend, visible: false, exposure: 0, opacity: 0.3, blend: .normal, mask: .whole),
        ]
        let store = ShootStore(shootName: "123 Maple St", cullItems: items, angles: items.compactMap(\.angleID), layers: layers)
        store.rerender()
        return store
    }
}

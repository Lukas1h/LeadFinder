import SwiftUI

/// The angle editor: the Mac's rendered composite fills the screen, layers and
/// the angle look live in a bottom sheet, and mask tools draw over the canvas.
struct EditScreen: View {
    let store: ShootStore
    @State private var showSheet = true

    var body: some View {
        EditCanvas(store: store)
            .overlay(alignment: .top) { AngleStrip(store: store) }
            .background(Color.black)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Reset Layer", systemImage: "arrow.counterclockwise") { store.resetLayer(store.selectedLayer) }
                            .disabled(store.selectedLayer == nil)
                        Button("Reset All", systemImage: "arrow.counterclockwise.circle", role: .destructive) { store.resetLayer(nil) }
                    } label: {
                        Image(systemName: "arrow.counterclockwise")
                    }
                }
            }
            .sheet(isPresented: $showSheet) {
                LayerSheet(store: store)
                    .presentationDetents([.height(170), .medium, .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                    .presentationBackground(Theme.background.opacity(0.96))
                    .presentationCornerRadius(18)
                    .presentationDragIndicator(.visible)
                    .interactiveDismissDisabled()
                    .preferredColorScheme(.dark)
            }
    }
}

// MARK: - Canvas geometry

/// Maps normalized image points (0...1, y down) to canvas points and back,
/// through aspect-fit, zoom (about the canvas centre) and pan.
struct CanvasMap {
    var size: CGSize
    var imageSize: CGSize
    var scale: CGFloat
    var offset: CGSize

    var fit: CGRect {
        guard imageSize.width > 0, imageSize.height > 0 else { return CGRect(origin: .zero, size: size) }
        let s = min(size.width / imageSize.width, size.height / imageSize.height)
        let w = imageSize.width * s, h = imageSize.height * s
        return CGRect(x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h)
    }

    func view(_ p: CGPoint) -> CGPoint {
        let f = fit
        let x = f.minX + p.x * f.width, y = f.minY + p.y * f.height
        return CGPoint(x: size.width / 2 + (x - size.width / 2) * scale + offset.width,
                       y: size.height / 2 + (y - size.height / 2) * scale + offset.height)
    }

    func norm(_ v: CGPoint) -> CGPoint {
        let f = fit
        let x = (v.x - offset.width - size.width / 2) / scale + size.width / 2
        let y = (v.y - offset.height - size.height / 2) / scale + size.height / 2
        return CGPoint(x: min(1, max(0, (x - f.minX) / f.width)), y: min(1, max(0, (y - f.minY) / f.height)))
    }
}

// MARK: - Canvas

private struct EditCanvas: View {
    let store: ShootStore

    @State private var scale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @GestureState private var pinch: CGFloat = 1
    @GestureState private var pan: CGSize = .zero
    @State private var angleSwipe: CGFloat = 0
    @State private var angleTick = 0
    /// Set while a mask handle is dragged, so the canvas doesn't pan with it.
    @State private var handleActive = false

    private var layer: PhoneLayer? { store.layers.first { $0.id == store.selectedLayer } }

    private enum Tool { case none, gradient, poly }
    private var tool: Tool {
        switch layer?.mask {
        case .gradient: .gradient
        case .polygon: .poly
        default: .none
        }
    }

    var body: some View {
        GeometryReader { geo in
            let liveScale = scale * pinch
            let liveOffset = CGSize(width: offset.width + pan.width, height: offset.height + pan.height)
            let imgSize = store.preview.map { CGSize(width: $0.width, height: $0.height) } ?? geo.size
            let map = CanvasMap(size: geo.size, imageSize: imgSize, scale: liveScale, offset: liveOffset)

            ZStack {
                Color.black
                if let preview = store.preview {
                    Image(decorative: preview, scale: 1)
                        .resizable()
                        .interpolation(.medium)
                        .scaledToFit()
                        .frame(width: geo.size.width, height: geo.size.height)
                        .scaleEffect(liveScale)
                        .offset(x: liveOffset.width + angleSwipe, y: liveOffset.height)
                }
                if store.isLoadingAngle {
                    ProgressView().tint(Theme.secondaryText)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture(count: 2) {
                withAnimation(.snappy) {
                    if scale > 1 { scale = 1; offset = .zero } else { scale = 2.5 }
                }
            }
            .onLongPressGesture(minimumDuration: 0.25, maximumDistance: 12) {
                if tool == .none { store.showBefore = true }
            } onPressingChanged: { pressing in
                if !pressing, store.showBefore { store.showBefore = false }
            }
            .overlay {
                if let layer, !store.showBefore {
                    switch layer.mask {
                    case .gradient(let from, let to):
                        GradientOverlay(store: store, layerID: layer.id, from: from, to: to, map: map, handleActive: $handleActive)
                    case .polygon(let shapes):
                        PolyOverlay(store: store, layerID: layer.id, shapes: shapes, map: map, handleActive: $handleActive)
                            .id(layer.id)
                    default:
                        EmptyView()
                    }
                }
            }
            // On the container so pinch and pan also work over the mask tools.
            .simultaneousGesture(magnify)
            .simultaneousGesture(dragGesture)
            .overlay(alignment: .bottomLeading) { beforeBadge }
            .coordinateSpace(.named("canvas"))
        }
        .clipped()
        .sensoryFeedback(.selection, trigger: angleTick)
        .sensoryFeedback(.impact(weight: .light), trigger: store.showBefore)
        .onChange(of: store.currentAngle) { _, _ in
            scale = 1; offset = .zero
        }
    }

    private var magnify: some Gesture {
        MagnifyGesture()
            .updating($pinch) { v, s, _ in s = v.magnification }
            .onEnded { v in
                scale = min(8, max(1, scale * v.magnification))
                if scale == 1 { withAnimation(.snappy) { offset = .zero } }
            }
    }

    /// Pans while zoomed; at fit, a horizontal swipe changes angle (unless a
    /// mask tool owns single-finger input).
    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 12)
            .updating($pan) { v, s, _ in if scale > 1, !handleActive { s = v.translation } }
            .onChanged { v in
                if scale == 1, tool == .none, abs(v.translation.width) > abs(v.translation.height) {
                    angleSwipe = v.translation.width * 0.35
                }
            }
            .onEnded { v in
                if handleActive { return }
                if scale > 1 {
                    offset.width += v.translation.width
                    offset.height += v.translation.height
                    return
                }
                defer { withAnimation(.snappy) { angleSwipe = 0 } }
                guard tool == .none, abs(v.translation.width) > 80,
                      abs(v.translation.width) > abs(v.translation.height),
                      let cur = store.currentAngle, let i = store.angles.firstIndex(of: cur) else { return }
                let next = v.translation.width < 0 ? i + 1 : i - 1
                guard store.angles.indices.contains(next) else { return }
                angleTick += 1
                store.select(angle: store.angles[next])
            }
    }

    @ViewBuilder private var beforeBadge: some View {
        HStack(spacing: 8) {
            if store.showBefore {
                BadgeChip(text: "Before", tint: Theme.amber, filled: true)
            }
            // Press-and-hold works even while a mask tool owns the canvas.
            Image(systemName: "circle.lefthalf.filled")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(store.showBefore ? Theme.amber : Theme.primaryText)
                .frame(width: 36, height: 36)
                .background(.black.opacity(0.5), in: Circle())
                .onLongPressGesture(minimumDuration: 0, perform: {}) { store.showBefore = $0 }
                .accessibilityLabel("Hold for before")
        }
        .padding(.leading, 12)
        .padding(.bottom, 182)
    }
}

// MARK: - Gradient tool

private struct GradientOverlay: View {
    let store: ShootStore
    let layerID: String
    let from: CGPoint
    let to: CGPoint
    let map: CanvasMap
    @Binding var handleActive: Bool

    @State private var live: (CGPoint, CGPoint)?
    @State private var grabbed = 0

    var body: some View {
        let (a, b) = live ?? (from, to)
        let va = map.view(a), vb = map.view(b)
        ZStack {
            Path { p in p.move(to: va); p.addLine(to: vb) }
                .stroke(.white.opacity(0.9), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
                .shadow(color: .black.opacity(0.6), radius: 1)
                .allowsHitTesting(false)
            handle(at: va, filled: true, end: 0)
            handle(at: vb, filled: false, end: 1)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: grabbed)
    }

    private func handle(at p: CGPoint, filled: Bool, end: Int) -> some View {
        Circle()
            .fill(filled ? Color.white : Color.black.opacity(0.4))
            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            .frame(width: 22, height: 22)
            .frame(width: 44, height: 44)
            .contentShape(Circle())
            .position(p)
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .named("canvas"))
                    .onChanged { v in
                        let began = live == nil
                        var pair = live ?? (from, to)
                        if end == 0 { pair.0 = map.norm(v.location) } else { pair.1 = map.norm(v.location) }
                        live = pair
                        if began { grabbed += 1; handleActive = true }
                        store.setGradient(layerID, from: pair.0, to: pair.1, began ? .began : .changed)
                    }
                    .onEnded { _ in
                        if let pair = live { store.setGradient(layerID, from: pair.0, to: pair.1, .ended) }
                        live = nil
                        handleActive = false
                    }
            )
    }
}

// MARK: - Polygon tool

/// Window masks. Shapes are kept locally while a point is dragged so only the
/// overlay redraws; the store hears began/changed/ended for drags and
/// `discrete` for adds and deletes.
private struct PolyOverlay: View {
    let store: ShootStore
    let layerID: String
    let shapes: [[CGPoint]]
    let map: CanvasMap
    @Binding var handleActive: Bool

    @State private var live: [[CGPoint]]?
    /// Index of the shape still being drawn (open), if any.
    @State private var drawing: Int?
    @State private var dragging: (shape: Int, point: Int, at: CGPoint)?
    @State private var tick = 0
    @State private var deleteTick = 0

    private var current: [[CGPoint]] { live ?? shapes }

    var body: some View {
        let cur = current
        ZStack {
            // Empty space: tap adds a point.
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture(coordinateSpace: .named("canvas")) { add(map.norm($0)) }

            ForEach(cur.indices, id: \.self) { s in
                shapeView(cur[s], index: s)
            }
            ForEach(cur.indices, id: \.self) { s in
                ForEach(cur[s].indices, id: \.self) { p in
                    vertex(shape: s, point: p, at: map.view(cur[s][p]))
                }
            }
            if let d = dragging, let preview = store.preview {
                Loupe(image: preview, point: cur[safe: d.shape]?[safe: d.point] ?? .zero, map: map)
                    .position(x: d.at.x, y: d.at.y < 150 ? d.at.y + 100 : d.at.y - 100)
                    .allowsHitTesting(false)
            }
        }
        .overlay(alignment: .topTrailing) { toolBar }
        .sensoryFeedback(.impact(weight: .light), trigger: tick)
        .sensoryFeedback(.warning, trigger: deleteTick)
    }

    private func shapeView(_ pts: [CGPoint], index: Int) -> some View {
        let open = drawing == index
        let path = Path { p in
            guard let first = pts.first else { return }
            p.move(to: map.view(first))
            for q in pts.dropFirst() { p.addLine(to: map.view(q)) }
            if !open { p.closeSubpath() }
        }
        return ZStack {
            if !open {
                path.fill(Theme.sky.opacity(0.18))
            }
            path.stroke(Theme.sky, style: StrokeStyle(lineWidth: 1.5, lineJoin: .round, dash: open ? [5, 4] : []))
                .shadow(color: .black.opacity(0.7), radius: 1)
        }
        .contentShape(path)
        .onTapGesture(coordinateSpace: .named("canvas")) { add(map.norm($0)) }
        .onLongPressGesture(minimumDuration: 0.5) { if !open { deleteShape(index) } }
    }

    private func vertex(shape s: Int, point p: Int, at v: CGPoint) -> some View {
        let isFirstOpen = drawing == s && p == 0 && current[s].count >= 3
        let active = dragging?.shape == s && dragging?.point == p
        return Circle()
            .fill(isFirstOpen ? Theme.sky : .white)
            .overlay(Circle().strokeBorder(Theme.sky, lineWidth: 2))
            .frame(width: active ? 8 : (isFirstOpen ? 16 : 12), height: active ? 8 : (isFirstOpen ? 16 : 12))
            .frame(width: 40, height: 40)
            .contentShape(Circle())
            .position(v)
            .onTapGesture {
                if isFirstOpen { close() }
            }
            .onLongPressGesture(minimumDuration: 0.45) { deletePoint(shape: s, point: p) }
            .highPriorityGesture(
                DragGesture(minimumDistance: 4, coordinateSpace: .named("canvas"))
                    .onChanged { g in
                        var next = live ?? shapes
                        guard next.indices.contains(s), next[s].indices.contains(p) else { return }
                        let began = dragging == nil
                        next[s][p] = map.norm(g.location)
                        live = next
                        dragging = (s, p, g.location)
                        if began { tick += 1; handleActive = true }
                        store.setShapes(layerID, next, began ? .began : .changed)
                    }
                    .onEnded { _ in
                        if let next = live { store.setShapes(layerID, next, .ended) }
                        live = nil
                        dragging = nil
                        handleActive = false
                    }
            )
    }

    @ViewBuilder private var toolBar: some View {
        if drawing != nil {
            Button {
                finish()
            } label: {
                Text("Done").font(.subheadline.weight(.semibold)).padding(.horizontal, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.sky)
            .foregroundStyle(.black)
            .padding(.top, 64)
            .padding(.trailing, 12)
        }
    }

    // MARK: Edits

    private func add(_ p: CGPoint) {
        var next = shapes
        if let d = drawing, next.indices.contains(d) {
            next[d].append(p)
        } else {
            next.append([p])
            drawing = next.count - 1
        }
        tick += 1
        store.setShapes(layerID, next, .discrete)
    }

    private func close() {
        drawing = nil
        tick += 1
    }

    /// Ends drawing; an open shape too small to be a polygon is dropped.
    private func finish() {
        defer { drawing = nil }
        guard let d = drawing, shapes.indices.contains(d), shapes[d].count < 3 else { return }
        var next = shapes
        next.remove(at: d)
        store.setShapes(layerID, next, .discrete)
    }

    private func deletePoint(shape s: Int, point p: Int) {
        var next = shapes
        guard next.indices.contains(s), next[s].indices.contains(p) else { return }
        next[s].remove(at: p)
        if next[s].count < 3, drawing != s {
            next.remove(at: s)
            if let d = drawing, d > s { drawing = d - 1 }
        } else if next[s].isEmpty {
            next.remove(at: s); drawing = nil
        }
        deleteTick += 1
        store.setShapes(layerID, next, .discrete)
    }

    private func deleteShape(_ s: Int) {
        var next = shapes
        guard next.indices.contains(s) else { return }
        next.remove(at: s)
        if let d = drawing { drawing = d == s ? nil : (d > s ? d - 1 : d) }
        deleteTick += 1
        store.setShapes(layerID, next, .discrete)
    }
}

/// Magnified view of the image around the dragged point, since the finger
/// covers exactly what's being placed.
private struct Loupe: View {
    let image: CGImage
    let point: CGPoint
    let map: CanvasMap
    private let size: CGFloat = 120

    var body: some View {
        let f = map.fit
        let zoom = map.scale * 3
        let w = f.width * zoom, h = f.height * zoom
        ZStack {
            Color.black
            Image(decorative: image, scale: 1)
                .resizable()
                .frame(width: w, height: h)
                .offset(x: (0.5 - point.x) * w, y: (0.5 - point.y) * h)
            Image(systemName: "plus")
                .font(.system(size: 16, weight: .light))
                .foregroundStyle(Theme.sky)
                .shadow(color: .black, radius: 1)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(.white.opacity(0.9), lineWidth: 2))
        .shadow(color: .black.opacity(0.5), radius: 8)
    }
}

extension Array {
    fileprivate subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

// MARK: - Angle strip

private struct AngleStrip: View {
    let store: ShootStore

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 6) {
                    ForEach(Array(store.angles.enumerated()), id: \.element) { i, angle in
                        let selected = angle == store.currentAngle
                        let thumb = store.cullItems.first { $0.angleID == angle }?.thumbnail
                        Button { store.select(angle: angle) } label: {
                            ZStack(alignment: .bottomLeading) {
                                if let thumb {
                                    Image(uiImage: thumb).resizable().scaledToFill()
                                } else {
                                    Theme.cardRaised
                                }
                                Text("\(i + 1)")
                                    .font(.caption2.weight(.bold).monospacedDigit())
                                    .foregroundStyle(.white)
                                    .shadow(color: .black, radius: 1)
                                    .padding(3)
                            }
                            .frame(width: 46, height: 32)
                            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 5, style: .continuous)
                                    .strokeBorder(selected ? Theme.primaryText : Theme.border, lineWidth: selected ? 2 : 0.5)
                            )
                        }
                        .buttonStyle(.plain)
                        .id(angle)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            .frame(height: 44)
            .background(.black.opacity(0.35))
            .sensoryFeedback(.selection, trigger: store.currentAngle)
            .onChange(of: store.currentAngle) { _, a in
                withAnimation(.snappy) { proxy.scrollTo(a, anchor: .center) }
            }
        }
    }
}

// MARK: - Layer sheet

private struct LayerSheet: View {
    let store: ShootStore

    private var layer: PhoneLayer? { store.layers.first { $0.id == store.selectedLayer } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let layer {
                    selectedHeader(layer)
                    maskBar(layer)
                    layerControls(layer)
                }
                section("Layers")
                layerList
                section("Angle")
                VStack(spacing: 10) {
                    EditSlider(title: "Exposure", value: store.angleExposure, range: -3...3, unit: "EV") {
                        store.setAngleExposure($0, $1)
                    }
                    EditSlider(title: "Highlights", value: store.highlights, range: -1...1, unit: "") {
                        store.setHighlights($0, $1)
                    }
                }
                .card()
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
    }

    private func section(_ t: String) -> some View {
        Text(t.uppercased())
            .font(.caption.weight(.semibold))
            .foregroundStyle(Theme.tertiaryText)
            .padding(.top, 4)
    }

    private func selectedHeader(_ layer: PhoneLayer) -> some View {
        HStack(spacing: 8) {
            Image(systemName: layer.kind.symbol).foregroundStyle(layer.kind.tint)
            Text(layer.name)
                .font(.headline)
                .foregroundStyle(Theme.primaryText)
            Spacer()
            Menu {
                Picker("Blend", selection: Binding(get: { layer.blend }, set: { store.setBlend(layer.id, $0) })) {
                    ForEach(PhoneLayer.Blend.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                }
            } label: {
                HStack(spacing: 3) {
                    Text(layer.blend.rawValue.capitalized)
                    Image(systemName: "chevron.up.chevron.down").font(.caption2)
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.secondaryText)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Theme.cardRaised, in: Capsule())
            }
        }
    }

    private func maskBar(_ layer: PhoneLayer) -> some View {
        HStack(spacing: 4) {
            maskButton("Whole", "rectangle", layer.mask == .whole) { store.setMaskPreset(layer.id, .whole) }
            maskButton("Keep L", "rectangle.lefthalf.filled", layer.mask == .keepLeft) { store.setMaskPreset(layer.id, .keepLeft) }
            maskButton("Keep R", "rectangle.righthalf.filled", layer.mask == .keepRight) { store.setMaskPreset(layer.id, .keepRight) }
            maskButton("Gradient", "circle.and.line.horizontal", layer.mask.isGradient) {
                if !layer.mask.isGradient { store.setMaskPreset(layer.id, .gradient) }
            }
            maskButton("Poly", "skew", layer.mask.isPolygon) {
                if !layer.mask.isPolygon { store.setShapes(layer.id, [], .discrete) }
            }
        }
        .padding(3)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .sensoryFeedback(.selection, trigger: layer.mask)
    }

    private func maskButton(_ title: String, _ icon: String, _ on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon).font(.system(size: 14, weight: .medium))
                Text(title).font(.caption2.weight(.semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .foregroundStyle(on ? Color.black : Theme.secondaryText)
            .background(on ? Theme.accent : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func layerControls(_ layer: PhoneLayer) -> some View {
        VStack(spacing: 10) {
            EditSlider(title: "Exposure", value: layer.exposure, range: -3...3, unit: "EV") {
                store.setExposure(layer.id, $0, $1)
            }
            EditSlider(title: "Opacity", value: layer.opacity, range: 0...1, unit: "%", percent: true, defaultValue: 1) {
                store.setOpacity(layer.id, $0, $1)
            }
        }
        .id(layer.id)
        .card()
    }

    private var layerList: some View {
        VStack(spacing: 0) {
            ForEach(Array(store.layers.reversed().enumerated()), id: \.element.id) { i, layer in
                if i > 0 { Divider().overlay(Theme.hairline) }
                LayerRow(layer: layer, selected: layer.id == store.selectedLayer,
                         soloed: store.layers.filter(\.visible).map(\.id) == [layer.id],
                         onSelect: { store.selectedLayer = layer.id },
                         onToggle: { store.setVisible(layer.id, !layer.visible) },
                         onSolo: { solo in store.solo(solo ? layer.id : nil) })
            }
        }
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.border, lineWidth: 0.5))
    }
}

private struct LayerRow: View {
    let layer: PhoneLayer
    let selected: Bool
    let soloed: Bool
    let onSelect: () -> Void
    let onToggle: () -> Void
    let onSolo: (Bool) -> Void
    @State private var soloTick = 0

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: layer.visible ? "eye.fill" : "eye.slash")
                .font(.system(size: 15))
                .foregroundStyle(layer.visible ? Theme.primaryText : Theme.tertiaryText)
                .frame(width: 40, height: 40)
                .contentShape(Rectangle())
                .onTapGesture(perform: onToggle)
                .onLongPressGesture(minimumDuration: 0.4) {
                    soloTick += 1
                    onSolo(!soloed)
                }
                .sensoryFeedback(.impact(weight: .medium), trigger: soloTick)
            Image(systemName: layer.kind.symbol)
                .foregroundStyle(layer.kind.tint)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(layer.name)
                    .font(.body.weight(.medium))
                    .foregroundStyle(layer.visible ? Theme.primaryText : Theme.tertiaryText)
                Text(subtitle)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Theme.secondaryText)
            }
            Spacer(minLength: 0)
            if soloed { BadgeChip(text: "Solo", tint: Theme.amber, filled: true) }
        }
        .padding(.trailing, 12)
        .padding(.vertical, 2)
        .background(selected ? Theme.accent.opacity(0.12) : .clear)
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
        .sensoryFeedback(.selection, trigger: selected)
    }

    private var subtitle: String {
        var parts = [layer.blend.rawValue.capitalized]
        if layer.exposure != 0 { parts.append(String(format: "%+.1f EV", layer.exposure)) }
        if layer.opacity < 1 { parts.append("\(Int((layer.opacity * 100).rounded()))%") }
        switch layer.mask {
        case .whole: break
        case .keepLeft: parts.append("Keep L")
        case .keepRight: parts.append("Keep R")
        case .gradient: parts.append("Gradient")
        case .polygon(let s): parts.append("\(s.count) shape\(s.count == 1 ? "" : "s")")
        }
        return parts.joined(separator: " · ")
    }
}

/// Slider that keeps its own value while dragging so only it redraws, and
/// reports began/changed/ended. Tap the title to reset.
struct EditSlider: View {
    let title: String
    let value: Double
    let range: ClosedRange<Double>
    var unit: String
    var percent = false
    var defaultValue: Double = 0
    let onEdit: (Double, EditPhase) -> Void

    @State private var local: Double?
    @State private var resetTick = 0

    var body: some View {
        let shown = local ?? value
        VStack(spacing: 2) {
            HStack {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .onTapGesture(count: 2) {
                        resetTick += 1
                        onEdit(defaultValue, .discrete)
                    }
                Spacer()
                Text(label(shown))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(shown == defaultValue ? Theme.tertiaryText : Theme.primaryText)
                    .frame(width: 70, alignment: .trailing)
            }
            Slider(
                value: Binding(
                    get: { local ?? value },
                    set: { v in
                        local = v
                        onEdit(v, .changed)
                    }
                ),
                in: range
            ) { editing in
                if editing {
                    local = value
                    onEdit(value, .began)
                } else {
                    onEdit(local ?? value, .ended)
                    local = nil
                }
            }
            .tint(Theme.accent)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: resetTick)
    }

    private func label(_ v: Double) -> String {
        if percent { return "\(Int((v * 100).rounded()))\(unit)" }
        let s = String(format: "%+.2f", v)
        return unit.isEmpty ? s : "\(s) \(unit)"
    }
}

extension PhoneLayer.Mask {
    var isGradient: Bool { if case .gradient = self { true } else { false } }
    var isPolygon: Bool { if case .polygon = self { true } else { false } }
}

extension PhoneLayer.Kind {
    var symbol: String {
        switch self {
        case .ambient: "sun.haze"
        case .flash: "bolt.fill"
        case .flashColor: "paintpalette.fill"
        case .window: "window.casement"
        case .ambientBlend: "circle.lefthalf.filled"
        }
    }

    var tint: Color {
        switch self {
        case .ambient: Theme.slate
        case .flash: Theme.amber
        case .flashColor: Theme.violet
        case .window: Theme.sky
        case .ambientBlend: Theme.emerald
        }
    }
}

#Preview {
    NavigationStack {
        EditScreen(store: .mock())
            .navigationBarTitleDisplayMode(.inline)
    }
    .preferredColorScheme(.dark)
}

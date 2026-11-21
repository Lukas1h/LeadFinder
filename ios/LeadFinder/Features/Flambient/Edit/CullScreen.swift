import SwiftUI

/// Full-screen cull: swipe right to pass, left to reject, tap to step through
/// the item's frames. Photos are cached locally and the next few prefetched so
/// swiping never waits on the network.
struct CullScreen: View {
    let store: ShootStore

    @State private var index = 0
    @State private var frameIndex = 0
    @State private var photos: [String: UIImage] = [:]
    @State private var loading: Set<String> = []
    @State private var swipe: CGFloat = 0
    @State private var zoomed = false
    @State private var feedback: Bool?

    private var items: [CullCard] { store.cullItems }
    private var current: CullCard? { items.indices.contains(index) ? items[index] : nil }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Color.black
                if let card = current {
                    frameView(card)
                        .offset(x: swipe)
                        .rotationEffect(.degrees(Double(swipe) / 40), anchor: .bottom)
                        .overlay(alignment: .top) { verdictStamp }
                        .overlay(alignment: .topLeading) { infoBar(card) }
                        .id(card.id)
                        // The thrown card is already off screen when the swap
                        // happens, so it must vanish at once — a removal fade
                        // would pop it back to the centre mid-crossfade.
                        .transition(.asymmetric(insertion: .opacity, removal: .identity))
                } else {
                    EmptyStateView(icon: "photo.stack", title: "Nothing to cull")
                }
            }
            .clipped()
            filmstrip
        }
        .background(Theme.background)
        .sensoryFeedback(trigger: feedback) { _, new in
            guard let new else { return nil }
            return new ? .success : .impact(weight: .medium)
        }
        .task(id: current?.id) { await loadAround() }
        .onChange(of: store.cullFocus) { _, focus in
            // One-shot: consume it so a later undo can point at the same item
            // again — a bare `.onChange` would miss the equal-value repeat.
            guard let focus else { return }
            store.cullFocus = nil
            if let i = items.firstIndex(where: { $0.id == focus }), i != index {
                withAnimation(.snappy) { index = i; frameIndex = 0 }
            }
        }
        .onChange(of: items.count) { _, n in index = min(index, max(0, n - 1)) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { if let card = current { itemMenu(card) } }
        }
    }

    // MARK: Frame

    private func frameView(_ card: CullCard) -> some View {
        let file = card.frames.indices.contains(frameIndex) ? card.frames[frameIndex] : card.frames.first
        let image = file.flatMap { photos[$0] } ?? card.thumbnail
        return ZoomableImage(image: image, zoomed: $zoomed) {
            guard card.frames.count > 1 else { return }
            frameIndex = (frameIndex + 1) % card.frames.count
        }
        .simultaneousGesture(zoomed ? nil : swipeGesture(card))
    }

    private func swipeGesture(_ card: CullCard) -> some Gesture {
        DragGesture(minimumDistance: 20)
            .onChanged { v in
                guard abs(v.translation.width) > abs(v.translation.height) else { return }
                swipe = v.translation.width
            }
            .onEnded { v in
                let w = v.translation.width + v.predictedEndTranslation.width * 0.2
                guard abs(w) > 110 else {
                    withAnimation(.snappy) { swipe = 0 }
                    return
                }
                let pass = w > 0
                feedback = nil; feedback = pass
                store.decide(card.id, passed: pass)
                withAnimation(.easeIn(duration: 0.16)) { swipe = pass ? 600 : -600 } completion: {
                    frameIndex = 0
                    if index < items.count - 1 {
                        withAnimation(.snappy(duration: 0.2)) { index += 1 }
                        swipe = 0
                    } else {
                        // Deciding the last card keeps it on screen: spring back.
                        withAnimation(.snappy) { swipe = 0 }
                    }
                }
            }
    }

    @ViewBuilder private var verdictStamp: some View {
        if abs(swipe) > 30 {
            let pass = swipe > 0
            Label(pass ? "PASS" : "REJECT", systemImage: pass ? "checkmark" : "xmark")
                .font(.headline.weight(.heavy))
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background((pass ? Theme.emerald : Theme.danger).opacity(0.85), in: Capsule())
                .foregroundStyle(.black)
                .opacity(min(1, Double(abs(swipe) - 30) / 80))
                .padding(.top, 60)
        }
    }

    private func infoBar(_ card: CullCard) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(card.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)
                BadgeChip(text: card.passed ? "Pass" : "Reject", tint: card.passed ? Theme.emerald : Theme.danger, filled: true)
                if card.frames.count > 1 {
                    Text("\(frameIndex + 1)/\(card.frames.count)")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Theme.secondaryText)
                }
            }
            Text(card.detail).font(.caption).foregroundStyle(Theme.secondaryText)
            if !card.warnings.isEmpty {
                HStack(spacing: 4) {
                    ForEach(card.warnings, id: \.self) {
                        BadgeChip(text: $0, tint: Theme.warning, icon: "exclamationmark.triangle.fill")
                    }
                }
            }
        }
        .padding(10)
        .background(.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .padding(12)
        .allowsHitTesting(false)
    }

    private func itemMenu(_ card: CullCard) -> some View {
        Menu {
            Button { store.merge(card.id) } label: { Label("Merge with next", systemImage: "arrow.triangle.merge") }
                .disabled(index >= items.count - 1)
            Button {
                if card.frames.indices.contains(frameIndex) { store.split(card.id, at: card.frames[frameIndex]) }
            } label: { Label("Split here", systemImage: "scissors") }
                .disabled(frameIndex == 0)
            Divider()
            Button { store.decide(card.id, passed: !card.passed) } label: {
                Label(card.passed ? "Reject" : "Pass", systemImage: card.passed ? "xmark" : "checkmark")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
    }

    // MARK: Filmstrip

    private var filmstrip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 6) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { i, card in
                        CullThumb(card: card, selected: i == index)
                            .id(card.id)
                            .onTapGesture {
                                withAnimation(.snappy) { index = i; frameIndex = 0 }
                            }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
            .frame(height: 78)
            .background(Theme.card)
            .onChange(of: index) { _, i in
                guard items.indices.contains(i) else { return }
                withAnimation(.snappy) { proxy.scrollTo(items[i].id, anchor: .center) }
            }
        }
    }

    // MARK: Loading

    /// Current item's frames first, then the next three items' first frames.
    private func loadAround() async {
        guard let card = current else { return }
        var files = card.frames
        for i in (index + 1)..<min(items.count, index + 4) { files += items[i].frames.prefix(1) }
        for file in files where photos[file] == nil && !loading.contains(file) {
            loading.insert(file)
            let img = await store.photo(file)
            loading.remove(file)
            if let img { photos[file] = img }
            if Task.isCancelled { return }
        }
    }
}

private struct CullThumb: View {
    let card: CullCard
    let selected: Bool

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let t = card.thumbnail {
                    Image(uiImage: t).resizable().scaledToFill()
                } else {
                    Theme.cardRaised.overlay(Image(systemName: "photo").foregroundStyle(Theme.tertiaryText))
                }
            }
            .frame(width: 72, height: 54)
            .clipped()
            .opacity(card.passed ? 1 : 0.35)
            Image(systemName: card.passed ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(card.passed ? Theme.emerald : Theme.danger)
                .background(Circle().fill(.black))
                .padding(3)
        }
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(selected ? Theme.primaryText : Theme.border, lineWidth: selected ? 2 : 0.5)
        )
        .contentShape(Rectangle())
    }
}

/// Aspect-fit image with pinch zoom, pan while zoomed, double tap to fit.
/// `onTap` fires for single taps (the cull screen steps frames with it).
struct ZoomableImage: View {
    let image: UIImage?
    @Binding var zoomed: Bool
    var onTap: () -> Void = {}

    @State private var scale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @GestureState private var pinch: CGFloat = 1
    @GestureState private var pan: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            Group {
                if let image {
                    Image(uiImage: image).resizable().interpolation(.medium).scaledToFit()
                } else {
                    ProgressView().tint(Theme.secondaryText)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .scaleEffect(scale * pinch)
            .offset(x: offset.width + pan.width, y: offset.height + pan.height)
            .contentShape(Rectangle())
            .gesture(
                MagnifyGesture()
                    .updating($pinch) { v, s, _ in s = v.magnification }
                    .onEnded { v in
                        scale = min(6, max(1, scale * v.magnification))
                        if scale == 1 { offset = .zero }
                        zoomed = scale > 1
                    }
            )
            .simultaneousGesture(
                scale > 1 ? DragGesture()
                    .updating($pan) { v, s, _ in s = v.translation }
                    .onEnded { v in offset.width += v.translation.width; offset.height += v.translation.height }
                : nil
            )
            .onTapGesture(count: 2) {
                withAnimation(.snappy) {
                    if scale > 1 { scale = 1; offset = .zero } else { scale = 2.5 }
                    zoomed = scale > 1
                }
            }
            .onTapGesture(perform: onTap)
        }
    }
}

#Preview {
    NavigationStack {
        CullScreen(store: .mock())
            .navigationBarTitleDisplayMode(.inline)
    }
    .preferredColorScheme(.dark)
}

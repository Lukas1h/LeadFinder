import SwiftUI

/// The web's `PhotoCarousel` (`src/app/PhotoCarousel.tsx`): a swipeable frame
/// with arrow controls and a "No photo" state. On the web a horizontal swipe
/// is a navigation gesture and must not also count as a tap, so the tap is
/// suppressed for a moment after a swipe.
struct PhotoCarousel: View {
    let photos: [String]
    var alt: String = ""
    /// Arrows are hover-only on the web, which is useless on touch, so the
    /// full-size context (a detail screen) shows them. Cards don't: on a phone
    /// you swipe the photo anyway, and arrows just cover it.
    var alwaysShowControls: Bool = false
    /// The frame's shape. Fixing this is what stops the photo stretching: a
    /// plain height on a fill-mode image lets it distort, and the web's carousel
    /// is 3:2 for the same reason.
    var aspectRatio: CGFloat = 3.0 / 2.0
    var onTap: (() -> Void)?

    @State private var index = 0
    @State private var swipedAt: Date?

    var body: some View {
        Group {
            if photos.isEmpty {
                emptyFrame
            } else {
                image
            }
        }
        .frame(maxWidth: .infinity)
        .aspectRatio(aspectRatio, contentMode: .fit)
        .background(Theme.cardRaised)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .onTapGesture {
            // A swipe ends with the finger lifting, which SwiftUI would otherwise
            // deliver as a tap on top of the page change.
            if let swipedAt, Date().timeIntervalSince(swipedAt) < 0.5 { return }
            onTap?()
        }
    }

    private var image: some View {
        TabView(selection: $index) {
            ForEach(photos.indices, id: \.self) { photoIndex in
                AsyncImage(url: URL(string: photos[photoIndex])) { phase in
                    switch phase {
                    case let .success(image):
                        image.resizable().scaledToFill()
                    case .empty:
                        ZStack {
                            Theme.cardRaised
                            ProgressView().controlSize(.small)
                        }
                    default:
                        ZStack {
                            Theme.cardRaised
                            Image(systemName: "photo").foregroundStyle(Theme.tertiaryText)
                        }
                    }
                }
                // scaledToFill crops rather than stretches, but only once the
                // page is clipped to the frame.
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .tag(photoIndex)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .onChange(of: index) { _, _ in swipedAt = Date() }
        .overlay(alignment: .bottomTrailing) {
            if photos.count > 1, alwaysShowControls { arrows }
        }
        .overlay(alignment: .bottomLeading) {
            if photos.count > 1 {
                Text("\(index + 1)/\(photos.count)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.black.opacity(0.55), in: Capsule())
                    .padding(8)
            }
        }
        .accessibilityLabel(alt.isEmpty ? "Listing photos" : alt)
    }

    private var arrows: some View {
        HStack(spacing: 4) {
            arrowButton("chevron.left") { step(-1) }
            arrowButton("chevron.right") { step(1) }
        }
        .opacity(alwaysShowControls ? 1 : 0.9)
        .padding(8)
    }

    private func arrowButton(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(.black.opacity(0.55), in: Circle())
        }
        .buttonStyle(.plain)
    }

    private var emptyFrame: some View {
        VStack(spacing: 4) {
            Image(systemName: "photo.badge.exclamationmark")
                .font(.subheadline)
            Text("No photo")
                .font(.caption2)
        }
        .foregroundStyle(Theme.tertiaryText)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private func step(_ delta: Int) {
        withAnimation(.snappy(duration: 0.2)) {
            index = (index + delta + photos.count) % photos.count
        }
        swipedAt = Date()
    }
}

/// The web samples five photos across the whole set rather than taking the
/// first few exterior shots — `sampleCardPhotos` in AgentLeadCard.tsx. Same
/// sampling here, so the app and the web show the same spread.
enum PhotoSampling {
    static let maxCardPhotos = 5

    static func card(_ photos: [String]) -> [String] {
        guard photos.count > maxCardPhotos else { return photos }
        let last = photos.count - 1
        let indexes = (0..<maxCardPhotos).map { Int((Double($0) * Double(last) / Double(maxCardPhotos - 1)).rounded()) }
        var seen = Set<Int>()
        return indexes.filter { seen.insert($0).inserted }.map { photos[$0] }
    }
}
import ImageIO
import SwiftUI
import UIKit

/// Listing photos, loaded once and kept.
///
/// `AsyncImage` keeps nothing between appearances, so scrolling back up the
/// Leads list downloaded and decoded every photo again, and a full-size Zillow
/// photo (~500 KB, 1536 px) decoded on the main thread is what made the list
/// stutter. This downloads through a large disk cache, decodes off the main
/// thread at the size the frame actually needs, and keeps decoded images in
/// memory, with one download per URL however many views ask for it.
actor ImagePipeline {
    static let shared = ImagePipeline()

    // NSCache is thread-safe, so the synchronous memory check can skip the actor.
    nonisolated(unsafe) private let memory = NSCache<NSURL, UIImage>()
    private var inFlight: [URL: Task<UIImage?, Never>] = [:]
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 32 << 20, diskCapacity: 300 << 20)
        config.requestCachePolicy = .returnCacheDataElseLoad
        // A stalled download should fail and be retried, not hold a blank frame for a minute.
        config.timeoutIntervalForRequest = 20
        return URLSession(configuration: config)
    }()

    init() {
        memory.totalCostLimit = 120 << 20
    }

    nonisolated func cached(_ url: URL) -> UIImage? {
        memory.object(forKey: url as NSURL)
    }

    func image(for url: URL, maxPixel: CGFloat) async -> UIImage? {
        if let hit = memory.object(forKey: url as NSURL) { return hit }
        if let task = inFlight[url] { return await task.value }

        let session = self.session
        let task = Task<UIImage?, Never>.detached(priority: .userInitiated) {
            let request = URLRequest(url: url)
            guard let (data, response) = try? await session.data(for: request) else { return nil }
            if (response as? HTTPURLResponse)?.statusCode == 200, let image = Self.downsample(data, maxPixel: maxPixel) {
                return image
            }
            // The session hands back whatever is on disk without asking the
            // server again, so an error page left there would be this photo
            // forever. Drop it and let the next try go to the network.
            session.configuration.urlCache?.removeCachedResponse(for: request)
            return nil
        }
        inFlight[url] = task
        let image = await task.value
        inFlight[url] = nil
        if let image {
            let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
            memory.setObject(image, forKey: url as NSURL, cost: cost)
        }
        return image
    }

    /// Starts loading photos a little ahead of the scroll, so they're ready
    /// when their card arrives.
    nonisolated func prefetch(_ urls: [URL], maxPixel: CGFloat) {
        for url in urls where cached(url) == nil {
            Task(priority: .utility) { _ = await image(for: url, maxPixel: maxPixel) }
        }
    }

    private static func downsample(_ data: Data, maxPixel: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
        else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// How big a photo needs to be where it's shown.
enum PhotoSize {
    /// A card or thumbnail: Zillow's 768 px rendition, a quarter of the bytes.
    case card
    /// A detail screen: the full photo.
    case full

    var maxPixel: CGFloat { self == .card ? 900 : 1600 }

    /// Zillow serves the same photo at several sizes by suffix; anything else
    /// is used as is.
    func url(_ string: String) -> URL? {
        guard self == .card, string.contains("photos.zillowstatic.com") else { return URL(string: string) }
        return URL(string: string.replacingOccurrences(
            of: #"-[a-z_0-9]+\.(jpg|webp)$"#,
            with: "-cc_ft_768.jpg",
            options: .regularExpression
        ))
    }
}

/// A photo that fills its frame, from the shared pipeline.
struct RemoteImage: View {
    let url: URL?
    var size: PhotoSize = .full
    /// Tried when `url` won't load: the original photo behind a smaller rendition.
    var fallback: URL?

    @Environment(\.scenePhase) private var scenePhase
    @State private var loaded: Loaded?
    @State private var failed = false
    @State private var attempt = 0

    private struct Loaded {
        let url: URL
        let image: UIImage
    }

    private struct LoadKey: Equatable {
        let url: URL?
        let attempt: Int
    }

    /// A photo by its address, at the size the frame needs, falling back to
    /// the original if that rendition is missing.
    init(photo: String, size: PhotoSize = .full) {
        let original = URL(string: photo)
        url = size.url(photo)
        self.size = size
        fallback = original == url ? nil : original
    }

    private var current: UIImage? {
        guard let url else { return nil }
        if let loaded, loaded.url == url { return loaded.image }
        return ImagePipeline.shared.cached(url)
    }

    var body: some View {
        ZStack {
            if let current {
                Image(uiImage: current).resizable().scaledToFill()
            } else {
                Theme.cardRaised
                if failed {
                    Image(systemName: "photo").foregroundStyle(Theme.tertiaryText)
                }
            }
        }
        .task(id: LoadKey(url: url, attempt: attempt)) { await load() }
        // Coming back to the app (or back online) is the moment to try a photo
        // that never arrived again.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, current == nil { attempt += 1 }
        }
    }

    private func load() async {
        guard let url else { return }
        failed = false
        // Held in the view's own state even on a cache hit. The memory cache
        // is emptied whenever the app goes to the background and under memory
        // pressure, and a photo that lived only there went blank with nothing
        // left to load it again.
        if let hit = ImagePipeline.shared.cached(url) {
            loaded = Loaded(url: url, image: hit)
            return
        }
        for delay in [0.0, 1.0, 3.0] {
            if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
            if Task.isCancelled { return }
            for candidate in [url, fallback].compactMap({ $0 }) {
                if let image = await ImagePipeline.shared.image(for: candidate, maxPixel: size.maxPixel) {
                    loaded = Loaded(url: url, image: image)
                    return
                }
            }
        }
        failed = !Task.isCancelled
    }
}

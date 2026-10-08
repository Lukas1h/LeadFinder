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
            guard let (data, _) = try? await session.data(from: url) else { return nil }
            return Self.downsample(data, maxPixel: maxPixel)
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

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image = image ?? url.flatMap({ ImagePipeline.shared.cached($0) }) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Theme.cardRaised
                if failed {
                    Image(systemName: "photo").foregroundStyle(Theme.tertiaryText)
                }
            }
        }
        .task(id: url) {
            guard let url, ImagePipeline.shared.cached(url) == nil else { return }
            failed = false
            image = await ImagePipeline.shared.image(for: url, maxPixel: size.maxPixel)
            failed = image == nil
        }
    }
}

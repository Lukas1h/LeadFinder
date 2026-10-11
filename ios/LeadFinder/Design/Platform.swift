import Foundation
import SwiftUI

#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// The one place the app is allowed to know which platform it is on.
///
/// The iPhone app and the Mac app compile the same `API/`, `Store/`, `Design/`
/// and `Features/` sources. Everything that genuinely differs — a keyboard, a
/// pasteboard, opening a URL, an image type — is expressed here once, so a
/// shared view reads the same on both and the platform detail lives in a single
/// file.

#if os(macOS)
typealias PlatformImage = NSImage
#else
typealias PlatformImage = UIImage
#endif

// MARK: - Text input

/// What kind of value a field holds. Only the keyboard and the autofill hint
/// change between platforms; on the Mac both are no-ops and the field is an
/// ordinary text field.
enum KeyboardKind {
    case `default`
    case phone
    case email
    case number
    case decimal
}

/// The autofill hint for a field. iOS uses it to offer a saved phone number or
/// address; macOS has no equivalent, so it does nothing there.
enum ContentKind {
    case name
    case phone
    case email
    case streetAddress
}

enum Autocapitalization {
    case never
    case words
    case sentences
    case characters
}

#if os(iOS)
extension KeyboardKind {
    var uiKeyboardType: UIKeyboardType {
        switch self {
        case .default: .default
        case .phone: .phonePad
        case .email: .emailAddress
        case .number: .numberPad
        case .decimal: .decimalPad
        }
    }
}

extension ContentKind {
    var uiTextContentType: UITextContentType {
        switch self {
        case .name: .name
        case .phone: .telephoneNumber
        case .email: .emailAddress
        case .streetAddress: .streetAddressLine1
        }
    }
}
#endif

/// How a navigation bar draws its title. Inline is the iPhone's small centred
/// title; a Mac window has one big title and no such choice.
enum TitleDisplayMode {
    case inline
    case automatic
}

extension View {
    @ViewBuilder
    func keyboard(_ kind: KeyboardKind) -> some View {
        #if os(iOS)
        self.keyboardType(kind.uiKeyboardType)
        #else
        self
        #endif
    }

    @ViewBuilder
    func contentType(_ kind: ContentKind) -> some View {
        #if os(iOS)
        self.textContentType(kind.uiTextContentType)
        #else
        self
        #endif
    }

    @ViewBuilder
    func autocapitalization(_ style: Autocapitalization) -> some View {
        #if os(iOS)
        switch style {
        case .never: self.textInputAutocapitalization(.never)
        case .words: self.textInputAutocapitalization(.words)
        case .sentences: self.textInputAutocapitalization(.sentences)
        case .characters: self.textInputAutocapitalization(.characters)
        }
        #else
        self
        #endif
    }

    @ViewBuilder
    func titleDisplay(_ mode: TitleDisplayMode) -> some View {
        #if os(iOS)
        self.navigationBarTitleDisplayMode(mode == .inline ? .inline : .automatic)
        #else
        self
        #endif
    }

    /// Search lives in the navigation bar on a phone and in the toolbar on a
    /// Mac; the placement is the only difference.
    @ViewBuilder
    func searchField(text: Binding<String>, prompt: String) -> some View {
        #if os(iOS)
        self.searchable(text: text, placement: .navigationBarDrawer(displayMode: .always), prompt: prompt)
        #else
        self.searchable(text: text, placement: .toolbar, prompt: prompt)
        #endif
    }

    /// Puts a list into reordering mode. iOS only shows drag handles while an
    /// `EditMode` is in the environment; a Mac `List` is dragged directly, so
    /// there is nothing to switch — the caller's own toggle still drives the
    /// button that turns it on.
    @ViewBuilder
    func reorderMode(_ isEditing: Binding<Bool>) -> some View {
        #if os(iOS)
        let editMode = Binding<EditMode>(
            get: { isEditing.wrappedValue ? .active : .inactive },
            set: { isEditing.wrappedValue = $0.isEditing }
        )
        self.environment(\.editMode, editMode)
        #else
        self
        #endif
    }
}

/// Wraps a screen in a `NavigationStack` only when it needs one.
///
/// A shared detail view is a sheet on the phone, so it brings its own stack and
/// its own Done button. The same view filling the Mac window's detail column
/// must not: the column is already inside the split view's navigation, and a
/// second stack would nest a title bar inside the window's.
struct NavigationStackIfNeeded: ViewModifier {
    let isInDetailColumn: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if isInDetailColumn {
            content
        } else {
            NavigationStack { content }
        }
    }
}

extension View {
    /// See `NavigationStackIfNeeded`.
    func navigationStackIfNeeded(_ isInDetailColumn: Bool) -> some View {
        modifier(NavigationStackIfNeeded(isInDetailColumn: isInDetailColumn))
    }
}

// MARK: - Toolbar

extension ToolbarItemPlacement {
    /// The trailing edge of the bar. On a phone that's the navigation bar's
    /// right-hand button; on a Mac the same intent is the window's primary
    /// action, which sits at the end of the unified toolbar.
    static var trailingBar: ToolbarItemPlacement {
        #if os(iOS)
        .topBarTrailing
        #else
        .primaryAction
        #endif
    }

    /// The leading edge. iOS's navigation bar button, or the toolbar's
    /// navigation area on a Mac.
    static var leadingBar: ToolbarItemPlacement {
        #if os(iOS)
        .topBarLeading
        #else
        .navigation
        #endif
    }
}

// MARK: - System services

@MainActor
enum Platform {
    /// Hands a URL to whatever handles it: the dialer, Mail, Safari. On iOS
    /// that has to go through `UIApplication`; on the Mac `NSWorkspace` is both
    /// simpler and the documented way.
    static func open(_ url: URL) {
        #if os(iOS)
        UIApplication.shared.open(url)
        #else
        NSWorkspace.shared.open(url)
        #endif
    }

    static var pasteboardString: String? {
        #if os(iOS)
        UIPasteboard.general.string
        #else
        NSPasteboard.general.string(forType: .string)
        #endif
    }

    /// "The app went away" — iOS sends this to the background, the Mac when it
    /// loses key window. Used to tell a real phone call from a cancelled prompt.
    static var didLeaveForeground: Notification.Name {
        #if os(iOS)
        UIApplication.didEnterBackgroundNotification
        #else
        NSApplication.didResignActiveNotification
        #endif
    }

    static var didEnterForeground: Notification.Name {
        #if os(iOS)
        UIApplication.didBecomeActiveNotification
        #else
        NSApplication.didBecomeActiveNotification
        #endif
    }
}

// MARK: - Images

#if os(iOS)
extension UIImage {
    /// The Mac's version of this lives on `PlatformImage` itself; on iOS
    /// `UIImage(cgImage:)` is the platform's own initialiser.
    convenience init?(downsampled data: Data, maxPixel: CGFloat) {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceShouldCacheImmediately: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: maxPixel,
              ] as CFDictionary)
        else { return nil }
        self.init(cgImage: cg)
    }
}
#endif

extension PlatformImage {
    /// Decoded from bytes at no more than `maxPixel` on the long edge.
    ///
    /// On iOS this is the platform's own initialiser; on the Mac it needs a
    /// size, so it is a static factory rather than an initialiser.
    static func downsampling(_ data: Data, maxPixel: CGFloat) -> PlatformImage? {
        #if os(iOS)
        return PlatformImage(downsampled: data, maxPixel: maxPixel)
        #else
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceShouldCacheImmediately: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: maxPixel,
              ] as CFDictionary)
        else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
        #endif
    }

    /// Size in pixels, for the memory cache's cost. `UIImage`'s `cgImage` and
    /// `NSImageRep`'s own `pixelsWide`/`pixelsHigh` are both ways of asking the
    /// same thing about an image that was decoded at a known size.
    var pixelSize: CGSize {
        #if os(iOS)
        guard let cg = cgImage else { return size }
        return CGSize(width: cg.width, height: cg.height)
        #else
        guard let rep = representations.first, rep.pixelsWide > 0, rep.pixelsHigh > 0 else { return size }
        return CGSize(width: rep.pixelsWide, height: rep.pixelsHigh)
        #endif
    }

    /// Resized so the long edge is at most `longEdge`, keeping the aspect
    /// ratio. The orientation is baked in on the way through.
    func resized(longEdge: CGFloat) -> PlatformImage {
        let current = pixelSize
        let scale = min(1, longEdge / max(current.width, current.height))
        let target = CGSize(
            width: max(1, (current.width * scale).rounded()),
            height: max(1, (current.height * scale).rounded())
        )
        #if os(iOS)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
        #else
        let image = NSImage(size: target)
        image.lockFocus()
        NSGraphicsContext.current?.imageInterpolation = .high
        draw(in: NSRect(origin: .zero, size: target),
             from: NSRect(origin: .zero, size: current),
             operation: .copy,
             fraction: 1)
        image.unlockFocus()
        return image
        #endif
    }

    /// JPEG at the given quality. Named differently from `UIImage`'s own
    /// `jpegData(compressionQuality:)` on purpose: an extension method with the
    /// same signature would call itself. On the Mac `NSImage` has no encoder at
    /// all, so it goes through a bitmap representation.
    func encodedJPEG(quality: CGFloat) -> Data? {
        #if os(iOS)
        return self.jpegData(compressionQuality: quality)
        #else
        guard let tiff = tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff)
        else { return nil }
        return bitmap.representation(
            using: .jpeg,
            properties: [.compressionFactor: quality]
        )
        #endif
    }

    var swiftUIImage: Image {
        #if os(iOS)
        Image(uiImage: self)
        #else
        Image(nsImage: self)
        #endif
    }
}
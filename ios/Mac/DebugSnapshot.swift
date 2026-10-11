#if DEBUG
import AppKit
import SwiftUI

/// `-snapshot /tmp/out.png [-page leads] [-snapshot-delay 6]` draws the window's
/// own view hierarchy to a PNG and quits. Debug builds only: it exists so the
/// window can be looked at without Screen Recording permission or anyone
/// clicking.
@MainActor
enum DebugSnapshot {
    private static func value(after flag: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }

    static var page: Page? {
        value(after: "-page").flatMap { Page(rawValue: $0) }
    }

    static func scheduleIfRequested() {
        guard let path = value(after: "-snapshot") else { return }
        let delay = value(after: "-snapshot-delay").flatMap(Double.init) ?? 6
        Task {
            try? await Task.sleep(for: .seconds(delay))
            guard let view = NSApp.windows.first(where: { $0.contentView != nil && $0.isVisible })?.contentView?.superview
                ?? NSApp.windows.first?.contentView
            else { exit(2) }
            // A sheet is a window of its own; capture it beside the main one.
            if let sheet = NSApp.windows.first(where: { $0.sheetParent != nil }), let content = sheet.contentView?.superview {
                if let rep = content.bitmapImageRepForCachingDisplay(in: content.bounds) {
                    content.cacheDisplay(in: content.bounds, to: rep)
                    let sheetPath = path.replacingOccurrences(of: ".png", with: "-sheet.png")
                    try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: sheetPath))
                }
            }
            let bounds = view.bounds
            guard let rep = view.bitmapImageRepForCachingDisplay(in: bounds) else { exit(3) }
            view.cacheDisplay(in: bounds, to: rep)
            if let png = rep.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: path))
            }
            exit(0)
        }
    }
}
#endif

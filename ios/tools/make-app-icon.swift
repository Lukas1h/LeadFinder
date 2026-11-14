// Generates the LeadFinder app icon (light, dark, tinted) into the asset catalog.
// Run from ios/: swift tools/make-app-icon.swift
import AppKit
import CoreGraphics

let S: CGFloat = 1024
let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1]
    : "LeadFinder/Resources/Assets.xcassets/AppIcon.appiconset"

func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: a)
}

// Location pin: circle head + tapered point, centered.
func pinPath() -> CGPath {
    let p = CGMutablePath()
    let cx = S / 2, cy: CGFloat = 590, r: CGFloat = 270   // y up
    let tipY: CGFloat = 170
    // tangent points from tip to circle
    let d = cy - tipY
    let ang = asin(r / d)
    let a1 = -CGFloat.pi / 2 + (.pi / 2 - ang) // right tangent angle
    let a2 = -CGFloat.pi / 2 - (.pi / 2 - ang) // left tangent angle
    p.move(to: CGPoint(x: cx, y: tipY))
    p.addLine(to: CGPoint(x: cx + r * cos(a1), y: cy + r * sin(a1)))
    p.addArc(center: CGPoint(x: cx, y: cy), radius: r, startAngle: a1, endAngle: a2 + 2 * .pi, clockwise: false)
    p.closeSubpath()
    return p
}

// House glyph inside the pin head.
func housePath() -> CGPath {
    let p = CGMutablePath()
    let cx = S / 2, base: CGFloat = 480, w: CGFloat = 220, wallH: CGFloat = 125, roofH: CGFloat = 125
    let eave: CGFloat = 30
    p.move(to: CGPoint(x: cx - w / 2, y: base))
    p.addLine(to: CGPoint(x: cx - w / 2, y: base + wallH))
    p.addLine(to: CGPoint(x: cx - w / 2 - eave, y: base + wallH))
    p.addLine(to: CGPoint(x: cx, y: base + wallH + roofH))
    p.addLine(to: CGPoint(x: cx + w / 2 + eave, y: base + wallH))
    p.addLine(to: CGPoint(x: cx + w / 2, y: base + wallH))
    p.addLine(to: CGPoint(x: cx + w / 2, y: base))
    // door notch
    p.addLine(to: CGPoint(x: cx + 32, y: base))
    p.addLine(to: CGPoint(x: cx + 32, y: base + 78))
    p.addLine(to: CGPoint(x: cx - 32, y: base + 78))
    p.addLine(to: CGPoint(x: cx - 32, y: base))
    p.closeSubpath()
    return p
}

enum Variant { case light, dark, tinted }

func render(_ v: Variant) -> Data {
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(data: nil, width: Int(S), height: Int(S), bitsPerComponent: 8, bytesPerRow: 0,
                        space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let full = CGRect(x: 0, y: 0, width: S, height: S)

    // Background
    switch v {
    case .light:
        let g = CGGradient(colorsSpace: cs, colors: [rgb(14, 92, 222), rgb(28, 170, 214), rgb(52, 211, 178)] as CFArray,
                           locations: [0, 0.6, 1])!
        ctx.drawLinearGradient(g, start: CGPoint(x: 0, y: S), end: CGPoint(x: S, y: 0), options: [])
        // soft top glow
        let glow = CGGradient(colorsSpace: cs, colors: [rgb(255, 255, 255, 0.28), rgb(255, 255, 255, 0)] as CFArray, locations: [0, 1])!
        ctx.drawRadialGradient(glow, startCenter: CGPoint(x: S * 0.3, y: S * 0.95), startRadius: 0,
                               endCenter: CGPoint(x: S * 0.3, y: S * 0.95), endRadius: S * 0.75, options: [])
    case .dark:
        let g = CGGradient(colorsSpace: cs, colors: [rgb(30, 34, 44), rgb(10, 11, 15)] as CFArray, locations: [0, 1])!
        ctx.drawLinearGradient(g, start: CGPoint(x: 0, y: S), end: CGPoint(x: 0, y: 0), options: [])
    case .tinted:
        ctx.setFillColor(rgb(0, 0, 0)); ctx.fill(full)
    }

    let pin = pinPath(), house = housePath()

    // Drop shadow for depth
    if v != .tinted {
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -18), blur: 50, color: rgb(0, 20, 60, v == .dark ? 0.6 : 0.35))
        ctx.addPath(pin); ctx.setFillColor(rgb(255, 255, 255)); ctx.fillPath()
        ctx.restoreGState()
    }

    // Pin fill (glyph)
    ctx.saveGState()
    ctx.addPath(pin); ctx.clip()
    let pinColors: [CGColor]
    switch v {
    case .light: pinColors = [rgb(255, 255, 255), rgb(226, 238, 250)]
    case .dark:  pinColors = [rgb(110, 200, 255), rgb(60, 205, 180)]
    case .tinted: pinColors = [rgb(255, 255, 255), rgb(200, 200, 200)]
    }
    let pg = CGGradient(colorsSpace: cs, colors: pinColors as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(pg, start: CGPoint(x: 0, y: 860), end: CGPoint(x: 0, y: 170), options: [])
    // glass highlight on head
    let hl = CGGradient(colorsSpace: cs, colors: [rgb(255, 255, 255, v == .light ? 0.0 : 0.25), rgb(255, 255, 255, 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(hl, startCenter: CGPoint(x: 430, y: 760), startRadius: 0,
                           endCenter: CGPoint(x: 430, y: 760), endRadius: 260, options: [])
    ctx.restoreGState()

    // House cut-out: punch with background-ish color
    ctx.saveGState()
    ctx.addPath(house); ctx.clip()
    switch v {
    case .light:
        let hg = CGGradient(colorsSpace: cs, colors: [rgb(14, 92, 222), rgb(24, 150, 220)] as CFArray, locations: [0, 1])!
        ctx.drawLinearGradient(hg, start: CGPoint(x: 0, y: 730), end: CGPoint(x: 0, y: 480), options: [])
    case .dark:
        ctx.setFillColor(rgb(16, 18, 24)); ctx.fill(full)
    case .tinted:
        ctx.setFillColor(rgb(0, 0, 0)); ctx.fill(full)
    }
    ctx.restoreGState()

    let img = ctx.makeImage()!
    let rep = NSBitmapImageRep(cgImage: img)
    return rep.representation(using: .png, properties: [:])!
}

for (v, name) in [(Variant.light, "AppIcon.png"), (.dark, "AppIcon-Dark.png"), (.tinted, "AppIcon-Tinted.png")] {
    try! render(v).write(to: URL(fileURLWithPath: outDir + "/" + name))
    print("wrote \(name)")
}

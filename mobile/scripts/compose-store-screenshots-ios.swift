import AppKit
import Foundation
// Genuine Simulator images in; copy-framed and captioned JPEG images out.
// Do not alter the separate App Store subscription review screenshot.
let headlines: [(String, String)] = [
  ("01-daily-decision.jpg", "What would you pick?"),
  ("02-reveal-comparison.jpg", "See what the trophy drafter took"),
  ("03-daily-hub.jpg", "Three new Dailies every day"),
  ("04-leaderboard.jpg", "Same picks. Compare scores."),
  ("05-practice.jpg", "Practice between Dailies")
]
guard CommandLine.arguments.count == 2 else { fatalError("Need screenshot root") }
let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
for device in ["iphone", "ipad"] {
  for (filename, caption) in headlines {
    let url = root.appendingPathComponent(device).appendingPathComponent(filename)
    guard let source = NSImage(contentsOf: url),
          let data = source.tiffRepresentation,
          let sourceRep = NSBitmapImageRep(data: data) else { fatalError("Missing native scene: " + url.path) }
    let width = sourceRep.pixelsWide, height = sourceRep.pixelsHigh
    guard width >= 1200 && height >= 2700 else { fatalError("Unexpected capture dimensions") }
    guard let canvas = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
      bytesPerRow: 0, bitsPerPixel: 0),
      let context = NSGraphicsContext(bitmapImageRep: canvas) else { fatalError("No image context") }
    let w = CGFloat(width), h = CGFloat(height), header = CGFloat(height) * 0.19
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    NSColor(calibratedRed: 0.964, green: 0.969, blue: 0.978, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: w, height: h).fill()
    let scale = min(0.89, (h - header - 12) / h)
    let shownW = w * scale, shownH = h * scale
    let screenshotFrame = NSRect(x: (w - shownW) / 2, y: 12, width: shownW, height: shownH)
    source.draw(in: screenshotFrame, from: .zero, operation: .copy, fraction: 1)
    NSColor(calibratedWhite: 0.75, alpha: 1).setStroke()
    NSBezierPath(rect: screenshotFrame).stroke()
    let margin = w * 0.06
    let brand = NSAttributedString(string: "PACK ONE", attributes: [
      .font: NSFont.systemFont(ofSize: w * 0.025, weight: .bold),
      .foregroundColor: NSColor(calibratedRed: 0.31, green: 0.41, blue: 0.58, alpha: 1)
    ])
    brand.draw(at: NSPoint(x: margin, y: h - header + header * 0.71))
    let headline = NSAttributedString(string: caption, attributes: [
      .font: NSFont.systemFont(ofSize: w * 0.051, weight: .bold),
      .foregroundColor: NSColor(calibratedRed: 0.10, green: 0.14, blue: 0.2, alpha: 1)
    ])
    headline.draw(in: NSRect(x: margin, y: h - header + header * 0.12, width: w - 2 * margin, height: header * 0.49))
    NSGraphicsContext.restoreGraphicsState()
    guard let jpeg = canvas.representation(using: .jpeg, properties: [.compressionFactor: 0.91]), jpeg.count > 100000 else {
      fatalError("Blank composed screenshot: " + filename)
    }
    try jpeg.write(to: url, options: .atomic)
    print(device + "/" + filename + ": " + String(width) + "x" + String(height))
  }
}

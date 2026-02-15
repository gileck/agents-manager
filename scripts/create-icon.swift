#!/usr/bin/swift
import Cocoa

// Create a simple task manager icon
let size = 1024
let image = NSImage(size: NSSize(width: size, height: size))

image.lockFocus()

// Background - rounded rectangle with gradient
let rect = NSRect(x: 0, y: 0, width: size, height: size)
let path = NSBezierPath(roundedRect: rect.insetBy(dx: 50, dy: 50), xRadius: 180, yRadius: 180)

// Gradient background (blue to purple)
let gradient = NSGradient(colors: [
    NSColor(red: 0.2, green: 0.4, blue: 0.9, alpha: 1.0),
    NSColor(red: 0.5, green: 0.2, blue: 0.8, alpha: 1.0)
])!
gradient.draw(in: path, angle: -45)

// Draw a checkmark/task symbol
let checkPath = NSBezierPath()
checkPath.lineWidth = 80
checkPath.lineCapStyle = .round
checkPath.lineJoinStyle = .round

// Checkmark
checkPath.move(to: NSPoint(x: 280, y: 520))
checkPath.line(to: NSPoint(x: 420, y: 380))
checkPath.line(to: NSPoint(x: 720, y: 680))

NSColor.white.setStroke()
checkPath.stroke()

// Draw horizontal lines (task list)
NSColor.white.withAlphaComponent(0.7).setStroke()
let lineY = [320, 240, 160]
for y in lineY {
    let linePath = NSBezierPath()
    linePath.lineWidth = 40
    linePath.lineCapStyle = .round
    linePath.move(to: NSPoint(x: 280, y: y))
    linePath.line(to: NSPoint(x: 720, y: y))
    linePath.stroke()
}

image.unlockFocus()

// Save as PNG
if let tiffData = image.tiffRepresentation,
   let bitmapRep = NSBitmapImageRep(data: tiffData),
   let pngData = bitmapRep.representation(using: .png, properties: [:]) {

    let url = URL(fileURLWithPath: "assets/icon.png")
    try? pngData.write(to: url)
    print("Created icon.png")
}

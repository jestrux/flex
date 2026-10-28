// flex read: the text in an image or a PDF, by macOS's own text recognition (Vision, the engine behind Live Text). Offline.
// Compiled once by flex-core (crates/flex-core/src/read.rs) into the support folder.
//   ocr <file> [--fast] [--lang en-US,…]   → stdout: one JSON object
//   ocr --batch [--fast] [--lang …]        → a file path per stdin line, a JSON object per stdout line (flex reading:
//                                            hundreds of frames in one process; a file that fails gives {"error": …})
// { width, height, pages, lines: [{ text, confidence, page, box: { x, y, w, h } }] }; boxes in the image's pixels, origin top
// left (a PDF page is rendered at 2×: its pixels). Lines in reading order: top to bottom, then left to right.
import AppKit
import PDFKit
import Vision

let args = CommandLine.arguments
guard args.count > 1 else { FileHandle.standardError.write("usage: ocr <image|pdf> [--fast] [--lang en-US] | ocr --batch\n".data(using: .utf8)!); exit(2) }
let batch = args[1] == "--batch"
let fast = args.contains("--fast")
let langs = args.firstIndex(of: "--lang").flatMap { $0 + 1 < args.count ? args[$0 + 1].split(separator: ",").map(String.init) : nil }

struct Failure: Error { let m: String }
func fail(_ m: String) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(1) }

/// the pages as images: a PDF's pages rendered at 2×, else the image itself
func pages(_ url: URL) throws -> [CGImage] {
    if url.pathExtension.lowercased() == "pdf" {
        guard let doc = PDFDocument(url: url) else { throw Failure(m: "can't open the PDF") }
        return (0..<doc.pageCount).compactMap { i in
            guard let p = doc.page(at: i) else { return nil }
            let r = p.bounds(for: .mediaBox), s: CGFloat = 2
            let img = NSImage(size: NSSize(width: r.width * s, height: r.height * s))
            img.lockFocus()
            NSColor.white.set(); NSRect(origin: .zero, size: img.size).fill()
            if let ctx = NSGraphicsContext.current?.cgContext { ctx.scaleBy(x: s, y: s); p.draw(with: .mediaBox, to: ctx) }
            img.unlockFocus()
            return img.cgImage(forProposedRect: nil, context: nil, hints: nil)
        }
    }
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { throw Failure(m: "can't read the image") }
    return [img]
}

func read(_ url: URL) throws -> [String: Any] {
var lines: [[String: Any]] = []
var size = (w: 0, h: 0)
let imgs = try pages(url)
for (pi, img) in imgs.enumerated() {
    if pi == 0 { size = (img.width, img.height) }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = fast ? .fast : .accurate
    req.usesLanguageCorrection = true
    if let langs { req.recognitionLanguages = langs }
    do { try VNImageRequestHandler(cgImage: img, options: [:]).perform([req]) } catch { throw Failure(m: "recognition failed: \(error)") }
    let W = Double(img.width), H = Double(img.height)
    var page: [[String: Any]] = []
    for o in req.results ?? [] {
        guard let c = o.topCandidates(1).first else { continue }
        let b = o.boundingBox // normalised, origin bottom left
        page.append(["text": c.string, "confidence": (Double(c.confidence) * 100).rounded() / 100, "page": pi + 1,
                     "box": ["x": (b.minX * W).rounded(), "y": ((1 - b.maxY) * H).rounded(), "w": (b.width * W).rounded(), "h": (b.height * H).rounded()]])
    }
    // reading order: rows (centres within half a line height of each other), then left to right
    page.sort { a, b in
        let ba = a["box"] as! [String: Double], bb = b["box"] as! [String: Double]
        let ya = ba["y"]! + ba["h"]! / 2, yb = bb["y"]! + bb["h"]! / 2
        if abs(ya - yb) > min(ba["h"]!, bb["h"]!) / 2 { return ya < yb }
        return ba["x"]! < bb["x"]!
    }
    lines += page
}
return ["width": size.w, "height": size.h, "pages": imgs.count, "lines": lines]
}

func emit(_ o: [String: Any]) {
    FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]))
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}
if batch {
    while let l = readLine() {
        let path = l.trimmingCharacters(in: .whitespaces)
        if path.isEmpty { continue }
        do { emit(try read(URL(fileURLWithPath: path))) } catch let e as Failure { emit(["error": e.m]) } catch { emit(["error": "\(error)"]) }
    }
} else {
    do { emit(try read(URL(fileURLWithPath: args[1]))) } catch let e as Failure { fail(e.m) } catch { fail("\(error)") }
}

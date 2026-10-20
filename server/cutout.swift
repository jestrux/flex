// flex cutout: where the person is in a picture, by macOS Vision (offline). Compiled once by flex-core
// (crates/flex-core/src/cutout.rs) into the support folder; flex-core does the smoothing, defringe and encoding.
//
// The mask: Vision's foreground-instance mask (Lift Subject: clean hair and arm edges) limited to where its person
// segmentation, grown a little, says there's a person, so signs, lights and props behind her drop out (the "both"
// mask of the first films' cutout.swift). `--keep-text`: the foreground mask alone. No foreground found: the person mask alone.
//
//   cutout stream <W> <H> [--keep-text]   stdin: W×H RGBA8 frames, one after another, until EOF
//                                         stdout per frame: 1 flag byte, then W×H mask bytes (0–255, rows top first)
//   cutout photo <file> [--keep-text]     stdout: u32 LE W, u32 LE H, W×H×4 RGBA8 (sRGB, upright), 1 flag byte, W×H mask
// flag: 0 = the mask asked for (foreground ∩ person; with --keep-text the foreground), 1 = the person mask alone (no
// foreground found), 2 = nobody found
import CoreImage
import Foundation
import Vision

func fail(_ m: String) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(1) }

let args = CommandLine.arguments
let keepText = args.contains("--keep-text")
let ctx = CIContext()
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

/// The mask for one upright picture, at its own size, as bytes (rows top first).
func mask(rgba: Data, w: Int, h: Int) -> (UInt8, Data) {
    let src = CIImage(bitmapData: rgba, bytesPerRow: w * 4, size: CGSize(width: w, height: h), format: .RGBA8, colorSpace: srgb)
    let handler = VNImageRequestHandler(ciImage: src)
    let fgReq = VNGenerateForegroundInstanceMaskRequest()
    let personReq = VNGeneratePersonSegmentationRequest()
    personReq.qualityLevel = .accurate
    personReq.outputPixelFormat = kCVPixelFormatType_OneComponent8
    do { try handler.perform(keepText ? [fgReq] : [fgReq, personReq]) } catch { fail("Vision: \(error.localizedDescription)") }
    let extent = src.extent
    var fg: CIImage? = nil
    if let obs = fgReq.results?.first, !obs.allInstances.isEmpty,
       let pb = try? obs.generateScaledMaskForImage(forInstances: obs.allInstances, from: handler) { fg = CIImage(cvPixelBuffer: pb) }
    var person: CIImage? = nil
    if !keepText, let pb = personReq.results?.first?.pixelBuffer { person = CIImage(cvPixelBuffer: pb) }
    let fit = { (m: CIImage) in m.transformed(by: CGAffineTransform(scaleX: extent.width / m.extent.width, y: extent.height / m.extent.height)) }
    var flag: UInt8 = 2
    var m: CIImage? = nil
    if let f = fg, let p = person {
        // the person mask grown ~1.2 % of the long side (10 px at 848) and softened, so it only limits, never cuts her edge
        let grow = max(10.0, Double(max(w, h)) * 0.012)
        let pm = fit(p).clampedToExtent()
            .applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": grow])
            .applyingFilter("CIGaussianBlur", parameters: ["inputRadius": grow * 0.4]).cropped(to: extent)
        m = fit(f).applyingFilter("CIMultiplyCompositing", parameters: ["inputBackgroundImage": pm])
        flag = 0
    } else if let one = fg ?? person { m = fit(one); flag = keepText ? 0 : 1 }
    var out = Data(count: w * h)
    if let m = m {
        out.withUnsafeMutableBytes { p in
            ctx.render(m.cropped(to: extent), toBitmap: p.baseAddress!, rowBytes: w, bounds: extent, format: .L8, colorSpace: nil)
        }
    }
    return (flag, out)
}

func readFull(_ n: Int) -> Data? {
    var d = Data(count: n)
    var got = 0
    let ok = d.withUnsafeMutableBytes { (p: UnsafeMutableRawBufferPointer) -> Bool in
        while got < n {
            let r = read(0, p.baseAddress! + got, n - got)
            if r <= 0 { return false }
            got += r
        }
        return true
    }
    if !ok { if got == 0 { return nil }; fail("a frame was cut short (\(got) of \(n) bytes)") }
    return d
}

let out = FileHandle.standardOutput
func le32(_ v: Int) -> Data { var x = UInt32(v).littleEndian; return Data(bytes: &x, count: 4) }

switch args.count > 1 ? args[1] : "" {
case "stream":
    guard args.count > 3, let w = Int(args[2]), let h = Int(args[3]), w > 0, h > 0 else { fail("usage: cutout stream <W> <H> [--keep-text]") }
    while let frame = readFull(w * h * 4) {
        let (flag, m) = autoreleasepool { mask(rgba: frame, w: w, h: h) }
        out.write(Data([flag])); out.write(m)
    }
case "photo":
    guard args.count > 2 else { fail("usage: cutout photo <file> [--keep-text]") }
    let url = URL(fileURLWithPath: args[2])
    guard var img = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) else { fail("can't read the image") }
    img = img.transformed(by: CGAffineTransform(translationX: -img.extent.minX, y: -img.extent.minY))
    let w = Int(img.extent.width.rounded()), h = Int(img.extent.height.rounded())
    var rgba = Data(count: w * h * 4)
    rgba.withUnsafeMutableBytes { p in
        ctx.render(img, toBitmap: p.baseAddress!, rowBytes: w * 4, bounds: CGRect(x: 0, y: 0, width: w, height: h), format: .RGBA8, colorSpace: srgb)
    }
    // the picture as a plain opaque image (a PNG with alpha is cut out by its colour, not its old alpha)
    rgba.withUnsafeMutableBytes { p in let b = p.bindMemory(to: UInt8.self); for i in stride(from: 3, to: b.count, by: 4) { b[i] = 255 } }
    let (flag, m) = mask(rgba: rgba, w: w, h: h)
    out.write(le32(w)); out.write(le32(h)); out.write(rgba); out.write(Data([flag])); out.write(m)
default:
    fail("usage: cutout stream <W> <H> [--keep-text] | cutout photo <file> [--keep-text]")
}

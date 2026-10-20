// flex crop: where the subject is in a photo, by macOS Vision (faces and people). Offline.
// Compiled once by flex-core (crates/flex-core/src/crop.rs) into the support folder.
//   subject <image>   → stdout: one JSON object
// { width, height, faces: [{ x, y, w, h, confidence }], people: [{ x, y, w, h, confidence }] }; boxes in the image's
// pixels as it is shown (its EXIF orientation applied), origin top left; each list largest first.
import Foundation
import ImageIO
import Vision

let args = CommandLine.arguments
guard args.count > 1 else { FileHandle.standardError.write("usage: subject <image>\n".data(using: .utf8)!); exit(2) }
let url = URL(fileURLWithPath: args[1])

func fail(_ m: String) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(1) }

guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fail("can't read the image") }
let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
let raw = (props?[kCGImagePropertyOrientation] as? NSNumber)?.uint32Value ?? 1
let orientation = CGImagePropertyOrientation(rawValue: raw) ?? .up
// the shown size: orientations 5–8 turn the picture a quarter
let turned = raw >= 5 && raw <= 8
let W = Double(turned ? img.height : img.width), H = Double(turned ? img.width : img.height)

let faces = VNDetectFaceRectanglesRequest()
let people = VNDetectHumanRectanglesRequest()
if #available(macOS 12.0, *) { people.upperBodyOnly = false }
do { try VNImageRequestHandler(cgImage: img, orientation: orientation, options: [:]).perform([faces, people]) } catch { fail("detection failed: \(error)") }

// Vision's boxes are normalised to the oriented image, origin bottom left
func boxes(_ obs: [VNDetectedObjectObservation]) -> [[String: Double]] {
    obs.map { o -> [String: Double] in
        let b = o.boundingBox
        return ["x": (b.minX * W * 10).rounded() / 10, "y": ((1 - b.maxY) * H * 10).rounded() / 10,
                "w": (b.width * W * 10).rounded() / 10, "h": (b.height * H * 10).rounded() / 10,
                "confidence": (Double(o.confidence) * 100).rounded() / 100]
    }.sorted { $0["w"]! * $0["h"]! > $1["w"]! * $1["h"]! }
}
let out: [String: Any] = ["width": Int(W), "height": Int(H), "faces": boxes(faces.results ?? []), "people": boxes(people.results ?? [])]
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]))
FileHandle.standardOutput.write("\n".data(using: .utf8)!)

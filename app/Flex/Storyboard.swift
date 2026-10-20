import SwiftUI
import AppKit

/// The film's storyboard: its script (script.json, flex_core::script) on the timeline as a lane of panels, and in the
/// viewer as an animatic: wherever the film isn't built (a beat the script marks a sketch, or past the film's end, where
/// the plan goes on), the viewer shows the beat's panel instead of a frame. The panels are the film's own work (sketches
/// its maker draws); Flex only places and shows them.

/// What the viewer shows for a frame the film doesn't have yet.
struct StorySketch: Equatable {
    /// the panel's picture (nil: the beat has no panel, or its sketch is missing)
    let image: NSImage?
    let file: String?
    let beat: String
    let caption: String?
    /// past the film's end
    let planned: Bool
    let missing: String?

    static func == (a: StorySketch, b: StorySketch) -> Bool {
        a.file == b.file && a.beat == b.beat && a.caption == b.caption && a.planned == b.planned && a.missing == b.missing && (a.image == nil) == (b.image == nil)
    }
}

extension ProjectStore {
    /// panels are drawn this wide for the viewer and the lane
    nonisolated static let sketchWidth: UInt32 = 960

    /// Read the script and draw its sketches (an SVG is rendered by the engine and cached by content), off the main thread.
    func loadScript() {
        let e = engine
        Task.detached {
            let sc = e.script()
            var files: [String: String] = [:]
            for b in sc?.beats ?? [] {
                for p in b.panels where p.found && files[p.sketch] == nil {
                    if let f = e.sketchPng(sketch: p.sketch, width: Self.sketchWidth) { files[p.sketch] = f }
                }
            }
            let images = files.compactMapValues { NSImage(contentsOfFile: $0) }
            let drawn = files
            await MainActor.run {
                self.script = sc
                self.sketches = images
                self.sketchFiles = drawn
                self.player.plannedFrames = Int(((sc?.length ?? 0) * Double(self.player.fps)).rounded())
                // -startAt past the film's end: it was clamped to the film until the plan was known
                let start = UserDefaults.standard.integer(forKey: "startAt")
                if start >= self.player.frames && start < self.player.total && self.player.frame != start { self.player.seek(start) }
                self.player.refresh()
            }
        }
    }

    /// The panel the viewer shows at `frame`: in a beat the script marks a sketch (not built), or past the film's end.
    func storySketch(at frame: Int) -> StorySketch? {
        guard let sc = script else { return nil }
        let t = Double(frame) / Double(max(1, player.fps))
        let past = frame >= player.frames
        guard let b = sc.beats.first(where: { t >= $0.start - 1e-6 && t < $0.end }) ?? (past ? sc.beats.last(where: { $0.start <= t }) : nil),
              past || b.status != "built" else { return nil }
        let p = b.panels.first(where: { t >= $0.start - 1e-6 && t < $0.end }) ?? b.panels.last(where: { $0.start <= t }) ?? b.panels.first
        return StorySketch(image: p.flatMap { sketches[$0.sketch] }, file: p.flatMap { sketchFiles[$0.sketch] }, beat: b.title,
                           caption: p?.caption, planned: past || b.planned, missing: p.flatMap { $0.found ? nil : $0.sketch })
    }

    /// the plan's length when it runs past the film (seconds), else nil
    var plannedLength: Double? {
        guard let sc = script, sc.length > sc.duration + 0.01 else { return nil }
        return sc.length
    }
}

/// The storyboard lane: each beat as a band over its bars (its title; planned beats dashed), each panel's sketch as a
/// thumbnail across its stretch. Hover for the beat's bars, its narration and the panel's caption.
struct StoryboardLane: View {
    @ObservedObject var store: ProjectStore
    let script: ScriptInfo
    let xt: (Double) -> CGFloat
    let y: CGFloat
    let height: CGFloat
    let width: CGFloat

    var body: some View {
        // past the film's end: the plan, shaded across every lane above
        if script.length > script.duration + 0.01 {
            let x0 = xt(script.duration)
            Rectangle().fill(Color.primary.opacity(0.05))
                .overlay(alignment: .topLeading) {
                    Text("planned").font(.system(size: 8, weight: .semibold)).foregroundStyle(.secondary).padding(3)
                }
                .frame(width: max(0, width - x0), height: y + height)
                .offset(x: x0)
                .allowsHitTesting(false)
        }
        ForEach(Array(script.beats.enumerated()), id: \.offset) { _, b in
            let x0 = xt(b.start), w = max(3, xt(b.end) - x0 - 2)
            let built = b.status == "built" && !b.planned
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.primary.opacity(built ? 0.06 : 0.1))
                ForEach(Array(b.panels.enumerated()), id: \.offset) { _, p in
                    let px = xt(p.start) - x0, pw = max(2, xt(p.end) - xt(p.start) - 1)
                    Group {
                        if let img = store.sketches[p.sketch] {
                            Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
                        } else {
                            Rectangle().fill(Color.red.opacity(0.25))
                                .overlay(Image(systemName: "questionmark").font(.system(size: 9)).foregroundStyle(.red))
                        }
                    }
                    .frame(width: pw, height: height - 2)
                    .clipped()
                    .opacity(built ? 0.45 : 1)
                    .offset(x: px, y: 1)
                    .help(panelHelp(b, p))
                }
                Text(b.title).font(.system(size: 9, weight: .semibold)).lineLimit(1)
                    .padding(.horizontal, 4).padding(.vertical, 1)
                    .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 3))
                    .foregroundStyle(.white)
                    .padding(2)
                    .allowsHitTesting(false)
            }
            .frame(width: w, height: height, alignment: .topLeading)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4)
                .strokeBorder(b.planned ? Color.accentColor.opacity(0.8) : built ? Color.clear : Color.primary.opacity(0.35),
                              style: StrokeStyle(lineWidth: 1, dash: b.planned ? [4, 3] : [])))
            .offset(x: x0, y: y)
            .help(beatHelp(b))
        }
    }

    private func beatHelp(_ b: ScriptBeat) -> String {
        var s = "\(b.title) · \(b.at)–\(b.to) (\(Fmt.time(b.start))–\(Fmt.time(b.end))) · \(b.planned ? "planned past the film's end" : b.status)"
        for l in b.narration { s += "\n\(l.at) “\(l.text)”" }
        return s
    }

    private func panelHelp(_ b: ScriptBeat, _ p: ScriptPanel) -> String {
        var s = beatHelp(b) + "\n\(p.found ? p.sketch : "no sketch at \(p.sketch)")"
        if let c = p.caption { s += "\n\(c)" }
        return s
    }
}

/// The viewer's animatic: a panel's sketch letterboxed on the stage, its beat and caption under it; a card with the
/// beat's title when it has no picture.
struct StorySketchView: View {
    let sketch: StorySketch

    var body: some View {
        ZStack {
            Rectangle().fill(Color(white: 0.96))
            if let img = sketch.image {
                Image(nsImage: img).resizable().interpolation(.high).aspectRatio(contentMode: .fit)
            } else {
                VStack(spacing: 6) {
                    Image(systemName: "pencil.and.scribble").font(.system(size: 30, weight: .light))
                    Text(sketch.beat).font(.title3.weight(.semibold))
                    if let m = sketch.missing { Text("no sketch at \(m)").font(.caption).foregroundStyle(.red) }
                }
                .foregroundStyle(.black.opacity(0.55))
            }
        }
        .overlay(alignment: .top) {
            if sketch.image != nil {
                Text([sketch.beat, sketch.caption].compactMap { $0 }.joined(separator: " · "))
                    .font(.callout.weight(.medium)).foregroundStyle(.white).lineLimit(2)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 6))
                    .padding(.top, 10)
            }
        }
    }
}

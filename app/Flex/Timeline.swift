import SwiftUI

/// The film along one axis, top to bottom:
/// - the song's sections (verse, chorus …, from the project's markers);
/// - a ruler: the bar grid (every 4th bar stronger), the song's hits, the music edit's joins;
/// - the scenes, each with its paint bar, and a dot on every scene boundary (green when the cut
///   is seamless, red when the picture jumps);
/// - the storyboard: the script's beats and their panels (Storyboard.swift), when the project has a script.json;
/// - the camera: each take's zoom segments (upper row) and effects (lower row), as the film paints them; click one to
///   edit it (the take's edl.json);
/// - the music edit's waveform;
/// - the narration.
/// Click or drag to scrub; double-click a scene to loop it.
struct Timeline: View {
    let project: ProjectInfo
    @ObservedObject var store: ProjectStore
    @ObservedObject var player: Player

    // lane geometry (points from the top)
    private let sectionsY: CGFloat = 0, sectionsH: CGFloat = 14
    private let rulerY: CGFloat = 17, rulerH: CGFloat = 11
    private let scenesY: CGFloat = 31
    private let waveH: CGFloat = 24, voiceH: CGFloat = 16, cameraH: CGFloat = 17, storyH: CGFloat = 30
    @State private var editing: CameraTarget?

    var body: some View {
        GeometryReader { geo in
            // the film, or the plan when the script plans beats past its end
            let frames = max(1, Int(store.snapshot?.frames ?? UInt32(project.duration * 30)), player.plannedFrames)
            let fps = Double(store.snapshot?.fps ?? 30)
            let width = geo.size.width
            let x = { (f: Double) in CGFloat(f / Double(frames)) * width }
            let xt = { (t: Double) in x(t * fps) }
            let voiceY = geo.size.height - voiceH
            let waveY = voiceY - 3 - waveH
            let cameraY = waveY - 3 - cameraH
            let storyY = cameraY - (store.script == nil ? 0 : 3 + storyH)
            let scenesH = storyY - 3 - scenesY
            ZStack(alignment: .topLeading) {
                sections(xt: xt, width: width)
                ruler(xt: xt, width: width)
                scenes(x: x, fps: fps, height: scenesH)
                joinDots(x: x, fps: fps, y: scenesY + scenesH - 10)
                cutMarks(xt: xt, y: scenesY - 3)
                camera(xt: xt, y: cameraY)
                if let sc = store.script { StoryboardLane(store: store, script: sc, xt: xt, y: storyY, height: storyH, width: width) }
                Waveform(peaks: store.peaks, perSecond: Double(ProjectStore.peaksPerSecond), duration: Double(frames) / fps)
                    .frame(width: width, height: waveH)
                    .offset(y: waveY)
                    .allowsHitTesting(false)
                if store.showDuck { duck(xt: xt, y: waveY) }
                voice(xt: xt, y: voiceY)
                // the playhead
                Rectangle().fill(Color.red).frame(width: 2, height: geo.size.height)
                    .offset(x: x(Double(player.frame)) - 1)
                    .allowsHitTesting(false)
            }
            .contentShape(Rectangle())
            .onChange(of: store.camera.count) {
                // -editCamera <take>:<id>: open that block's editor once the plan is in (for scripts)
                if editing == nil, let t = UserDefaults.standard.string(forKey: "editCamera"), let i = t.firstIndex(of: ":"),
                   store.camera.contains(where: { $0.take == String(t[..<i]) }) {
                    editing = CameraTarget(take: String(t[..<i]), id: String(t[t.index(after: i)...]))
                }
            }
            .gesture(DragGesture(minimumDistance: 0).onChanged { v in
                let f = Int((v.location.x / width * CGFloat(frames)).rounded())
                if player.playing { player.pause() }
                player.seek(f)
                store.selected = store.scene(at: f)?.id
            })
        }
    }

    // MARK: lanes

    @ViewBuilder private func sections(xt: @escaping (Double) -> CGFloat, width: CGFloat) -> some View {
        let secs = store.markers?.sections ?? []
        ForEach(Array(secs.enumerated()), id: \.offset) { i, s in
            let x0 = xt(s.start), x1 = s.end.map(xt) ?? width
            RoundedRectangle(cornerRadius: 3)
                .fill(Color.primary.opacity(i % 2 == 0 ? 0.10 : 0.06))
                .overlay(alignment: .leading) {
                    Text(s.id).font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary).lineLimit(1).padding(.horizontal, 4)
                }
                .frame(width: max(2, x1 - x0 - 1), height: sectionsH)
                .offset(x: x0, y: sectionsY)
                .help("Section \(s.id): \(Fmt.time(s.start)) – \(s.end.map(Fmt.time) ?? "end")")
        }
    }

    @ViewBuilder private func ruler(xt: @escaping (Double) -> CGFloat, width: CGFloat) -> some View {
        // the project's own bars, else the film grid's (the song's beats through the music edit: flex music)
        let bars = (store.markers?.bars).flatMap { $0.isEmpty ? nil : $0 } ?? store.filmBars
        let joins = (store.markers?.joins).flatMap { $0.isEmpty ? nil : $0 } ?? project.joins
        // the bar grid: light ticks, every 4th stronger
        Canvas { ctx, size in
            for (i, t) in bars.enumerated() {
                let strong = i % 4 == 0
                let h: CGFloat = strong ? size.height : size.height * 0.45
                ctx.fill(Path(CGRect(x: xt(t), y: size.height - h, width: 1, height: h)),
                         with: .color(.secondary.opacity(strong ? 0.6 : 0.3)))
            }
            // the music edit's joins: where the song is spliced
            for t in joins {
                ctx.fill(Path(CGRect(x: xt(t) - 0.5, y: 0, width: 2, height: size.height)), with: .color(.blue.opacity(0.75)))
            }
        }
        .frame(width: width, height: rulerH)
        .offset(y: rulerY)
        .allowsHitTesting(false)
        // the song's own hits (flex music), when chosen in the Hits menu: entries as rings, a stem's onsets sized by strength
        if store.hitView != "declared" {
            let shown = store.filmHits.filter { store.hitView == "entries" ? $0.entry : ($0.stem == store.hitView && !$0.entry) }
            ForEach(Array(shown.enumerated()), id: \.offset) { _, h in
                let d: CGFloat = h.entry ? 9 : 3 + 4 * h.strength
                Circle()
                    .strokeBorder(Color.yellow.opacity(h.entry ? 0.95 : 0), lineWidth: 1.5)
                    .background(Circle().fill(Color.yellow.opacity(h.entry ? 0 : 0.35 + 0.6 * h.strength)))
                    .frame(width: d, height: d)
                    .offset(x: xt(h.t) - d / 2, y: rulerY)
                    .help("\(h.stem) \(h.entry ? "comes in" : "hit, strength \(String(format: "%.2f", h.strength))") at \(h.at) (\(Fmt.time(h.t)))")
            }
        }
        // hits: small markers, labelled on hover
        ForEach(Array((store.hitView == "declared" ? store.markers?.hits ?? [] : []).enumerated()), id: \.offset) { _, h in
            Image(systemName: "arrowtriangle.down.fill")
                .font(.system(size: 6))
                .foregroundStyle(Color.orange)
                .frame(width: 8, height: 8)
                .contentShape(Rectangle())
                .offset(x: xt(h.t) - 4, y: rulerY - 1)
                .help("Hit “\(h.label)” at \(Fmt.time(h.t))")
        }
    }

    @ViewBuilder private func scenes(x: @escaping (Double) -> CGFloat, fps: Double, height: CGFloat) -> some View {
        let scenes = store.snapshot?.scenes ?? []
        ForEach(Array(scenes.enumerated()), id: \.element.id) { i, s in
            let x0 = x(Double(s.first)), w = max(2, x(Double(s.first + s.frames)) - x0 - 2)
            let on = store.selected == s.id
            let looped = player.loop.map { $0.lowerBound == Int(s.first) } ?? false
            VStack(alignment: .leading, spacing: 3) {
                RoundedRectangle(cornerRadius: 6)
                    .fill(s.error != nil ? Color.red.opacity(on ? 0.9 : 0.7) : Palette.scene(i).opacity(on ? 0.95 : 0.72))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(looped ? Color.white : on ? Color.primary.opacity(0.7) : .clear, lineWidth: 2))
                    .overlay(alignment: .topLeading) {
                        HStack(spacing: 4) {
                            if looped { Image(systemName: "repeat") }
                            Text(s.id).fontWeight(.semibold)
                            if !s.unpaintable.isEmpty { Image(systemName: "film").opacity(0.8) }
                            if s.error != nil { Image(systemName: "exclamationmark.triangle.fill") }
                        }
                        .font(.callout).foregroundStyle(.white).lineLimit(1)
                        .padding(.horizontal, 7).padding(.vertical, 5)
                    }
                // painted share of the scene
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.secondary.opacity(0.2))
                        Capsule().fill(s.unpaintable.isEmpty ? Color.green.opacity(0.75) : Color.secondary.opacity(0.35))
                            .frame(width: s.unpaintable.isEmpty ? g.size.width * CGFloat(s.painted) / CGFloat(max(1, s.frames)) : g.size.width)
                    }
                }
                .frame(height: 4)
            }
            .frame(width: w, height: height)
            .offset(x: x0, y: scenesY)
            .help(s.error.map { "\(s.id) didn't draw: \($0.components(separatedBy: "\n").first ?? "")" }
                  ?? "\(s.id): \(Fmt.code(Int(s.first), fps: Int(fps))) – \(Fmt.code(Int(s.first + s.frames), fps: Int(fps))) · double-click to loop")
            .onTapGesture(count: 2) { store.loop(s.id) }
        }
    }

    /// A mark on each cut (a change of card, take or scene): green within 40 ms of a beat or a declared hit, amber
    /// between beats, white for a cut the project declares deliberate. Measurement, not a verdict.
    @ViewBuilder private func cutMarks(xt: @escaping (Double) -> CGFloat, y: CGFloat) -> some View {
        ForEach(store.cuts, id: \.t) { c in
            let color: Color = c.on ? .green : c.declared ? .white : .orange
            Image(systemName: "arrowtriangle.down.fill")
                .font(.system(size: c.scene ? 8 : 6))
                .foregroundStyle(color)
                .frame(width: 9, height: 8)
                .contentShape(Rectangle())
                .offset(x: xt(c.t) - 4.5, y: y)
                .help("Cut \(c.from) → \(c.to) at \(c.at): \(Int(abs(c.offMs))) ms \(c.offMs < 0 ? "before" : "after") the nearest \(c.target)\(c.on ? "" : c.declared ? " (a declared cut)" : ", between beats")")
        }
    }

    /// A dot on each scene boundary: green seamless, red jumps, grey not checked (yet).
    @ViewBuilder private func joinDots(x: @escaping (Double) -> CGFloat, fps: Double, y: CGFloat) -> some View {
        let joins = store.snapshot?.joins ?? []
        ForEach(joins, id: \.frame) { j in
            let color: Color = j.cut ? .white : j.unknown != nil ? .gray : j.jumps ? .red : .green
            Circle()
                .fill(color)
                .overlay { if j.cut { Image(systemName: "scissors").font(.system(size: 7, weight: .bold)).foregroundStyle(.black) } }
                .overlay(Circle().strokeBorder(Color.black.opacity(0.35), lineWidth: 1))
                .frame(width: 11, height: 11)
                .contentShape(Circle().inset(by: -3))
                .offset(x: x(Double(j.frame)) - 6.5, y: y)
                .help(joinHelp(j, fps: fps))
        }
    }

    private func joinHelp(_ j: JoinCheck, fps: Double) -> String {
        let at = "\(j.prev) → \(j.scene) at \(Fmt.code(Int(j.frame), fps: Int(fps)))"
        if let why = j.unknown { return "\(at): not checked (\(why))" }
        let nums = String(format: "across the cut %.2f/255, just before it %.2f/255 (jumps above %.2f)", j.mean, j.baseline, j.threshold)
        if j.cut { return "\(at): intended cut · \(nums)" }
        return "\(at): \(j.jumps ? "the picture jumps" : "seamless") · \(nums)"
    }

    @ViewBuilder private func camera(xt: @escaping (Double) -> CGFloat, y: CGFloat) -> some View {
        ForEach(store.camera, id: \.filmStart) { c in
            // the clip's stretch of the film, faint, so an empty plan still shows where the take plays
            RoundedRectangle(cornerRadius: 3).fill(Color.primary.opacity(0.05))
                .frame(width: max(2, xt(c.filmEnd) - xt(c.filmStart) - 2), height: cameraH)
                .offset(x: xt(c.filmStart), y: y)
                .allowsHitTesting(false)
            ForEach(c.blocks.filter { $0.endMs / 1000 > c.from && $0.startMs / 1000 < c.to }, id: \.id) { b in
                CameraBlockView(store: store, player: player, clip: c, block: b, xt: xt, y: y, height: cameraH, editing: $editing)
            }
        }
    }

    /// The music's dip under each line (flex duck): a band over the line's span on the music lane, with the dip on it,
    /// and the attack, release, pumping and the voice over the music on hover. Numbers only.
    @ViewBuilder private func duck(xt: @escaping (Double) -> CGFloat, y: CGFloat) -> some View {
        ForEach(Array(store.duck.enumerated()), id: \.offset) { _, d in
            let x0 = xt(d.t), w = max(3, xt(d.t + d.dur) - x0)
            Rectangle().fill(Color.cyan.opacity(0.18)).frame(width: w, height: waveH)
                .overlay(alignment: .topLeading) {
                    if w > 40, let dip = d.dip { Text("−\(Int(dip.rounded())) dB").font(.system(size: 8, weight: .semibold)).foregroundStyle(.cyan).padding(1) }
                }
                .offset(x: x0, y: y)
                .help(String(format: "Under this line the music dips %.1f dB (attack %@ ms, release %@ ms), pumping %.1f dB, the voice %.1f dB over it",
                             d.dip ?? .nan, d.attackMs.map(String.init) ?? "—", d.releaseMs.map(String.init) ?? "—", d.pumping ?? .nan, d.voiceOverMusic ?? .nan))
        }
    }

    @ViewBuilder private func voice(xt: @escaping (Double) -> CGFloat, y: CGFloat) -> some View {
        ForEach(Array((store.snapshot?.voice ?? []).enumerated()), id: \.offset) { _, v in
            let x0 = xt(v.start), w = max(3, xt(v.start + v.dur) - x0)
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.primary.opacity(0.14))
                .overlay(alignment: .leading) {
                    Text(v.text).font(.caption2).lineLimit(1).padding(.horizontal, 5).foregroundStyle(.secondary)
                }
                .frame(width: w, height: voiceH)
                .offset(x: x0, y: y)
                .help("“\(v.text)” at \(Fmt.time(v.start))")
        }
        // each word, at its film time (flex narration): a tick along the line's top edge (lime when the song sings over it);
        // the word, its bar.beat and how far it is off the beat on hover (the line's text is in the block)
        ForEach(Array(store.words.enumerated()), id: \.offset) { _, w in
            Rectangle().fill(w.overSinging ? Color.yellow : Color.primary.opacity(0.5)).frame(width: 1.5, height: 5)
                .frame(width: 7, height: 6).contentShape(Rectangle())
                .offset(x: xt(w.t) - 3, y: y)
                .help("“\(w.word)” at \(w.at) · \(Int(w.offBeatMs)) ms from the beat\(w.overSinging ? " · the song sings here" : "")")
        }
    }
}

/// The music edit's peaks, mirrored around the middle, one line per point of width.
struct Waveform: View {
    let peaks: [Float]
    let perSecond: Double
    let duration: Double

    var body: some View {
        Canvas { ctx, size in
            guard !peaks.isEmpty, duration > 0, size.width > 0 else { return }
            let mid = size.height / 2
            var path = Path()
            let cols = Int(size.width)
            for c in 0..<cols {
                let a = Int(Double(c) / Double(cols) * duration * perSecond)
                let b = max(a + 1, Int(Double(c + 1) / Double(cols) * duration * perSecond))
                guard a < peaks.count else { break }
                let p = peaks[a..<min(b, peaks.count)].max() ?? 0
                let h = max(0.5, CGFloat(p) * mid)
                path.addRect(CGRect(x: CGFloat(c), y: mid - h, width: 1, height: h * 2))
            }
            ctx.fill(path, with: .color(.secondary.opacity(0.55)))
        }
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 4))
    }
}

struct CameraTarget: Equatable { let take: String; let id: String }

/// One camera block, edited in the take's edl.json: nudge its start, end or both by a frame or a beat, turn it off, lock
/// the plan. The engine reloads on the save and repaints only what moved.
struct CameraEditor: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var player: Player
    let clip: CameraClip
    let block: CameraBlockInfo

    /// the live block (it changes as edits land)
    private var live: CameraBlockInfo { store.camera.first { $0.take == clip.take }?.blocks.first { $0.id == block.id } ?? block }
    private var liveClip: CameraClip { store.camera.first { $0.take == clip.take } ?? clip }
    /// a beat: a quarter of the film's bar, else 600 ms
    private var beatMs: Double {
        guard let b = store.markers?.bars, b.count > 1 else { return 600 }
        return (b[1] - b[0]) * 250
    }
    private var frameMs: Double { 1000 / Double(max(1, player.fps)) }

    var body: some View {
        let b = live, c = liveClip
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("\(c.take) · \(b.id)").font(.headline)
                Text(b.label).foregroundStyle(.secondary)
                Spacer()
                Toggle("On", isOn: Binding(get: { b.enabled }, set: { store.editCamera(c.take, b.id, enabled: $0) })).toggleStyle(.switch).controlSize(.small)
            }
            Text("\(Int(b.startMs))–\(Int(b.endMs)) ms of the take · film \(Fmt.time(c.filmStart + b.startMs / 1000 - c.from)) – \(Fmt.time(c.filmStart + b.endMs / 1000 - c.from))")
                .font(.caption).foregroundStyle(.secondary).monospacedDigit()
            Grid(alignment: .leading, horizontalSpacing: 6, verticalSpacing: 6) {
                row("Start") { store.editCamera(c.take, b.id, start: b.startMs + $0) }
                row("End") { store.editCamera(c.take, b.id, end: b.endMs + $0) }
                row("Both") { store.editCamera(c.take, b.id, shift: $0) }
            }
            HStack {
                Button("Go to Start") { player.seek(Int(((c.filmStart + b.startMs / 1000 - c.from) * Double(player.fps)).rounded())) }
                Spacer()
                Toggle("Plan locked", isOn: Binding(get: { c.locked }, set: { store.lockCamera(c.take, $0) }))
                    .help("Locked, a re-capture keeps this plan (shifted to the new take at pick); any edit locks it")
            }
            .controlSize(.small)
            if c.patched {
                Label("The scene patches this take's plan: an edit to edl.json may be changed by the patch.", systemImage: "exclamationmark.triangle")
                    .font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(width: 380)
    }

    private func row(_ name: String, _ by: @escaping (Double) -> Void) -> some View {
        GridRow {
            Text(name).font(.callout).frame(width: 40, alignment: .leading)
            Button("−beat") { by(-beatMs) }
            Button("−frame") { by(-frameMs) }
            Button("+frame") { by(frameMs) }
            Button("+beat") { by(beatMs) }
        }
        .controlSize(.small)
    }
}

/// One block on the camera lane: zooms on the upper row, effects on the lower; click to edit.
struct CameraBlockView: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var player: Player
    let clip: CameraClip
    let block: CameraBlockInfo
    let xt: (Double) -> CGFloat
    let y: CGFloat
    let height: CGFloat
    @Binding var editing: CameraTarget?

    private func film(_ ms: Double) -> Double { clip.filmStart + min(max(ms / 1000, clip.from), clip.to) - clip.from }

    var body: some View {
        let x0 = xt(film(block.startMs)), x1 = xt(film(block.endMs))
        let zoom = block.kind == "zoom"
        let rowH = (height - 1) / 2
        let target = CameraTarget(take: clip.take, id: block.id)
        let color: Color = zoom ? .teal : .purple
        RoundedRectangle(cornerRadius: 2)
            .fill(color.opacity(block.enabled ? 0.8 : 0.25))
            .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(editing == target ? Color.white : Color.clear, lineWidth: 1.5))
            .frame(width: max(3, x1 - x0 - 1), height: rowH)
            .onTapGesture { editing = target }
            // placed by padding, not offset, so the popover points at the block
            .popover(isPresented: Binding(get: { editing == target }, set: { if !$0 { editing = nil } }), arrowEdge: .bottom) {
                CameraEditor(store: store, player: player, clip: clip, block: block)
            }
            .padding(.leading, x0).padding(.top, y + (zoom ? 0 : rowH + 1))
            .help("\(clip.take) \(block.id): \(block.label) · \(Int(block.startMs))–\(Int(block.endMs)) ms of the take · click to edit")
    }
}

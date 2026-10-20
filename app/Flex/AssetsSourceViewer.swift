import SwiftUI
import AppKit
import AVFoundation

/// The source viewer's place beside the film's viewer: nothing until an asset is open, then the asset on its own (audio
/// with its waveform and words, a take as recorded with its timing report, a card looping alone, a still with its
/// element boxes, a render). It plays apart from the film: the film's playhead doesn't move.
struct SourceSlot: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var assets: AssetsStore

    var body: some View {
        if let a = assets.open {
            HStack(spacing: 0) {
                VStack(spacing: 0) {
                    SourceHeader(asset: a, assets: assets)
                    Divider()
                    SourceBody(asset: a, assets: assets)
                        .id(a.id + "@\(a.modified)")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(width: 520)
                Divider()
            }
        }
    }
}

private struct SourceHeader: View {
    let asset: AssetInfo
    @ObservedObject var assets: AssetsStore

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: AssetText.icon(asset.kind)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(asset.title).font(.headline).lineLimit(1).truncationMode(.middle)
                Text(([asset.kind.replacingOccurrences(of: "-", with: " ")] + [AssetText.facts(asset)].filter { !$0.isEmpty }).joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if let m = assets.madeBy[asset.id] { Label("made by \(m)", systemImage: "sparkles").font(.caption2).foregroundStyle(.secondary) }
            }
            Spacer()
            if let f = asset.file {
                Button { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: f)]) } label: { Image(systemName: "folder") }
                    .buttonStyle(.borderless).help("Show \((f as NSString).lastPathComponent) in Finder")
            }
            Button { assets.close() } label: { Image(systemName: "xmark") }
                .buttonStyle(.borderless).help("Close the source viewer")
                .keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }
}

private struct SourceBody: View {
    let asset: AssetInfo
    @ObservedObject var assets: AssetsStore

    var body: some View {
        switch asset.kind {
        case "music", "stem", "sound": AudioSource(asset: asset, assets: assets)
        case "take", "take-version": TakeSource(asset: asset, assets: assets)
        case "card" where asset.cardType != nil: CardSource(asset: asset, assets: assets)
        case "freeze", "still", "sketch", "image": StillSource(asset: asset, assets: assets)
        case "render": VideoSource(file: asset.file, assets: assets, loop: false)
        case "lab": LabSource(asset: asset, assets: assets)
        default: FileSource(asset: asset)
        }
    }
}

// MARK: playing a file

/// An AVPlayer with a clock for the views (30 Hz), muted when the app is.
@MainActor
final class AssetSourcePlayer: ObservableObject {
    @Published var t: Double = 0
    @Published var playing = false
    @Published var duration: Double = 0
    let player: AVPlayer
    private var observer: Any?
    private var ended: NSObjectProtocol?
    private var looper: AVPlayerLooper?

    init(url: URL, loop: Bool = false) {
        if loop {
            let q = AVQueuePlayer()
            looper = AVPlayerLooper(player: q, templateItem: AVPlayerItem(url: url))
            player = q
        } else {
            player = AVPlayer(url: url)
        }
        if UserDefaults.standard.bool(forKey: "mute") { player.isMuted = true }
        ended = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] n in
            MainActor.assumeIsolated {
                guard let self, (n.object as? AVPlayerItem) === self.player.currentItem, self.looper == nil else { return }
                self.playing = false
            }
        }
        observer = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.t = time.seconds
                self.playing = self.player.timeControlStatus != .paused
                if let d = self.player.currentItem?.duration.seconds, d.isFinite { self.duration = d }
            }
        }
    }

    func toggle() {
        if player.timeControlStatus == .paused {
            if duration > 0, t >= duration - 0.05, looper == nil { seek(0) }
            player.play()
        } else { player.pause() }
        playing = player.timeControlStatus != .paused
    }
    func seek(_ s: Double) {
        t = s
        player.seek(to: CMTime(seconds: s, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }
    func stop() {
        player.pause()
        if let observer { player.removeTimeObserver(observer) }
        observer = nil
        if let ended { NotificationCenter.default.removeObserver(ended) }
        ended = nil
    }
    /// the launch args' moment and autoplay, for scripted checks
    func applyLaunch(_ assets: AssetsStore) {
        if let at = assets.launchAt { seek(at) }
        if assets.launchPlay { player.play() }
    }
}

private struct SourceTransport: View {
    @ObservedObject var p: AssetSourcePlayer
    var body: some View {
        HStack(spacing: 10) {
            Button { p.toggle() } label: { Image(systemName: p.playing ? "pause.fill" : "play.fill").frame(width: 16) }
                .buttonStyle(.borderless).keyboardShortcut(.space, modifiers: [.option])
                .help("Play or pause the source (⌥Space)")
            Slider(value: Binding(get: { p.t }, set: { p.seek($0) }), in: 0...max(0.01, p.duration))
                .controlSize(.small)
            Text("\(Fmt.time(p.t)) / \(Fmt.time(p.duration))").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
    }
}

/// Loads something slow (a proxy, a clip) off the main thread; the view shows a line until it's there.
@MainActor
final class AssetPending<T>: ObservableObject {
    @Published var value: T?
    @Published var error: String?
    func load(_ work: @escaping @Sendable () throws -> T) where T: Sendable {
        Task.detached {
            do { let v = try work(); await MainActor.run { self.value = v } }
            catch let FlexError.Failed(m) { await MainActor.run { self.error = m } }
            catch { await MainActor.run { self.error = "\(error)" } }
        }
    }
}

// MARK: audio

private struct AudioSource: View {
    let asset: AssetInfo
    @ObservedObject var assets: AssetsStore
    @StateObject private var p: AssetSourcePlayer
    @State private var peaks: [Float] = []
    @State private var words: [AssetWord] = []
    nonisolated static let perSecond: UInt32 = 100

    init(asset: AssetInfo, assets: AssetsStore) {
        self.asset = asset
        self.assets = assets
        _p = StateObject(wrappedValue: AssetSourcePlayer(url: URL(fileURLWithPath: asset.file ?? "/dev/null")))
    }

    /// the word sounding now, held a moment after it ends (sung words are often shorter than they sound); none in a gap
    private var current: Int? { words.lastIndex { $0.start <= p.t && p.t < max($0.end, $0.start + 0.08) + 0.35 } }

    var body: some View {
        VStack(spacing: 0) {
            WaveView(peaks: peaks, perSecond: Double(Self.perSecond), duration: max(p.duration, asset.duration ?? 0), t: p.t, words: words) { p.seek($0) }
                .frame(height: 150).padding(.horizontal, 12).padding(.top, 12)
            SourceTransport(p: p)
            Divider()
            facts.padding(.horizontal, 12).padding(.vertical, 8)
            Divider()
            if words.isEmpty {
                Text(asset.words == nil ? "No transcription. flex music --lyrics (the track and its lead stem) or flex transcribe <file> makes one."
                     : "Loading the words…")
                    .font(.callout).foregroundStyle(.secondary).padding(14).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                WordsView(words: words, current: current) { p.seek($0) }
            }
        }
        .onAppear {
            let lib = assets.lib, id = asset.id
            Task.detached {
                let pk = (try? lib.peaks(id: id, perSecond: Self.perSecond)) ?? []
                let w = lib.words(id: id)
                await MainActor.run { peaks = pk; words = w; p.applyLaunch(assets) }
            }
        }
        .onDisappear { p.stop() }
    }

    private var facts: some View {
        VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 14) {
            fact("length", asset.duration.map { Fmt.time($0) })
            fact("loudness", asset.lufs.map { String(format: "%.1f LUFS", $0) })
            fact("peak", asset.peak.map { String(format: "%.1f dB", $0) })
            fact("tempo", asset.bpm.map { String(format: "%.1f bpm", $0) })
            fact("words", asset.words.map { "\($0)" })
            if let c = current, let at = words[c].at { fact("bar.beat", at) }
            Spacer()
        }
        if let n = asset.note { Text(n).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
        }
    }

    @ViewBuilder private func fact(_ k: String, _ v: String?) -> some View {
        if let v {
            VStack(alignment: .leading, spacing: 1) {
                Text(k).font(.caption2).foregroundStyle(.secondary)
                Text(v).font(.caption.monospacedDigit())
            }
        }
    }
}

/// The waveform with the playhead and each word's span; a click or a drag seeks.
private struct WaveView: View {
    let peaks: [Float]
    let perSecond: Double
    let duration: Double
    let t: Double
    let words: [AssetWord]
    let seek: (Double) -> Void

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let dur = max(0.001, duration > 0 ? duration : Double(peaks.count) / perSecond)
            let x = { (s: Double) in CGFloat(s / dur) * w }
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 6).fill(Color.black.opacity(0.85))
                Canvas { ctx, size in
                    let mid = (size.height - 14) / 2
                    let n = max(1, Int(size.width))
                    var played = Path(), rest = Path()
                    for i in 0..<n where !peaks.isEmpty {
                        let a = i * peaks.count / n, b = max(a + 1, (i + 1) * peaks.count / n)
                        let v = CGFloat(peaks[min(a, peaks.count - 1)..<min(b, peaks.count)].max() ?? 0)
                        let hh = max(0.5, v * (mid - 4))
                        let r = CGRect(x: CGFloat(i), y: mid - hh, width: 0.8, height: hh * 2)
                        if Double(i) / Double(n) * dur <= t { played.addRect(r) } else { rest.addRect(r) }
                    }
                    ctx.fill(rest, with: .color(Color(red: 0.35, green: 0.66, blue: 0.9).opacity(0.55)))
                    ctx.fill(played, with: .color(Color(red: 0.45, green: 0.75, blue: 1.0)))
                    // the words' spans, under the wave
                    for wd in words {
                        let on = wd.start <= t && t < max(wd.end, wd.start + 0.08)
                        let r = CGRect(x: x(wd.start), y: size.height - 10, width: max(1.5, x(wd.end) - x(wd.start)), height: 4)
                        ctx.fill(Path(r), with: .color(on ? .yellow : Color(red: 0.9, green: 0.72, blue: 0.35).opacity(0.6)))
                    }
                }
                Rectangle().fill(Color.white).frame(width: 1.5, height: h).offset(x: x(t))
                if peaks.isEmpty { ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity) }
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { v in seek(max(0, min(dur, Double(v.location.x / w) * dur))) })
        }
    }
}

/// The words, line by line (as they were heard), the one sounding now lit; a click seeks to a word.
private struct WordsView: View {
    let words: [AssetWord]
    let current: Int?
    let seek: (Double) -> Void

    private var lines: [[Int]] {
        var out: [[Int]] = []
        for (i, w) in words.enumerated() {
            if let last = out.last?.last, words[last].line == w.line { out[out.count - 1].append(i) } else { out.append([i]) }
        }
        return out
    }

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { n, line in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(Fmt.time(words[line[0]].start)).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                                .frame(width: 52, alignment: .trailing)
                                .onTapGesture { seek(words[line[0]].start) }
                            line.reduce(Text("")) { acc, i in
                                let w = words[i]
                                let past = current.map { i < $0 } ?? false
                                let t = Text(w.word + " ")
                                    .foregroundStyle(i == current ? Color.yellow : past ? Color.primary : Color.secondary)
                                    .fontWeight(i == current ? .bold : .regular)
                                return acc + t
                            }
                            .font(.body)
                        }
                        .id(n)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: current) { _, c in
                guard let c, let n = lines.firstIndex(where: { $0.contains(c) }) else { return }
                withAnimation(.easeOut(duration: 0.2)) { scroll.scrollTo(n, anchor: .center) }
            }
        }
    }
}

// MARK: takes

private struct TakeSource: View {
    let asset: AssetInfo
    @ObservedObject var assets: AssetsStore
    @StateObject private var proxy = AssetPending<String>()
    @State private var report: Report?
    @State private var first: NSImage?

    struct Report {
        struct Beat: Identifiable { let id = UUID(); let n: Int; let label: String; let late: Double }
        struct Mark: Identifiable { let id = UUID(); let label: String; let offset: Double; let drift: Double }
        var beats: [Beat] = []
        var marks: [Mark] = []
        var late: Int?
        var worst: Double?
        var against: String?
    }

    var body: some View {
        VStack(spacing: 0) {
            if let file = proxy.value {
                TakePlayer(file: file, assets: assets)
            } else {
                ZStack {
                    Rectangle().fill(Color.black)
                    if let first { Image(nsImage: first).resizable().aspectRatio(contentMode: .fit).opacity(0.6) }
                    VStack(spacing: 6) {
                        if let e = proxy.error { Text(e).font(.caption).foregroundStyle(.orange).padding() }
                        else { ProgressView().controlSize(.small); Text("Making a playable copy of the take…").font(.caption).foregroundStyle(.white.opacity(0.8)) }
                    }
                }
                .aspectRatio(16.0 / 9.0, contentMode: .fit)
                .padding(12)
            }
            Divider()
            ScrollView { details.padding(12).frame(maxWidth: .infinity, alignment: .leading) }
        }
        .onAppear {
            let lib = assets.lib, id = asset.id
            proxy.load { try lib.takeProxy(id: id, width: 1280) }
            if let f = asset.file { first = AssetsStore.downsample(f, max: 960) }
            if let json = lib.report(id: id) { report = Self.parse(json) }
        }
    }

    static func parse(_ json: String) -> Report? {
        guard let o = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { return nil }
        var r = Report()
        r.beats = (o["beats"] as? [[String: Any]] ?? []).map { .init(n: $0["n"] as? Int ?? 0, label: $0["label"] as? String ?? "", late: ($0["late"] as? NSNumber)?.doubleValue ?? 0) }
        r.marks = (o["marks"] as? [[String: Any]] ?? []).map { .init(label: $0["label"] as? String ?? "", offset: ($0["offset"] as? NSNumber)?.doubleValue ?? 0, drift: ($0["drift"] as? NSNumber)?.doubleValue ?? 0) }
        r.late = o["late"] as? Int
        r.worst = (o["worst"] as? NSNumber)?.doubleValue
        r.against = o["against"] as? String
        return r
    }

    @ViewBuilder private var details: some View {
        VStack(alignment: .leading, spacing: 10) {
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 3) {
                row("length", asset.duration.map { Fmt.time($0) })
                row("frames played", asset.frames.map { "\($0) (events.json: what the film plays, after retiming)" })
                row("viewport", asset.width.map { w in "\(w)×\(asset.height ?? 0) @\(asset.dpr.map { String(format: "%g", $0) } ?? "?")x" })
                if asset.kind == "take" { row("pick", asset.version.map { "v\($0)" } ?? "the take as it was (no versions yet)") }
                if asset.kind == "take-version" { row("picked", asset.picked == true ? "yes: the film plays this one" : "no") }
                row("note", asset.note)
            }
            .font(.caption)
            if !asset.versions.isEmpty {
                Text("Versions").font(.caption.weight(.semibold))
                ForEach(asset.versions, id: \.id) { v in
                    Button { if let a = assets.assets.first(where: { $0.id == v.id }) { assets.select(a) } } label: {
                        Text("v\(v.n)\(v.picked ? "  ★ picked" : "")  ·  \(v.duration.map { Fmt.time($0) } ?? "–")  ·  \(v.frames.map { "\($0) frames played" } ?? "")\(v.at.map { "  ·  \($0.prefix(16).replacingOccurrences(of: "T", with: " "))" } ?? "")")
                            .font(.caption)
                    }
                    .buttonStyle(.link)
                }
            }
            if let r = report {
                Text("Timing report\(r.against.map { " (against \($0))" } ?? "")").font(.caption.weight(.semibold))
                Text("\(r.late ?? 0) beats more than 40 ms late · worst \(r.worst.map { String(format: "%g ms", $0) } ?? "–")").font(.caption).foregroundStyle(.secondary)
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 2) {
                    ForEach(r.beats) { b in
                        GridRow { Text("beat \(b.n)"); Text(b.label); Text(String(format: "%+g ms", b.late)).foregroundStyle(b.late > 40 ? .orange : .secondary) }
                    }
                    ForEach(r.marks) { m in
                        GridRow { Text("mark"); Text(m.label); Text(String(format: "%+g ms · drift %+g", m.offset, m.drift)).foregroundStyle(.secondary) }
                    }
                }
                .font(.caption.monospacedDigit())
            } else if asset.kind == "take-version" {
                Text("No timing report (a version recorded by flex capture has one).").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private func row(_ k: String, _ v: String?) -> some View {
        if let v { GridRow { Text(k).foregroundStyle(.secondary); Text(v) } }
    }
}

private struct TakePlayer: View {
    let file: String
    @ObservedObject var assets: AssetsStore
    @StateObject private var p: AssetSourcePlayer
    init(file: String, assets: AssetsStore) {
        self.file = file; self.assets = assets
        _p = StateObject(wrappedValue: AssetSourcePlayer(url: URL(fileURLWithPath: file)))
    }
    var body: some View {
        VStack(spacing: 0) {
            PlayerSurface(player: p.player).aspectRatio(16.0 / 9.0, contentMode: .fit).background(Color.black).padding([.horizontal, .top], 12)
            SourceTransport(p: p)
        }
        .onAppear { p.applyLaunch(assets) }
        .onDisappear { p.stop() }
    }
}

// MARK: cards

private struct CardSource: View {
    let asset: AssetInfo
    @ObservedObject var assets: AssetsStore
    @StateObject private var clip = AssetPending<String>()

    var body: some View {
        VStack(spacing: 0) {
            if let file = clip.value {
                VideoSource(file: file, assets: assets, loop: true)
                    .frame(maxHeight: 360)
            } else {
                ZStack {
                    Rectangle().fill(Color.black)
                    if let t = assets.thumbs[asset.id] { Image(nsImage: t).resizable().aspectRatio(contentMode: .fit).opacity(0.5) }
                    VStack(spacing: 6) {
                        if let e = clip.error { Text(e).font(.caption).foregroundStyle(.orange).padding().textSelection(.enabled) }
                        else { ProgressView().controlSize(.small); Text("Rendering the card alone…").font(.caption).foregroundStyle(.white.opacity(0.8)) }
                    }
                }
                .aspectRatio(16.0 / 9.0, contentMode: .fit).padding(12)
            }
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text(asset.cardType ?? "").font(.caption.monospaced()).textSelection(.enabled)
                    if assets.blank.contains(asset.id) {
                        Label("Draws nothing with its \(asset.sample == "preview" ? "own sample" : "defaults"): no sample values of its own yet.", systemImage: "exclamationmark.circle")
                            .font(.caption).foregroundStyle(.orange)
                    }
                    Text(asset.sample == "preview" ? "Sample values: the card's own preview" : "Sample values: the card's defaults")
                        .font(.caption.weight(.semibold))
                    Text(asset.params ?? "{}").font(.system(size: 11, design: .monospaced)).textSelection(.enabled)
                    if let f = asset.file { Text((f as NSString).abbreviatingWithTildeInPath).font(.caption2).foregroundStyle(.secondary) }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear {
            let lib = assets.lib, id = asset.id
            clip.load { try lib.cardClip(id: id, width: 960) }
            assets.want(asset)  // its still, and whether it draws anything (the tile may be off screen)
        }
    }

}

// MARK: video (renders, card clips, labs)

private struct VideoSource: View {
    let file: String?
    @ObservedObject var assets: AssetsStore
    let loop: Bool
    var body: some View {
        if let file { VideoPlayerBox(file: file, assets: assets, loop: loop).id(file) }
        else { Text("No file").foregroundStyle(.secondary) }
    }
}

private struct VideoPlayerBox: View {
    let file: String
    @ObservedObject var assets: AssetsStore
    @StateObject private var p: AssetSourcePlayer
    let loop: Bool
    init(file: String, assets: AssetsStore, loop: Bool) {
        self.file = file; self.assets = assets; self.loop = loop
        _p = StateObject(wrappedValue: AssetSourcePlayer(url: URL(fileURLWithPath: file), loop: loop))
    }
    var body: some View {
        VStack(spacing: 0) {
            PlayerSurface(player: p.player).aspectRatio(16.0 / 9.0, contentMode: .fit).background(Color.black).padding([.horizontal, .top], 12)
            SourceTransport(p: p)
            Spacer(minLength: 0)
        }
        .onAppear {
            // a card's clip loops by itself; a render waits for play unless asked at launch
            if loop { p.player.play() }
            p.applyLaunch(assets)
        }
        .onDisappear { p.stop() }
    }
}

private struct LabSource: View {
    let asset: AssetInfo
    @ObservedObject var assets: AssetsStore
    var body: some View {
        if let r = asset.files.first(where: { $0.hasSuffix(".mp4") }) {
            VideoSource(file: r, assets: assets, loop: false)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("A lab of this film\(asset.target.map { ", over its \($0) section" } ?? ""). It has no render yet.").font(.callout)
                if let f = asset.file { Button("Open its folder in Flex") { NSWorkspace.shared.open(URL(fileURLWithPath: (f as NSString).deletingLastPathComponent)) } }
            }
            .padding(14).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: stills

private struct StillSource: View {
    let asset: AssetInfo
    @ObservedObject var assets: AssetsStore
    @State private var image: NSImage?
    @State private var boxes: [StillBox] = []
    @State private var showBoxes = true

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Rectangle().fill(Color.black.opacity(0.85))
                if let image {
                    GeometryReader { geo in
                        // boxes are in the still's own pixels: scale by its full size, not the downsampled copy's
                        let iw = asset.width.map(Double.init) ?? image.size.width, ih = asset.height.map(Double.init) ?? image.size.height
                        let k = min(geo.size.width / iw, geo.size.height / ih)
                        let (w, h) = (iw * k, ih * k)
                        let ox = (geo.size.width - w) / 2, oy = (geo.size.height - h) / 2
                        ZStack(alignment: .topLeading) {
                            Image(nsImage: image).resizable().frame(width: w, height: h)
                            if showBoxes {
                                ForEach(boxes, id: \.name) { b in
                                    Rectangle().strokeBorder(Color(red: 1, green: 0.23, blue: 0.55), lineWidth: 2)
                                        .frame(width: max(2, b.w * k), height: max(2, b.h * k))
                                        .overlay(alignment: .topLeading) {
                                            Text(b.name).font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
                                                .padding(.horizontal, 4).padding(.vertical, 1)
                                                .background(Color(red: 1, green: 0.23, blue: 0.55))
                                                .offset(y: -16)
                                        }
                                        .offset(x: b.x * k, y: b.y * k)
                                }
                            }
                        }
                        .frame(width: w, height: h)
                        .offset(x: ox, y: oy)
                    }
                } else { ProgressView().controlSize(.small) }
            }
            .padding(12)
            Divider()
            HStack {
                if !boxes.isEmpty { Toggle("Element boxes (\(boxes.count))", isOn: $showBoxes).toggleStyle(.checkbox).font(.caption) }
                else if asset.kind == "still" { Text("No element boxes (capture.walk.elements records them)").font(.caption).foregroundStyle(.secondary) }
                Spacer()
                if let w = asset.width, let h = asset.height { Text("\(w)×\(h) px").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
        .onAppear {
            let lib = assets.lib, id = asset.id, file = asset.file, kind = asset.kind
            Task.detached {
                // a sketch may be an SVG: the engine draws it (cached)
                let shown = kind == "sketch" ? (try? lib.thumbnail(id: id, width: 1600))??.file : file
                let img = shown.flatMap { AssetsStore.downsample($0, max: 2000) }
                let b = lib.boxes(id: id)
                await MainActor.run { image = img; boxes = b }
            }
        }
    }
}


// MARK: anything else (a look, a piece other cards use)

private struct FileSource: View {
    let asset: AssetInfo
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(asset.kind == "look" ? "The film's look: its cards are listed with the cards, each previewable alone."
                 : asset.kind == "card" ? "A piece other cards use (it registers no card of its own), so it has no preview alone."
                 : "No preview for this kind.")
                .font(.callout)
            if let n = asset.cards { Text("\(n) cards").font(.caption).foregroundStyle(.secondary) }
            if let f = asset.file {
                Text((f as NSString).abbreviatingWithTildeInPath).font(.caption.monospaced()).textSelection(.enabled)
                Button("Open in Editor") { NSWorkspace.shared.open(URL(fileURLWithPath: f)) }
            }
        }
        .padding(14).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

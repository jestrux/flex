import SwiftUI
import AppKit
import AVFoundation

/// How a finished render sits beside the live preview.
enum CompareMode: String, CaseIterable { case sideBySide = "Side by Side", wipe = "Wipe" }

/// The toolbar's list of the project's finished renders (the pipeline's mp4s): pick one to A/B
/// it against the preview.
struct RendersMenu: View {
    @ObservedObject var store: ProjectStore

    var body: some View {
        Menu {
            let folder = ((store.rendersFolder ?? "") as NSString).abbreviatingWithTildeInPath
            if store.renders.isEmpty {
                Text("No renders in \(folder)")
            } else {
                Section("Compare with a render · \(folder)") {
                    ForEach(store.renders, id: \.path) { r in
                        Toggle(isOn: Binding(get: { store.compare?.path == r.path },
                                             set: { store.compare = $0 ? r : nil })) {
                            Text("\(store.isAdded(r) ? r.file : RenderText.kind(r))  ·  \(RenderText.size(r.bytes))  ·  \(RenderText.date(r.modified))")
                        }
                    }
                }
            }
            Divider()
            Button("Add Render…") { store.addRender() }
            Button("Choose Renders Folder…") { store.chooseRendersFolder() }
            if let pipe = store.engine.pipelineRendersDir(), pipe != store.rendersFolder, FileManager.default.fileExists(atPath: pipe) {
                Button("Use the Pipeline's Folder (\((pipe as NSString).abbreviatingWithTildeInPath))") { store.rendersFolder = pipe }
            }
            if let c = store.compare, store.isAdded(c) {
                Button("Remove \(c.file) from the List") { store.removeAdded(c) }
            }
            Divider()
            if store.compare != nil {
                Picker("Show", selection: $store.compareMode) {
                    ForEach(CompareMode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.inline)
                Button("Stop Comparing") { store.compare = nil }
                Divider()
            }
            Button("Show Renders Folder in Finder") {
                if let d = store.rendersFolder { NSWorkspace.shared.open(URL(fileURLWithPath: d)) }
            }
            Button("Refresh List") { store.refreshRenders() }
        } label: {
            Label(store.compare.map { "A/B: \(RenderText.kind($0))" } ?? "Renders (\(store.renders.count))", systemImage: "rectangle.split.2x1")
                .labelStyle(.titleAndIcon)
        }
        .help("The project's finished renders: pick one to play it in sync beside the preview")
    }
}

enum RenderText {
    /// "Whole film", "Scene book", "Scene outro-dark", with " @4k"
    static func kind(_ r: RenderInfo) -> String {
        let what = r.part.map { "Scene \($0)" } ?? "Whole film"
        return r.size.isEmpty ? what : "\(what) \(r.size)"
    }
    static func size(_ b: UInt64) -> String { ByteCountFormatter.string(fromByteCount: Int64(b), countStyle: .file) }
    static func date(_ t: Double) -> String {
        let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .short; f.doesRelativeDateFormatting = true
        return f.string(from: Date(timeIntervalSince1970: t))
    }
}

/// Keeps a render's AVPlayer on the playhead: playing along while the film plays (re-syncing
/// when it drifts), seeking frame-exactly while paused or scrubbing. Muted: the sound is the mix.
@MainActor
final class RenderSync: ObservableObject {
    let player: AVPlayer
    let path: String
    /// the film frame the render's time 0 is
    let offset: Int
    @Published private(set) var duration: Double = 0
    private var lastSeek: Double = -1

    init(path: String, offset: Int) {
        self.path = path; self.offset = offset
        player = AVPlayer(url: URL(fileURLWithPath: path))
        player.isMuted = true
        player.automaticallyWaitsToMinimizeStalling = false
        Task { [player] in
            if let d = try? await player.currentItem?.asset.load(.duration) { self.duration = d.seconds }
        }
    }

    /// the render's time for a film frame (nil = outside the render)
    func time(frame: Int, fps: Int) -> Double? {
        let t = Double(frame - offset) / Double(fps)
        return t < 0 || (duration > 0 && t > duration) ? nil : t
    }

    func follow(frame: Int, fps: Int, playing: Bool) {
        guard let t = time(frame: frame, fps: fps) else { player.pause(); return }
        let cm = CMTime(seconds: t, preferredTimescale: 600)
        if playing {
            if player.timeControlStatus != .playing { player.seek(to: cm, toleranceBefore: .zero, toleranceAfter: .zero); player.play() }
            else if abs(player.currentTime().seconds - t) > 0.12 { player.seek(to: cm, toleranceBefore: .zero, toleranceAfter: .zero) }
            lastSeek = -1
        } else {
            player.pause()
            if t != lastSeek { lastSeek = t; player.seek(to: cm, toleranceBefore: .zero, toleranceAfter: .zero) }
        }
    }
}

/// The live preview and a finished render, in sync with the playhead: side by side, or as a wipe
/// (drag the divider; the preview is left of it, the render right).
struct CompareView: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var player: Player
    let render: RenderInfo
    @StateObject private var sync: RenderSync
    @State private var split: CGFloat = 0.5

    init(store: ProjectStore, player: Player, render: RenderInfo) {
        self.store = store; self.player = player; self.render = render
        _sync = StateObject(wrappedValue: RenderSync(path: render.path, offset: store.renderOffset(render)))
    }

    var body: some View {
        Group {
            switch store.compareMode {
            case .sideBySide:
                HStack(spacing: 10) {
                    Viewer(store: store, player: player)
                    renderPane.aspectRatio(store.frameAspect, contentMode: .fit)
                }
            case .wipe:
                wipe
            }
        }
        .onAppear { sync.follow(frame: player.frame, fps: player.fps, playing: player.playing) }
        .onChange(of: player.frame) { _, f in sync.follow(frame: f, fps: player.fps, playing: player.playing) }
        .onChange(of: player.playing) { _, p in sync.follow(frame: player.frame, fps: player.fps, playing: p) }
        .onDisappear { sync.player.pause() }
    }

    private var outside: Bool { sync.time(frame: player.frame, fps: player.fps) == nil }

    private var renderPane: some View {
        ZStack {
            Rectangle().fill(Color.black)
            PlayerSurface(player: sync.player)
            if outside {
                Text("The playhead is outside this render (\(render.scene.map { "scene \($0)" } ?? "film"))")
                    .font(.callout).foregroundStyle(.white.opacity(0.7)).padding()
                    .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .overlay(alignment: .bottomTrailing) { tag(render.file) }
    }

    private var wipe: some View {
        GeometryReader { g in
            ZStack(alignment: .topLeading) {
                Viewer(store: store, player: player)
                renderPane
                    .mask(alignment: .leading) {
                        Rectangle().frame(width: g.size.width * (1 - split)).offset(x: g.size.width * split)
                    }
                // the divider
                Rectangle().fill(Color.white).frame(width: 2, height: g.size.height)
                    .shadow(radius: 2)
                    .overlay {
                        Circle().fill(Color.white).frame(width: 22, height: 22).shadow(radius: 2)
                            .overlay(Image(systemName: "arrow.left.and.right").font(.system(size: 10, weight: .bold)).foregroundStyle(.black))
                    }
                    .offset(x: g.size.width * split - 1)
                    .gesture(DragGesture().onChanged { v in split = min(1, max(0, v.location.x / g.size.width)) })
                    .onHover { h in if h { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
            }
        }
        .aspectRatio(store.frameAspect, contentMode: .fit)
    }

    private func tag(_ s: String) -> some View {
        Text(s).font(.caption2.weight(.semibold)).foregroundStyle(.white.opacity(0.75))
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(.black.opacity(0.5), in: Capsule())
            .padding(8)
    }
}

/// An AVPlayer's picture, with no controls.
struct PlayerSurface: NSViewRepresentable {
    let player: AVPlayer
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        v.wantsLayer = true
        let l = AVPlayerLayer(player: player)
        l.videoGravity = .resizeAspect
        l.autoresizingMask = [.layerWidthSizable, .layerHeightSizable]
        v.layer = l
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) {
        (nsView.layer as? AVPlayerLayer)?.player = player
    }
}

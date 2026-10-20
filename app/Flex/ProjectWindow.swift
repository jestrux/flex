import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// One project's window: the viewer, the transport and the timeline. The engine paints and
/// watches; this polls its snapshot and shows painted frames.
@MainActor
final class ProjectStore: ObservableObject {
    enum Phase { case loading, ready(ProjectInfo), failed(String) }
    @Published var phase: Phase = .loading
    @Published var snapshot: EngineSnapshot?
    @Published var selected: String?
    /// the project's markers (sections, bars, hits, the edit's joins), once loaded
    @Published var markers: Markers?
    /// every take clip's camera plan (the camera lane)
    @Published var camera: [CameraClip] = []
    /// every cut against what it's aimed at, and the film's bar lines through the music edit (after flex music)
    @Published var cuts: [CutMark] = []
    @Published var filmBars: [Double] = []
    /// the song's hits through the music edit (flex music), and which the ruler shows: "declared" (the project's own),
    /// "entries" (a stem coming in), or one stem's name
    @Published var filmHits: [FilmHit] = []
    @Published var hitView = UserDefaults.standard.string(forKey: "hitView") ?? "declared"  // -hitView entries (for scripts)
    /// each narration word at its film time (Whisper, cached), filled in the background
    @Published var words: [NarrationWord] = []
    /// the music's dip under each line (flex duck), on request: it mixes the film twice
    @Published var duck: [DuckLine] = []
    @Published var showDuck = UserDefaults.standard.bool(forKey: "duck") { didSet { if showDuck && duck.isEmpty { loadDuck() } } }
    @Published var duckLoading = false
    struct DuckLine: Decodable { let t: Double; let dur: Double; let dip: Double?; let pumping: Double?; let attackMs: Int?; let releaseMs: Int?; let voiceOverMusic: Double? }
    /// the film's script (script.json) on its clock, and its panels' sketches drawn (Storyboard.swift)
    @Published var script: ScriptInfo?
    @Published var sketches: [String: NSImage] = [:]
    var sketchFiles: [String: String] = [:]
    var scriptGeneration: UInt64 = .max
    /// the declared variants and the value each runs with
    @Published var variants: [Variant] = []
    /// the music edit's peaks on the film's clock, `Self.peaksPerSecond` per second
    @Published var peaks: [Float] = []
    nonisolated static let peaksPerSecond: UInt32 = 50
    /// the project's finished renders, and the one shown beside the preview (A/B)
    @Published var renders: [RenderInfo] = []
    @Published var compare: RenderInfo?
    @Published var compareMode: CompareMode = .sideBySide
    /// a line for the transport after an export ("Saved …")
    @Published var notice: String?
    /// File › Export Still… is open
    @Published var exportingStill = false
    /// the Capture panel is open (-capture YES opens it at launch)
    @Published var showCapture = UserDefaults.standard.bool(forKey: "capture")
    /// journeys, take versions and the data state (Capture.swift)
    lazy var capture = CaptureStore(path: path, engine: engine)
    /// the side panel left of the viewer, if open (Panels.swift; -panel assets|activity opens one at launch)
    @Published var side: SidePanel? = UserDefaults.standard.string(forKey: "panel").flatMap(SidePanel.init(rawValue:))
    /// the project's assets and its activity trail (Assets.swift, Activity.swift)
    lazy var assets = AssetsStore(path: path, engine: engine)
    lazy var activity = ActivityStore(path: path, engine: engine)
    let path: String
    let engine: ProjectEngine
    let player: Player
    private var poll: Timer?
    private var generation: UInt64 = 0
    private var launchVariantApplied = false
    private var launchCompareApplied = false
    /// the notice line is showing a `flex render`'s progress
    private var renderNotice = false

    /// preview frames are painted this wide (half of the film's 1920)
    static let previewWidth: UInt32 = 960

    /// the film's frame, width over height (16:9, or 9:16 for a vertical film: frame.json)
    var frameAspect: CGFloat {
        if case .ready(let p) = phase, p.frameHeight > 0 { return CGFloat(p.frameWidth) / CGFloat(p.frameHeight) }
        return 16 / 9
    }

    init(path: String) {
        self.path = path
        engine = ProjectEngine(path: path, width: Self.previewWidth)
        player = Player(engine: engine)
    }

    func load() {
        phase = .loading
        let path = self.path
        Task.detached {
            let result: Phase
            do { result = .ready(try openProject(path: path)) }
            catch let FlexError.Failed(message) { result = .failed(message) }
            catch { result = .failed(error.localizedDescription) }
            await MainActor.run {
                self.phase = result
                if case .ready(let p) = result {
                    self.player.loadMusic(file: p.musicFile, segments: Self.segments(p))
                    self.loadPeaks(p)
                }
            }
        }
        player.sketchAt = { [weak self] f in self?.storySketch(at: f) }
        poll?.invalidate()
        poll = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    /// The waveform: decoded once by the engine (ffmpeg) and cached there.
    private func loadPeaks(_ p: ProjectInfo) {
        guard let file = p.musicFile else { return }
        let segs = p.segments
        Task.detached {
            let peaks = (try? musicPeaks(file: file, segments: segs, perSecond: Self.peaksPerSecond)) ?? []
            await MainActor.run { self.peaks = peaks }
        }
    }

    /// Run the film with a variant value (restarts the engine's session; unchanged frames stay cached).
    func setVariant(_ name: String, _ value: String) {
        engine.setVariant(name: name, value: value)
        variants = engine.variants()
    }

    // MARK: folders and renders (remembered per project, by its path)

    private func key(_ k: String) -> String { "\(k):\(path)" }

    /// Where this project's renders are listed from: the folder the user chose, else Flex's
    /// default `~/Downloads/flex-videos/<name>/`.
    var rendersFolder: String? {
        get { UserDefaults.standard.string(forKey: key("rendersFolder")) ?? engine.defaultDir() }
        set { UserDefaults.standard.set(newValue, forKey: key("rendersFolder")); refreshRenders() }
    }

    /// Videos added one by one (Add Render…), from anywhere.
    private var addedRenders: [String] {
        get { UserDefaults.standard.stringArray(forKey: key("addedRenders")) ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: key("addedRenders")) }
    }

    /// Where the last export of this project went, else the default folder.
    var exportFolder: String? {
        get { UserDefaults.standard.string(forKey: key("exportFolder")) ?? engine.defaultDir() }
        set { UserDefaults.standard.set(newValue, forKey: key("exportFolder")) }
    }

    func chooseRendersFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true
        panel.message = "Choose the folder with this project's renders (mp4s named after the project)"
        panel.prompt = "Choose"
        if let d = rendersFolder { panel.directoryURL = URL(fileURLWithPath: d) }
        if panel.runModal() == .OK, let url = panel.url { rendersFolder = url.path }
    }

    func addRender() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.mpeg4Movie, .quickTimeMovie, .movie]
        panel.message = "Add a video to compare with the preview"
        panel.prompt = "Add"
        if let d = rendersFolder { panel.directoryURL = URL(fileURLWithPath: d) }
        guard panel.runModal() == .OK else { return }
        let paths = panel.urls.map(\.path)
        addedRenders = addedRenders.filter { !paths.contains($0) } + paths
        refreshRenders(select: paths.last)
    }

    func removeAdded(_ r: RenderInfo) {
        addedRenders = addedRenders.filter { $0 != r.path }
        if compare?.path == r.path { compare = nil }
        refreshRenders()
    }

    func isAdded(_ r: RenderInfo) -> Bool { addedRenders.contains(r.path) }

    func refreshRenders(select: String? = nil) {
        let e = engine, dir = rendersFolder, added = addedRenders
        Task.detached {
            var r = dir.map { e.renders(dir: $0) } ?? []
            for p in added where !r.contains(where: { $0.path == p }) { if let x = e.renderFile(path: p) { r.append(x) } }
            let found = r
            await MainActor.run {
                let r = found
                if let select, let hit = r.first(where: { $0.path == select }) { self.compare = hit }
                self.renders = r
                // -compare <file name> [-compareMode wipe]: open on an A/B (for scripts)
                if !self.launchCompareApplied, let want = UserDefaults.standard.string(forKey: "compare"), let hit = r.first(where: { $0.file == want }) {
                    self.launchCompareApplied = true
                    self.compare = hit
                    if UserDefaults.standard.string(forKey: "compareMode") == "wipe" { self.compareMode = .wipe }
                }
                if let c = self.compare, !r.contains(where: { $0.path == c.path }) { self.compare = nil }
            }
        }
    }

    /// the film frame a render's time 0 is (a scene render starts at its scene)
    func renderOffset(_ r: RenderInfo) -> Int {
        guard let id = r.scene, let s = snapshot?.scenes.first(where: { $0.id == id }) else { return 0 }
        return Int(s.first)
    }

    /// the music edit as song-second pairs, rebuilt from the joins and the scenes' music key
    private static func segments(_ p: ProjectInfo) -> [[Double]] { p.segments.map { [$0.start, $0.end] } }

    private func tick() {
        let s = engine.snapshot()
        snapshot = s
        if s.frames > 0 && (player.frames != Int(s.frames) || player.fps != Int(s.fps)) {
            player.configure(fps: Int(s.fps), frames: Int(s.frames))
            // -startAt <frame>: open on that frame (for driving the app from scripts)
            let start = UserDefaults.standard.integer(forKey: "startAt")
            if start > 0 { player.seek(start) }
            // -autoplay YES: start playing once the music is ready (-mute YES keeps it silent)
            if UserDefaults.standard.bool(forKey: "autoplay") {
                Task { @MainActor in
                    for _ in 0..<50 where !player.musicReady { try? await Task.sleep(for: .milliseconds(100)) }
                    player.play()
                }
            }
        }
        if let mix = s.mixPath { player.useMix(mix) }
        // `flex show`: the playhead where the command asked
        if player.frames > 0, let f = engine.takeSeek() { player.seek(Int(f)) }
        // `flex render` through the app: its progress on the transport's line
        if let r = s.rendering {
            let pct = r.total > 0 ? Int(Double(r.done) / Double(r.total) * 100) : 0
            notice = "Rendering \(r.what) for flex render… \(pct)%"; renderNotice = true
        } else if renderNotice { renderNotice = false; notice = "Rendered (flex render)"; refreshRenders() }
        // the script reads again on its own changes (script.json, a sketch), and on a reload (the film's length, its grid)
        if s.scriptGeneration != scriptGeneration || s.generation != generation { scriptGeneration = s.scriptGeneration; loadScript() }
        if s.generation != generation {
            generation = s.generation; player.refresh()
            markers = engine.markers(); variants = engine.variants(); camera = engine.camera()
            cuts = engine.cuts(); filmBars = engine.filmBars(); filmHits = engine.filmHits()
            loadWords()
            if showDuck { duck = []; loadDuck() }  // (also on the first load with -duck YES)
            refreshRenders()
            // -variant NAME=VALUE: run with a variant from launch (for driving the app from scripts)
            if !launchVariantApplied, let kv = UserDefaults.standard.string(forKey: "variant"), let i = kv.firstIndex(of: "=") {
                launchVariantApplied = true
                setVariant(String(kv[..<i]), String(kv[kv.index(after: i)...]))
            }
        }
        else if player.holding { player.refresh() }
    }

    /// Edit a camera block (take ms); the engine reloads on the file change. Errors go to the notice line.
    func editCamera(_ take: String, _ id: String, start: Double? = nil, end: Double? = nil, shift: Double? = nil, enabled: Bool? = nil) {
        do { try engine.cameraEdit(take: take, id: id, startMs: start, endMs: end, shiftMs: shift, enabled: enabled) }
        catch { notice = CaptureStore.message(error) }
    }

    func lockCamera(_ take: String, _ locked: Bool) {
        do { try engine.cameraLock(take: take, locked: locked) } catch { notice = CaptureStore.message(error) }
    }

    private func loadWords() {
        let e = engine
        Task.detached { let w = e.narrationWords(); await MainActor.run { self.words = w } }
    }

    private func loadDuck() {
        duckLoading = true
        let e = engine
        Task.detached {
            struct R: Decodable { let lines: [ProjectStore.DuckLine] }
            let lines = e.duckJson().flatMap { try? JSONDecoder().decode(R.self, from: Data($0.utf8)).lines } ?? []
            await MainActor.run { self.duck = lines; self.duckLoading = false }
        }
    }

    /// the stems the song's hits come from (for the Hits menu)
    var hitStems: [String] { Array(Set(filmHits.map(\.stem))).sorted() }

    func close() { poll?.invalidate(); player.pause(); engine.close() }

    func scene(at frame: Int) -> SceneStatus? {
        snapshot?.scenes.first { frame >= Int($0.first) && frame < Int($0.first + $0.frames) }
    }

    func loop(_ id: String) {
        guard let s = snapshot?.scenes.first(where: { $0.id == id }) else { return }
        let r = Int(s.first)...Int(s.first + s.frames) - 1
        if player.loop == r { player.loop = nil; return }
        player.loop = r
        selected = id
        player.seek(r.lowerBound)
        player.play()
    }

    func jumpScene(_ d: Int) {
        guard let scenes = snapshot?.scenes, !scenes.isEmpty else { return }
        let cur = scenes.lastIndex { Int($0.first) <= player.frame } ?? 0
        // "previous" goes to this scene's start first, unless already there
        let i = d < 0 && player.frame > Int(scenes[cur].first) ? cur : min(max(0, cur + d), scenes.count - 1)
        selected = scenes[i].id
        player.seek(Int(scenes[i].first))
    }
}

struct ProjectWindow: View {
    @StateObject private var store: ProjectStore

    init(path: String) { _store = StateObject(wrappedValue: ProjectStore(path: path)) }

    var body: some View {
        Group {
            switch store.phase {
            case .loading:
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Reading the project…").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message):
                FailedView(path: store.path, message: message) { store.load() }
            case .ready(let p):
                FilmView(project: p, store: store, player: store.player)
            }
        }
        .navigationTitle((store.path as NSString).lastPathComponent)
        .navigationSubtitle(subtitle)
        .toolbar {
            ToolbarItemGroup {
                ForEach(store.variants, id: \.name) { v in
                    Menu {
                        Picker(v.name, selection: Binding(get: { v.current }, set: { store.setVariant(v.name, $0) })) {
                            ForEach(v.values, id: \.self) { Text($0 == v.values.first ? "\($0) (default)" : $0).tag($0) }
                        }
                        .pickerStyle(.inline)
                    } label: {
                        Label("\(v.name): \(v.current)", systemImage: "slider.horizontal.3")
                            .labelStyle(.titleAndIcon)
                    }
                    .help("Variant \(v.name): the film runs with \(v.name)=\(v.current). Choosing another restarts the engine with it.")
                }
                RendersMenu(store: store)
            }
            ToolbarItem {
                Button { store.side = store.side == .assets ? nil : .assets } label: { Label("Assets", systemImage: "square.grid.2x2") }
                    .keyboardShortcut("1", modifiers: [.command, .option])
                    .help("Assets: everything the film is made from, each playable on its own  ⌥⌘1")
            }
            ToolbarItem {
                Button { store.side = store.side == .activity ? nil : .activity } label: { Label("Activity", systemImage: "list.bullet.rectangle") }
                    .keyboardShortcut("2", modifiers: [.command, .option])
                    .help("Activity: what the agents and flex commands did, on one clock  ⌥⌘2")
            }
            ToolbarItem {
                Button { store.showCapture.toggle() } label: { Label("Capture", systemImage: "record.circle") }
                    .keyboardShortcut("c", modifiers: [.command, .option])
                    .help("Capture: record the project's journeys into take versions, compare and pick  ⌥⌘C")
            }
            ToolbarItem {
                Button { NSWorkspace.shared.open(URL(fileURLWithPath: store.path)) } label: { Label("Show in Finder", systemImage: "folder") }
                    .help("Show the project folder in Finder")
            }
        }
        .inspector(isPresented: $store.showCapture) {
            CapturePanel(cap: store.capture).inspectorColumnWidth(min: 320, ideal: 380, max: 560)
        }
        .focusedSceneObject(store)
        .sheet(isPresented: $store.exportingStill) { StillExportSheet(store: store) }
        .onAppear { store.load() }
        .onDisappear { store.close() }
    }

    private var subtitle: String {
        guard case .ready(let p) = store.phase else { return "" }
        var s = "\(Fmt.time(p.duration)) · \(p.scenes.count) scenes"
        if let plan = store.plannedLength { s += " · planned to \(Fmt.time(plan))" }
        if let snap = store.snapshot {
            if snap.loading && snap.generation > 0 { s += " · reloading…" }
            else if snap.painting { s += " · painting" }
            else if snap.generation > 1 { s += " · \(snap.changed) frames changed (\(snap.reloadMs) ms)" }
        }
        return s
    }
}

struct FailedView: View {
    let path: String
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("This project didn't open", systemImage: "exclamationmark.triangle.fill")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.orange)
            Text((path as NSString).abbreviatingWithTildeInPath).font(.callout).foregroundStyle(.secondary)
            ScrollView {
                Text(message)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 240)
            Button("Try Again", action: retry).keyboardShortcut("r", modifiers: [.command])
        }
        .padding(32)
        .frame(maxWidth: 640, maxHeight: .infinity)
    }
}

enum Fmt {
    /// 72.44 → "1:12.44"
    static func time(_ s: Double) -> String {
        let m = Int(s) / 60, r = s - Double(m * 60)
        return m > 0 ? String(format: "%d:%05.2f", m, r) : String(format: "%.2fs", r)
    }
    /// a timecode: 1:12.13 (minutes:seconds.frames)
    static func code(_ frame: Int, fps: Int) -> String {
        let s = frame / fps, f = frame % fps
        return String(format: "%d:%02d.%02d", s / 60, s % 60, f)
    }
}

enum Palette {
    // no red or pink: red means a scene whose code threw
    static let colors: [Color] = [.indigo, .teal, .orange, .mint, .blue, .purple, .green, .brown]
    static func scene(_ i: Int) -> Color { colors[i % colors.count] }
}

struct FilmView: View {
    let project: ProjectInfo
    @ObservedObject var store: ProjectStore
    @ObservedObject var player: Player

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                if store.side != nil {
                    SidePanelView(store: store).frame(width: 320)
                    Divider()
                }
                SourceSlot(store: store, assets: store.assets)
                Group {
                    if let r = store.compare { CompareView(store: store, player: player, render: r).id(r.path) }
                    else { Viewer(store: store, player: player) }
                }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(16)
            }
            Divider()
            Transport(store: store, player: player)
                .padding(.horizontal, 16).padding(.vertical, 8)
            Timeline(project: project, store: store, player: player)
                .frame(height: 196)
                .padding(.horizontal, 16).padding(.bottom, 14)
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .background(KeyHandler(store: store, player: player))
    }
}

struct Viewer: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var player: Player

    var body: some View {
        ZStack {
            Rectangle().fill(Color.black)
            let scene = store.scene(at: player.frame)
            if let scene, let err = scene.error, player.holding {
                VStack(alignment: .leading, spacing: 8) {
                    Label("\(scene.id) didn't draw", systemImage: "exclamationmark.triangle.fill")
                        .font(.headline).foregroundStyle(.orange)
                    Text(err).font(.system(.caption, design: .monospaced)).foregroundStyle(.white.opacity(0.85))
                        .textSelection(.enabled).lineLimit(8)
                    Text("Fix the scene's code and save: it reloads by itself.").font(.caption).foregroundStyle(.white.opacity(0.5))
                }
                .padding(18)
                .frame(maxWidth: 640, alignment: .leading)
            } else if let scene, !scene.unpaintable.isEmpty, player.holding {
                VStack(spacing: 6) {
                    Image(systemName: "film").font(.system(size: 34, weight: .light))
                    Text("Take \(scene.unpaintable.joined(separator: ", "))").font(.headline)
                    Text("Takes play once the pipeline can give a take's layers (docs/pipeline-seam.md).")
                        .font(.callout).multilineTextAlignment(.center)
                }
                .foregroundStyle(.white.opacity(0.55))
                .padding()
            } else if let sk = player.sketch {
                StorySketchView(sketch: sk)
            } else if let img = player.image {
                Image(nsImage: img).resizable().interpolation(.high).aspectRatio(contentMode: .fit)
            }
            if player.holding && (store.scene(at: player.frame).map { $0.unpaintable.isEmpty && $0.error == nil } ?? true) {
                Label("painting", systemImage: "paintbrush.pointed")
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(.black.opacity(0.6), in: Capsule())
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(10)
            }
            if let err = store.snapshot?.error {
                Text(err)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.white)
                    .padding(10)
                    .background(Color.red.opacity(0.8), in: RoundedRectangle(cornerRadius: 8))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(12)
                    .textSelection(.enabled)
            }
        }
        .aspectRatio(store.frameAspect, contentMode: .fit)
        .overlay(alignment: .bottomLeading) {
            // a pill like the render's name tag in A/B, so it reads over any picture
            Text(player.sketch.map { $0.planned ? "Storyboard · planned" : "Storyboard" } ?? "Preview").font(.caption2.weight(.semibold)).foregroundStyle(.white.opacity(0.85))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(.black.opacity(0.55), in: Capsule())
                .padding(10)
        }
    }
}

struct Transport: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var player: Player

    var body: some View {
        HStack(spacing: 14) {
            Button { store.jumpScene(-1) } label: { Image(systemName: "backward.end.fill") }
                .help("Previous scene  [")
            Button { player.toggle() } label: { Image(systemName: player.playing ? "pause.fill" : "play.fill").frame(width: 18) }
                .help("Play / pause  Space")
            Button { store.jumpScene(1) } label: { Image(systemName: "forward.end.fill") }
                .help("Next scene  ]")
            Text(Fmt.code(player.frame, fps: player.fps)).font(.system(.body, design: .monospaced)).monospacedDigit()
            if let s = store.scene(at: player.frame) { Text(s.id).foregroundStyle(.secondary) }
            if let sk = player.sketch { Label(sk.beat, systemImage: "pencil.and.scribble").foregroundStyle(.secondary) }
            if let loop = player.loop {
                Label("Looping \(store.scene(at: loop.lowerBound)?.id ?? "")", systemImage: "repeat")
                    .font(.callout).foregroundStyle(Color.accentColor)
                Button("Stop Loop") { player.loop = nil }.controlSize(.small)
            }
            Spacer()
            if !store.filmHits.isEmpty || store.markers?.hits.isEmpty == false {
                Menu {
                    Picker("Hits", selection: $store.hitView) {
                        Text("The project's hits").tag("declared")
                        if !store.filmHits.isEmpty {
                            Text("Entries (a stem comes in)").tag("entries")
                            Divider()
                            ForEach(store.hitStems, id: \.self) { Text("\($0) hits").tag($0) }
                        }
                    }.pickerStyle(.inline)
                } label: { Label(store.hitView == "declared" ? "Hits" : store.hitView == "entries" ? "Entries" : store.hitView, systemImage: "metronome") }
                .menuStyle(.borderlessButton).fixedSize().font(.caption)
                .help("Which hits the ruler shows: the project's declared hits, or the song's (flex music): entries, or one stem's onsets, sized by strength")
            }
            Toggle(isOn: $store.showDuck) { Label(store.duckLoading ? "Ducking…" : "Ducking", systemImage: "waveform.path.ecg") }
                .toggleStyle(.button).controlSize(.small).font(.caption)
                .help("Show how the music dips under each narration line (flex duck: it mixes the film, a few seconds)")
            if let n = store.notice { Text(n).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle) }
            Group {
                if store.snapshot?.mixing == true { Label("mixing the sound…", systemImage: "waveform") }
                else if let err = store.snapshot?.mixError { Label("music only: the mix failed", systemImage: "exclamationmark.triangle").help(err) }
                else if player.sound == "mix" { Label("narration + music", systemImage: "waveform") }
                else if !player.musicReady { Text("no sound") }
                else { Label("music only", systemImage: "music.note") }
            }
            .font(.caption).foregroundStyle(.secondary)
            if let snap = store.snapshot {
                let painted = snap.scenes.reduce(0) { $0 + Int($1.painted) }
                let paintable = snap.scenes.filter { $0.unpaintable.isEmpty }.reduce(0) { $0 + Int($1.frames) }
                Text("\(painted)/\(paintable) frames painted").font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .buttonStyle(.borderless)
    }
}

/// Space, ←/→ (a frame; ⇧ a second), [ ] (scenes), L (loop the scene under the playhead).
struct KeyHandler: NSViewRepresentable {
    let store: ProjectStore
    let player: Player

    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        context.coordinator.monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak v] e in
            guard let w = v?.window, w.isKeyWindow, !(w.firstResponder is NSText) else { return e }
            let mods = e.modifierFlags.intersection([.command, .option, .control, .shift])
            guard mods.isEmpty || mods == .shift else { return e }
            let big = mods == .shift ? player.fps : 1
            switch e.keyCode {
            case 49: player.toggle()                                  // space
            case 123: player.step(-big)                               // ←
            case 124: player.step(big)                                // →
            case 33: store.jumpScene(-1)                              // [
            case 30: store.jumpScene(1)                               // ]
            case 37: if let s = store.scene(at: player.frame) { store.loop(s.id) }   // L
            default: return e
            }
            return nil
        }
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator { var monitor: Any?; deinit { if let m = monitor { NSEvent.removeMonitor(m) } } }
}

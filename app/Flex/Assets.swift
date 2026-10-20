import SwiftUI
import AppKit
import ImageIO

/// The assets panel: a grid of everything the film is made from, and a source viewer (AssetsSourceViewer.swift) that
/// plays one apart from the film. Nothing is registered by hand: the engine scans the project's files
/// (flex_core::assets); this shows what the scan found and what it measured, and never judges a piece.
///
/// The scan is ~10 ms, so the panel simply rescans every 2 s while it is visible. Slow pictures (a card's still runs the
/// pipeline, a render's still runs ffmpeg) are made in the background, one at a time, and cached by the engine.
@MainActor
final class AssetsStore: ObservableObject {
    let path: String
    let engine: ProjectEngine
    let lib: AssetsLibrary

    @Published private(set) var assets: [AssetInfo] = []
    @Published private(set) var cardsStale = false
    @Published private(set) var cardsError: String?
    @Published private(set) var listingCards = false
    @Published var query = ""
    /// one kind only ("music", "take" …), or all (-assetKind <kind> at launch, for scripted checks)
    @Published var kind: String? = UserDefaults.standard.string(forKey: "assetKind")
    @Published var selected: String?
    /// what the source viewer shows
    @Published var open: AssetInfo?
    /// folder groups (images, stills) the author unfolded; folded by default
    @Published var unfolded: Set<String> = []
    /// tile pictures and mini waveforms, by asset id
    @Published private(set) var thumbs: [String: NSImage] = [:]
    @Published private(set) var blank: Set<String> = []
    @Published private(set) var peaks: [String: [Float]] = [:]
    /// what made an asset, when known (an agent's name, from the activity trail). Empty until the orchestrator wires it:
    /// a tile shows the mark only when there is an entry.
    @Published var madeBy: [String: String] = [:]

    /// launch args for scripted checks: -openAsset <id or path>, -assetAt <seconds>, -assetPlay YES
    let launchAt = UserDefaults.standard.object(forKey: "assetAt") != nil ? UserDefaults.standard.double(forKey: "assetAt") : nil
    let launchPlay = UserDefaults.standard.bool(forKey: "assetPlay")
    private var pendingReveal = UserDefaults.standard.string(forKey: "openAsset")

    private var revealTries = 0
    private var timer: Timer?
    private var scanning = false
    private var thumbsAsked: [String: Double] = [:]
    private let fast = DispatchQueue(label: "flex.assets.thumbs", qos: .utility)
    private let slow = DispatchQueue(label: "flex.assets.cards", qos: .utility)

    init(path: String, engine: ProjectEngine) {
        self.path = path
        self.engine = engine
        lib = AssetsLibrary(path: path)
        if pendingReveal != nil { rescan() }
    }

    /// What the window knows that a file scan doesn't: the film's track (a library song) and the renders folder.
    func configure(track: String?, renders: String?) {
        lib.setTrack(file: track)
        lib.setRenders(dir: renders)
        rescan()
    }

    /// Rescan every 2 s while the panel is visible.
    func start() {
        rescan()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.rescan() }
        }
    }
    func stop() { timer?.invalidate(); timer = nil }

    func rescan() {
        guard !scanning else { return }
        scanning = true
        let lib = self.lib
        Task.detached {
            let r = try? lib.scan(refreshCards: false)
            await MainActor.run {
                self.scanning = false
                guard let r else { return }
                if r.assets != self.assets { self.assets = r.assets; self.refreshOpen() }
                self.cardsStale = r.cardsStale
                // after the engine has loaded: listing the cards and the engine's start both link the project into Flex's
                // projects folder (tools::projects_link), and doing both at once can fail one of them
                if r.cardsStale && !self.listingCards && self.cardsError == nil && self.engineSettled { self.listCards() }
                if let p = self.pendingReveal { self.reveal(p) }
            }
        }
    }

    private var engineSettled: Bool {
        let snap = engine.snapshot()
        return !snap.loading && (snap.generation >= 1 || snap.error != nil)
    }

    /// The card list runs the pipeline (2–4 s): in the background, then a rescan.
    private func listCards() {
        listingCards = true
        let lib = self.lib
        Task.detached {
            let err: String?
            do { err = try lib.scan(refreshCards: true).cardsError } catch let FlexError.Failed(m) { err = m } catch { err = "\(error)" }
            await MainActor.run { self.listingCards = false; self.cardsError = err; self.rescan() }
        }
    }

    /// The open asset follows its rescans (a new version picked, a still re-shot).
    private func refreshOpen() {
        guard let o = open else { return }
        if let now = assets.first(where: { $0.id == o.id }) { if now != o { open = now } }
    }

    /// select and open a project-relative path (from the activity trail): an id, a file, or a file of one
    func reveal(_ path: String) {
        guard !assets.isEmpty else { pendingReveal = path; rescan(); return }
        guard let id = lib.find(path: path), let a = assets.first(where: { $0.id == id }) else {
            // not there yet (the file is being written, or the window hasn't passed the track in): try the next scans
            if pendingReveal == path { revealTries += 1 } else { pendingReveal = path; revealTries = 0 }
            if revealTries > 15 { pendingReveal = nil }
            return
        }
        pendingReveal = nil
        if let g = a.group { unfolded.insert(g) }
        kind = nil; query = ""
        select(a)
    }

    func select(_ a: AssetInfo) {
        selected = a.id
        open = a
    }

    func close() { open = nil }

    // MARK: the grid

    struct Section: Identifiable {
        let id: String
        let title: String
        let items: [AssetInfo]
        /// a folder group: folds
        let folds: Bool
    }

    static func plural(_ kind: String) -> String {
        switch kind {
        case "music": return "Music"
        case "stem": return "Stems"
        case "sound": return "Sounds"
        case "take", "take-version": return "Takes"
        case "card": return "Cards"
        case "look": return "Looks"
        case "lab": return "Labs"
        case "freeze": return "Freezes"
        case "still": return "Stills"
        case "sketch": return "Storyboard"
        case "image": return "Images"
        case "render": return "Renders"
        default: return "Other"
        }
    }
    static let kinds = ["music", "stem", "sound", "take", "card", "look", "lab", "freeze", "still", "sketch", "image", "render", "other"]

    func matches(_ a: AssetInfo) -> Bool {
        if let k = kind, a.kind != k, !(k == "take" && a.kind == "take-version") { return false }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return true }
        return [a.title, a.id, a.note ?? "", a.cardType ?? ""].contains { $0.lowercased().contains(q) }
    }

    /// The grid's sections: one per kind (a take's versions in its take's), images and stills one per folder.
    var sections: [Section] {
        let shown = assets.filter(matches)
        var out: [Section] = []
        for k in Self.kinds {
            let items = shown.filter { $0.kind == k || (k == "take" && $0.kind == "take-version") }
            if items.isEmpty { continue }
            if k == "image" || k == "still" {
                var order: [String] = []
                var by: [String: [AssetInfo]] = [:]
                for a in items { let g = a.group ?? ""; if by[g] == nil { order.append(g) }; by[g, default: []].append(a) }
                for g in order { out.append(Section(id: "\(k):\(g)", title: g.isEmpty ? Self.plural(k) : g, items: by[g]!, folds: true)) }
            } else {
                out.append(Section(id: k, title: Self.plural(k), items: items, folds: false))
            }
        }
        return out
    }

    func isFolded(_ s: Section) -> Bool {
        s.folds && !unfolded.contains(s.id) && query.trimmingCharacters(in: .whitespaces).isEmpty
    }
    func toggleFold(_ s: Section) { if unfolded.contains(s.id) { unfolded.remove(s.id) } else { unfolded.insert(s.id) } }

    // MARK: tile pictures

    static let audioKinds: Set<String> = ["music", "stem", "sound"]

    /// Ask for a tile's picture or peaks (once per version of the asset).
    func want(_ a: AssetInfo) {
        if thumbsAsked[a.id] == a.modified { return }
        thumbsAsked[a.id] = a.modified
        let lib = self.lib, id = a.id
        if Self.audioKinds.contains(a.kind) {
            fast.async {
                let p = (try? lib.peaks(id: id, perSecond: 20)) ?? []
                DispatchQueue.main.async { MainActor.assumeIsolated { self.peaks[id] = p } }
            }
            return
        }
        // images and frames are files already: downsample them; cards and renders are made by the engine
        let slowOne = a.kind == "card" || a.kind == "render" || a.kind == "lab"
        if a.kind == "card" && a.cardType == nil { return }
        if a.kind == "look" || a.kind == "other" { return }
        (slowOne ? slow : fast).async {
            guard let t = try? lib.thumbnail(id: id, width: 320) else { return }
            let img = Self.downsample(t.file, max: 320)
            DispatchQueue.main.async { MainActor.assumeIsolated {
                if let img { self.thumbs[id] = img }
                if t.blank { self.blank.insert(id) } else { self.blank.remove(id) }
            } }
        }
    }

    /// A small copy of a big image (3× screenshots are 4000+ px), without decoding it whole.
    nonisolated static func downsample(_ file: String, max: Int) -> NSImage? {
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: file) as CFURL, nil) else { return nil }
        let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: max,
                                     kCGImageSourceCreateThumbnailWithTransform: true]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
    }
}

enum AssetText {
    /// a short line of what was measured, for a tile
    static func facts(_ a: AssetInfo) -> String {
        var v: [String] = []
        if let d = a.duration { v.append(Fmt.time(d)) }
        switch a.kind {
        case "music", "stem", "sound":
            if let w = a.words { v.append("\(w) words") }
            if let l = a.lufs { v.append(String(format: "%.1f LUFS", l)) }
            if a.registered == false { v.append("not in audio.json") }
        case "take", "take-version":
            if let f = a.frames { v.append("\(f) frames played") }
            if a.kind == "take", let p = a.version { v.append("pick v\(p)") }
            if a.picked == true { v.append("picked") }
            if let l = a.late, l > 0 { v.append("\(l) late") }
        case "card":
            if a.cardType == nil { v.append("a piece, no card") } else if let o = a.origin { v.append(o) }
        case "look":
            if let n = a.cards { v.append("\(n) cards") }
        case "lab":
            if let t = a.target { v.append("→ \(t)") }
        case "sketch":
            if let n = a.note { v.append(n) }
            if let w = a.width, let h = a.height { v.append("\(w)×\(h)") }
        case "still":
            if !a.boxNames.isEmpty { v.append("\(a.boxNames.count) boxes") }
            if let w = a.width, let h = a.height { v.append("\(w)×\(h)") }
        default:
            if let w = a.width, let h = a.height { v.append("\(w)×\(h)") }
        }
        return v.joined(separator: " · ")
    }

    static func icon(_ kind: String) -> String {
        switch kind {
        case "music": return "music.note"
        case "stem": return "slider.vertical.3"
        case "sound": return "speaker.wave.2"
        case "take", "take-version": return "record.circle"
        case "card": return "rectangle.on.rectangle"
        case "look": return "paintpalette"
        case "lab": return "flask"
        case "freeze": return "snowflake"
        case "still": return "camera.viewfinder"
        case "sketch": return "pencil.and.scribble"
        case "render": return "film"
        default: return "photo"
        }
    }
}

struct AssetsPanel: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var assets: AssetsStore

    private var track: String? { if case .ready(let p) = store.phase { return p.musicFile } else { return nil } }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Filter", text: $assets.query).textFieldStyle(.plain)
                Menu {
                    Button("All Kinds") { assets.kind = nil }
                    Divider()
                    ForEach(AssetsStore.kinds, id: \.self) { k in
                        let n = assets.assets.filter { $0.kind == k || (k == "take" && $0.kind == "take-version") }.count
                        if n > 0 { Button("\(AssetsStore.plural(k)) (\(n))") { assets.kind = k } }
                    }
                } label: { Text(assets.kind.map(AssetsStore.plural) ?? "All") }
                .menuStyle(.borderlessButton).fixedSize()
                .help("Show one kind of asset")
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            if assets.listingCards || assets.cardsError != nil {
                Text(assets.cardsError.map { "The cards couldn't be listed: \($0.components(separatedBy: "\n").first ?? $0)" } ?? "Listing the cards…")
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).padding(.bottom, 4)
            }
            Divider()
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10, pinnedViews: [.sectionHeaders]) {
                        ForEach(assets.sections) { s in
                            Section {
                                if !assets.isFolded(s) {
                                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 88), spacing: 8)], spacing: 10) {
                                        ForEach(s.items, id: \.id) { a in
                                            AssetTile(asset: a, assets: assets).id(a.id)
                                        }
                                    }
                                    .padding(.horizontal, 10)
                                }
                            } header: { header(s) }
                        }
                        if assets.assets.isEmpty {
                            Text("Nothing here yet: the project's audio, takes, cards, stills and renders show up as files appear.")
                                .font(.callout).foregroundStyle(.secondary).padding(14)
                        }
                    }
                    .padding(.bottom, 12)
                }
                .onChange(of: assets.selected) { _, id in
                    if let id { withAnimation { scroll.scrollTo(id, anchor: .center) } }
                }
            }
        }
        .onAppear { assets.configure(track: track, renders: store.rendersFolder); assets.start() }
        .onDisappear { assets.stop() }
        .onChange(of: track) { _, t in assets.configure(track: t, renders: store.rendersFolder) }
    }

    @ViewBuilder private func header(_ s: AssetsStore.Section) -> some View {
        HStack(spacing: 4) {
            if s.folds {
                Image(systemName: assets.isFolded(s) ? "chevron.right" : "chevron.down").font(.caption2.weight(.semibold)).frame(width: 10)
            }
            Text(s.title).font(.caption.weight(.semibold)).lineLimit(1).truncationMode(.head)
            Text("\(s.items.count)").font(.caption).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, 10).padding(.vertical, 4)
        .background(.bar)
        .contentShape(Rectangle())
        .onTapGesture { if s.folds { assets.toggleFold(s) } }
        .help(s.folds ? "\(s.items.count) in \(s.title): click to \(assets.isFolded(s) ? "show" : "fold") them" : "")
    }
}

struct AssetTile: View {
    let asset: AssetInfo
    @ObservedObject var assets: AssetsStore

    private var isVersion: Bool { asset.kind == "take-version" }

    var body: some View {
        let selected = assets.selected == asset.id
        VStack(alignment: .leading, spacing: 3) {
            ZStack {
                RoundedRectangle(cornerRadius: 5).fill(Color.black.opacity(0.82))
                picture
                if assets.blank.contains(asset.id) {
                    Text("no sample values").font(.system(size: 9, weight: .medium)).foregroundStyle(.white.opacity(0.7))
                        .padding(.horizontal, 4).padding(.vertical, 2).background(.white.opacity(0.12), in: Capsule())
                }
            }
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 5))
            .overlay(alignment: .topLeading) { badges }
            .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(selected ? Color.accentColor : .white.opacity(0.08), lineWidth: selected ? 2 : 1))
            Text(isVersion ? "v\(asset.version ?? 0)" + (asset.picked == true ? "  ★ picked" : "") : asset.title)
                .font(.caption).lineLimit(1).truncationMode(.middle)
            Text(AssetText.facts(asset)).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(.leading, isVersion ? 6 : 0)
        .contentShape(Rectangle())
        .onTapGesture { assets.select(asset) }
        .onAppear { assets.want(asset) }
        .help(help)
    }

    private var help: String {
        var h = [asset.id]
        if let n = asset.note { h.append(n) }
        if asset.frames != nil { h.append("frames played: events.json's list, what the film plays after retiming") }
        if assets.blank.contains(asset.id) { h.append("Draws nothing with its \(asset.sample == "preview" ? "own sample" : "defaults"): it has no sample values of its own yet") }
        if let m = assets.madeBy[asset.id] { h.append("made by \(m)") }
        return h.joined(separator: "\n")
    }

    @ViewBuilder private var picture: some View {
        if AssetsStore.audioKinds.contains(asset.kind) {
            if let p = assets.peaks[asset.id], !p.isEmpty {
                AssetMiniWave(peaks: p).padding(.horizontal, 4).padding(.vertical, 6)
            } else {
                Image(systemName: AssetText.icon(asset.kind)).foregroundStyle(.white.opacity(0.4))
            }
        } else if let img = assets.thumbs[asset.id] {
            Image(nsImage: img).resizable().aspectRatio(contentMode: .fit)
        } else {
            Image(systemName: AssetText.icon(asset.kind)).font(.title3).foregroundStyle(.white.opacity(0.35))
        }
    }

    @ViewBuilder private var badges: some View {
        HStack(spacing: 3) {
            if let m = assets.madeBy[asset.id] {
                Label(m, systemImage: "sparkles").labelStyle(.iconOnly).font(.system(size: 9))
                    .padding(3).background(.black.opacity(0.6), in: Circle()).foregroundStyle(.white)
                    .help("made by \(m)")
            }
            if asset.kind == "take", let n = asset.versions.count as Int?, n > 0 {
                Text("\(n) v").font(.system(size: 9, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 4).padding(.vertical, 1).background(.black.opacity(0.6), in: Capsule())
            }
        }
        .padding(4)
    }
}

/// A tile's waveform: the peaks squeezed to the tile's width.
struct AssetMiniWave: View {
    let peaks: [Float]
    var body: some View {
        Canvas { ctx, size in
            let n = max(1, Int(size.width / 2))
            var path = Path()
            for i in 0..<n {
                let a = i * peaks.count / n, b = max(a + 1, (i + 1) * peaks.count / n)
                let v = CGFloat(peaks[a..<min(b, peaks.count)].max() ?? 0)
                let h = max(0.5, v * size.height / 2)
                path.addRect(CGRect(x: CGFloat(i) * 2, y: size.height / 2 - h, width: 1.4, height: h * 2))
            }
            ctx.fill(path, with: .color(Color(red: 0.35, green: 0.66, blue: 0.9)))
        }
    }
}

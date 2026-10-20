import SwiftUI
import AppKit

// The Capture panel (⌥⌘C): the project's journeys and their takes' versions, the app's data state and the staging
// scripts, a dry run or a real capture with its live view and log, each version's timing report, a version previewed
// in the film before picking it, and the pick. Everything goes through `server/capture.mts` (docs/capture.md), the same
// runner `flex journeys / capture / report / pick / stage` uses.

struct CaptureInfo: Decodable {
    struct State: Decodable { let state: String?; let script: String?; let at: String?; let checked: Bool? }
    struct Script: Decodable { let run: String; let gives: String?; let writes: Bool?; let confirm: String?; let about: String? }
    struct Writes: Decodable { let confirm: String }
    struct Version: Decodable, Identifiable {
        let n: Int; let at: String; let dpr: Int?; let duration: Double?; let late: Int?; let worst: Int?; let note: String?; let picked: Bool
        var id: Int { n }
        var name: String { "v\(n)" }
    }
    struct Journey: Decodable, Identifiable {
        let name: String; let take: String; let needs: String?; let gives: String?; let writes: Writes?; let ready: Bool
        let picked: Int?; let versions: [Version]
        var id: String { name }
    }
    let dpr: Int
    let state: State
    let states: [String: String]
    let scripts: [String: Script]
    let journeys: [Journey]
}

struct TakeReport: Decodable {
    struct Beat: Decodable, Identifiable { let n: Double; let label: String; let late: Int; var id: String { "\(n)-\(label)" } }
    struct Mark: Decodable, Identifiable { let label: String; let offset: Int; let drift: Int; var id: String { label + "\(offset)" } }
    let duration: Double; let frames: Int; let dpr: Int?; let bpm: Double?
    let beats: [Beat]; let late: Int; let worst: Int
    let against: String?; let marks: [Mark]; let unmatched: Int
}

@MainActor
final class CaptureStore: ObservableObject {
    @Published var info: CaptureInfo?
    @Published var loadError: String?
    @Published var loading = false
    /// the running command, its log and live frame
    @Published var job: CaptureJob?
    @Published var jobTitle = ""
    @Published var log: [String] = []
    @Published var live: NSImage?
    @Published var lastResult: String?
    /// reports by "take/vN"
    @Published var reports: [String: TakeReport] = [:]
    /// versions previewed in the film in place of their picks: take → "vN"
    @Published var previewing: [String: String] = [:]
    /// a write or a state mismatch waiting for a yes
    @Published var confirm: Confirm?
    struct Confirm: Identifiable { let id = UUID(); let title: String; let message: String; let action: String; let go: () -> Void }

    let path: String
    let engine: ProjectEngine
    private var poll: Timer?
    private var liveFile: String?

    init(path: String, engine: ProjectEngine) { self.path = path; self.engine = engine }

    func refresh() {
        loading = true
        let path = self.path
        Task.detached {
            let r = Result { try captureQuery(project: path, cmd: "journeys", args: []) }
            await MainActor.run {
                self.loading = false
                switch r {
                case .success(let json):
                    do { self.info = try JSONDecoder().decode(CaptureInfo.self, from: Data(json.utf8)); self.loadError = nil }
                    catch { self.loadError = Self.error(json) ?? error.localizedDescription }
                case .failure(let e): self.loadError = Self.message(e)
                }
            }
        }
    }

    // MARK: running

    /// a dry run, or a real capture (asks first when the journey writes, or the data isn't in the state it needs)
    func capture(_ j: CaptureInfo.Journey, dry: Bool) {
        var args = [j.name]
        if dry { args.append("--dry"); start("Dry run: \(j.name)", "run", args); return }
        let go: ([String]) -> Void = { [weak self] extra in self?.start("Capturing \(j.name)", "run", args + extra) }
        let current = info?.state.state
        let mismatch = j.needs != nil && j.needs != current
        let needWrite: ([String]) -> Void = { extra in
            if let w = j.writes {
                self.confirm = Confirm(title: "\(j.name) writes to the app's data", message: w.confirm, action: "Capture and Write") { go(extra + ["--yes"]) }
            } else { go(extra) }
        }
        if mismatch, let need = j.needs {
            let what = info?.states[need].map { " (\($0))" } ?? ""
            confirm = Confirm(title: "\(j.name) needs “\(need)”",
                              message: "It records the app in the data state “\(need)”\(what); the data is \(current.map { "“\($0)”" } ?? "in an unknown state"). Stage it first from the Data menu, or capture anyway.",
                              action: "Capture Anyway") { needWrite(["--force"]) }
        } else { needWrite([]) }
    }

    func stage(_ name: String, _ s: CaptureInfo.Script) {
        let go: () -> Void = { [weak self] in self?.start("Staging: \(name)", "stage", [name, "--yes"]) }
        if s.writes == true {
            confirm = Confirm(title: "\(name) writes to the app's data", message: s.confirm ?? s.run, action: "Run It", go: go)
        } else { go() }
    }

    private func start(_ title: String, _ cmd: String, _ args: [String]) {
        guard job == nil else { return }
        do {
            job = try CaptureJob.start(project: path, cmd: cmd, args: args)
            jobTitle = title; log = []; live = nil; liveFile = nil; lastResult = nil
            poll = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tick() } }
        } catch { lastResult = Self.message(error) }
    }

    private func tick() {
        guard let job else { return }
        log = job.log()
        if let f = job.latestFrame(), f != liveFile { liveFile = f; live = NSImage(contentsOfFile: f) }
        guard !job.running() else { return }
        poll?.invalidate(); poll = nil
        let json = job.result() ?? "{}"
        self.job = nil
        if let e = Self.error(json) { lastResult = "✗ \(e)" }
        else if let o = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] {
            if let v = o["version"] as? String, let take = o["take"] as? String {
                lastResult = "✓ \(take) \(v): \(o["late"] as? Int ?? 0) late beat(s). Preview it in the film, then pick it."
                if let r = o["report"], let d = try? JSONSerialization.data(withJSONObject: r), let rep = try? JSONDecoder().decode(TakeReport.self, from: d) { reports["\(take)/\(v)"] = rep }
            } else if o["dry"] as? Bool == true { lastResult = "✓ dry run ok: screenshots in \(o["dir"] as? String ?? "")" }
            else if let st = (o["state"] as? [String: Any])?["state"] as? String { lastResult = "✓ data state: \(st)" }
            else { lastResult = "✓ done" }
        }
        refresh()
    }

    func stop() { job?.stop() }

    // MARK: versions

    func report(_ take: String, _ v: CaptureInfo.Version) {
        let path = self.path, key = "\(take)/\(v.name)"
        Task.detached {
            guard let json = try? captureQuery(project: path, cmd: "report", args: [take, v.name]),
                  let r = try? JSONDecoder().decode(TakeReport.self, from: Data(json.utf8)) else { return }
            await MainActor.run { self.reports[key] = r }
        }
    }

    /// show this version in the film in place of the pick (nil: back to the pick)
    func preview(_ take: String, _ v: String?) {
        previewing[take] = v
        engine.setTakeVersions(value: previewing.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ","))
    }

    func pick(_ take: String, _ v: CaptureInfo.Version) {
        let path = self.path
        Task.detached {
            let r = Result { try captureQuery(project: path, cmd: "pick", args: [take, v.name]) }
            await MainActor.run {
                if case .success(let json) = r, Self.error(json) == nil {
                    self.lastResult = "✓ the film now uses \(take) \(v.name)"
                    if self.previewing[take] != nil { self.preview(take, nil) }
                } else if case .success(let json) = r { self.lastResult = "✗ \(Self.error(json) ?? "")" }
                else if case .failure(let e) = r { self.lastResult = "✗ \(Self.message(e))" }
                self.refresh()
            }
        }
    }

    nonisolated static func error(_ json: String) -> String? {
        guard let o = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any], o["ok"] as? Bool == false else { return nil }
        return o["error"] as? String ?? "failed"
    }
    nonisolated static func message(_ e: Error) -> String {
        if case FlexError.Failed(let m) = e { return m }
        return e.localizedDescription
    }
}

struct CapturePanel: View {
    @ObservedObject var cap: CaptureStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(12)
            Divider()
            if cap.job != nil || cap.lastResult != nil { running.padding(12); Divider() }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let e = cap.loadError {
                        Text(e).font(.system(.caption, design: .monospaced)).foregroundStyle(.orange).textSelection(.enabled)
                    }
                    if let info = cap.info {
                        if info.journeys.isEmpty { Text("No journeys: journeys/<name>.ts exporting `take` and `run`.").foregroundStyle(.secondary) }
                        ForEach(info.journeys) { JourneyRow(cap: cap, j: $0, dpr: info.dpr) }
                    } else if cap.loading { ProgressView().frame(maxWidth: .infinity) }
                }
                .padding(12)
            }
        }
        .frame(minWidth: 320, idealWidth: 380)
        .onAppear { if cap.info == nil { cap.refresh() } }
        .alert(item: $cap.confirm) { c in
            Alert(title: Text(c.title), message: Text(c.message), primaryButton: .destructive(Text(c.action), action: c.go), secondaryButton: .cancel())
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text("Capture").font(.headline)
            Spacer()
            if let info = cap.info {
                Menu {
                    Section("Data state: \(info.state.state ?? "unknown")") {
                        if let s = info.state.state, let about = info.states[s] { Text(about) }
                    }
                    Section("Staging scripts") {
                        ForEach(info.scripts.keys.sorted(), id: \.self) { k in
                            let s = info.scripts[k]!
                            Button("\(k)\(s.gives.map { " → \($0)" } ?? "")\(s.writes == true ? "  (writes)" : "")") { cap.stage(k, s) }
                                .help(s.about ?? s.confirm ?? s.run)
                        }
                    }
                } label: {
                    Label(info.state.state ?? "data: unknown", systemImage: "cylinder.split.1x2")
                }
                .fixedSize()
                .disabled(cap.job != nil)
                .help("The app's data state (\(info.state.checked == true ? "checked just now" : "as the last script left it")), and the scripts that stage it")
            }
            Button { cap.refresh() } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.borderless).help("Check the data state and re-read the journeys")
        }
    }

    private var running: some View {
        VStack(alignment: .leading, spacing: 8) {
            if cap.job != nil {
                HStack {
                    ProgressView().controlSize(.small)
                    Text(cap.jobTitle).font(.callout.weight(.medium))
                    Spacer()
                    Button("Stop") { cap.stop() }.controlSize(.small)
                }
                ZStack {
                    Rectangle().fill(.black)
                    if let img = cap.live { Image(nsImage: img).resizable().interpolation(.medium).aspectRatio(contentMode: .fit) }
                    else { Text(cap.jobTitle.hasPrefix("Capturing") ? "warming up (a dry run first)…" : "rehearsing: no recording").font(.caption).foregroundStyle(.white.opacity(0.6)) }
                }
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                ScrollViewReader { sv in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 1) {
                            ForEach(Array(cap.log.suffix(200).enumerated()), id: \.offset) { i, l in
                                Text(l).font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(l.contains("!") ? Color.orange : .secondary).id(i)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(height: 110)
                    .onChange(of: cap.log.count) { sv.scrollTo(min(cap.log.count, 200) - 1, anchor: .bottom) }
                }
            }
            if let r = cap.lastResult {
                Text(r).font(.caption).foregroundStyle(r.hasPrefix("✗") ? .orange : .secondary).textSelection(.enabled).lineLimit(4)
            }
        }
    }
}

struct JourneyRow: View {
    @ObservedObject var cap: CaptureStore
    let j: CaptureInfo.Journey
    let dpr: Int
    @State private var open: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(j.name).font(.callout.weight(.semibold))
                Text("→ \(j.take)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                Button("Dry Run") { cap.capture(j, dry: true) }.help("Rehearse the journey in a fresh browser: no recording, screenshots per mark")
                Button("Capture") { cap.capture(j, dry: false) }.help("Warm up with a dry run, then record a new version at \(dpr)×")
            }
            .controlSize(.small).disabled(cap.job != nil)
            HStack(spacing: 6) {
                if let need = j.needs { Badge(text: "needs \(need)", color: j.ready ? .green : .orange) }
                if let g = j.gives { Badge(text: "leaves \(g)", color: .secondary) }
                if j.writes != nil { Badge(text: "writes", color: .orange) }
            }
            ForEach(j.versions.reversed()) { v in version(v) }
            if j.versions.isEmpty { Text("not versioned yet: the first capture keeps the current take as v0").font(.caption2).foregroundStyle(.tertiary) }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
    }

    @ViewBuilder private func version(_ v: CaptureInfo.Version) -> some View {
        let previewed = cap.previewing[j.take] == v.name
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: v.picked ? "checkmark.circle.fill" : "circle").foregroundStyle(v.picked ? Color.accentColor : .secondary)
                    .help(v.picked ? "The film uses this version" : "")
                Text(v.name).font(.system(.caption, design: .monospaced).weight(.semibold))
                Text(Self.when(v.at)).font(.caption2).foregroundStyle(.secondary)
                if let d = v.duration { Text(String(format: "%.1f s", d / 1000)).font(.caption2).foregroundStyle(.secondary) }
                if let late = v.late { Text(late == 0 ? "on the beat" : "\(late) late").font(.caption2).foregroundStyle(late == 0 ? .green : .orange) }
                Spacer()
                Button { open = open == v.n ? nil : v.n; if open != nil { cap.report(j.take, v) } } label: { Image(systemName: "chart.bar.xaxis") }
                    .help("Timing report")
                if !v.picked {
                    Button { cap.preview(j.take, previewed ? nil : v.name) } label: { Image(systemName: previewed ? "eye.fill" : "eye") }
                        .help(previewed ? "Back to the pick in the film" : "Preview this version in the film (the pick stays until you pick)")
                    Button("Pick") { cap.pick(j.take, v) }.controlSize(.mini)
                        .help("The film uses this version; the pick's locked camera plan comes along, shifted by each mark's offset")
                }
            }
            .buttonStyle(.borderless)
            if let note = v.note { Text(note).font(.caption2).foregroundStyle(.tertiary) }
            if open == v.n, let r = cap.reports["\(j.take)/\(v.name)"] { ReportView(r: r) }
        }
        .padding(.leading, 2)
        .background(previewed ? Color.accentColor.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 4))
    }

    static func when(_ iso: String) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return iso }
        return d.formatted(date: .abbreviated, time: .shortened)
    }
}

struct ReportView: View {
    let r: TakeReport
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if r.beats.isEmpty { Text("no beat log (captured before Flex logged beats)").font(.caption2).foregroundStyle(.tertiary) }
            ForEach(r.beats) { b in
                row("beat \(b.n.formatted())", b.label, b.late, "\(b.late >= 0 ? "+" : "")\(b.late) ms")
            }
            if !r.marks.isEmpty {
                Text("against the \(r.against ?? "pick"): drift from the first mark").font(.caption2).foregroundStyle(.secondary).padding(.top, 4)
                ForEach(r.marks) { m in row("", m.label, m.drift, "\(m.drift >= 0 ? "+" : "")\(m.drift) ms") }
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.05)))
    }
    private func row(_ a: String, _ label: String, _ ms: Int, _ v: String) -> some View {
        HStack {
            Text(a).frame(width: 52, alignment: .leading).foregroundStyle(.secondary)
            Text(label).lineLimit(1)
            Spacer()
            Text(v).monospacedDigit().foregroundStyle(abs(ms) > 40 ? .orange : .secondary)
        }
        .font(.system(size: 10, design: .monospaced))
    }
}

struct Badge: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.caption2.weight(.medium)).foregroundStyle(color)
            .padding(.horizontal, 6).padding(.vertical, 1)
            .background(color.opacity(0.12), in: Capsule())
    }
}

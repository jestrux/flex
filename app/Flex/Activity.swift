import SwiftUI

/// The activity panel: one lane per agent (the main one and each subagent), the flex commands they ran, the files
/// that changed and what they said, on one clock. Lane B owns this file; the rows are in ActivityViews.swift.
///
/// The engine's trail (flex_core::activity) is polled every 1.5 s while the panel shows. Events arrive unfolded, and
/// the store folds them as they come: a command replaces the agent's Bash call that ran it, a result updates its call,
/// a change gives the Edit that made it the file's real diff.
@MainActor
final class ActivityStore: ObservableObject {
    let path: String
    let engine: ProjectEngine

    /// One row: an event, plus what later events told us about it.
    struct Item: Identifiable {
        var e: ActivityEvent
        var ok: Bool?
        var durMs: UInt64?
        var diff: String?
        var detail: String?
        var id: String { e.id }
        init(_ e: ActivityEvent) { self.e = e; ok = e.ok; durMs = e.durMs; diff = e.diff; detail = e.detail }
    }

    @Published var lanes: [ActivityLane] = []
    /// oldest first
    @Published private(set) var items: [Item] = []
    @Published var loading = false
    @Published var error: String?
    /// lanes shown (empty: all); `-activityLane <id or words of its label>` at launch
    @Published var laneFilter: Set<String> = []
    /// kinds shown (empty: all); `-activityKind command,change` at launch
    @Published var kindFilter: Set<Group> = Set((UserDefaults.standard.string(forKey: "activityKind") ?? "")
        .split(separator: ",").compactMap { Group.of(String($0)) })
    /// rows opened to their diff or detail; `-activityExpand <words of a title>` opens the matching ones
    @Published var expanded: Set<String> = []
    /// whether the app writes file changes into the project's trail (FLEX_ACTIVITY=off: it doesn't)
    @Published var records = true
    /// what an agent made, by project-relative path: the files its flex commands made and the files it wrote (Write),
    /// with the agent's lane label (the assets panel's "made by" marks)
    @Published private(set) var madeBy: [String: String] = [:]

    /// What the kind filter offers: the agent's own account is three kinds, shown together.
    enum Group: String, CaseIterable, Identifiable {
        case commands, changes, words, tools, agents
        var id: String { rawValue }
        var title: String {
            switch self {
            case .commands: "Flex commands"
            case .changes: "File changes"
            case .words: "Prompts and messages"
            case .tools: "Tool calls"
            case .agents: "Subagents and reports"
            }
        }
        static func of(_ kind: String) -> Group? {
            switch kind {
            case "command", "commands": .commands
            case "change", "changes": .changes
            case "prompt", "message", "words": .words
            case "tool", "result", "tools": .tools
            case "spawn", "done", "checkpoint", "agents": .agents
            default: nil
            }
        }
    }

    private var trail: ActivityTrail?
    private var timer: Timer?
    private var polling = false
    private var index: [String: Int] = [:]
    /// calls a command replaced (their late results are dropped)
    private var replaced: Set<String> = []
    private let expandMatch = UserDefaults.standard.string(forKey: "activityExpand")
    private let laneMatch = UserDefaults.standard.string(forKey: "activityLane")
    private static let kept = 5000

    init(path: String, engine: ProjectEngine) { self.path = path; self.engine = engine }

    /// Start following (the panel appeared).
    func start() {
        if trail == nil {
            let since = activitySince(text: UserDefaults.standard.string(forKey: "activitySince") ?? "24h")
                ?? Int64(Date().timeIntervalSince1970 * 1000) - 86_400_000
            trail = ActivityTrail(path: path, sinceMs: since)
            records = trail?.records() ?? true
            loading = true
        }
        poll()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
    }

    /// Read what's new once, without following (the assets panel wants the "made by" marks).
    func catchUp() {
        if trail == nil {
            let since = activitySince(text: UserDefaults.standard.string(forKey: "activitySince") ?? "24h")
                ?? Int64(Date().timeIntervalSince1970 * 1000) - 86_400_000
            trail = ActivityTrail(path: path, sinceMs: since)
            records = trail?.records() ?? true
        }
        poll()
    }

    /// Stop following (the panel is hidden); what was read stays.
    func stop() { timer?.invalidate(); timer = nil }

    private func poll() {
        guard let trail, !polling else { return }
        polling = true
        Task.detached {
            let r = Result { try trail.poll() }
            await MainActor.run {
                self.polling = false
                self.loading = false
                switch r {
                case .success(let up): self.apply(up)
                case .failure(let e): self.error = (e as? FlexError).map { if case .Failed(let m) = $0 { m } else { "\($0)" } } ?? "\(e)"
                }
            }
        }
    }

    private func apply(_ up: ActivityUpdate) {
        lanes = up.lanes
        if let m = laneMatch, laneFilter.isEmpty, !up.lanes.isEmpty {
            laneFilter = Set(up.lanes.filter { $0.id == m || $0.id.contains(m) || $0.label.localizedCaseInsensitiveContains(m) }.map(\.id))
        }
        guard !up.events.isEmpty else { return }
        noteMade(up)
        var list = items
        for e in up.events { fold(e, into: &list) }
        if list.count > Self.kept { list.removeFirst(list.count - Self.kept) }
        reindex(list)
        items = list
        if let m = expandMatch {
            for i in list where i.e.title.localizedCaseInsensitiveContains(m) && (i.diff != nil || i.detail != nil) { expanded.insert(i.id) }
        }
    }

    private func noteMade(_ up: ActivityUpdate) {
        var made = madeBy
        for e in up.events where e.lane != "flex" {
            guard let label = up.lanes.first(where: { $0.id == e.lane })?.label else { continue }
            for m in e.made where m.place == "project" { made[m.path] = label }
            // a file the agent wrote whole; a path inside the project is relative (the trail's convention)
            if e.kind == "tool", e.tool == "Write" { for p in e.paths where !p.hasPrefix("/") && !p.hasPrefix("~") { made[p] = label } }
        }
        if made != madeBy { madeBy = made }
    }

    private func reindex(_ list: [Item]) {
        index = [:]
        for (n, i) in list.enumerated() { index[i.id] = n }
    }

    private func fold(_ e: ActivityEvent, into list: inout [Item]) {
        let call = e.refId.flatMap { index[$0] }.flatMap { $0 < list.count && list[$0].id == e.refId ? $0 : nil }
        switch e.kind {
        case "result":
            if let r = e.refId, replaced.contains(r) { return }
            if let c = call {
                list[c].ok = e.ok; list[c].durMs = e.durMs
                if e.ok == false, let d = e.detail { list[c].detail = d }
                return
            }
            if e.ok != false { return } // an answer to a call before the window: nothing to show
        case "command":
            if let c = call, let r = e.refId {
                replaced.insert(r)
                list.remove(at: c)
                reindex(list)
            }
        case "change":
            if let c = call, ["Edit", "MultiEdit", "Write"].contains(list[c].e.tool ?? "") {
                list[c].diff = e.diff ?? list[c].diff
                return
            }
        default: break
        }
        // in time order (a command's line lands after the calls that ran during it)
        var at = list.count
        while at > 0 && list[at - 1].e.tMs > e.tMs { at -= 1 }
        list.insert(Item(e), at: at)
        if at == list.count - 1 { index[e.id] = at } else { reindex(list) }
    }

    func lane(_ id: String) -> ActivityLane? { lanes.first { $0.id == id } }

    /// Newest first, through the filters.
    var shown: [Item] {
        items.reversed().filter { i in
            (laneFilter.isEmpty || laneFilter.contains(i.e.lane))
                && (kindFilter.isEmpty || Self.group(i.e).map(kindFilter.contains) == true)
        }
    }

    /// An agent's Edit or Write of a project file is a file change too.
    static func group(_ e: ActivityEvent) -> Group? {
        if e.kind == "tool", ["Edit", "MultiEdit", "Write"].contains(e.tool ?? ""), e.paths.first.map({ !$0.hasPrefix("/") }) == true { return .changes }
        return Group.of(e.kind)
    }

    func toggle(lane id: String) { if laneFilter.contains(id) { laneFilter.remove(id) } else { laneFilter.insert(id) } }
    func toggle(expanded id: String) { if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) } }

    /// A lane's colour: Flex's own is grey, each agent a stable hue.
    static func color(_ lane: String) -> Color {
        if lane == "flex" { return .gray }
        // no red or pink: red means failed
        let hues: [Color] = [.blue, .purple, .orange, .teal, .green, .indigo, .brown, .mint, .cyan]
        var h: UInt32 = 5381
        for b in lane.utf8 { h = (h &* 33) ^ UInt32(b) }
        return hues[Int(h % UInt32(hues.count))]
    }
}

struct ActivityPanel: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var activity: ActivityStore

    var body: some View {
        VStack(spacing: 0) {
            ActivityLanes(activity: activity)
            Divider()
            ActivityToolbar(activity: activity)
            Divider()
            ActivityEvents(store: store, activity: activity)
        }
        .onAppear { activity.start() }
        .onDisappear { activity.stop() }
    }
}

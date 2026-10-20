import SwiftUI

/// The activity panel's pieces (Activity.swift has the store): the lanes, the filters, the events. Lane B owns this file.

/// One row per lane, a subagent indented under its parent. Click a lane to show only it (click more to add them).
/// Lanes that only read the project come after the working ones, dimmed.
struct ActivityLanes: View {
    @ObservedObject var activity: ActivityStore

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack {
                Text("Lanes").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                if !activity.laneFilter.isEmpty {
                    Button("All") { activity.laneFilter = [] }.buttonStyle(.link).font(.caption)
                }
            }
            .padding(.bottom, 2)
            ScrollView {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(activity.lanes, id: \.id) { l in row(l) }
                }
            }
            .frame(maxHeight: 132)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }

    private func depth(_ l: ActivityLane) -> Int {
        var d = 0, p = l.parent
        while let id = p, d < 6 { d += 1; p = activity.lane(id)?.parent }
        return d
    }

    private func row(_ l: ActivityLane) -> some View {
        let on = activity.laneFilter.isEmpty || activity.laneFilter.contains(l.id)
        let dim = l.kind != "flex" && !l.works
        return Button { activity.toggle(lane: l.id) } label: {
            HStack(spacing: 6) {
                Circle().fill(ActivityStore.color(l.id)).frame(width: 7, height: 7)
                VStack(alignment: .leading, spacing: 0) {
                    Text(l.kind == "main" ? "\(l.label)" : l.label)
                        .font(.callout.weight(l.kind == "main" ? .semibold : .regular)).lineLimit(1)
                    Text(subtitle(l)).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                if l.done { Image(systemName: "checkmark.circle").font(.caption).foregroundStyle(.secondary).help("finished") }
                Text("\(l.events)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            .padding(.leading, CGFloat(depth(l)) * 14)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
            .opacity(on ? (dim ? 0.55 : 1) : 0.35)
        }
        .buttonStyle(.plain)
        .help("\(l.label): \(l.why)\(l.agentType.map { " · \($0)" } ?? "")")
    }

    private func subtitle(_ l: ActivityLane) -> String {
        switch l.kind {
        case "flex": return "commands and changes no agent claimed"
        case "main": return l.works ? "main agent" : (l.parentOnly ? "main agent · its subagents' parent" : "main agent · reads the project")
        default: return [l.agentType, l.works ? nil : "reads the project"].compactMap { $0 }.joined(separator: " · ")
        }
    }
}

/// The kind filter and the trail's state.
struct ActivityToolbar: View {
    @ObservedObject var activity: ActivityStore

    var body: some View {
        HStack(spacing: 8) {
            Menu {
                Button(activity.kindFilter.isEmpty ? "✓ Everything" : "Everything") { activity.kindFilter = [] }
                Divider()
                ForEach(ActivityStore.Group.allCases) { g in
                    Button((activity.kindFilter.contains(g) ? "✓ " : "") + g.title) {
                        if activity.kindFilter.contains(g) { activity.kindFilter.remove(g) } else { activity.kindFilter.insert(g) }
                    }
                }
            } label: {
                Label(activity.kindFilter.isEmpty ? "Everything" : activity.kindFilter.map(\.title).sorted().joined(separator: ", "),
                      systemImage: "line.3.horizontal.decrease")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .font(.caption)
            Spacer()
            if activity.loading { ProgressView().controlSize(.mini) }
            if !activity.records {
                Text("not recording").font(.caption2).foregroundStyle(.secondary).help("FLEX_ACTIVITY=off: the app doesn't write file changes into the project")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
    }
}

/// The events, newest first.
struct ActivityEvents: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var activity: ActivityStore

    var body: some View {
        let shown = activity.shown
        if let e = activity.error, activity.items.isEmpty {
            Text(e).font(.caption).foregroundStyle(.red).padding().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        } else if shown.isEmpty {
            VStack(spacing: 6) {
                if activity.loading { ProgressView() } else {
                    Image(systemName: "list.bullet.rectangle").font(.title2).foregroundStyle(.tertiary)
                    Text(activity.items.isEmpty ? "Nothing yet" : "Nothing matches the filters").font(.callout)
                    if activity.items.isEmpty {
                        Text("Every flex command run on this project, every change to its files, and the agents working in it show up here.")
                            .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(shown.prefix(1500)) { i in
                        ActivityRow(store: store, activity: activity, item: i)
                        Divider().opacity(0.5)
                    }
                }
            }
        }
    }
}

struct ActivityRow: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var activity: ActivityStore
    let item: ActivityStore.Item

    private var e: ActivityEvent { item.e }
    private var open: Bool { activity.expanded.contains(item.id) }
    private var expandable: Bool { item.diff != nil || (item.detail?.isEmpty == false) }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Rectangle().fill(ActivityStore.color(e.lane)).frame(width: 3)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: icon).font(.caption).foregroundStyle(tint).frame(width: 14)
                    Text(e.title).font(e.kind == "command" ? .system(.callout, design: .monospaced) : .callout)
                        .lineLimit(open ? 8 : 2).frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack(spacing: 6) {
                    Text(Self.time(e.tMs)).monospacedDigit()
                    Text(laneName).lineLimit(1)
                    if let d = item.durMs, d >= 1000 || e.kind == "command" { Text(Self.duration(d)) }
                    if item.ok == false { Text("failed").foregroundStyle(.red) }
                    if e.guess { Text("lane guessed").italic() }
                    if let s = seekSeconds { Text(String(format: "at %.2fs", s)).foregroundStyle(Color.accentColor) }
                    Spacer(minLength: 0)
                    if expandable { Image(systemName: open ? "chevron.down" : "chevron.right").font(.caption2) }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
                .padding(.leading, 20)
                if !e.made.isEmpty { made.padding(.leading, 20) }
                if open { expansion.padding(.leading, 20) }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
        }
        .contentShape(Rectangle())
        .onTapGesture { tap() }
        .help(e.paths.joined(separator: "\n"))
    }

    private var laneName: String {
        guard let l = activity.lane(e.lane) else { return e.lane }
        return l.kind == "flex" ? "Flex" : l.label
    }

    /// A command about a film time seeks there; anything with a diff or more to say opens; else its made file reveals.
    private func tap() {
        if let s = seekSeconds { store.seek(seconds: s) }
        if expandable { activity.toggle(expanded: item.id); return }
        if seekSeconds == nil, let m = e.made.first(where: { $0.place == "project" }) { store.reveal(asset: m.path) }
        else if seekSeconds == nil, e.kind != "command", let p = e.paths.first, !p.hasPrefix("/") { store.reveal(asset: p) }
    }

    private var seekSeconds: Double? {
        if let s = e.seekS { return s }
        if let f = e.seekFrame { return Double(f) / Double(max(1, store.player.fps)) }
        return nil
    }

    private var icon: String {
        switch e.kind {
        case "command": "terminal"
        case "change": "plus.forwardslash.minus"
        case "prompt": "person.fill"
        case "message": "text.bubble"
        case "spawn": "arrow.triangle.branch"
        case "done": "flag.checkered"
        case "checkpoint": "bookmark.fill"
        case "result": "exclamationmark.triangle"
        default:
            switch e.tool ?? "" {
            case "Edit", "MultiEdit", "Write": "pencil"
            case "Read": "doc.text"
            case "Bash": "chevron.left.forwardslash.chevron.right"
            case "Grep", "Glob": "magnifyingglass"
            case "SendMessage": "paperplane"
            default: "wrench.and.screwdriver"
            }
        }
    }

    private var tint: Color {
        if item.ok == false { return .red }
        switch e.kind {
        case "command": return .primary
        case "change": return .orange
        case "prompt", "checkpoint": return ActivityStore.color(e.lane)
        default: return .secondary
        }
    }

    /// What a command made: stills as thumbnails (click one to open it in the assets panel), the rest as chips.
    private var made: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(e.made.prefix(8), id: \.path) { m in
                    Button { if m.place == "project" { store.reveal(asset: m.path) } else { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: m.abs)]) } } label: {
                        if m.kind == "still", let img = NSImage(contentsOfFile: m.abs) {
                            Image(nsImage: img).resizable().aspectRatio(contentMode: .fit).frame(height: 54)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                                .overlay(RoundedRectangle(cornerRadius: 4).stroke(.quaternary))
                        } else {
                            Label((m.path as NSString).lastPathComponent, systemImage: Self.symbol(m.kind))
                                .font(.caption2).lineLimit(1)
                                .padding(.horizontal, 6).padding(.vertical, 3)
                                .background(.quaternary.opacity(0.6), in: Capsule())
                        }
                    }
                    .buttonStyle(.plain)
                    .help("\(m.kind): \(m.path)")
                }
            }
        }
    }

    @ViewBuilder private var expansion: some View {
        if let d = item.detail, !d.isEmpty, item.diff == nil || item.ok == false {
            Text(d).font(.caption.monospaced()).foregroundStyle(item.ok == false ? .red : .secondary)
                .textSelection(.enabled).lineLimit(40).frame(maxWidth: .infinity, alignment: .leading)
        }
        if let diff = item.diff { DiffView(text: diff) }
    }

    static func symbol(_ kind: String) -> String {
        switch kind {
        case "render", "video": "film"
        case "audio": "waveform"
        case "take-version": "record.circle"
        case "folder": "folder"
        case "data": "curlybraces"
        default: "doc"
        }
    }

    static func time(_ ms: Int64) -> String {
        let f = DateFormatter()
        f.dateFormat = Calendar.current.isDateInToday(Date(timeIntervalSince1970: Double(ms) / 1000)) ? "HH:mm:ss" : "d MMM HH:mm"
        return f.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
    }

    static func duration(_ ms: UInt64) -> String {
        ms < 1000 ? "\(ms) ms" : ms < 60_000 ? String(format: "%.1f s", Double(ms) / 1000) : "\(ms / 60_000) min \(ms / 1000 % 60) s"
    }
}

/// A unified diff, added lines green, removed red, long lines wrapped (the change is often at a line's end), cut to
/// its first 60 lines.
struct DiffView: View {
    let text: String

    var body: some View {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).prefix(60)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, l in
                Text(l.isEmpty ? " " : String(l))
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(l.hasPrefix("@@") ? Color.secondary : .primary)
                    .lineLimit(6)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(l.hasPrefix("+") ? Color.green.opacity(0.16) : l.hasPrefix("-") ? Color.red.opacity(0.16) : .clear)
            }
        }
        .padding(4)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 4))
        .textSelection(.enabled)
    }
}

import SwiftUI

/// The side panel left of the viewer: the project's assets (Assets.swift) or its activity trail (Activity.swift).
/// Shared between the two panels; the orchestrator owns this file.
enum SidePanel: String, CaseIterable {
    case assets, activity
    var title: String { self == .assets ? "Assets" : "Activity" }
}

/// What one panel asks of the rest of the window (an activity event opening an asset, jumping to a frame).
extension ProjectStore {
    /// select and open a project-relative path in the assets panel (and its source viewer)
    func reveal(asset path: String) {
        side = .assets
        assets.reveal(path)
    }
    /// move the playhead to a film time in seconds
    func seek(seconds t: Double) {
        player.seek(Int((t * Double(player.fps)).rounded()))
    }
}

struct SidePanelView: View {
    @ObservedObject var store: ProjectStore

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: Binding(get: { store.side ?? .assets }, set: { store.side = $0 })) {
                ForEach(SidePanel.allCases, id: \.self) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(8)
            Divider()
            switch store.side ?? .assets {
            case .assets: AssetsPanel(store: store, assets: store.assets).onAppear { store.activity.catchUp() }
            case .activity: ActivityPanel(store: store, activity: store.activity)
            }
        }
        // the activity trail's "made by" marks, on the assets they name
        .onReceive(store.activity.$madeBy) { store.assets.mark(madeBy: $0, project: store.path) }
        .onReceive(store.assets.$assets) { _ in store.assets.mark(madeBy: store.activity.madeBy, project: store.path) }
    }
}

extension AssetsStore {
    /// Mark each asset an agent made: `made` is by project-relative path (the activity trail's), an asset is by its file.
    func mark(madeBy made: [String: String], project: String) {
        guard !made.isEmpty else { return }
        let roots = Set([project, URL(fileURLWithPath: project).resolvingSymlinksInPath().path]).map { $0.hasSuffix("/") ? $0 : $0 + "/" }
        var marks: [String: String] = [:]
        for a in assets {
            for f in [a.file].compactMap({ $0 }) + a.files {
                guard let root = roots.first(where: { f.hasPrefix($0) }) else { continue }
                if let m = made[String(f.dropFirst(root.count))] { marks[a.id] = m; break }
            }
            if marks[a.id] == nil, let m = made[a.id] { marks[a.id] = m }
        }
        if marks != madeBy { madeBy = marks }
    }
}

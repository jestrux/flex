import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// File › Export Still… (⇧⌘E): the playhead's frame painted by the engine at a chosen width, as
/// a PNG (not a screenshot of the view). The CLI's `flex frame <dir> <frame> -o x.png --width N`.
struct StillCommands: Commands {
    @FocusedObject var store: ProjectStore?

    var body: some Commands {
        CommandGroup(after: .saveItem) {
            Button("Export Still…") { store?.exportingStill = true }
                .keyboardShortcut("e", modifiers: [.command, .shift])
                .disabled(store == nil)
        }
    }
}

struct StillExportSheet: View {
    @ObservedObject var store: ProjectStore
    @Environment(\.dismiss) private var dismiss
    @State private var choice = 1920
    @State private var custom = "2560"
    @State private var busy = false
    @State private var error: String?

    private var width: Int? { choice == 0 ? Int(custom).flatMap { (16...8192).contains($0) ? $0 : nil } : choice }

    var body: some View {
        let frame = store.player.frame, fps = store.player.fps
        VStack(alignment: .leading, spacing: 14) {
            Text("Export Still").font(.headline)
            Text("Frame \(frame) (\(Fmt.code(frame, fps: fps))\(store.scene(at: frame).map { ", \($0.id)" } ?? "")), painted by the engine as a PNG.")
                .font(.callout).foregroundStyle(.secondary)
            Picker("Width", selection: $choice) {
                Text("1920 (1080p)").tag(1920)
                Text("3840 (4K)").tag(3840)
                Text("Custom").tag(0)
            }
            .pickerStyle(.radioGroup)
            if choice == 0 {
                HStack {
                    TextField("Width", text: $custom).frame(width: 80)
                    Text(width.map { "× \($0 * 9 / 16) px" } ?? "16–8192 px").foregroundStyle(.secondary)
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled).lineLimit(4) }
            HStack {
                if busy { ProgressView().controlSize(.small); Text("Painting…").foregroundStyle(.secondary) }
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Export…") { export(frame: frame, fps: fps) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(width == nil || busy)
            }
        }
        .padding(20)
        .frame(width: 380)
    }

    private func export(frame: Int, fps: Int) {
        guard let width else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.png]
        var name = (store.path as NSString).lastPathComponent
        if case .ready(let p) = store.phase { name = p.name }
        panel.nameFieldStringValue = "\(name)-\(Fmt.code(frame, fps: fps).replacingOccurrences(of: ":", with: ".")).png"
        panel.canCreateDirectories = true
        if let d = store.exportFolder { panel.directoryURL = URL(fileURLWithPath: d) }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        store.exportFolder = url.deletingLastPathComponent().path
        busy = true; error = nil
        let engine = store.engine
        Task.detached {
            let result: String?
            do { try engine.exportStill(frame: UInt32(frame), width: UInt32(width), path: url.path); result = nil }
            catch let FlexError.Failed(message) { result = message }
            catch { result = error.localizedDescription }
            await MainActor.run {
                busy = false
                if let result { self.error = result; return }
                store.notice = "Saved \(url.lastPathComponent)"
                dismiss()
            }
        }
    }
}

import SwiftUI
import AppKit

@main
struct FlexApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // The start window: open a project folder, or one from Recent.
        Window("Flex", id: "welcome") {
            WelcomeView()
        }
        .windowResizability(.contentSize)
        .commands { OpenCommands(); StillCommands(); ToolsCommands() }

        // One window per project, like Switchboard. The value is the folder's path.
        WindowGroup(id: "project", for: String.self) { $path in
            if let path { ProjectWindow(path: path) }
        }
        .defaultSize(width: 1280, height: 760)

        // Flex › Settings… (⌘,): the keys Flex passes to the tools it runs
        Settings { SettingsView() }
    }
}

/// Recent projects, newest first.
enum Recents {
    private static let key = "recentProjects"
    static var all: [String] { UserDefaults.standard.stringArray(forKey: key) ?? [] }
    static func note(_ path: String) {
        var r = all.filter { $0 != path }
        r.insert(path, at: 0)
        UserDefaults.standard.set(Array(r.prefix(10)), forKey: key)
    }
}

/// Opening a project from anywhere (the open panel, Finder, `open -a Flex <folder>`, the
/// `-openProject <path>` launch argument) goes through here, so it opens a window once.
@MainActor
final class Opener: ObservableObject {
    static let shared = Opener()
    var openWindow: OpenWindowAction?
    private var pending: [String] = []

    func open(_ path: String) {
        let path = (path as NSString).standardizingPath
        guard let openWindow else { pending.append(path); return }
        Recents.note(path)
        openWindow(id: "project", value: path)
    }

    func attach(_ action: OpenWindowAction) {
        openWindow = action
        let p = pending; pending = []
        p.forEach(open)
    }

    func choose() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.message = "Choose a film project: a folder with a project.ts"
        panel.prompt = "Open"
        if panel.runModal() == .OK, let url = panel.url { open(url.path) }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillTerminate(_ notification: Notification) { Control.stop() }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Control.start()
        if let path = UserDefaults.standard.string(forKey: "openProject") {
            Task { @MainActor in Opener.shared.open(path) }
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        Task { @MainActor in urls.forEach { Opener.shared.open($0.path) } }
    }
}

struct OpenCommands: Commands {
    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("Open Project…") { Opener.shared.choose() }
                .keyboardShortcut("o", modifiers: [.command])
        }
    }
}

struct WelcomeView: View {
    @Environment(\.openWindow) private var openWindow
    @State private var recents = Recents.all

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Flex").font(.largeTitle.weight(.semibold))
                Text("Watch and steer a fancy-e2e-videos film while it's being built.")
                    .foregroundStyle(.secondary)
            }
            Button {
                Opener.shared.choose()
            } label: {
                Label("Open Project…", systemImage: "folder")
            }
            .controlSize(.large)
            .keyboardShortcut("o", modifiers: [.command])

            if !recents.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Recent").font(.headline)
                    ForEach(recents, id: \.self) { path in
                        Button {
                            Opener.shared.open(path)
                        } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text((path as NSString).lastPathComponent).fontWeight(.medium)
                                Text((path as NSString).abbreviatingWithTildeInPath)
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(28)
        .frame(width: 460, alignment: .leading)
        .onAppear {
            Opener.shared.attach(openWindow)
            recents = Recents.all
        }
    }
}

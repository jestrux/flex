import SwiftUI
import AppKit

/// The `flex` command's way into the app (the engine's control socket): `flex show` opens a project here and moves its
/// playhead, `flex status` reads it, `flex frame` and `flex render` use its warm session. And Flex › Install flex
/// Command…, which links the bundled command and its agent skill.
enum Control {
    private static let handler = Handler()

    /// Serve the socket (at launch). Another Flex already serving it is fine: that one answers.
    static func start() {
        do { try serveControl(handler: handler) } catch { NSLog("flex control socket: \(error)") }
    }

    static func stop() { stopControl() }

    /// Requests that need the windows, from a socket thread.
    private final class Handler: ControlHandler, @unchecked Sendable {
        func openProject(project: String?) {
            DispatchQueue.main.async {
                NSApp.activate(ignoringOtherApps: true)
                if let project { Opener.shared.open(project) }
            }
        }
    }

    /// Link the app's `flex` to ~/.flex/bin and its skill into ~/.claude/skills, then say what happened.
    @MainActor static func installTools() {
        let contents = Bundle.main.bundleURL.appendingPathComponent("Contents")
        let cli = contents.appendingPathComponent("Helpers/flex").path
        let skill = contents.appendingPathComponent("Resources/skills/flex").path
        let alert = NSAlert()
        do {
            let got = try linkTools(cli, skill)
            alert.messageText = "The flex command is installed"
            var lines = ["Command: \((got.commandPath as NSString).abbreviatingWithTildeInPath)"]
            if let s = got.skillPath { lines.append("Agent skill: \((s as NSString).abbreviatingWithTildeInPath)") }
            if let e = got.skillError { lines.append("The skill wasn't linked: \(e)") }
            switch got.claudeMd {
            case "added": lines.append("Listed /flex in ~/.claude/CLAUDE.md.")
            case "listed", "none": break
            default: lines.append("~/.claude/CLAUDE.md wasn't updated: \(got.claudeMd)")
            }
            lines.append(got.onPath
                ? "Both are links into the app, so they update when Flex does. Try “flex status” in a terminal."
                : "~/.flex/bin was added to the PATH in ~/.zshrc: open a new terminal, then try “flex status”.")
            alert.informativeText = lines.joined(separator: "\n")
        } catch {
            alert.alertStyle = .warning
            alert.messageText = "Couldn't install the flex command"
            alert.informativeText = CaptureStore.message(error)
        }
        alert.runModal()
    }
}

struct ToolsCommands: Commands {
    var body: some Commands {
        CommandGroup(after: .appSettings) {
            Button("Install flex Command…") { Control.installTools() }
        }
    }
}

/// The engine's install (a free function the enum's own `installTools` would shadow).
private func linkTools(_ cli: String, _ skill: String) throws -> ToolsInstalled { try installTools(cliPath: cli, skillDir: skill) }

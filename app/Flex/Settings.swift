import SwiftUI

/// Flex › Settings…: the OpenAI key. With one, narration is voiced by OpenAI (gpt-4o-mini-tts) instead of local Kokoro,
/// except in projects that pin Kokoro (`export const voice = "kokoro"`). It lives in Flex's support folder (keys/, readable only by
/// you), so the app and the `flex` CLI share it; `flex key set openai` does the same from a terminal.
struct SettingsView: View {
    @State private var key = ""
    @State private var saved = hasKey(name: "openai")
    @State private var engine = voiceEngine(project: nil)
    @State private var message: String?

    var body: some View {
        Form {
            Section {
                if saved {
                    LabeledContent("OpenAI key") {
                        HStack {
                            Text("Saved").foregroundStyle(.secondary)
                            Button("Remove") { act { try removeKey(name: "openai") } }
                        }
                    }
                } else {
                    SecureField("OpenAI key", text: $key, prompt: Text("sk-…"))
                        .onSubmit(save)
                    HStack {
                        Spacer()
                        Button("Save", action: save).disabled(key.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                LabeledContent("Narration voice", value: engine)
            } footer: {
                Text("With a key, narration is voiced by OpenAI instead of Kokoro. Lines are cached per voice, so switching re-voices a film's lines. A project can keep Kokoro with `export const voice = \"kokoro\"` in its project.ts.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let message { Text(message).font(.caption).foregroundStyle(.orange) }
        }
        .formStyle(.grouped)
        .frame(width: 460)
    }

    private func save() {
        let k = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !k.isEmpty else { return }
        act { try setKey(name: "openai", value: k) }
        key = ""
    }

    private func act(_ f: () throws -> Void) {
        do { try f(); message = nil } catch { message = CaptureStore.message(error) }
        saved = hasKey(name: "openai")
        engine = voiceEngine(project: nil)
    }
}

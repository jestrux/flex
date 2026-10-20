//! The activity trail end to end, on fixtures: a temp project, recorded commands, file changes, and fake Claude Code
//! transcripts in a temp root (never the real `~/.claude`).

use flex_core::activity::{self, trail, Kind, LaneKind, Options, Recorder, Trail};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Recorder::end reads the process environment and cwd: tests that record run one at a time.
static SERIAL: Mutex<()> = Mutex::new(());

fn project(dir: &Path) -> PathBuf {
    let p = dir.join("film");
    fs::create_dir_all(p.join("scenes")).unwrap();
    fs::create_dir_all(p.join("takes/.versions/home/v1/frames")).unwrap();
    fs::write(p.join("project.ts"), "export default {};\n").unwrap();
    fs::write(p.join("scenes/01-a.ts"), "one\ntwo\nthree\n").unwrap();
    fs::canonicalize(p).unwrap()
}

fn opts(since: i64, root: Option<&Path>) -> Options {
    Options { since_ms: since, claude_root: root.map(Path::to_path_buf), cache_dir: None, given: vec![] }
}

fn argv(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }

/// One transcript line.
fn line(ty: &str, ts: &str, content: serde_json::Value, extra: serde_json::Value) -> String {
    let mut v = serde_json::json!({ "type": ty, "timestamp": ts, "uuid": format!("u-{ts}-{ty}"), "cwd": "/elsewhere",
        "message": { "role": ty, "content": content } });
    if let serde_json::Value::Object(m) = extra { for (k, x) in m { v[k] = x; } }
    v.to_string() + "\n"
}

#[test]
fn records_commands_changes_and_what_they_made() {
    let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    std::env::remove_var("CLAUDE_CODE_SESSION_ID");
    std::env::remove_var("CLAUDECODE");
    std::env::remove_var("AI_AGENT");
    let t = tempfile::tempdir().unwrap();
    let p = project(t.path());
    let ps = p.to_string_lossy().into_owned();

    // the first command takes the baseline: nothing changed yet
    Recorder::begin(&argv(&["flex", "open", &ps])).end(Ok(0));
    // between commands, a scene is edited and one added
    std::thread::sleep(std::time::Duration::from_millis(5));
    fs::write(p.join("scenes/01-a.ts"), "one\n2\nthree\n").unwrap();
    fs::write(p.join("scenes/02-b.ts"), "new\n").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5)); // (an edit in the very ms a command starts counts as its)
    // a command that makes a still, a take version and changes a file while it runs
    let r = Recorder::begin(&argv(&["flex", "frame", &ps, "12.5s", "-o", &format!("{ps}/still.png")]));
    std::thread::sleep(std::time::Duration::from_millis(5));
    fs::write(p.join("still.png"), [0u8; 10]).unwrap();
    fs::create_dir_all(p.join("takes/.versions/home/v2/frames")).unwrap();
    fs::write(p.join("takes/.versions/home/v2/frames/000001.png"), [0u8; 4]).unwrap();
    fs::write(p.join("scenes/02-b.ts"), "newer\n").unwrap();
    r.end(Err("boom".into()));
    // the trail's own reads are never recorded
    Recorder::begin(&argv(&["flex", "activity", &ps])).end(Ok(0));

    let log = fs::read_to_string(activity::log_path(&p)).unwrap();
    let lines: Vec<serde_json::Value> = log.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    let kinds: Vec<&str> = lines.iter().map(|l| l["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["command", "change", "change", "command"], "{log}");
    assert_eq!(lines[0]["cmd"], "open");
    assert!(lines[0]["agent"].is_null());
    // changes found by the frame command: the edit before it is no one's, the one during it is the command's
    let edit = lines.iter().find(|l| l["path"] == "scenes/01-a.ts").unwrap();
    assert_eq!(edit["op"], "modified");
    assert_eq!(edit["diff"], "@@ -1,3 +1,3 @@\n one\n-two\n+2\n three\n");
    assert!(edit["by"].is_null());
    let during = lines.iter().find(|l| l["path"] == "scenes/02-b.ts").unwrap();
    assert_eq!(during["op"], "added");
    assert_eq!(during["by"], lines[3]["id"]);
    let frame = &lines[3];
    assert_eq!((frame["ok"].as_bool(), frame["error"].as_str()), (Some(false), Some("boom")));
    let made: Vec<(&str, &str)> = frame["made"].as_array().unwrap().iter().map(|m| (m["path"].as_str().unwrap(), m["kind"].as_str().unwrap())).collect();
    assert!(made.contains(&("still.png", "still")), "{made:?}");
    assert!(made.contains(&("takes/.versions/home/v2", "take-version")), "{made:?}");
    assert!(!made.iter().any(|(p, _)| p.contains("frames")), "never a take's frames: {made:?}");

    // the trail with no agents: everything in Flex's lane, the frame's film time picked up
    let mut tr = Trail::open(&p, opts(0, None));
    let up = tr.poll();
    assert_eq!(up.lanes.len(), 1);
    assert!(up.events.iter().all(|e| e.lane == "flex"));
    let f = up.events.iter().find(|e| e.kind == Kind::Command && e.title.contains("frame")).unwrap();
    assert_eq!(f.seek_s, Some(12.5));
    assert_eq!(f.made.iter().find(|m| m.kind == "still").unwrap().abs, format!("{ps}/still.png"));
    // and incrementally: nothing new, then the next command
    assert!(tr.poll().events.is_empty());
    fs::remove_file(p.join("scenes/02-b.ts")).unwrap();
    Recorder::begin(&argv(&["flex", "status", &ps])).end(Ok(0));
    let next = tr.poll().events;
    assert_eq!(next.iter().map(|e| e.kind).collect::<Vec<_>>(), [Kind::Command, Kind::Change]);
    assert!(next[1].title.starts_with("deleted scenes/02-b.ts"));
}

#[test]
fn commands_with_no_project_go_to_the_global_log() {
    let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let t = tempfile::tempdir().unwrap();
    std::env::set_var("FLEX_SUPPORT", t.path());
    Recorder::begin(&argv(&["flex", "doctor", "--json"])).end(Ok(0));
    std::env::remove_var("FLEX_SUPPORT");
    let log = fs::read_to_string(t.path().join("activity.jsonl")).unwrap();
    assert!(log.contains("\"cmd\":\"doctor\"") && log.contains("\"project\":null"), "{log}");
}

#[test]
fn agents_lanes_from_transcripts() {
    let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let t = tempfile::tempdir().unwrap();
    let p = project(t.path());
    let ps = p.to_string_lossy().into_owned();
    let root = t.path().join("claude");
    let sid = "11111111-2222-3333-4444-555555555555";
    let folder = root.join("-elsewhere");
    fs::create_dir_all(folder.join(sid).join("subagents")).unwrap();
    // the main agent: a prompt, a spawn of a subagent, and its end
    let main = [
        line("user", "2026-10-17T05:00:00.000Z", "Make the film".into(), serde_json::json!({})),
        line("assistant", "2026-10-17T05:00:01.000Z", serde_json::json!([{ "type": "text", "text": "Spawning a lane." }]), serde_json::json!({})),
        line("assistant", "2026-10-17T05:00:02.000Z", serde_json::json!([{ "type": "tool_use", "id": "toolu_spawn", "name": "Agent",
            "input": { "description": "Scene lane", "subagent_type": "general-purpose", "prompt": "Work on scene a" } }]), serde_json::json!({})),
        line("user", "2026-10-17T05:00:30.000Z", format!("<task-notification>\n<task-id>abc</task-id>\n<status>completed</status>\n<summary>Agent \"Scene lane\" finished</summary>\n</task-notification>").into(), serde_json::json!({ "origin": { "kind": "task-notification" } })),
        line("user", "2026-10-17T05:00:40.000Z", "<task-notification>\n<task-id>bq1</task-id>\n<tool-use-id>toolu_bg</tool-use-id>\n<status>completed</status>\n<summary>Background command \"Render\" completed (exit code 0)</summary>\n</task-notification>".into(), serde_json::json!({ "origin": { "kind": "task-notification" } })),
        // a session that only talks about another project's sibling folder isn't evidence
        line("assistant", "2026-10-17T05:00:31.000Z", serde_json::json!([{ "type": "tool_use", "id": "toolu_x", "name": "Read", "input": { "file_path": format!("{ps}-lab/project.ts") } }]), serde_json::json!({})),
    ].concat();
    fs::write(folder.join(format!("{sid}.jsonl")), main).unwrap();
    // the subagent: works in the project (an Edit, a flex command through Bash), then reports
    let sub = [
        line("user", "2026-10-17T05:00:03.000Z", "Work on scene a".into(), serde_json::json!({ "isSidechain": true })),
        line("assistant", "2026-10-17T05:00:04.000Z", serde_json::json!([{ "type": "tool_use", "id": "toolu_edit", "name": "Edit",
            "input": { "file_path": format!("{ps}/scenes/01-a.ts"), "old_string": "two", "new_string": "2" } }]), serde_json::json!({})),
        line("user", "2026-10-17T05:00:05.000Z", serde_json::json!([{ "type": "tool_result", "tool_use_id": "toolu_edit", "content": "ok" }]), serde_json::json!({})),
        line("assistant", "2026-10-17T05:00:06.000Z", serde_json::json!([{ "type": "tool_use", "id": "toolu_bash", "name": "Bash",
            "input": { "command": format!("flex frame {ps} 3s -o /tmp/x.png"), "description": "Look at 3s" } }]), serde_json::json!({})),
        line("user", "2026-10-17T05:00:09.000Z", serde_json::json!([{ "type": "tool_result", "tool_use_id": "toolu_bash", "content": [{ "type": "text", "text": "wrote" }] }]), serde_json::json!({})),
        line("assistant", "2026-10-17T05:00:10.000Z", serde_json::json!([{ "type": "tool_use", "id": "toolu_bad", "name": "Read", "input": { "file_path": format!("{ps}/nope.ts") } }]), serde_json::json!({})),
        line("user", "2026-10-17T05:00:11.000Z", serde_json::json!([{ "type": "tool_result", "tool_use_id": "toolu_bad", "is_error": true, "content": "File does not exist." }]), serde_json::json!({})),
        line("assistant", "2026-10-17T05:00:12.000Z", serde_json::json!([{ "type": "tool_use", "id": "toolu_hb", "name": "SubagentHandback", "input": { "message": "Scene a done." } }]), serde_json::json!({})),
    ].concat();
    fs::write(folder.join(sid).join("subagents/agent-abc.jsonl"), &sub).unwrap();
    fs::write(folder.join(sid).join("subagents/agent-abc.meta.json"), r#"{"agentType":"general-purpose","description":"Scene lane","toolUseId":"toolu_spawn","spawnDepth":1}"#).unwrap();
    // a subagent that only reads the project (prior art)
    fs::write(folder.join(sid).join("subagents/agent-rdr.jsonl"), [
        line("user", "2026-10-17T05:00:01.500Z", "Study the film".into(), serde_json::json!({})),
        line("assistant", "2026-10-17T05:00:02.500Z", serde_json::json!([{ "type": "tool_use", "id": "toolu_rd", "name": "Read", "input": { "file_path": format!("{ps}/scenes/01-a.ts") } }]), serde_json::json!({})),
    ].concat()).unwrap();
    fs::write(folder.join(sid).join("subagents/agent-rdr.meta.json"), r#"{"agentType":"Explore","description":"Prior art","toolUseId":"toolu_rdspawn","spawnDepth":1}"#).unwrap();
    // an unrelated session in another folder
    fs::create_dir_all(root.join("-other")).unwrap();
    fs::write(root.join("-other/99.jsonl"), line("user", "2026-10-17T05:00:00.000Z", "hello".into(), serde_json::json!({}))).unwrap();

    // Flex's log: the command the subagent ran (it carries the session id), and the change its Edit made
    let ms = |s: &str| activity::parse_iso(s).unwrap();
    let log = [
        serde_json::json!({"v":1,"kind":"change","id":"c1","ms":ms("2026-10-17T05:00:04.500Z"),"path":"scenes/01-a.ts","op":"modified","plus":1,"minus":1,"diff":"@@ -1,3 +1,3 @@\n one\n-two\n+2\n three\n","by":null}),
        serde_json::json!({"v":1,"kind":"command","id":"k1","ms":ms("2026-10-17T05:00:07.000Z"),"dur_ms":900,"cmd":"frame","argv":["flex","frame",ps,"3s","-o","/tmp/x.png"],"ok":true,"code":0,"made":[],"changed":[],"agent":{"tool":"claude-code","session":sid}}),
        serde_json::json!({"v":1,"kind":"command","id":"k2","ms":ms("2026-10-17T05:00:20.000Z"),"dur_ms":10,"cmd":"status","argv":["flex","status","."],"ok":true,"code":0,"made":[],"changed":[]}),
    ].iter().map(|v| v.to_string() + "\n").collect::<String>();
    fs::create_dir_all(activity::flex_dir(&p)).unwrap();
    fs::write(activity::log_path(&p), log).unwrap();

    let mut tr = Trail::open(&p, opts(ms("2026-10-17T04:00:00Z"), Some(&root)));
    let up = tr.poll();
    let ids: Vec<&str> = up.lanes.iter().map(|l| l.id.as_str()).collect();
    assert_eq!(ids, ["flex", &format!("s:{sid}"), "a:abc", "a:rdr"], "lanes: parent before child, working before reading");
    let reader = &up.lanes[3];
    assert_eq!((reader.works, reader.why.as_str()), (false, "reads the project"));
    assert_eq!((up.lanes[2].works, up.lanes[2].why.as_str()), (true, "works in the project's files"));
    let sub_lane = &up.lanes[2];
    assert_eq!((sub_lane.kind, sub_lane.parent.as_deref(), sub_lane.label.as_str()), (LaneKind::Subagent, Some(&*format!("s:{sid}")), "Scene lane"));
    assert!(sub_lane.done);
    assert!(up.lanes[1].parent_only, "the main agent is only the subagent's parent here");

    let ev = trail::fold(up.events);
    let by_lane = |l: &str| ev.iter().filter(|e| e.lane == l).map(|e| (e.kind, e.title.clone())).collect::<Vec<_>>();
    // the parent shows only what concerns its subagent: the spawn and the end
    let main_ev = by_lane(&format!("s:{sid}"));
    assert_eq!(main_ev.iter().map(|e| e.0).collect::<Vec<_>>(), [Kind::Spawn, Kind::Done], "{main_ev:?}");
    assert!(!ev.iter().any(|e| e.title.contains("Background")), "a parent-only lane shows only what concerns its subagents");
    let spawn = ev.iter().find(|e| e.kind == Kind::Spawn).unwrap();
    assert_eq!(spawn.child_lane.as_deref(), Some("a:abc"));
    // the subagent: its prompt, its edit (with the real file diff), its command (replacing its Bash call), a failed
    // read, its report
    let sub_ev = by_lane("a:abc");
    let kinds: Vec<Kind> = sub_ev.iter().map(|e| e.0).collect();
    assert_eq!(kinds, [Kind::Prompt, Kind::Tool, Kind::Command, Kind::Tool, Kind::Checkpoint], "{sub_ev:?}");
    let edit = ev.iter().find(|e| e.id == "toolu_edit").unwrap();
    assert_eq!(edit.paths, ["scenes/01-a.ts"]);
    assert_eq!(edit.diff.as_deref(), Some("@@ -1,3 +1,3 @@\n one\n-two\n+2\n three\n"), "the file's diff, from the shadow");
    let cmd = ev.iter().find(|e| e.kind == Kind::Command && e.title.contains("frame")).unwrap();
    assert_eq!((cmd.lane.as_str(), cmd.ref_id.as_deref(), cmd.seek_s), ("a:abc", Some("toolu_bash"), Some(3.0)));
    let bad = ev.iter().find(|e| e.id == "toolu_bad").unwrap();
    assert_eq!((bad.ok, bad.detail.as_deref()), (Some(false), Some("File does not exist.")));
    // a command no agent ran stays in Flex's lane
    assert_eq!(ev.iter().find(|e| e.title.contains("status")).unwrap().lane, "flex");
    assert!(!ev.iter().any(|e| e.title.contains("-lab")), "a sibling folder isn't the project");

    // incrementally: the subagent goes on after its report
    let more = line("assistant", "2026-10-17T05:01:00.000Z", serde_json::json!([{ "type": "text", "text": "Resumed: one more pass." }]), serde_json::json!({}));
    fs::OpenOptions::new().append(true).open(folder.join(sid).join("subagents/agent-abc.jsonl")).unwrap();
    fs::write(folder.join(sid).join("subagents/agent-abc.jsonl"), sub + &more).unwrap();
    let up = tr.poll();
    assert_eq!(up.events.len(), 1);
    assert_eq!((up.events[0].kind, up.events[0].lane.as_str()), (Kind::Message, "a:abc"));
    assert!(!up.lanes.iter().find(|l| l.id == "a:abc").unwrap().done, "resumed: not done any more");
}

/// The recorder's cost on a real project: `FLEX_OVERHEAD_PROJECT=<dir> cargo test -p flex-core --test activity_tests
/// overhead -- --ignored --nocapture`. It records `flex open <dir>` (writing the project's `.flex/`).
#[test]
#[ignore]
fn overhead() {
    let Some(dir) = std::env::var_os("FLEX_OVERHEAD_PROJECT") else { return };
    let dir = PathBuf::from(dir);
    let a = argv(&["flex", "open", &dir.to_string_lossy()]);
    let walk = std::time::Instant::now();
    let n = activity::shadow::walk(&fs::canonicalize(&dir).unwrap()).len();
    println!("walk: {n} entries in {:.1} ms", walk.elapsed().as_secs_f64() * 1e3);
    for i in 0..6 {
        let r = Recorder::begin(&a);
        let t = std::time::Instant::now();
        r.end(Ok(0));
        println!("run {i}: end() {:.1} ms", t.elapsed().as_secs_f64() * 1e3);
    }
}

#[test]
fn background_commands_end_in_their_own_lane() {
    let t = tempfile::tempdir().unwrap();
    let p = project(t.path());
    let root = t.path().join("claude");
    // a session started in the project: a full lane
    let folder = root.join(activity::transcripts::slug(&p));
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("s1.jsonl"), [
        line("assistant", "2026-10-17T05:00:00.000Z", serde_json::json!([{ "type": "tool_use", "id": "toolu_bg", "name": "Bash", "input": { "command": "flex render .", "run_in_background": true } }]), serde_json::json!({})),
        line("user", "2026-10-17T05:00:40.000Z", "<task-notification>\n<task-id>bq1</task-id>\n<tool-use-id>toolu_bg</tool-use-id>\n<status>completed</status>\n<summary>Background command \"Render\" completed (exit code 0)</summary>\n</task-notification>".into(), serde_json::json!({ "origin": { "kind": "task-notification" } })),
    ].concat()).unwrap();
    let up = Trail::open(&p, opts(activity::parse_iso("2026-10-17T04:00:00Z").unwrap(), Some(&root))).poll();
    let main = up.lanes.iter().find(|l| l.id == "s:s1").unwrap();
    assert_eq!((main.works, main.why.as_str()), (true, "started in the project"));
    let done = up.events.iter().find(|e| e.kind == Kind::Done).unwrap();
    assert_eq!((done.lane.as_str(), done.child_lane.as_deref(), done.ref_id.as_deref()), ("s:s1", None, Some("toolu_bg")));
    assert!(done.title.starts_with("Background command"));
}

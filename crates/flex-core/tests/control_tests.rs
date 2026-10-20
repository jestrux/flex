//! The control socket (what the `flex` command asks the app) and Install flex Command.

use flex_core::control::{self, Client, ControlHandler, Request};
use flex_core::install::{self, ClaudeMd};
use std::sync::{Arc, Mutex};

struct Recorder(Mutex<Vec<Option<String>>>);
impl ControlHandler for Recorder {
    fn open_project(&self, project: Option<String>) { self.0.lock().unwrap().push(project); }
}

// a short folder: a socket path must fit in 104 bytes
fn short_dir() -> tempfile::TempDir { tempfile::Builder::new().prefix("fx").tempdir_in("/tmp").unwrap() }

#[test]
fn the_socket_answers_and_opens_projects_through_the_app() {
    let d = short_dir();
    let sock = d.path().join("c.sock");
    let rec = Arc::new(Recorder(Mutex::new(vec![])));
    let server = control::serve(&sock, Some(rec.clone())).unwrap();
    let mut c = Client::connect(&sock).unwrap();
    assert_eq!(c.call(&Request::Ping).unwrap()["ok"], true);
    // no engine in this process: nothing open
    assert_eq!(c.call(&Request::Status { project: None }).unwrap()["projects"].as_array().unwrap().len(), 0);
    c.call(&Request::Open { project: Some("/films/x".into()) }).unwrap();
    assert_eq!(rec.0.lock().unwrap().as_slice(), &[Some("/films/x".to_string())]);
    // a project the app hasn't open can't be painted there
    let e = c.call(&Request::Frame { project: "/films/x".into(), frame: 0, width: None, out: d.path().join("f.png") }).unwrap_err();
    assert!(e.contains("isn't open in Flex"), "{e}");
    // a second app on the same socket is refused while the first answers
    assert!(control::serve(&sock, None).is_err());
    drop(server);
    assert!(!sock.exists());
}

#[test]
fn a_bad_request_gets_an_error_not_a_hang() {
    let d = short_dir();
    let sock = d.path().join("c.sock");
    let _server = control::serve(&sock, None).unwrap();
    let mut s = std::os::unix::net::UnixStream::connect(&sock).unwrap();
    use std::io::{BufRead, Write};
    writeln!(s, "{{\"op\":\"nonsense\"}}").unwrap();
    let mut line = String::new();
    std::io::BufReader::new(s).read_line(&mut line).unwrap();
    let v: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(v["ok"], false);
}

#[test]
fn install_links_the_command_and_the_skill_and_lists_it_once() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    let app = tempfile::tempdir().unwrap();
    let cli = app.path().join("flex");
    std::fs::write(&cli, "#!/bin/sh\n").unwrap();
    let skill = app.path().join("skills/flex");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(skill.join("SKILL.md"), "---\nname: flex\n---\n").unwrap();
    // an older copy from scripts/install-cli.sh is replaced; a skills table gets a row after its last
    std::fs::create_dir_all(h.join(".flex/bin")).unwrap();
    std::fs::write(h.join(".flex/bin/flex"), "old copy").unwrap();
    std::fs::create_dir_all(h.join(".claude")).unwrap();
    std::fs::write(h.join(".claude/CLAUDE.md"), "# Skills\n\n| Skill | What |\n|---|---|\n| `/browse` | a browser |\n\nMore text.\n").unwrap();

    let i = install::install(&cli, &skill, h).unwrap();
    assert_eq!(std::fs::read_link(&i.command).unwrap(), cli);
    assert!(!i.on_path);
    assert_eq!(std::fs::read_link(i.skill.as_ref().unwrap()).unwrap(), skill);
    assert_eq!(i.claude_md, Ok(ClaudeMd::Added(h.join(".claude/CLAUDE.md"))));
    let md = std::fs::read_to_string(h.join(".claude/CLAUDE.md")).unwrap();
    assert!(md.contains("| `/browse` | a browser |\n| `/flex` |"), "{md}");
    assert!(std::fs::read_to_string(h.join(".zshrc")).unwrap().contains(".flex/bin"));

    // again: links replaced, nothing listed twice, the PATH line not added twice
    let i = install::install(&cli, &skill, h).unwrap();
    assert!(i.on_path);
    assert_eq!(i.claude_md, Ok(ClaudeMd::AlreadyListed(h.join(".claude/CLAUDE.md"))));
    assert_eq!(std::fs::read_to_string(h.join(".claude/CLAUDE.md")).unwrap().matches("`/flex`").count(), 1);
    assert_eq!(std::fs::read_to_string(h.join(".zshrc")).unwrap().matches(".flex/bin").count(), 1);

    // a skill folder that isn't Flex's link is left alone
    let other = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(other.path().join(".claude/skills/flex")).unwrap();
    let i = install::install(&cli, &skill, other.path()).unwrap();
    assert!(i.skill.is_err());
    assert_eq!(i.claude_md, Ok(ClaudeMd::NoFile));
}

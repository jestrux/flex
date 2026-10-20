//! The app's control socket: the running Flex app serves it so the `flex` command (and the agents that call it) can see
//! what the author is looking at, move the author's playhead, and paint or render with the app's warm session, not a
//! fresh server and an empty cache.
//!
//! One JSON request per line; replies are JSON lines too. Every final reply has `ok` (and `error` when it failed); a
//! render first streams `{"progress": [done, total]}` lines. The socket is `control.sock` in Flex's support folder
//! (it moves with `FLEX_SUPPORT`) and is private to the user.

use crate::engine::Engine;
use crate::frames::Session;
use crate::server::FrameLayers;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

pub const SOCKET_NAME: &str = "control.sock";

/// `control.sock` in Flex's support folder.
pub fn socket_path() -> PathBuf { crate::project::support_dir().join(SOCKET_NAME) }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Ping,
    /// The projects open in the app (or the one at `project`): the playhead, the scene under it, what's painted.
    Status { project: Option<String> },
    /// Open `project` in the app (bringing it forward) and, with `frame`, move its playhead there.
    Show { project: String, frame: Option<u32> },
    /// Bring the app forward, on `project` when one is named.
    Open { project: Option<String> },
    /// Paint one frame with the app's session into `out` (PNG or JPEG by extension).
    Frame { project: String, frame: u32, width: Option<u32>, out: PathBuf },
    /// Render with Flex's painter and the app's session. Without `fast`, refuses (`"pipeline": true`) when the film
    /// should go through the pipeline (captured takes, something the painter can't draw).
    Render { project: String, part: crate::render::Part, size: Option<String>, fast: bool },
}

/// What the app does for requests the engine can't answer alone (implemented by the app's windows).
pub trait ControlHandler: Send + Sync {
    /// Bring the app forward; open (or focus) the project's window when one is named.
    fn open_project(&self, project: Option<String>);
}

// ---- the open projects (each Engine registers itself) ----

fn registry() -> &'static Mutex<Vec<Weak<Engine>>> {
    static R: std::sync::OnceLock<Mutex<Vec<Weak<Engine>>>> = std::sync::OnceLock::new();
    R.get_or_init(Default::default)
}

pub(crate) fn register(e: &Arc<Engine>) {
    let mut r = registry().lock().unwrap();
    r.retain(|w| w.upgrade().is_some_and(|e| !e.closed()));
    r.push(Arc::downgrade(e));
}

/// The open engines, newest first.
pub fn open_engines() -> Vec<Arc<Engine>> {
    let r = registry().lock().unwrap();
    r.iter().rev().filter_map(|w| w.upgrade()).filter(|e| !e.closed()).collect()
}

fn same(a: &Path, b: &Path) -> bool {
    a == b || std::fs::canonicalize(a).ok().zip(std::fs::canonicalize(b).ok()).is_some_and(|(x, y)| x == y)
}

fn find(project: &str) -> Option<Arc<Engine>> { open_engines().into_iter().find(|e| same(&e.dir, Path::new(project))) }

/// A loaded session of `project`'s engine, waiting up to `wait` for it (a window that has just opened is still loading).
fn session_of(project: &str, wait: Duration) -> Result<(Arc<Engine>, Arc<Session>), String> {
    let t = Instant::now();
    loop {
        if let Some(e) = find(project) {
            let st = e.state();
            if let (Some(s), false) = (e.session(), st.loading) { return Ok((e, s)); }
            if let (Some(err), false) = (st.error, st.loading) { return Err(format!("the project didn't load: {err}")); }
        }
        if t.elapsed() > wait { return Err(format!("{project} isn't open in Flex")); }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn status_of(e: &Engine) -> Value {
    let st = e.state();
    let Some(s) = e.session() else {
        return json!({ "dir": e.dir, "loading": st.loading, "error": st.error });
    };
    let m = s.manifest();
    let f = e.playhead().min(m.frames.saturating_sub(1));
    let (painted, total) = st.scenes.iter().fold((0, 0), |(a, b), (_, p, t)| (a + p, b + t));
    json!({
        "dir": e.dir, "name": m.name, "fps": m.fps, "frames": m.frames, "duration": m.duration, "size": m.size,
        "playhead": { "frame": f, "t": f as f64 / m.fps as f64, "scene": m.scene_at(f).map(|x| x.id.clone()) },
        "loading": st.loading, "error": st.error, "painted": painted, "total": total, "variants": st.variants,
        "rendering": e.rendering().map(|(d, n, what)| json!({ "done": d, "total": n, "what": what })),
        "scenes": m.scenes.iter().map(|x| json!({ "id": x.id, "first": x.first, "frames": x.frames })).collect::<Vec<_>>(),
    })
}

// ---- serving ----

/// A served socket. Dropping it stops serving and removes the socket file.
pub struct ControlServer { path: PathBuf, stop: Arc<AtomicBool> }

impl Drop for ControlServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = UnixStream::connect(&self.path); // wake the accept loop so it sees the flag
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Serve the control socket at `path`. Fails when another Flex already answers there.
pub fn serve(path: &Path, handler: Option<Arc<dyn ControlHandler>>) -> Result<ControlServer, String> {
    if let Some(mut c) = Client::connect(path) {
        if c.call(&Request::Ping).is_ok() { return Err(format!("another Flex already serves {}", path.display())); }
    }
    let _ = std::fs::remove_file(path);
    if let Some(d) = path.parent() { let _ = std::fs::create_dir_all(d); }
    let listener = UnixListener::bind(path).map_err(|e| format!("{}: {e}", path.display()))?;
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    let stop = Arc::new(AtomicBool::new(false));
    let s2 = stop.clone();
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            if s2.load(Ordering::SeqCst) { break; }
            let Ok(conn) = conn else { continue };
            let h = handler.clone();
            std::thread::spawn(move || { let _ = answer(conn, h); });
        }
    });
    Ok(ControlServer { path: path.to_path_buf(), stop })
}

fn answer(conn: UnixStream, handler: Option<Arc<dyn ControlHandler>>) -> std::io::Result<()> {
    let mut out = conn.try_clone()?;
    for line in BufReader::new(conn).lines() {
        let line = line?;
        if line.trim().is_empty() { continue; }
        let reply = match serde_json::from_str::<Request>(&line) {
            Ok(req) => handle(req, handler.as_deref(), &mut |v: Value| { let _ = writeln!(out, "{v}"); }),
            Err(e) => json!({ "ok": false, "error": format!("bad request: {e}") }),
        };
        writeln!(out, "{reply}")?;
    }
    Ok(())
}

fn fail(e: impl std::fmt::Display) -> Value { json!({ "ok": false, "error": e.to_string() }) }

fn handle(req: Request, handler: Option<&dyn ControlHandler>, stream: &mut (dyn FnMut(Value) + Send)) -> Value {
    match req {
        Request::Ping => json!({ "ok": true, "pid": std::process::id(), "version": env!("CARGO_PKG_VERSION") }),
        Request::Status { project } => {
            let es = open_engines();
            let es: Vec<_> = match &project { Some(p) => es.into_iter().filter(|e| same(&e.dir, Path::new(p))).collect(), None => es };
            json!({ "ok": true, "projects": es.iter().map(|e| status_of(e)).collect::<Vec<_>>() })
        }
        Request::Open { project } => {
            match handler { Some(h) => { h.open_project(project); json!({ "ok": true }) } None => fail("this Flex has no windows") }
        }
        Request::Show { project, frame } => {
            let Some(h) = handler else { return fail("this Flex has no windows") };
            h.open_project(Some(project.clone()));
            match session_of(&project, Duration::from_secs(60)) {
                Ok((e, s)) => {
                    if let Some(f) = frame { e.request_seek(f.min(s.manifest().frames.saturating_sub(1))); }
                    json!({ "ok": true, "status": status_of(&e) })
                }
                Err(err) => fail(err),
            }
        }
        Request::Frame { project, frame, width, out } => {
            let (_, s) = match session_of(&project, Duration::from_secs(1)) { Ok(x) => x, Err(e) => return fail(e) };
            let t = Instant::now();
            match s.server.layers(frame) {
                Ok(FrameLayers::Layers(l)) => {
                    let w = width.unwrap_or(s.manifest().size[0]);
                    match crate::paint::paint_in(&l, s.manifest().size, w) {
                        Ok(p) => match crate::paint::save(&p.pixmap, &out, 92) {
                            Ok(()) => json!({ "ok": true, "out": out, "layers": l.len(), "ms": t.elapsed().as_millis() as u64, "skipped": p.skipped,
                                "scene": s.manifest().scene_at(frame).map(|x| x.id.clone()), "t": frame as f64 / s.manifest().fps as f64 }),
                            Err(e) => fail(e),
                        },
                        Err(e) => fail(e),
                    }
                }
                Ok(FrameLayers::Placeholder(why)) => fail(format!("frame {frame} has nothing to paint yet: {why}")),
                Ok(FrameLayers::Error(e)) => fail(format!("frame {frame}: the scene's code threw:\n{e}")),
                Err(e) => fail(e),
            }
        }
        Request::Render { project, part, size, fast } => {
            let (e, s) = match session_of(&project, Duration::from_secs(1)) { Ok(x) => x, Err(err) => return fail(err) };
            if !e.state().variants.is_empty() {
                return json!({ "ok": false, "standalone": true, "error": "the app runs the film with a variant or a take preview" });
            }
            let why = crate::render::painter_refuses(&s);
            if !fast && !why.is_empty() && !matches!(part, crate::render::Part::Range { .. }) {
                return json!({ "ok": false, "pipeline": true, "error": why.join("; ") });
            }
            let what = match &part { crate::render::Part::Film => "the film".to_string(), crate::render::Part::Scene { id } => format!("scene {id}"), crate::render::Part::Range { from, to } => format!("{from:.2}–{to:.2} s") };
            e.set_rendering(Some((0, 0, what)));
            let stream = Mutex::new(stream);
            let r = crate::render::render_film(&s, &part, size.as_deref(),
                |step| (stream.lock().unwrap())(json!({ "say": step })),
                |d, n| { e.set_rendering_progress(d, n); (stream.lock().unwrap())(json!({ "progress": [d, n] })); });
            e.set_rendering(None);
            match r { Ok(r) => json!({ "ok": true, "rendered": r }), Err(err) => fail(err) }
        }
    }
}

// ---- the client (the `flex` command) ----

pub struct Client { reader: BufReader<UnixStream>, writer: UnixStream }

impl Client {
    pub fn connect(path: &Path) -> Option<Client> {
        let s = UnixStream::connect(path).ok()?;
        let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
        Some(Client { reader: BufReader::new(s.try_clone().ok()?), writer: s })
    }

    /// Connect to the running app, if it answers.
    pub fn app() -> Option<Client> {
        let mut c = Client::connect(&socket_path())?;
        c.call(&Request::Ping).ok()?;
        Some(c)
    }

    /// One request, its final reply (`ok` true); streamed lines go to `each`. No time limit once sent (renders are long).
    pub fn call_streaming(&mut self, req: &Request, mut each: impl FnMut(&Value)) -> Result<Value, String> {
        let line = serde_json::to_string(req).map_err(|e| e.to_string())?;
        writeln!(self.writer, "{line}").map_err(|e| e.to_string())?;
        if !matches!(req, Request::Ping) { let _ = self.reader.get_ref().set_read_timeout(None); }
        loop {
            let mut buf = String::new();
            if self.reader.read_line(&mut buf).map_err(|e| e.to_string())? == 0 { return Err("Flex closed the connection".into()); }
            let v: Value = serde_json::from_str(buf.trim()).map_err(|e| format!("bad reply: {e}"))?;
            if v.get("ok").is_some() {
                return if v["ok"].as_bool() == Some(true) { Ok(v) } else { Err(serde_json::to_string(&v).unwrap_or_default()) };
            }
            each(&v);
        }
    }

    pub fn call(&mut self, req: &Request) -> Result<Value, String> { self.call_streaming(req, |_| {}) }
}

/// Wait up to `within` for an app to serve the socket.
pub fn wait_for_app(within: Duration) -> Option<Client> {
    let t = Instant::now();
    while t.elapsed() < within {
        if let Some(c) = Client::app() { return Some(c); }
        std::thread::sleep(Duration::from_millis(150));
    }
    None
}

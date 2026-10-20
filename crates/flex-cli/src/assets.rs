//! `flex assets`: the project's assets, as the app's assets panel shows them, grouped by kind with what was measured;
//! `--preview <id> -o x.png|x.mp4` writes one the way the source viewer shows it (a waveform-and-words sheet, a take's
//! proxy, a card alone, a still with its boxes, a render's still), so an agent can look at what the author will.
use anyhow::{bail, Result};
use flex_core::assets::{self, Asset, Kind};
use std::path::PathBuf;

#[derive(clap::Args)]
pub struct Args {
    /// the project folder
    pub dir: PathBuf,
    /// print JSON
    #[arg(long)]
    pub json: bool,
    /// only these kinds (music, stem, sound, take, take-version, card, look, lab, freeze, still, image, render); repeat or comma-separate
    #[arg(long, value_delimiter = ',')]
    pub kind: Vec<String>,
    /// write this asset's preview (its id, or a project path naming it) to -o
    #[arg(long, value_name = "ID")]
    pub preview: Option<String>,
    /// the preview's file: .png/.jpg (a picture) or .mp4 (a clip)
    #[arg(short = 'o', long = "out")]
    pub out: Option<PathBuf>,
    /// the preview's width in pixels (cards, takes, renders; default 1280)
    #[arg(long)]
    pub width: Option<u32>,
    /// use the cached card list even when it is stale (listing cards runs the pipeline: 2–4 s)
    #[arg(long)]
    pub cached: bool,
    /// the renders folder (default ~/Downloads/flex-videos/<film>/)
    #[arg(long)]
    pub renders: Option<PathBuf>,
}

pub fn run(a: Args) -> Result<()> {
    let kinds: Vec<Kind> = a.kind.iter().map(|k| Kind::parse(k).ok_or_else(|| anyhow::anyhow!("no asset kind \"{k}\""))).collect::<Result<_>>()?;
    let opt = assets::Options { track: None, renders: a.renders.clone(), refresh_cards: !a.cached };
    let scan = assets::scan(&a.dir, &opt)?;

    use std::fmt::Write;
    let mut o = String::new();
    if let Some(id) = &a.preview {
        let Some(asset) = scan.find(id) else { bail!("no asset \"{id}\" (flex assets {} lists them)", a.dir.display()) };
        let Some(out) = &a.out else { bail!("--preview needs -o x.png or x.mp4") };
        assets::preview::write(&scan.dir, asset, out, a.width)?;
        let words = if asset.kind.is_audio() { assets::preview::words(&scan.dir, asset) } else { vec![] };
        if a.json {
            writeln!(o, "{}", serde_json::json!({ "ok": true, "id": asset.id, "kind": asset.kind, "file": out, "words": words }))?;
        } else {
            writeln!(o, "{}  ({} {})", out.display(), asset.kind.name(), asset.id)?;
            let mut line = -1i64;
            for w in &words {
                if w.line as i64 != line { if line >= 0 { o.push('\n'); } line = w.line as i64; write!(o, "  {:>7.2}s ", w.start)?; }
                write!(o, " {}", w.word)?;
            }
            if !words.is_empty() { o.push('\n'); }
        }
        return emit(&o);
    }

    let shown: Vec<&Asset> = scan.assets.iter().filter(|x| kinds.is_empty() || kinds.contains(&x.kind)).collect();
    if a.json {
        writeln!(o, "{}", serde_json::to_string_pretty(&serde_json::json!({
            "ok": true, "dir": scan.dir, "ms": scan.ms, "cards_stale": scan.cards_stale, "cards_error": scan.cards_error, "assets": shown,
        }))?)?;
        return emit(&o);
    }
    writeln!(o, "{}  {} assets  ({:.0} ms)", scan.dir.display(), shown.len(), scan.ms)?;
    match &scan.cards_error {
        Some(e) => writeln!(o, "  the cards couldn't be listed: {}", e.lines().next().unwrap_or_default())?,
        None if scan.cards_stale => writeln!(o, "  the card list is stale (run without --cached)")?,
        None => {}
    }
    for k in Kind::ALL {
        let group: Vec<&&Asset> = shown.iter().filter(|x| x.kind == k).collect();
        if group.is_empty() || k == Kind::TakeVersion && kinds.is_empty() { continue; }
        writeln!(o, "\n{} ({})", k.name(), group.len())?;
        // images and stills come in numbers: by folder, folded to a count unless the kind was asked for
        if matches!(k, Kind::Image | Kind::Still) {
            let mut folders: Vec<&str> = group.iter().map(|x| x.group.as_deref().unwrap_or("")).collect();
            folders.dedup();
            for f in folders {
                let inside: Vec<&&&Asset> = group.iter().filter(|x| x.group.as_deref().unwrap_or("") == f).collect();
                writeln!(o, "  {f}/  ({})", inside.len())?;
                if kinds.contains(&k) { for x in inside { writeln!(o, "    {:<32} {:<44} {}", clip(&x.title, 32), facts(x), x.id)?; } }
            }
            continue;
        }
        for x in group {
            writeln!(o, "  {:<34} {:<44} {}", clip(&x.title, 34), facts(x), x.id)?;
            // a take's versions under it
            if k == Kind::Take && kinds.is_empty() {
                for v in shown.iter().filter(|v| v.parent.as_deref() == Some(x.id.as_str())) {
                    writeln!(o, "    {:<32} {:<44} {}", clip(&v.title, 32), facts(v), v.id)?;
                }
            }
        }
    }
    emit(&o)
}

/// Print, and stop quietly when the reader has gone (`flex assets … | head`).
fn emit(s: &str) -> Result<()> {
    use std::io::Write;
    match std::io::stdout().lock().write_all(s.as_bytes()) {
        Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => Ok(()),
        r => Ok(r?),
    }
}

fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n { s.to_string() } else { format!("{}…", s.chars().take(n - 1).collect::<String>()) }
}

/// The measured facts, compactly.
fn facts(x: &Asset) -> String {
    let f = &x.facts;
    let mut v: Vec<String> = vec![];
    if let Some(d) = f.duration { v.push(format!("{d:.2} s")); }
    if let (Some(w), Some(h)) = (f.width, f.height) { v.push(format!("{w}×{h}")); }
    if let Some(d) = f.dpr { if x.kind != Kind::Still { v.push(format!("@{d}x")); } }
    if let Some(b) = f.bpm { v.push(format!("{b:.0} bpm")); }
    if let Some(l) = f.lufs { v.push(format!("{l} LUFS")); }
    if let Some(w) = f.words { v.push(format!("{w} words")); }
    if f.registered == Some(false) { v.push("not in audio.json".into()); }
    if let Some(n) = f.frames { v.push(format!("{n} frames played")); }
    match x.kind {
        Kind::Take => {
            if !f.versions.is_empty() { v.push(format!("{} versions", f.versions.len())); }
            if let Some(p) = f.version { v.push(format!("pick v{p}")); }
        }
        Kind::TakeVersion => {
            if f.picked == Some(true) { v.push("picked".into()); }
            if let Some(l) = f.late { v.push(format!("{l} late")); }
            if let Some(w) = f.worst_ms { v.push(format!("worst {w} ms")); }
            if f.report.is_some() { v.push("report".into()); }
        }
        Kind::Card => match &f.origin { Some(o) => v.push(o.clone()), None => v.push("no card of its own".into()) },
        Kind::Look => if let Some(n) = f.cards { v.push(format!("{n} cards")); },
        Kind::Lab => if let Some(t) = &f.target { v.push(format!("target {t}")); },
        Kind::Still => if !f.box_names.is_empty() { v.push(format!("boxes: {}", f.box_names.join(", "))); },
        _ => {}
    }
    if let Some(b) = x.bytes { if matches!(x.kind, Kind::Render | Kind::Stem | Kind::Music) { v.push(size(b)); } }
    v.join(" · ")
}

fn size(b: u64) -> String {
    let b = b as f64;
    if b >= 1e9 { format!("{:.1} GB", b / 1e9) } else if b >= 1e6 { format!("{:.1} MB", b / 1e6) } else { format!("{:.0} kB", b / 1e3) }
}

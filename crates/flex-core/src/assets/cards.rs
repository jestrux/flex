//! Cards as assets: the project's look (`look.ts`), the cards it and `cards/` register, and the pipeline's built-in
//! cards, each with its sample params (its defaults) and length. Only the pipeline knows what a file registers, so the
//! list comes from `flex card <dir> --json` (server/card.mts, 2–4 s in node), cached in `<support>/assets/cards/` by the
//! stamps (size, date) of project.ts, look.ts and cards/*.ts. Another look's cards (the pipeline registers every look it
//! has) aren't this film's and are left out.
//!
//! Which file a card lives in is found by a string search for `<name>: defineCard` / `<name> = defineCard`, a locator
//! for the source viewer, not a reading of the TypeScript.

use super::{Asset, Kind};
use crate::project::{support_dir, ProjectError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardInfo {
    #[serde(rename = "type")]
    pub kind_type: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub label: String,
    /// ms
    #[serde(default)]
    pub dur: f64,
    #[serde(default)]
    pub defaults: Value,
    /// the card's own sample (an exported `preview` beside it: `{ params, dur }`), once `flex card --json` reports it
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<Value>,
}

#[derive(Serialize, Deserialize)]
struct Cache { stamp: u64, feel: String, cards: Vec<CardInfo> }

fn sources(dir: &Path) -> Vec<PathBuf> {
    let mut v = vec![dir.join("project.ts"), dir.join("look.ts")];
    if let Ok(rd) = std::fs::read_dir(dir.join("cards")) {
        let mut c: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "ts")).collect();
        c.sort();
        v.extend(c);
    }
    v
}

/// The stamp of what the card list depends on.
pub(crate) fn stamp(dir: &Path) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for f in sources(dir) {
        f.hash(&mut h);
        if let Ok(m) = std::fs::metadata(&f) { m.len().hash(&mut h); m.modified().ok().hash(&mut h); }
    }
    h.finish()
}

fn cache_file(dir: &Path) -> PathBuf {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    dir.hash(&mut h);
    support_dir().join("assets").join("cards").join(format!("{:016x}.json", h.finish()))
}

fn load(dir: &Path) -> Option<Cache> { serde_json::from_str(&std::fs::read_to_string(cache_file(dir)).ok()?).ok() }

/// List the cards through the pipeline and cache the list. Returns the feel and the cards.
pub fn refresh(dir: &Path) -> Result<(String, Vec<CardInfo>), ProjectError> {
    let dir = std::fs::canonicalize(dir).map_err(|_| ProjectError::NotAProject(dir.to_path_buf()))?;
    let stamp = stamp(&dir);
    let o = crate::tools::card(&dir, &["--json".into()])?.stdin(std::process::Stdio::null()).output()?;
    let text = String::from_utf8_lossy(&o.stdout);
    let line = text.lines().rev().find(|l| l.starts_with('{'))
        .ok_or_else(|| ProjectError::Run(format!("flex card: no list\n{}", String::from_utf8_lossy(&o.stderr).lines().rev().take(6).collect::<Vec<_>>().join("\n"))))?;
    let v: Value = serde_json::from_str(line).map_err(|e| ProjectError::Run(e.to_string()))?;
    if v["ok"] != Value::Bool(true) { return Err(ProjectError::Run(format!("flex card: {}", v["error"].as_str().unwrap_or("failed")))); }
    let cards: Vec<CardInfo> = serde_json::from_value(v["cards"].clone()).map_err(|e| ProjectError::Run(e.to_string()))?;
    let feel = v["feel"].as_str().unwrap_or_default().to_string();
    let c = Cache { stamp, feel: feel.clone(), cards: cards.clone() };
    let f = cache_file(&dir);
    std::fs::create_dir_all(f.parent().unwrap())?;
    let tmp = f.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_string(&c).unwrap_or_default())?;
    std::fs::rename(&tmp, &f)?;
    Ok((feel, cards))
}

/// Where `name` is declared as a card in `text`: `name: defineCard` or `name = defineCard`.
pub(crate) fn declares(text: &str, name: &str) -> bool {
    let ident = |c: char| c.is_alphanumeric() || c == '_' || c == '$';
    let mut from = 0;
    while let Some(i) = text[from..].find(name) {
        let at = from + i;
        from = at + name.len();
        if text[..at].chars().next_back().is_some_and(ident) { continue; }
        let rest = text[from..].trim_start();
        let Some(rest) = rest.strip_prefix(':').or_else(|| rest.strip_prefix('=')) else { continue };
        if rest.trim_start().starts_with("defineCard") { return true; }
    }
    false
}

/// The card assets and the look. Returns whether the list is stale (or missing) and wasn't refreshed, and why a
/// refresh failed.
pub(crate) fn assets(dir: &Path, refresh_now: bool, out: &mut Vec<Asset>) -> (bool, Option<String>) {
    let now = stamp(dir);
    let mut cache = load(dir);
    let mut stale = cache.as_ref().is_none_or(|c| c.stamp != now);
    let mut error = None;
    if stale && refresh_now {
        match refresh(dir) {
            Ok((feel, cards)) => { cache = Some(Cache { stamp: now, feel, cards }); stale = false; }
            Err(e) => error = Some(e.to_string()),
        }
    }
    let name = crate::tools::project_name(dir);
    let (feel, list) = cache.map(|c| (c.feel, c.cards)).unwrap_or_default();
    // the files a card can live in, read once
    let look = dir.join("look.ts");
    let mut files: Vec<(PathBuf, String)> = super::files_in(&dir.join("cards"), &["ts"]).into_iter()
        .filter_map(|p| Some((p.clone(), std::fs::read_to_string(&p).ok()?))).collect();
    if let Ok(t) = std::fs::read_to_string(&look) { files.push((look.clone(), t)); }
    let mut used: Vec<PathBuf> = vec![];
    let mut look_cards = 0u32;
    for c in &list {
        let (origin, short) = match c.kind_type.split_once('/') {
            None => ("pipeline", c.kind_type.as_str()),
            Some((p, s)) if p == name || p == feel => ("look", s),
            _ => continue,
        };
        let file = (origin == "look").then(|| files.iter().find(|(_, t)| declares(t, short)).map(|(p, _)| p.clone())).flatten();
        let id = match &file {
            Some(f) => format!("{}#{short}", f.strip_prefix(dir).unwrap_or(f).to_string_lossy()),
            None => format!("card:{}", c.kind_type),
        };
        let mut a = Asset::new(id, Kind::Card, if c.label.is_empty() { short.to_string() } else { c.label.clone() }, file.clone());
        a.note = Some(c.kind_type.clone());
        a.facts.card_type = Some(c.kind_type.clone());
        a.facts.origin = Some(origin.into());
        // its own sample when it carries one, else its defaults (which may not be enough to draw anything: said, not hidden)
        let own = c.preview.as_ref().filter(|p| p.is_object());
        let dur = own.and_then(|p| p["dur"].as_f64()).unwrap_or(c.dur);
        a.facts.duration = (dur > 0.0).then_some(dur / 1000.0);
        a.facts.params = match own.map(|p| &p["params"]).filter(|p| !p.is_null()) {
            Some(p) => Some(p.to_string()),
            None => (!c.defaults.is_null()).then(|| c.defaults.to_string()),
        };
        a.facts.sample = Some(if own.is_some() { "preview" } else { "defaults" }.into());
        if origin == "look" { look_cards += 1; }
        if let Some(f) = file { used.push(f); }
        out.push(a);
    }
    // files under cards/ that register no card: the film's animation pieces (a lift, a count-up), shown, not previewable alone
    for (f, _) in &files {
        if *f == look || used.contains(f) { continue; }
        out.push(Asset::new(f.strip_prefix(dir).unwrap_or(f).to_string_lossy(), Kind::Card,
            f.file_stem().unwrap_or_default().to_string_lossy(), Some(f.clone())));
    }
    if look.is_file() {
        let mut a = Asset::new("look.ts", Kind::Look, if feel.is_empty() { name.clone() } else { feel.clone() }, Some(look));
        a.facts.cards = (!stale || look_cards > 0).then_some(look_cards);
        out.push(a);
    }
    (stale, error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_card_declarations() {
        assert!(declares("const poolBack = defineCard({", "poolBack"));
        assert!(declares("  sting: defineCard({", "sting"));
        assert!(!declares("const bigPoolBack = defineCard({", "poolBack"));
        assert!(!declares("poolBack(t)", "poolBack"));
        assert!(declares("x poolBack(t); const poolBack=defineCard", "poolBack"));
    }
}

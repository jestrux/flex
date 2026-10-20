//! A take's camera plan (`takes/<take>/edl.json`): its zoom segments and effects, edited by id. The file is the interface
//! (agents edit it directly too); this keeps every other field as it is. Any edit locks the plan, so a re-capture's
//! automatic plan doesn't replace a hand-tuned one (docs/capture.md).

use crate::project::ProjectError;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub fn edl_path(dir: &Path, take: &str) -> PathBuf { dir.join("takes").join(take).join("edl.json") }

fn read(dir: &Path, take: &str) -> Result<Value, ProjectError> {
    let p = edl_path(dir, take);
    let raw = std::fs::read_to_string(&p).map_err(|_| ProjectError::Invalid(format!("no camera plan at {}", p.display())))?;
    serde_json::from_str(&raw).map_err(|e| ProjectError::Invalid(format!("{}: {e}", p.display())))
}

fn write(dir: &Path, take: &str, v: &Value) -> Result<(), ProjectError> {
    std::fs::write(edl_path(dir, take), serde_json::to_string_pretty(v).unwrap() + "\n")?;
    Ok(())
}

/// What to change on one block: new times (take ms), a shift of both (ms), on or off.
#[derive(Debug, Default, Clone)]
pub struct Edit {
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub shift: Option<f64>,
    pub enabled: Option<bool>,
    /// parameters to set on the block (an effect's `params`; a zoom's own fields, e.g. scale, cx, cy)
    pub params: Vec<(String, Value)>,
}

/// Edit the segment or effect with this id; returns its new (start, end). Locks the plan.
pub fn edit(dir: &Path, take: &str, id: &str, e: &Edit) -> Result<(f64, f64), ProjectError> {
    let mut v = read(dir, take)?;
    let has = |v: &Value, k: &str| v.get(k).and_then(|a| a.as_array()).is_some_and(|a| a.iter().any(|b| b.get("id").and_then(|x| x.as_str()) == Some(id)));
    let key = ["segments", "effects"].into_iter().find(|k| has(&v, k))
        .ok_or_else(|| ProjectError::Invalid(format!("{take}: no segment or effect \"{id}\"")))?;
    let block = v[key].as_array_mut().unwrap().iter_mut().find(|b| b.get("id").and_then(|x| x.as_str()) == Some(id)).unwrap();
    let mut s = block["start"].as_f64().unwrap_or(0.0);
    let mut en = block["end"].as_f64().unwrap_or(s);
    if let Some(d) = e.shift { s += d; en += d; }
    if let Some(x) = e.start { s = x; }
    if let Some(x) = e.end { en = x; }
    if en <= s { return Err(ProjectError::Invalid(format!("{take} {id}: the end ({en} ms) must come after the start ({s} ms)"))); }
    block["start"] = Value::from(s.round() as i64);
    block["end"] = Value::from(en.round() as i64);
    if let Some(on) = e.enabled { block["enabled"] = Value::from(on); }
    for (k, v) in &e.params {
        if key == "effects" { if !block["params"].is_object() { block["params"] = serde_json::json!({}); } block["params"][k] = v.clone(); }
        else { block[k] = v.clone(); }
    }
    v["locked"] = Value::from(true);
    write(dir, take, &v)?;
    Ok((s.round(), en.round()))
}

/// Lock or unlock the plan (unlocked, the next capture's automatic plan replaces it).
pub fn set_locked(dir: &Path, take: &str, locked: bool) -> Result<(), ProjectError> {
    let mut v = read(dir, take)?;
    v["locked"] = Value::from(locked);
    write(dir, take, &v)
}

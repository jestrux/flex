//! The engine end to end on the in-repo sample: still export at any width, the join check, and a
//! variant restart (skipped without the pipeline's node_modules).

use flex_core::project::find_pipeline;
use std::path::Path;
use std::time::{Duration, Instant};

fn hello() -> std::path::PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../samples/hello-flex") }

#[test]
fn stills_joins_and_variants() {
    let Ok(pipe) = find_pipeline(&hello()) else { eprintln!("skip: no pipeline"); return };
    if !pipe.join("node_modules").exists() { eprintln!("skip: pipeline not installed"); return; }
    let support = tempfile::tempdir().unwrap();
    std::env::set_var("FLEX_SUPPORT", support.path());
    let e = flex_core::Engine::open(&hello(), 480);
    let wait = |what: &dyn Fn(&flex_core::EngineState) -> bool| {
        let t = Instant::now();
        while !what(&e.state()) { assert!(t.elapsed() < Duration::from_secs(60), "timed out"); std::thread::sleep(Duration::from_millis(100)); }
    };
    wait(&|s| s.generation >= 1 && !s.checking_joins);
    let st = e.state();
    assert!(st.error.is_none(), "{:?}", st.error);

    // a still at 4K, painted by the engine
    let out = support.path().join("still.png");
    e.export_still(60, 3840, &out).unwrap();
    let img = image::open(&out).unwrap();
    assert_eq!((img.width(), img.height()), (3840, 2160));

    // one checked join per scene boundary (hello-flex: 3 scenes), title cards cut cleanly or are flagged, never unknown
    assert_eq!(st.joins.len(), 2);
    assert!(st.joins.iter().all(|j| j.unknown.is_none()), "{:?}", st.joins);
    assert_eq!(st.joins[0].frame, 105);

    // a variant flag restarts the session with it
    e.set_variant("END", Some("dark"));
    wait(&|s| s.generation >= 2);
    assert_eq!(e.state().variants, vec![("END".to_string(), "dark".to_string())]);
    e.close();
}

//! The agent skill ships copies of pages in docs/. Keep them identical.

#[test]
fn skill_reference_pages_match_the_docs() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let skill = root.join("skills/flex");
    assert!(skill.join("SKILL.md").is_file());
    for page in ["making-a-film.md", "capture.md"] {
        let doc = std::fs::read_to_string(root.join("docs").join(page)).unwrap();
        let copy = std::fs::read_to_string(skill.join("reference").join(page)).unwrap_or_default();
        assert!(doc == copy, "skills/flex/reference/{page} differs from docs/{page}; run scripts/sync-skill.sh");
    }
}

/// The skill's example film opens with Flex's own pipeline (its two cards; the take's scene joins after a capture).
#[test]
fn the_skill_example_opens() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../skills/flex/examples/app-walkthrough");
    if flex_core::project::bundled_pipeline().map(|p| !p.join("node_modules").exists()).unwrap_or(true) { return; } // no pipeline installed here
    let p = flex_core::Project::open(&dir).unwrap();
    assert_eq!(p.name, "app-walkthrough");
    assert_eq!(p.scenes.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["intro", "outro"]);
    let _ = std::fs::remove_dir_all(dir.join(".flex")); // opening notes it in the activity trail
}

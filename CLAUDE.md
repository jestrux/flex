# Flex

A native Mac app (SwiftUI) over a Rust engine for watching and steering a fancy-e2e-videos
film while it is being built. See [README.md](README.md) for what it does and
[plans/PRD.md](plans/PRD.md) for where it is going.

**Before working here, read [docs/agent-guide.md](docs/agent-guide.md).** It has the build and
test loops, the UI driver, and the traps already hit.

The essentials:

- Rust (`crates/flex-core`) owns the project, the cache and the processes. Swift only renders
  engine state and drives it. Nothing in Flex knows how a film is drawn: that is the
  pipeline's (fancy-e2e-videos), reached through the preview server.
- The app reads a project only through the pipeline (today `server/outline.mts`, later the
  preview server's manifest), never by parsing TypeScript itself.
- `cargo test -p flex-core` is the fastest check. `scripts/package.sh` builds (Release), installs and
  relaunches the app.
- After changing `flex-ffi` run `scripts/build-core.sh --debug`. After adding a Swift file,
  `scripts/build-app.sh` regenerates the Xcode project.
- Verify UI changes by driving the app with `scripts/uidrive.swift` and looking at a
  screenshot, not by assuming. The author uses this Mac while you work: launch with
  `open -g`, screenshot with `uidrive shot`, and check the front app before any click.
- The sample film (`samples/circles-overview`) is KinPay product content and stays out of
  git: `scripts/copy-sample.sh` copies it in. `samples/hello-flex` is the in-repo sample.
- Don't edit fancy-e2e-videos from here. Another session works there; pipeline changes go
  through [PLAN.md](PLAN.md)'s hand-off items.

**To learn what the app already does, read [docs/features/](docs/features/README.md).** After
meaningful feature work, ask the author whether to update the docs, and on a yes update the
matching feature page as part of that work. Screenshots in the docs come from
`samples/hello-flex`, never from circles-overview.

**Asked to cut a release?** Run `scripts/release.sh <patch|minor|major> --publish`. It bumps the
version, builds, signs, notarizes, commits the bump as "Release X.Y.Z", pushes and creates the
GitHub release with the zip. Use patch for fixes, minor for new features, and ask which when it
is not clear. Commit other work first (the tree must be clean), preview with `--dry-run`, and
pass the commit trailers through `FLEX_RELEASE_TRAILERS`. Publishing is visible to everyone with
repo access, so confirm before running it unless the author has just asked for the release.

`scripts/docs.sh` serves everything in `docs/` as a browsable site (the app is in `docs-site/`;
the Markdown files are the source).

What is left to build: [PLAN.md](PLAN.md).

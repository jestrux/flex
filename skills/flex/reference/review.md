# Board reviews

`flex review` serves an app's flows as a board: every frame is the real app, running in a browser at that screen's
link, in the flow's order and on the project's devices. The author clicks a spot on a frame to pin a note, Send hands
the drafts over as a round, you reply in the notes file and fix the app. `flex review export` publishes the same board
as a static site beside the app.

The installed `~/.flex/bin/flex` and this skill can lag the Flex repo. If a field or flag below is missing, check
`flex review --help`; in a Flex checkout, `~/Documents/web/flex/target/debug/flex` is the current build.

## The shape: use the project's own e2e setup

**A board's states come from the project's own e2e seeding and test users. Never build around them.** Flex reaches a
state through:

- **setup**: a command in the project (beside its e2e helpers) that Flex runs before each frame; it signs the frame's
  person in and hands back cookies, storage, a URL, actions;
- **`storage`**: localStorage / sessionStorage keys, declared;
- **`clock`**: a fixed instant for the app's `Date`;
- **`actions`**: clicks, typing, scrolls after the page loads, for states only interaction reaches;
- **`proxies`**: a second origin on the same address (an SSO stand-in, a sign-in service);
- **`signinParam` / `signoutParam`**: the app's own sign-in link parameter, when it has one.

No app-side fake data, no stand-in endpoints, no proxy that answers for the app. The data is what the e2e seeder put
there; the session is a real sign-in as a real test user.

**Fallback, only for apps with no backend and no e2e** (a static demo, bundled data): an app-side seed route that
stages each state from its link. NCAA's static Expo build is that case; see "Apps with no backend" at the end.

## Safety

Setup commands sign in and may write data. Treat starting a board with setup as running the setup.

- **Setup runs only with `--allow-setup`** (`flex review`, `export --capture`, `resnap`) or View › Setup (this
  session, off at start). Without it, setup frames say "Setup not allowed" and captures skip them, listed.
- **Its writes need the author's approval** before you pass `--allow-setup`. Say in `project.json` that it writes:
  `"setup": { …, "writes": true }`; Flex says so at start.
- **Every run is logged** (command, frame, person; never the output) in `.flex/cache/review.log`. Read it when asked
  what a board did.
- **Throwaway data only:** fresh e2e users, a dedicated record or workspace. Never a shared persona's data, never a
  colleague's demo account.
- **Seed once, out of band; links read-only.** Run the e2e seeder yourself (with approval), then the frames only sign in
  and look. Never a reset in a frame link: one author scrolling the board would wipe the shared DB per frame. A proxy
  that blocks the reset path is a good pattern (career-path signs in with `/go?as=…`, never `stage=`, which wipes the
  local DB).
- **After any re-seed or reset, `flex review resnap [flow] --allow-setup`.** Snapshots don't know the data changed.
  `--screen`, `--state` narrow it; a running review picks the new ones up.
- **Actions never submit** (no Save, Approve, Send) unless writes are approved. Say in `_doc` what was left off for
  that reason.

## Where `.flex/` goes

**Beside the project's `.switchboard/`, in the same repo, committed like it.** Usually the cross-app e2e repo
(`career-path/e2e`, `otesha/e2e`, `thriveboundlessly/e2e`); the app's own repo when there is one app and no e2e repo
(`ncaa/mobile-app`). `base` points at the app wherever it runs. No `.switchboard/` yet: ask the owner; the e2e repo is
the usual answer.

- The setup script lives beside the e2e helpers it imports (`thriveboundlessly/e2e/helpers/flex-setup.ts` imports
  `./config`).
- `flex review` writes `.flex/.gitignore` (`cache/`, `flows/*.notes/`) on first start when there is none: the snapshots
  run to hundreds of MB (NCAA's cache is ~1 GB). Commit it with the board. Commit `<flow>.notes.json`: it is the review
  conversation; its screenshots are re-taken.
- No worktrees. Nothing untracked left in an app repo.

## Working with the project's owner session

Another session usually owns the repo you're putting `.flex/` in.

- **Send the file list first** (paths, one line each), then the files. The owner commits; some repos deploy on push to
  main.
- **Ask before** writes, seeds, resets, restarts of their servers.
- **A refusal stands.** Never route around a permission refusal by asking another session to do it.
- **Real staff names stay out of repo files.** People are role names ("Line manager · step 2"), or the e2e personas'
  own fictional names.
- **Owner facts are leads, not truth.** Confirm storage keys, routes, cookie names and flags in the code before relying
  on a brief.

## .flex/project.json

Found by walking up from the flow or the working folder. Thrive's, with setup:

```json
{
  "name": "Thrive",                      // heads the page
  "project": "thrive",                   // the review's path prefix and <project>.localhost
  "logo": "../.switchboard/icon.png",    // relative to .flex/
  "base": "http://localhost:3010",       // the app; every flow's default
  "devices": ["mac"],
  "port": 4876,
  "ready": { "selector": "h1" },         // optional, project-wide: when a live frame counts as ready
  "order": ["learning"],                 // the rest follow alphabetically
  "people": {
    "kheri":  { "name": "Kheri Mnyampala", "role": "Producer" },
    "baraka": { "name": "Baraka Temu", "role": "Manager (Kheri's)" }
  },
  "setup": { "command": "bun helpers/flex-setup.ts", "cwd": "..", "ttl": 600 },
  "clock": "2026-10-15T09:00:00+03:00",
  "tags": { "kyc": { "label": "KYC", "color": "#9333ea" }, "map": null }
}
```

(Comments for reading only; the file is plain JSON.) Career-path's adds a sign-in stand-in on a second origin:

```json
"base": "http://localhost:5178",
"proxies": { "/go": "http://localhost:5280" },
"signinParam": "as"
```

A flow's own `base`, `devices`, `logo` win over the project's. Fields Flex doesn't know are reported once, not an error.

- **`ready`**: wait on the step's heading (or a `[data-ready]` the app sets), never a fixed delay: skeletons pass a
  delay. One selector for the whole project, so pick one every screen has.
- **Signed-out products** (a public site): `"person": null` on the flows, `"people": {}` or omitted. If the app has no
  sign-out parameter, `"signoutParam": null`, or every link gets `signout=1`.
- **`tags`**: the chips flows can put on screens and states. Flex's defaults are always there (`form`, `list`,
  `detail`, `dashboard`, `map`, `prompt`, `sheet`, `share`, `success`, `error`, `empty`, `offline`, `system`,
  `public`, `payment`); the project's map adds its own custom tags (`{ "label", "color" }`), relabels or recolours a
  default, or turns one off (`null`). A tag in neither shows neutral and is reported once.
- **`controls`**: the app's own seed switches, an icon button each in the top bar beside the person (a menu of its
  choices; a dot when off its default), on the live frames they apply to, e.g.
  `"controls": { "banners": { "label": "Announcements", "default": "all", "options": [["all", "All"], ["none",
  "None"], ["trip", "Trip notice"]], "screens": ["tabs/home"] } }` (`param`, default the key; `options` as `[value,
  label]` or plain values; `screens` as `flow`, `flow/screen`, `flow/screen@state`, `*` anywhere). A value other than
  `default` adds `<param>=<value>` to those live frames' links (a state's link that sets it keeps its own); it is
  remembered per project and kept in the address (`?banners=trip`). Snapshots and `resnap` are always at the default:
  the fixed cases belong in states. `"multi": true` makes it a set of switches, an override like a theme's: those on
  go as `<param>=<a>,<b>` (the app shows them to anyone, whatever their audience), none on adds nothing; an option's third item is the heading it sits under.
- **Secrets** are `$VARS` from the process environment, else the `env` file beside `.flex/` (git-ignored). Never a
  password or token in a flow, the page, or a bundled `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` variable.

## Devices

Keys, from `server/devices.mts`:

| Kind | Keys |
|---|---|
| phones | `iphone`, `iphone-max`, `android` |
| tablets | `ipad`, `ipad-11`, `ipad-mini`, `android-tablet`; add `-landscape` (`ipad-11-landscape`) |
| laptops, displays | `mac`, `mac-16`, `display`, `pc`, `pc-16` |
| app windows | `mac-window`, `windows`, `window` (plain) |

- **A website:** `mac` (or `pc`), plus `ipad-11` if it is responsive. A phone key over a website draws the phone's
  status bar over the site's header: there is no mobile-browser frame yet. Use a phone only for a mobile app, or say so.
- **A mobile app's web target:** `android` or `iphone`, plus a tablet if the app has a tablet layout.
- Every device multiplies frames and snapshots. Start with one.

## The setup command

`project.json` `"setup": { "command", "cwd" (relative to .flex/), "ttl" (seconds a result is reused; default 600),
"writes" }`. A flow, screen or state opts in with `"setup": { <string args> }` (merged, state over screen over flow;
`null` turns it off from there down). No `setup` on a frame: no command, as before.

Before a frame opens or is captured, Flex runs the command (`sh`, the login-shell PATH, the project's env file) with:

| Env | Is |
|---|---|
| `FLEX_FLOW`, `FLEX_SCREEN`, `FLEX_STATE` | the frame |
| `FLEX_PERSON` | the person's slug; empty when signed out |
| `FLEX_LANG`, `FLEX_THEME`, `FLEX_DEVICE` | the view |
| `FLEX_BASE`, `FLEX_MODE` | the app's address; the data mode (static or an environment's key) |
| `FLEX_SETUP` | the merged args, as JSON |

It prints one JSON object on stdout:

```json
{ "url": "/tenant/ubongo-sandbox/me/report",
  "cookies": [{ "name": "t360_session", "value": "…", "path": "/", "httpOnly": true, "sameSite": "Lax", "maxAge": 2592000 }],
  "localStorage": { "t360_theme": "light" }, "sessionStorage": {},
  "actions": [{ "click": "text=Goals" }] }
```

Every key is optional. `url` defaults to the frame's link; `actions` run after the flow's. A non-zero exit or non-JSON
output shows in the frame with stderr; a capture keeps nothing. Results are reused per (args, person, language, theme,
device, data mode) for `ttl`, until the notes file's `build` changes or Reset to defaults: a dark frame and a light one,
or an iPhone and a Mac, each get their own run.

Writing one (Thrive's `helpers/flex-setup.ts` is the model):

- **Import the e2e helpers** (config, API URL, the sign-in the tests use). Don't re-derive them.
- **Sign in by API** as the e2e test user for `FLEX_PERSON`; empty or `null` → clear the session cookie (`maxAge: 0`).
- **Match the real login's cookie shape exactly** in an SSR app: same cookie name, same JSON field names, same encoding.
  Log in once in a browser and compare. A near miss signs nobody in and looks like a redirect bug.
- **Print only the HTTP status on failure**, never a response body (it carries tokens). Nothing to files.
- **Write nothing else** unless approved: no seed, no reset, no clock. Header comment says what it writes (a sign-in
  usually leaves an audit row; say so).

## Declared state: storage, clock, actions

On the project, a flow, a screen or a state:

- **`"storage"`**: `{ "localStorage": {..}, "sessionStorage": {..} }`, merged down; a setup command's keys win.
  Each frame gets its own overlay, so frames never see each other's keys. A value that isn't a string is stored as
  JSON; `null` makes the key the frame's own and empty (a "no draft yet" state, safe from another frame's writes).
  This replaces an app-side seed route: compute a stored draft with the app's own helpers so it passes its checks.
- **`"clock"`**: a real instant with an offset, `"2026-11-21T09:30:00+03:00"` (`null`: none). Only no-arg `new Date()`,
  `Date()` and `Date.now()` move; `new Date(x)`, `Date.parse`, `Date.UTC` stay real. Frozen unless `"clockTicks": true`.
  Not a wall-clock string: time zones convert it.
- **`"actions"`**: run in order after load, each waiting up to 10 s; the frame is ready once they are done. A lower
  level's list replaces the one above.

  ```json
  [{ "fill": "input[name=q]", "value": "budget" }, { "click": "text=Approve", "nth": 0 }, { "press": "Escape" },
   { "waitFor": "[role=dialog]" }, { "scroll": "text=Waiting for approval" }, { "wait": 300 }]
  ```

  Selectors: CSS or `text=…`. Use them for states only interaction reaches: an open dialog, a tab, a typed field, a
  section below the fold. `scroll` brings an element into view; it can't reach inside a nested scroller that doesn't
  move with it, and a long page still crops at the device height. One failing marks the frame; a capture keeps nothing.
  **Never press a submit** unless writes are approved.

Flex injects its script first in the app's `<head>` (SSR apps too), so clock and storage are in place before the app's
own scripts. A snapshot is retaken when its frame's setup, storage, clock or actions change.

## Per-frame isolation

- **With a setup** in a flow, the review serves at `http://<project>.localhost:<port>/` and gives each setup frame a host
  of its own under it (per flow, screen, person, language, data mode): separate cookies and storage, so two people sit
  side by side signed in. Chromium and Firefox resolve `*.localhost`.
- **On plain `http://localhost:<port>`** (a browser that can't resolve `*.localhost`), setup frames share one origin's
  cookies: the screen in view re-runs its setup when shown again. Storage stays per frame by the overlay either way.
- Only the cookies and storage asked for reach the page; the setup output is never logged or written.

## Writing flows

One file per flow, `.flex/flows/<flow>.json`. Thrive's `learning.json`, trimmed:

```json
{
  "title": "Learning",
  "_doc": "Follows e2e/flows/learning.ts on the ubongo-sandbox workspace as seeded. Setup signs each person in; nothing else is written. Actions only scroll, open a dialog, switch a tab or type: none presses a submit. Left off until a write is approved: …",
  "setup": { "for": "learning" },
  "screens": [
    { "name": "kheri-gap", "label": "Kheri: a capability gap offers a 30/60/90",
      "description": "Goals low on a complete record", "person": "kheri",
      "path": "/tenant/ubongo-sandbox/me/report",
      "actions": [{ "scroll": "text=Activate a 30/60/90" }],
      "states": [
        { "name": "plan-waiting", "label": "Her own request, waiting for Baraka",
          "actions": [{ "scroll": "text=Waiting for approval" }] } ] }
  ]
}
```

| Field | Where | Means |
|---|---|---|
| `title`, `_doc` | flow | the name; for the next agent: who, which seed, what was left off and why |
| `name`, `label`, `description` | screen, state | stable id (notes and snapshots key on it), heading, one line |
| `path` | screen, state | the link, relative to `base` (a state without one uses its screen's) |
| `states` | screen | the same screen with other data or another interaction |
| `person`, `people` | flow, screen, state | who is signed in by default (`null`: signed out); who the author may switch to |
| `setup`, `storage`, `clock`, `actions` | flow, screen, state | see above |
| `tester` | screen, state | `true`: shown only with View › Tester tools |
| `signal` | screen, state | `false`: always offline (`offline=1`) |
| `publish` | flow | `"all"`: export every theme, language and signal |
| `use` | screen entry | `"account"`: all of `account.json` as one item of this flow, shown and opened like a screen (its tile opens on its screens, each with its states); `"account/register"`: one of its screens as it is. Either may take its own `label` (a whole flow's: the item's title) |
| `system` | screen, state | the OS's own UI over the app: `"contacts"`, `{ "show": "permission", "for": "contacts" }` (see System screens) |
| `keywords` | flow, screen, state | words people search for that the label doesn't say (`["invite", "share link"]`); ⌘K ranks a keyword hit above a fuzzy one. A state is found by its screen's too |
| `tags` | flow, screen, state | from the project's tags (`["form", "sheet"]`): chips in ⌘K, the pickers and the canvas captions, and `#form` in ⌘K. A state shows its own, then its screen's |

Rules:

- **Screens follow the person's path** (hub, form, record, the next role's desk), not the router's file tree.
- **States follow the record's life:** empty, filled, errors; waiting, approved, done.
- **A different person is never a state.** That is `people`, and the author switches. A *person-set data state* is
  fine: a supervisor's view of someone's record, or a fresh "newcomer" person made by the seeder each time. Career-path
  puts each step of a first run on its own seeded manager, so `person` per screen carries the step.
- **"Not allowed" on purpose:** list the refused person in `people` and say so in `_doc`. An irrelevant person is left
  out. Two people giving the same picture: drop one from `people`.
- **Don't number labels.** The board numbers screens.
- **Links never contain the sign-in parameter.** The board adds `signin=<person>` (or `signout=1`; or the project's
  `signinParam`/`signoutParam`); a link that already has one is fixed to it.
- **Hash or modal routes:** URL-encode `#` and `?` inside a `to=` value (`to=%2Fboard%23card-12`), or the browser
  eats them.
- **A step that belongs to several flows is written once and used** (`{ "use": "account" }`), never copied: an
  account prompt between an invite and a form, a shared checkout. A whole flow used is one item in the host, behaving
  exactly like a screen: one tile on the canvas ("Account prompt · 2 screens", its first screen's picture), and
  opening it shows its screens (02.1 Sign in, 02.2 Register) the way a screen opens on its states; each of those
  opens on its own states. Joining reads Invite link → Account prompt → Join the visit. The
  used screens bring their own flow's `person`,
  `people`, `setup`, `storage`, `actions` and `clock` unless they set their own, so they run exactly as at home, and
  editing the home flow updates every flow that uses it. Uses can nest; a loop, a missing flow or screen, or two
  screens of one name is an error. **Notes stay with the flow they were left in** (the host), not the used screen's.
- **Write for search (⌘K):** the label says what is on the screen ("Invite a member", not "Step 3"); every screen gets
  a one-line `description`; `keywords` carry the words people use that the label doesn't (the product's slang, the
  old name, the API's: "msisdn", "transfer"); `tags` come from the project's list, a few per screen (what kind of
  screen it is: form, list, sheet; what it shows: error, empty, success). Add a tag to the project's `tags` rather
  than inventing one per flow.
- `"publish": "all"` only on a flow the author has reviewed: it multiplies snapshots by themes × languages × signal.
- Cross-reference in `_doc` which flow carries what this one leaves out.

## System screens

A step that is the OS's UI, not the app's (a permission prompt, the system contact picker), is not built in the app:
the board draws it over the app's frame. Put `"system"` on the screen or state (a state doesn't inherit its screen's):

- `"contacts"` (or `{ "show": "contacts" }`): the contact picker. iOS: a page sheet over the app pushed back and
  dimmed, Cancel and "Contacts", a search field, the contacts by family name in lettered sections, the A–Z index. iPad:
  the same as a centred form sheet. Android: full screen, Material 3, "Choose a contact" with back and search, round
  initial avatars, by given name.
- `{ "show": "permission", "for": "contacts" | "photos" | "camera" | "location" | "notifications" }`: the dialog.
  iOS: the centred alert ("“NCAA” Would Like to Access Your Contacts", the usage text, Don’t Allow / Allow; location
  and photos stacked with their three choices). Android: the Material 3 dialog, icon, "Allow **NCAA** to access your
  contacts?", stacked Allow / Don’t allow (location with Precise / Approximate; camera, photos their own choices).
  Android shows no usage text.

Drawn by device: iPhone and iPad the iOS look, Android Material 3; a laptop or window nothing. It follows the board's
theme, language (the OS words built in for en and sw) and Device frame switch, and shows on live frames, snapshots
and published copies. Notes and ⌥-copy are of the app underneath: Shift-click works on it, but the note's screenshot
and the copied picture are the app's snapshot, without the overlay. An unknown kind draws nothing and is reported
once (by flex review and in the page's console).

The project gives the words and people, all optional:

```json
"system": {
  "appName": "NCAA",                         // default: the project's "name"
  "contacts": [{ "name": "Neema Mwakyusa", "phones": ["+255754330218"], "photo": null }],   // default: 12 generic
  "permissions": { "contacts": { "en": "NCAA fills in who you’re adding from your contacts.", "sw": "…" } }
}
```

`permissions.<for>` is the app's usage text (its Info.plist string) per language, falling back to `en`, or one string;
a `photo` is a URL the avatar shows instead of the initial.

## Serving

```sh
flex review --no-open --allow-setup     # only once the author approved the setup's writes
flex review .flex/flows/learning.json --port 4877 --base http://localhost:3010
```

- **Run it under Switchboard** (`switchboard` skill): the owner adds `<project>/review/board` (and the app server it
  needs, e.g. `<project>/review/web`) with an absolute folder. An agent's background task is for checking only: it stops
  at the harness's 2-hour limit (that took the Otesha and Thrive boards down), and `nohup … &` dies with the agent's
  shell. Moving to Switchboard: stop the agent's copy by PID first, then start the command.
- **Check the port actually bound**: read the printed address. The app's `serve` picks a random port when its own is
  busy; the board then shows the wrong thing or nothing.
- **Never broad `pkill`** (`pkill node`, `pkill -f serve`): it kills the owner's servers. Kill by PID or by port
  (`lsof -ti :4876`).
- **gstack `/browse` keeps one headless browser per working folder.** Run it from your own folder (the e2e repo or
  a scratchpad), never from a folder another session works in, or you drive its browser and pages jump on both sides.
- A static build: **swap it in whole; never empty the served folder.** A capture that hits a half-written folder snaps
  the 404 page.

## On the board

What the author does there, so you can tell them:

- **Pickers** (flow, screen, state; list or grid) say how many each holds: a flow's screens, a screen's states. The
  canvas says it under each screen too.
- **Opening** a flow lands on all its screens (on its one screen when it has one); opening a screen lands on all its
  states (on its one state when it has none). The pickers, the canvas, the keys and a rollover all open the same way.
- **← / →** move at the level shown: all screens → between flows; one screen → through the flow's screens; one state →
  through the screen's states. A used flow is one stop among the screens; opened, ← / → move through its screens and
  roll on out of it. **Esc** steps back up one level (a state → its screen's states → the used flow → all screens). Past either end they roll into the next item one level up (the next screen's states,
  the next flow's screens), and past the last flow they wrap to the first. ↑ / ↓ step a screen's states.
- **Shift-click** a frame leaves a note at that point. **Holding ⌥** shows a "Click to copy" overlay on the screen
  under the pointer; **⌥-click** copies its snapshot to the clipboard ("Copied <screen> · <state>", with a thumbnail).
  The app in the frame sees neither click.
- **View** (the sliders button; the same panel on the home page) is compact: a header row of icon toggles (theme,
  language as its flag, signal as wifi, and on a flow's page the **device frame**: off, each screen is the app's
  window alone, no body, status bar, notch or camera, cropped to the safe areas so snapshots and live frames agree)
  with **reset** at its right; then Devices; then Data, Tester tools, Setup. Each viewer's choices are remembered per
  project (the address's `frame=0` too).
- **Command bar (⌘/, or Search in the top bar; home and flow pages):** as Raycast. It searches everything: flows, screens, states and
  people, one list ranked by best match (each screen and state once, at home); ⌘P's filter keeps one kind (Screens,
  States, Flows), Recent, or what has a tag or is seen as a person (↵ on a person sets that filter). Each result is one
  line: its icon, its name, where it is (its flow; a state's screen), and on the right a pin when pinned and its count
  (a flow's screens, a screen's states, a person's screens and states). Before anything is typed:
  Pinned, then **Flows**, then **Screens** (each once, at home); typed, just the results, ranked: this screen's matches
  above this flow's, above the rest (filtered lists put this flow's first too). The filter is a filter icon (three lines) beside the search (a dot when one is on); the filter
  in use shows as a chip at the search's start, and Backspace in an empty search removes it. Words narrow together, label first, then `keywords`, tags, people, description,
  forgiving a missing letter. The footer shows where the selected row is, then **Open ↵** ("Open Screen as Rehema" when
  found through a person) and **Actions ⌘K**: its states (or its screen), Pin, Peek this screen, Peek all found (⇧↵),
  Copy link. ↑↓ move, Esc clears the search, then the filter, then closes. `#form` and `@rehema` in the search work as filters too.
  **Modifiers** (a lexicon, no AI), taken out of the search words: `as <person | role>` (a name or slug's start, else
  the people whose `role` says it: "as a visitor", "as tour operator"), `dark`, `light`, `sw`/`swahili`/`kiswahili`/`in
  swahili`, `en`/`english`/`in english`, `on ipad`/`on tablet`, `on phone`/`on iphone`/`on android`, `on laptop`/`on
  mac`/`on desktop`, `landscape`, `offline`/`no signal`, `online`, `tester`. "as" counts only when someone follows it;
  a lone word some label starts ("light" with a Lighting screen) stays a search word. They stay as typed; each row
  says them after its name ("Home as Sofia · dark · in Swahili"). A role, or an unfinished "as reh", **fans out**: one
  row per person per screen that offers them (`people`); a screen offering none of them isn't listed. **Triggers**, as
  Kinpay's "how many" suggests "How many users / transactions / corridors": a search ending in "as ", "in " or "on "
  lists that word's completions for the best match first, under "Home as…": each person the screen offers, each
  language, each device (a sparkle marks them), then the results. ↵ opens the result with the
  person, theme, language, device, signal and tester tools set as the View panel would (in place on this flow, else
  remembered for the next page), and the footer says so: "Open Screen as Sofia · Dark · Swahili ↵". Letters in order
  ("rjctd") only count for a word that fits nothing properly. Hovering the
  top bar's Search button opens its panel: **Compact search** (only the search box until something is typed), the keys,
  and clearing pins and recents; the button itself is dimmed until hovered. Off on a published copy (no server).
- **On the board:** ⌘/, search, ⇧↵ makes the same peek of what it found (`POST /<project>/api/peek`).
- **When:** whenever the conversation is about some screens across flows (what a change touches, the screens a
  question is about, a before and after). Make the peek and give the author its link, rather than listing files.
- **What it takes:** `flow` (the whole flow, one tile; a glob works), `flow/screen` (with all its states), or
  `flow/screen@state[,state]` (only those states, with the default). Names are the flow file's and the screen's.
- **Where:** `.flex/cache/peek/_peek.json`: never committed, not one of the project's flows. A running `flex review`
  shows it first on the home page, marked **Temporary**, with a × to dismiss it; it opens at `/<project>/f/_peek/`.
  One peek at a time: the next replaces it.
- **Notes go to the screens' own flows** (unlike a flow's `use`, where they stay with the host): a note made on the
  peek is in that screen's `<flow>.notes.json`, and Send sends each of those flows' rounds. `flex review wait <flow>`
  as usual.
- Two flows' screens of one name: the later is named `<flow>-<screen>` on the peek. Two whole flows sharing a screen
  name are refused: name one's screens one by one.
- Under the hood a peek is a flow of `use`s; a `use` may also take `"as"` (another name) and `"only"` (those states).

## On a deck slide

A board for a call goes on a Deck `page` slide, one flow per slide, all from the one board process:
`{ "type": "page", "page": "http://localhost:4871/<project>/f/<flow>/", "title": "<flow>" }`. The call shows the
pictures already taken: take or retake them before the call (`flex review resnap`, setup and all), never seed from a
Run beat. The board must be running on the presenting laptop (frames are `*.localhost`); the app stack is needed only
to open a frame live or retake. With no server, point the slide at the static export (the default person only).

## Checking flows

Before the author sees a flow, every screen and state must land as intended, as its default person and each person it
lists, on each device.

**Best: let Flex capture it**, setup and all, then look:

```sh
flex review check [flow] --allow-setup       # every frame taken again; each failure listed; exit 1 if any failed
flex review resnap <flow> --allow-setup      # review server stopped or not; it picks them up
ls .flex/cache/snapshots/<flow>/             # <screen>[@state].<device>.<theme>.<lang>.<mode>.t<0|1>.s<0|1>.p-<person>.png
cat .flex/cache/snapshots/<flow>/manifest.json   # each picture's link, build, setup
```

Error pages (HTTP error, 404/502/503, blank, app not mounted) are retried, then not kept and listed. Open a sample of
the PNGs, and every one that looks like another.

**Otherwise, Playwright** from the pipeline (`~/Documents/web/flex/pipeline/node_modules`). The shape, corrected from
what went wrong:

```js
// check-flows.mjs <.flex dir>  — read-only; runs setup the way Flex does
import { createRequire } from "node:module"; import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process"; import { createHash } from "node:crypto";
const { chromium } = createRequire(process.env.HOME + "/Documents/web/flex/pipeline/")("playwright");
const dir = process.argv[2], pj = JSON.parse(readFileSync(`${dir}/project.json`, "utf8"));
const SIZE = { mac: [1512, 982], pc: [1280, 800], "ipad-11": [834, 1210], android: [412, 915], iphone: [402, 874] };
const b = await chromium.launch(), seen = new Map();
for (const file of readdirSync(`${dir}/flows`).filter((f) => f.endsWith(".json") && !f.includes(".notes"))) {
  const flow = JSON.parse(readFileSync(`${dir}/flows/${file}`, "utf8")), base = flow.base ?? pj.base;
  for (const s of flow.screens) for (const x of [s, ...(s.states ?? []).map((t) => ({ ...s, ...t, up: s }))]) {
    const person = "person" in x ? x.person : flow.person ?? null, people = x.people ?? flow.people ?? [];
    const setup = x.setup === null ? null : x.setup || s.setup || flow.setup ? { ...flow.setup, ...s.setup, ...x.setup } : null;
    for (const dev of flow.devices ?? pj.devices) for (const who of new Set([person, ...people])) {
      const id = `${file} ${s.name}${x.up ? "@" + x.name : ""} ${dev} as ${who}`;
      const ctx = await b.newContext({ viewport: { width: SIZE[dev][0], height: SIZE[dev][1] } }), page = await ctx.newPage();
      const errs = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("dialog", (d) => { errs.push("dialog: " + d.message()); d.dismiss(); });
      let out = {}, link = x.path;
      if (setup) out = JSON.parse(execSync(pj.setup.command, { cwd: `${dir}/${pj.setup.cwd ?? "."}`, env: { ...process.env,
        FLEX_FLOW: file.replace(".json", ""), FLEX_SCREEN: s.name, FLEX_STATE: x.up ? x.name : "", FLEX_PERSON: who ?? "",
        FLEX_LANG: "en", FLEX_THEME: "light", FLEX_DEVICE: dev, FLEX_BASE: base, FLEX_MODE: "static", FLEX_SETUP: JSON.stringify(setup) } }));
      else link += (link.includes("?") ? "&" : "?") + (who ? `${pj.signinParam ?? "signin"}=${who}` : "signout=1");
      if (out.cookies) await ctx.addCookies(out.cookies.map((c) => ({ name: c.name, value: c.value, url: new URL(c.path ?? "/", base).href,
        httpOnly: !!c.httpOnly, secure: !!c.secure, ...(c.maxAge ? { expires: Date.now() / 1e3 + c.maxAge } : {}) })));
      const st = { ...pj.storage?.localStorage, ...x.storage?.localStorage, ...out.localStorage };
      await ctx.addInitScript((st) => Object.entries(st).forEach(([k, v]) => localStorage.setItem(k, v)), st);
      await page.goto(new URL(out.url ?? link, base).href, { waitUntil: "load" }).catch((e) => errs.push(e.message));
      if (pj.ready?.selector) await page.waitForSelector(pj.ready.selector, { timeout: 15000 }).catch(() => errs.push("never ready"));
      for (const a of [...(x.actions ?? []), ...(out.actions ?? [])]) {   // never a submit
        if (a.scroll) await page.locator(a.scroll).first().scrollIntoViewIfNeeded().catch(() => errs.push("scroll " + a.scroll));
        else if (a.click) await page.locator(a.click).nth(a.nth ?? 0).click().catch(() => errs.push("click " + a.click));
        else if (a.fill) await page.locator(a.fill).fill(a.value).catch(() => errs.push("fill " + a.fill));
        else if (a.waitFor) await page.waitForSelector(a.waitFor).catch(() => errs.push("waitFor " + a.waitFor));
        else if (a.press) await page.keyboard.press(a.press); else if (a.wait) await page.waitForTimeout(a.wait);
      }
      const text = (await page.innerText("body").catch(() => "")).trim(), h = createHash("sha1").update(await page.screenshot()).digest("hex");
      const bad = !text ? "blank" : errs.length ? errs.join("; ") : seen.has(h) ? `same as ${seen.get(h)}` : "";
      seen.set(h, id); console.log(bad ? `!! ${id}: ${bad}` : `ok ${id} → ${new URL(page.url()).pathname}`);
      await ctx.close();
    }
  }
}
await b.close();
```

- **Every device the project lists**, not one viewport.
- **`load` + the ready selector**, not `networkidle`: a background video or a poll never goes idle.
- **Follow setup** (run the command, apply its cookies, storage, url) or the check sees the sign-in page everywhere.
- **Catch `pageerror` and dialogs.** Don't grep for "not found": that's real copy in many apps ("No courses found").
  Judge error pages by eye.
- **"Same as" between two people** usually means that person sees nothing different there: drop them from `people`.
  Between two screens: a step that did nothing, or a redirect (the landed path shows it).

Fix the flow, the seed or the setup, then check again.

## Many flows at once

Fan out with lanes (`lane-orchestration` skill): one lane per group of flows. A lane edits only its own
`.flex/flows/<flow>.json`, checks against the already-served app, and runs no git, builds, seeds, resnaps or exports.
Missing states or test users come back as a request. The orchestrator owns `project.json`, the setup script, every
seed, build and capture.

## The round loop

```sh
flex review wait learning                       # blocks until the author sends a round; prints it as JSON
flex review wait learning --since 3 --timeout 1800   # exit 3 at the timeout
```

- `wait` prints `{ flow, notesFile, round, sentAt, notes: [...] }`; each note has `screen`, `state`, `device`, `theme`,
  `lang`, `mode`, `tester`, `offline`, `person`, `text`, the frame's `link`, and `screenshot` and `crop`. **Look at the
  crop** before reading the text.
- **Reply in `<flow>.notes.json`:** append `{ "by": "claude", "text": "…", "at": "<ISO>" }` to the note's `replies`;
  `"resolved": true` when done. Markdown works. Re-read just before writing, write it whole, keep unknown fields: the
  page writes to it too.
- **Fix the app**, rebuild (swapping a static folder in whole), then **stamp the notes file's top-level `"build"`**
  (`"2026-11-22T18:42:16.137Z"`): frames reload, setup results and older snapshots are retaken.
- A flow file edit rebuilds its page on the next load; snapshots whose link changed are retaken.
- Data changed under the board (a re-seed): `flex review resnap`, not a rebuild.
- The board remembers each viewer's view. If it looks wrong to the author, View › **reset**.
- Notes and snapshots are kept per data mode, tester setting, signal and person.

## Publishing

```sh
flex review export <site>/screen-canvas --prefix /screen-canvas --capture [--allow-setup]
flex review export <out> --capture --capture-set all --jobs 6 --scale 1.25 --quality 60
```

- Writes `<out>/index.html`, `<out>/f/<flow>/index.html`, `<out>/snap/` (WebP); empties `<out>` first. No notes, Data
  switch or server.
- `--capture` takes missing or stale snapshots from the app at `base` (stop the review server: they share
  `.flex/cache`). Setup frames need `--allow-setup`, else they're skipped and listed.
- **Frames with setup, storage, clock or actions can't run live there** (no server): they show their snapshots only,
  opened on their own too. Plain frames load the app live from the site's root.
- Put the canvas inside the app's static build, so one host serves both. The server needs an SPA fallback for the app
  and a real directory index for the canvas (`serve -s` gets this wrong). nginx, from NCAA's `deploy/web/nginx.conf`:

  ```nginx
  location = /screen-canvas { return 301 /screen-canvas/; }
  location /screen-canvas/ { try_files $uri $uri/index.html =404; add_header Cache-Control "no-cache"; }
  location / { try_files $uri $uri.html /index.html; add_header Cache-Control "no-cache"; }
  ```

- **Check after deploy** by status code: `/`, a deep link, `/screen-canvas/`, `/screen-canvas/f/<flow>/`; then open one
  flow.

## Environments (a Data switch)

`"environments": { <key>: { label, base, api: { path, target }, login: { url, token }, accounts: { <person>: { email,
password } }, env } }` adds **Data**: Static (the project's `base`) and each environment. In one, frames load that
environment's build at its `base`, `api.path/…` calls go through Flex to `api.target`, and a frame's person is signed in
for real (Flex POSTs the account to `login.url`, reads the token at `login.token`, passes it as `token=`). Built for
the seed-route fallback (NCAA); a setup command sees the data mode as `FLEX_MODE`. Test users must exist on each backend first:
create them by script, idempotently (NCAA's `scripts/setup-test-users.ts`), and ask before writing to shared staging.

## Apps with no backend: a seed route (NCAA)

Only when there is no e2e and no backend to seed. Proven on `~/Documents/web/ncaa/mobile-app` (Expo); read its files
before copying.

- **The web target is the review build:** `scripts/export-web.sh static` runs `bunx expo export -p web --clear` with
  `EXPO_PUBLIC_STATIC_DEMO=1 EXPO_PUBLIC_TESTER_TOOLS=1`. `--clear`: Metro caches `EXPO_PUBLIC_*` values.
- **Static data behind the same API layer:** each feature's `api.ts` branches on the build flag, `static.ts` beside it.
  The mode is a build flag, never a runtime switch.
- **The seed route** `src/app/dev/seed.tsx`, gated by `TESTER_TOOLS` (it is an auth bypass in a store build):
  `clock=`, `quiet=1`, `tester=`, `scheme=`, `insets=`, `lang=`, `reset=all|<feature>`, `offline=`, `signout=1`,
  `signin=<slug>`, `token=` (real builds), feature params (`fleet=allocated`), `<feature>_form=<form>-filled|-errors`,
  `to=<path>`. Document every param in the file's header; flows' `_doc` cite them. Wait for persisted stores to hydrate
  (`whenHydrated()`) before writing.
- **Links pin** the clock, `lang=en`, `quiet=1`, and `reset=all`: fine here because the data is bundled per browser,
  nothing shared. Never `reset` against a shared backend.
- **Demo people** in `src/mocks/personas.ts`, mirrored in `project.json` `"people"`.
- **Serving:** `bunx serve -s -l 8099 dist/web`; `export-web.sh` builds into `<out>.next` and swaps it in.

Expo web traps the boards hit:

- **`web.output: "static"` breaks** once any module touches `window` at import. Use `"single"`.
- **Fonts loaded by the `expo-font` config plugin are missing on web.** Add a web `@font-face` stand-in.
- **Native modules imported from shared code** need a seam file plus a `.web.ts` beside it (`secure-store.web.ts`,
  `ncaa-map.web.tsx`). maplibre's worker: copy it into `public/` and `setWorkerUrl`. Expect one fix per native module.
- **A static-only guard on a seed route** (`if (!STATIC_DEMO) return`) breaks real builds that need `token=`. Gate on
  tester tools, not the data mode.
- **Offline simulation needs both** the banner and the send path (queue to the outbox), or the board shows "offline"
  while sends succeed.

Other stacks: **Flutter web** (`flutter build web`; plugins without a web implementation need `kIsWeb` stand-ins; check
before promising a board). **Native-only apps** have no live board: say so; offer `flex mockup <folder> --sheet` over
simulator screenshots, or a film.

## Apps whose session lives on the server (Thrive)

The app keeps its session in a server-side cookie and has no seed route: nothing in the URL or storage can sign a frame
in. The setup command does it the way the e2e suite does, through the app's real login, and hands Flex the cookies:

- Port the suite's sign-in (its `loginViaForm` / API login helper) to its API form: `POST /auth/login` with the
  persona's address and the suite's shared test password, read the `Set-Cookie`, print
  `{ "cookies": [{ "name", "value", "path", "sameSite" }], "localStorage": { ... } }`. `FLEX_PERSON` empty means signed
  out: print the session cookie with `maxAge: 0`. Language and theme cookies go in the same list.
- It lives with the suite (`e2e/helpers/flex-setup.ts`), reads the suite's config and `.env`, and is run from there
  (`"setup": { "command": "bun helpers/flex-setup.ts", "cwd": ".." }`).
- A sign-in is still a write (an audit row, a last-seen time): say so to the author before `--allow-setup`. Anything
  beyond signing in (a request sent, an approval) is a state the board leaves out until the author approves its write.
- Never print the response body on failure: it carries tokens. The status code is enough.


# Follow-ups

Open questions, deferred decisions, and known gaps found while doing
session 1. Nothing here is broken *today* — the suites are green and the
port is faithful. These are the things worth a decision before they
calcify, plus the places where "it passes" is weaker evidence than it
looks.

Each item says what it is, why it matters, and what I'd suggest — but
they're written to be argued with, not just executed.

Status key: **[decide]** needs a call from the maintainer ·
**[verify]** needs evidence we don't have · **[chore]** mechanical

---

## 3. Verification gaps

### 3.1 What mutation testing has and hasn't covered

Mutation checks were run on `core`, the jsdom boot test, and the
Playwright suite, and they earned their keep — the `apply()` dirty-guard
gap (§1.3) was invisible until a mutant survived. But this was a handful
of hand-picked mutants, not systematic mutation coverage. Surviving
mutants elsewhere are likely.

If this matters later, StrykerJS over `packages/core` would give a real
number. Not worth it yet.

### 3.4 The jsdom boot test stubs layout **[verify]**

`app.test.ts` replaces `Element.prototype.getBoundingClientRect` globally
with a fixed rect, because jsdom has no layout engine. That's necessary
for the app to boot, but it means any assertion depending on real
geometry is meaningless there. Geometry belongs in Playwright — just
don't let that stub grow into something load-bearing.

### 3.6 `tsc -b` trusts its buildinfo over its own output **[chore]**

*What it is.* `tsc -b` decides a project is up to date by comparing input
mtimes against `tsconfig.tsbuildinfo` — not against the files it emits. Delete
`packages/core/dist` but leave the buildinfo and it reports "up to date" and
emits nothing. The `pretest*` hooks sidestep it with `--force` (a full core
build is ~1s, a quarter-second more than an incremental one), but plain
`npm run build` and `npm run typecheck` still have the blind spot.

*Why it matters.* Only bites when `dist` is removed without the buildinfo
going too — a hand-deleted directory, or a partially-cleaned tree. It presents
as a build that claims success while the output the tests import isn't there.

*Suggested direction.* Leave it unless it bites: the honest fix is for anything
that cleans `dist` to clean the buildinfo beside it, which is a convention
nothing currently enforces.

### 3.7 `test:watch` builds core once, at start **[chore]**

*What it is.* `pretest:watch` builds `packages/core` before Vitest starts, but
editing a file under `packages/core/src` during a watch session doesn't rebuild
`dist` — and `dist` is what everything downstream imports (§3.6). The watch
re-runs against the core it started with.

*Why it matters.* Vitest re-running on a core edit while reporting results from
the previous core is a worse failure than the stale-dist one, because it looks
live. Core's own `*.test.ts` files are unaffected — they import `./x.js`
relatively, so they see the source.

*Suggested direction.* Run `tsc -b packages/core --watch` alongside Vitest
(`concurrently`, or a documented second terminal). Not worth a dependency until
someone actually iterates on core under watch.

## 7. Extension (Session 3) — deferred polish

### 7.1 The webview bundle ships `@angular/compiler` **[DEFERRED — accepted for now]**

The webview bundle is ~508 kB (141 kB gzipped) because the shared editor's
`apply()` parses locally (`state.ts` → `parseTemplate`), which pulls in
`@angular/compiler`.

**Decision (deferred):** accept it for now. The cost is a one-time ~140 kB
gzipped on panel open (retained while the panel stays open — not
per-interaction), and current load time is fine.

The real fix is a genuine re-architecture, not a config tweak — scoped
here so it isn't under-estimated later:
- Move the `parseTemplate` import out of the shared editor into the
  *standalone* host (the standalone keeps bundling the parser — fine, it's
  a browser app with no Node side). The editor package becomes parser-free,
  so the extension webview tree-shakes `@angular/compiler` out.
- `apply()` stops parsing — the model comes from the host, which for the
  extension arrives **asynchronously** (a Node-host round-trip). The `Host`
  interface grows a build-model responsibility.
- Extension edits can no longer re-render locally (no parser): a canvas
  edit sends `Edit[]`, the host applies + re-parses + returns the fresh
  model, *then* the canvas updates — an added round-trip before the canvas
  reflects the edit.
- `core` needs `"sideEffects": false` for the tree-shake to actually drop
  the parser module.

This touches the apply engine and the host↔webview sync (the most delicate
code, and newly test-covered). Worth it before a wider rollout where load
time matters; not worth the churn now. A near-zero-risk alternative if only
*felt* load matters: show the panel instantly and parse the first document
a tick later — doesn't shrink the bundle.

## 8. Grid-fidelity gaps (deferred features)

### 8.2 Other unmodeled grid features **[deferred — lower priority]**

- **`order-*`** (`order-md-2`, `order-last`): flexbox reorders columns, but
  the canvas always draws source order — real layout can differ.
- **`row-cols-*`** (`row-cols-3`): row-driven equal-column count, set on the
  row instead of each column; not parsed.
- **Alignment / gutters** (`justify-content-*`, `align-items-*`, `g-*`):
  affect spacing/position, not the 12-col span math — lowest priority for a
  schematic.

The core 12-column grid (widths, offsets, both BS3 and BS4/5 dialects, all
breakpoints, auto/equal, nesting, containers) is fully modeled; these are the
grid-relevant gaps toward "full fidelity". Bootstrap the *framework*
(components, JS, utilities at large) is explicitly out of scope — this is a
grid drafting board.

## 9. Extension behaviour & settings

### 9.8 The class convention is the first `resource`-scoped setting **[decide]**

*What it is.* `bootstrapVisualizer.newRowClasses` / `.newColumnClasses`
(`packages/app-extension/package.json`) ship with `"scope": "resource"`, unlike
the five settings before them (all `application` — §9.1). A markup convention
is a property of the codebase, not of the person, so a repo can commit it to
`.vscode/settings.json` and everyone editing that project gets it.

*Why it matters.* Two consequences follow, both deliberate but neither obvious:
`readConfig` now takes the bound document's URI
(`packages/app-extension/src/host/extension.ts`), so a multi-root workspace can
give two folders different conventions; and the canvas's own write-back goes to
`ConfigurationTarget.Workspace` when a folder is open (`writeTarget`), because
a Global write would be shadowed by a committed workspace value and the field
would silently appear not to stick. That means typing in the inspector field
edits a file in the user's repo — correct for a shared convention, but the
first time this extension writes anything into a project.

*Suggested direction.* Leave it; revisit if someone wants a personal
convention that survives across projects (a per-user default the workspace
value overrides). If we ever add one, the seam is `writeTarget`.

### 9.9 Only three settings are live; the rest are still read once **[decide]**

*What it is.* `onDidChangeConfiguration` (`extension.ts`, gated by
`isLiveSetting`) forwards *only* the two class-convention settings and the
dialect to an open panel, as a `liveSettings` message. The other four are still
read once at panel open (§9.1).

*Why it matters.* It's an asymmetry someone will trip on. Those three are live
for a specific reason — the panel *writes* them too, so a panel holding a stale
copy would clobber an edit made in settings.json — and re-seeding the whole
`OpenConfig` mid-session would instead yank the breakpoint and view toggles
back from under someone who changed them on the canvas. Hence a separate
message rather than a second `config`.

*Suggested direction.* The dialect half of this is done (it was the one people
would actually trip on, since it's a setting a project commits). Of what's
left, `liveSync` is safe to re-apply; the breakpoint and the view toggles are
not, and each would need its own answer to "what if the user has since changed
it on the canvas?" Probably leave them read-once.

### 9.15 A canvas-written setting is pushed straight back to the canvas **[chore]**

*What it is.* The header's version chip writes `dialect` to the workspace
settings, which fires `onDidChangeConfiguration`, which now passes
`isLiveSetting` — so the host pushes the value the canvas just chose back to
it. Same for the class convention edited in the inspector.

*Why it matters.* Harmless today: `readLiveSettings`
(`packages/editor/src/state.ts`) sets the same value it already holds and
writes nothing back, so it converges in one hop and there is no loop. But it's
a round trip that does no work, and it re-renders — if a future live setting is
costlier to apply, or applying it disturbs canvas state, the free hop stops
being free.

*Suggested direction.* Have `Session` ignore a change it caused itself — record
the key and value it last wrote via `setConfig` and drop the matching push.
Cheap, but it's new state with its own staleness question, so it's not worth
doing until something depends on it.

### 9.10 One convention per document, not named presets **[decide]**

*What it is.* There is exactly one row convention and one column convention.
A document with two kinds of row (a form row and a plain layout row) can't
express both.

*Why it matters.* It's the obvious next request, and it's a UI decision, not a
data one: `newRowClassList()` / `newColClassList()`
(`packages/editor/src/state.ts`) already take everything they need as
parameters, so presets would be a picker beside each create action plus a list
editor in settings — no change to how the markup is built.

*Suggested direction.* Wait for a real second convention before building it.

### 9.11 A `d-*` utility in the column convention hides every new column **[verify]**

*What it is.* `parseExtraClasses` (`packages/core/src/scaffold.ts`) drops grid
tokens but deliberately keeps display utilities, so `d-none` in the column
convention is written verbatim — and `isHiddenAt` (`packages/core/src/classes.ts`)
then gives every created column zero grid width (§8.1), i.e. it appears on the
canvas as hidden.

*Why it matters.* It surprises rather than corrupts: the class is exactly what
the user asked for, and the canvas is telling the truth about it. But nothing
warns, and the inspector's preview shows the class list, not its effect.

*Suggested direction.* Probably a hint in the convention section when the
tokens include a `d-*` that hides at the current breakpoint. Filtering it out
would be wrong — it's a legitimate thing to want.

### 9.12 `addRowAtEnd` appends at end-of-file when a document has no rows **[decide]**

*What it is.* With no top-level row to anchor to, "Add row" inserts at
`state.src.length` (`packages/editor/src/edits.ts`). For a template wrapped in
a `<form>` or a `<div class="container">`, the row lands *after* the wrapper,
not inside it — the user then has to move it.

*Why it matters.* It's the first-use path for the feature that exists to let
someone start a page from scratch, so the dumb rule is on show at exactly the
wrong moment. It's a deliberate choice: any smarter rule is a heuristic about
which element was "meant", and a wrong guess writes into a container the user
didn't intend. The toast says where the row went.

*Suggested direction.* If this proves annoying, the least-guessy improvement is
to offer the choice rather than infer it — e.g. insert into the innermost
element that already contains block content, but say so and make it undoable in
one step (it already is).

### 9.13 A row added after a conditional last row lands inside that branch **[decide]**

*What it is.* `addRowAtEnd` delegates to `addRowAfter(lastTopLevelRow)`. If
that row sits inside an `@if` branch, the new row is written inside the branch's
braces.

*Why it matters.* Consistent with `addColToRow`, which deliberately inserts
after the last *shown* column so a conditional row adds into the active branch
(`packages/editor/src/edits.ts`). But "add a row to the document" reads like a
top-level action, and landing inside a conditional is a surprise the canvas
does show (the row draws inside the branch box) but doesn't announce.

*Suggested direction.* Leave the behaviour; consider naming the branch in the
toast when the insertion point is inside one.

## 10. Edit granularity and view state

*Both surfaced while hardening the canvas↔buffer seam (§7.4/§7.5/§9.4). Neither
is a correctness bug — edits land where they should — but both make editing feel
less precise than it is, and both were deliberately left out of that change to
keep it reviewable.*

### 10.2 Selection and collapse state don't survive an edit **[decide]**

*What it is.* Selection is a path (`state.sel.path`, `[rowIdx, colIdx, …]`) and
is re-resolved against a freshly built model after every apply. Two consequences,
both verified in the code:
- ~~`moveCol` and `deleteEl` set `state.sel = null` outright, so the column you
  just dragged is deselected the moment it lands.~~ **Done for `moveCol`:**
  `ApplyOpts.selectAt` (`packages/editor/src/state.ts`) selects the block at an
  offset in the *new* source, and `moveCol` passes where the moved tag lands,
  computed from its own edit batch — the offset-anchoring below, applied to the
  one edit that needed it. `deleteEl` still clears (there is nothing obvious to
  select instead).
- A path that still resolves may resolve to a *different* element after an
  external change (a live-sync refresh keeps the selection by path), so the
  inspector can quietly describe something other than what the user selected.

Row collapse has the same shape of problem: `computeRowIds`
(`packages/editor/src/render.ts`) keys it on a hash of the row's exact source
text plus an occurrence counter, so editing anything inside a collapsed row
changes its identity and silently re-expands it — and `state.collapsed`
accumulates keys that can never match again.

*Why it matters.* It reads as the canvas losing your place. It's most visible
exactly when someone is working quickly, which is the workflow the seam work was
meant to protect.

*Suggested direction.* Anchor identity to a source offset rather than a path or
a content hash: an edit batch is a list of spans, so an offset can be mapped
through it (shift by the net delta of every edit that starts before it). Then
after an apply, re-select via the existing `nodeAtOffset` (`core/model.ts`) at
the mapped offset. `selectAt` is the seam for that: what's left is the general
mapping (so every canvas edit and the live-sync refresh keep the selection by
offset, not path) rather than the per-edit offset `moveCol` computes. For
collapse, key on the same mapped-offset identity, and drop keys that no longer
resolve so the set stops growing.

---

### 10.3 The inspector is rebuilt wholesale on every render **[chore]**

*What it is.* `renderInspector` (`packages/editor/src/inspector.ts`) starts
with `inspector.innerHTML = ''` and rebuilds every control. Checkboxes and
steppers don't notice; the class-convention text fields do — a live-sync
refresh while someone is typing would take the caret away mid-word. Handled
for now by remembering the focused field and its selection range around the
wipe (`rememberFieldFocus` / `restoreFieldFocus`).

*Why it matters.* That's a targeted patch over a general problem: any future
control with internal state (a text field, an open dropdown, a scroll
position) needs its own version of the same save/restore. Related to §10.2 —
same root cause, that view state lives in the DOM the renderer discards.

*Suggested direction.* If a third piece of DOM state shows up, stop patching
and make the inspector update in place (or key its sections) instead of
rebuilding.

---

## 12. Release and CI

### 12.1 Release actions are pinned to floating major tags **[chore]**

*What it is.* Every action the workflows use is referenced by a moving major
tag: `actions/checkout@v5` and `actions/setup-node@v5`
(`.github/workflows/release.yml:20`, `:22`, and the same pair in
`.github/workflows/test.yml:15`, `:17`),
`actions/upload-artifact@v4` (`release.yml:74`) and
`softprops/action-gh-release@v2` (`release.yml:103`). Whatever the maintainer
last moved that tag to is what runs.

*Why it matters.* This is not hypothetical here. The v0.3.0 release (run
35266541641, 2026-09-17) published to the Marketplace and then failed its
`Publish GitHub Release` step: the action created the release as a *draft*,
GitHub's get-release-by-tag API does not return drafts, so the action's own
"not yet discoverable by tag" retry loop ran out and the asset upload failed.
Nothing in the repository changed between the green v0.2.1 release and that
failure — only the code behind `@v2` did. A release is the one workflow where
a silent upstream change costs an irreversible Marketplace publish.

*Suggested direction.* Pin each action to a full commit SHA with the
human-readable version in a trailing comment
(`softprops/action-gh-release@<sha> # v2.4.1`), and let Dependabot's
`github-actions` ecosystem raise the bumps as reviewable PRs. Not done in the
v0.3.1 change because that session had no network access to resolve a SHA it
could actually verify, and guessing one is worse than the floating tag. The
explicit `draft: false` and the post-publish verification step added in
v0.3.1 defend against this specific failure at any action version; the pin is
the general fix.

---

## Resolved (archive)

Closed items, one line each — full rationale and detail is in git history.
Section numbers are kept stable so references elsewhere still resolve.

- **1.1** The insulation rule, reworded — _RESOLVED — rule reworded, model not enriched_
- **1.2** Control flow: `@if`/`@else` now first-class; `@for`/`@switch` still flattened — _RESOLVED for `@if` — see below_
- **1.4** The `El` span shape is part of the parser-swap contract — _RESOLVED_
- **1.3** Dirty-guard responsibility is split between two layers — _RESOLVED — apply() is authoritative; early checks are documented redundancy_
- **2.1** `nudgeCol` / `nudgeRow` ignore their `node` argument — _RESOLVED — parameter dropped_
- **2.2** `fmtEff` was dead code and is not ported — _RESOLVED — confirmed dead, correctly dropped_
- **2.3** Two ported assertions are weaker than their names — _RESOLVED_
- **2.4** Schematic guesses in `computeWidths` — _RESOLVED — every guess now shows the `~`_
- **2.5** `colSequence` / `nestedRows` index alignment — _RESOLVED — was a real bug_
- **3.2** Interactive paths still untested — _RESOLVED — the four named paths_
- **3.3** Chromium only — _RESOLVED — Firefox + WebKit projects added_
- **3.5** The VS Code integration suite has never been executed — _RESOLVED — first green run_
- **4.1** E2E assertions are coupled to the sample's literal text — _RESOLVED — coupling made explicit and fail-fast_
- **4.2** `index.html` ↔ `dom.ts` element IDs are coupled by convention only — _RESOLVED — boot-time assertion + a shared contract_
- **4.3** Line endings — _RESOLVED_
- **5** CI — _RESOLVED — workflows added_
- **6** Documentation drift — _RESOLVED_
- **7.2** "Saved to persist" cue — _RESOLVED_
- **7.3** Extension tests — sync logic covered; VS Code wiring still not — _RESOLVED — wiring covered with a mocked `vscode`_
- **7.4** `applyEdits` isn't serialized — a concurrent-edit race can false-diverge — _RESOLVED — the whole controller is serial now_
- **7.5** Column resize occasionally corrupts a class in the extension — guarded, drift now caught at the source — _RESOLVED in code; one verification still owed_
- **8.1** `d-*` responsive show/hide utilities — _RESOLVED — hidden columns take zero grid space_
- **8.3** An `@if` directly inside an `@if`/`@else` branch loses its nesting — _RESOLVED — `El.condPath`_
- **8.4** Inserted markup always uses `\n`, even in a CRLF document — _RESOLVED — `detectEol`_
- **8.5** Inserted markup matched neither the file's indent character nor width — _RESOLVED — `detectIndentUnit`_
- **9.1** Tier-1 settings (user-scoped) — _DONE — shipped_
- **9.2** "Open Grid Visualizer" spawns a new panel every time — _RESOLVED — single reusable panel_
- **9.3** Back-to-back canvas edits falsely diverged (issue #1) — _RESOLVED — message queue in Session_
- **9.4** `onSave`/`onDocChange` bypass the message queue — _RESOLVED — folded into the same queue_
- **9.5** Divergence warned on every keystroke — _RESOLVED — edge-triggered_
- **9.6** Auto-resync on external edits instead of blocking — _IMPLEMENTED — `liveSync`, now the default_
- **9.7** Sync is decided by content, not `doc.version` — _RESOLVED — `syncedText`_
- **9.14** The resolved dialect is invisible in the canvas — _IMPLEMENTED — inspector names the version and what decided it; header chip switches it where the file doesn't_
- **10.1** A class edit rewrites the whole attribute value — _RESOLVED — token-level edits_
- **11.1** An unclosed element's span is a guess, and structural edits trusted it — _RESOLVED — `El.unclosed` + a per-element guard_

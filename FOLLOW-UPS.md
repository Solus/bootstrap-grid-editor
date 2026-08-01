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

## 1. Design decisions that shape session 2

### 1.1 The insulation rule, reworded **[RESOLVED — rule reworded, model not enriched]**

Resolved by **rewording the rule**, not enriching the model. The parser
swap was the deciding evidence: `buildModel` and every classifier
(`colTitle`, `contentHint`, `isContainerCol`, …) were untouched through a
total parser replacement, and the app kept working — so "frontends call
pure `core` functions at render" demonstrably does not leak parser
details. The protection that actually matters is "don't *re-implement*
core's logic in a frontend", which the current design already satisfies.

Enriching the model (precomputing `role`/`title`/`hint`/`dynamic` onto
nodes) was rejected: it's eager work nobody needs — the model is rebuilt
on every edit, and the extension webview can call the same pure functions
the standalone app does rather than read fields. Reworded in
`CLAUDE.md` "Non-negotiable boundaries", `PLAN.md` "The insulation
principle", and `PLAN.md` "Non-negotiables": frontends **call** core's
functions and never re-derive; whether core precomputes or computes on
demand is core's own choice (today: on demand).

### 1.2 Control flow: `@if`/`@else` now first-class; `@for`/`@switch` still flattened **[RESOLVED for `@if` — see below]**

**Update (`@if`/`@else` session):** `@if`/`@else`/`@else if` are now modeled
as **conditional regions**. The parser still flattens branch elements into
siblings, but **tags** each with `El.cond = { region, branch }` and registers
the full branch list (incl. empty branches) in `RootEl.condRegions`. The
region key is content-derived (`hashStr(joined conditions) + ':' + occ`), so
it survives column edits and only changes when a condition changes — same
drift class as `collapsed`. `buildModel(root, active)` groups tagged runs and
emits **only the active branch's** cols (default branch 0), interleaved with
untagged siblings, plus a `CondRegion` on `RowNode.conds` / `ColNode.conds`.

Frontend: a per-row/per-column **branch bar** (chips of branch labels) toggles
which branch is shown; `setActiveBranch` rebuilds the model view-only — no
`apply`, no history, no `host.commit` (so a toggle never dirties the document).
Fill is now **per-branch** and real (`N/12`), dropping `~unreliable` for
modeled `@if`. Intra-branch edits (resize/add/split/delete/move) work
unchanged; cross-branch move/nudge is guarded (`CROSS_BRANCH_MSG`).

**Update 2:** top-level `@if`-of-rows (and row-level `*ngIf`) is now
first-class too — `findRows` groups branch runs to the active branch, the
canvas walks the tagged source tree to box them (`renderTopRows`), hidden
regions collapse to the thin chip strip in place, and `nudgeRow` guards
cross-boundary moves. Every conditional position (in-row, in-column,
top-level) now shares one look and one toggle model.

**Still deferred (documented, not in v1):** branch-aware find (`computeFind`
walks active cols only); inline (between-columns) toggle placement;
cross-branch move/nudge; `@for`/`@switch` first-classing.

---

Decision (Session 2): the Angular adapter **flattens** control flow —
`@if/@for/@switch` lift their branch/case/loop/empty elements into the
parent, and `Template` wrappers (`*ngIf/*ngFor`) are unwrapped. The model
stays shape-identical to the hand-rolled parser's, so behavior is
unchanged: `rowHasControlFlow` still flags the row (via `looseText`) and
fill still counts branches as simultaneous columns → the `~unreliable`
pill. All ported tests stay green; new tests lock the flattening
(`parser.test.ts`).

**Still open, deliberately deferred to a dedicated session** — two coupled
questions that are a UX/product decision, not a parser one, and shouldn't
ride along with the swap:
- **`CondRegion` as a first-class node.** The real AST now makes it
  possible (draft shape in `PLAN.md` GridModel). It must be able to appear
  at the top level and inside a column's sequence, not only inside a row's
  `items` — `@if` wraps whole rows in real templates.
- **`@if/@else` frontend behavior.** Per-branch fill (`max` across
  branches) vs. the `~unreliable` pill; how the canvas/inspector present
  and edit branches. Decide with real examples in front of us.

Flattening now forecloses nothing: the control-flow nodes exist in the
AST, so this can be built deliberately later.

### 1.4 The `El` span shape is part of the parser-swap contract **[RESOLVED]**

The frontends read raw `El` span fields (`.start/.end/.openEnd/
.contentStart/.contentEnd`) directly to make surgical edits, so the swap's
real contract is span *semantics*, not just the 157 core tests.

Handled in the Session 2 swap:
- Added a **span-semantics test suite** (`parser.test.ts`) pinning the
  mapping directly — `openEnd` just past `>`, `contentStart/contentEnd`
  bounding exactly the inner text, void and self-closing elements
  collapsing the content span, nesting containment. Mutation-checked:
  breaking the `contentEnd` mapping fails 11 tests in `core`.
- Gated on **`npm run test:all`** (177 unit + 51 e2e). The e2e edits slice
  source at exact offsets, so their passing validated span fidelity in the
  browser, not just in isolation.

### 1.3 Dirty-guard responsibility is split between two layers **[RESOLVED — apply() is authoritative; early checks are documented redundancy]**

Decision: the guard inside `apply()` (via the host's `canApplyEdit()`) is
the single authority. Early checks exist only where an interaction must
be refused *before* it changes state, and every one of them now calls the
same `canApplyEdit()` — never `state.dirty` directly — and carries a
comment naming it deliberate redundancy:
- `dnd.ts` drag-start and resize pointerdown (abort a doomed gesture);
- `state.ts` `undo()`/`redo()` (the pre-check must run before `hIndex`
  moves, or a refusal inside `apply()` would desync history — this was
  the one remaining direct `state.dirty` read, now routed through the
  guard).

The Session 3 host-adapter work had already put `dnd.ts` on
`canApplyEdit()`; this entry lagged the code. Any future entry point
follows the same rule: rely on `apply()`, add an early call to the same
guard only when ordering/UX demands it.

---

## 2. Inherited from the prototype — confirm intent

These are all things the prototype does that I ported faithfully. Each
might be deliberate, or might be a latent bug nobody hit yet.

### 2.1 `nudgeCol` / `nudgeRow` ignore their `node` argument **[RESOLVED — parameter dropped]**

Resolved by **dropping** the parameter — the reverse of this item's
original lean ("I'd use it"), after looking closer. You can't meaningfully
*use* a `node` here: `ColNode`/`RowNode` don't carry their own path, and
the sibling swap needs a path (which index, which parent), not just a
node. So the honest options were drop it, or switch to a `path` param —
and a path param adds generality no caller needs (every call site nudges
the current selection) plus an awkward `state.sel!.path` at the inspector.

Signatures are now `nudgeCol(dir)` / `nudgeRow(dir)`, which say exactly
what they do: move the *selected* item. That matches how the rest of the
app is built (`swapSiblings`/`apply` already mutate `state.sel`) and
removes the trap — there's no longer a misleading argument to pass wrong.
Callers in `inspector.ts` and `keyboard.ts` updated.

Added an e2e case for the inspector Move buttons (previously the only
`nudgeCol` caller with no coverage); the keyboard Shift+Arrow path was
already covered. 50 e2e green.

### 2.2 `fmtEff` was dead code and is not ported **[RESOLVED — confirmed dead, correctly dropped]**

Verified: it is superseded dead code, not a missing feature. Evidence:

- `fmtEff` produces prose — `'12/12 (no col class)'`, `'equal share'`,
  `'auto (content width)'`.
- The **only** place the inspector shows an effective width is the
  stepper's `.val` box (`inspector.ts`, `wDisp`): ~52px, centered,
  wedged between the `+`/`−` buttons. Those prose strings can't fit it.
- The prototype has exactly one reference to `fmtEff` — its own
  definition, zero callers — and no prose line for effective values
  anywhere in its final design.

So it's a leftover from an earlier iteration that the compact-stepper
design replaced. Wiring it in would either overflow the stepper or add a
prose line the reference deliberately doesn't have — a divergence from
the spec for no clear gain. Staying dropped.

**Salvageable, but out of parity — opt-in, not done [decide]:** the
friendlier *semantics* would make a good accessibility `title` /
`aria-label` on the stepper value (a screen reader saying "12 out of 12,
no col class" beats "12"), without changing the visible compact display.
That's new behavior the prototype never had, so it's a deliberate
enhancement to request, not a port task — recording the idea here rather
than slipping it in.

### 2.3 Two ported assertions are weaker than their names **[RESOLVED]**

- `'blank-line comment not carried in cut range'`
  (`core/src/edits.test.ts`) was an `A || B` disjunction satisfiable by
  either branch. Replaced with three positive assertions that pin the
  actual intent directly: `textStart === el.start` (the comment isn't part
  of the carried text), the moved text excludes the comment, and a delete
  leaves the comment in place while removing the element. Not a behavior
  change — the code was already correct; the test now proves it.
- `'row reorder swaps content'` — the always-true conjunct was already
  dropped during the port (kept the real check). Nothing left to do.

### 2.4 Schematic guesses in `computeWidths` **[RESOLVED — every guess now shows the `~`]**

Decision: keep the constants (`col-auto` = 2, non-col child = 12) — there's
no truer number without rendering the content, which `core` won't do — but
make the *estimate always announce itself*. Two of the three guessed kinds
(auto, equal) already set `approx` → the pill shows `~N/12`; the non-col
('plain') case silently didn't, so a full-width guess read as an exact
total. Fixed: `plain` now sets `approx` too. And when a guess pushes a row
past 12, the overfull pill says `⚠ ~N/12 → may wrap` (not a definitive
`→ wraps`), since the row might not actually wrap if the guess is too wide.
Covered by e2e (`§2.4`, the `<legend>` case) and the sample smoke test.

### 2.5 `colSequence` / `nestedRows` index alignment **[RESOLVED — was a real bug]**

Verified, and it was *not* fine. `renderCol` paired the two by an
incrementing counter, which holds only while every row `findRows` collects
is also emitted by `colSequence`. It isn't: `findRows` recurses into a
heading (`legend`/`h1-6`), `colSequence` emits the heading as a `sep` and
stops. So a **row nested inside a heading** lands in `nestedRows` but has
no `'row'` item in the sequence, and the counter then misaligned every
following row — wrong element at the wrong path (mis-selection) and one
row silently dropped. Reachable in practice via an *unclosed* heading,
which the tolerant parser swallows following rows into. The prototype has
the same latent bug.

Note the FOLLOW-UP's original guess ("rows nested at different depths
under mixed wrappers") was **wrong** — the two walkers agree on wrappers.
The real trigger is headings.

Fix (`render.ts`): pair sequence rows to `nestedRows` by **element
identity**, not position, and append any nested row the sequence never
surfaces so none is dropped. Identical output for well-formed templates
(zero behavior change there); correct paths and no lost rows on the
malformed edge cases where the old code was already wrong.

Locked by: `core/titles.test.ts` "colSequence vs nestedRows divergence"
(3 cases pinning that the two do not align, so positional pairing can't be
reassumed) and `e2e/app.spec.ts` "heading-nested rows" (2 cases; both fail
on the old positional code, pass on the fix). Not counted in the ported
157.

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

### 3.2 Interactive paths still untested **[RESOLVED — the four named paths]**

All four now have Playwright coverage (`e2e/app.spec.ts`), each
mutation-checked:

- **Pane resizer** (`source-pane.ts`) — drag resizes and sets the
  `active`/`pane-resizing` flags, plus a clamp test. Note the clamp test
  asserts on the inline `flexBasis` the handler sets, **not** the rendered
  width: `.pane-src` also has CSS `min-width`/`max-width`, so a
  boundingBox assertion would pass even with the JS clamp removed (it was,
  in the first draft — mutation testing caught it). flexBasis isolates the
  JS.
- **Window file drop** (`file-io.ts`) — the depth counter (two enters, one
  leave keeps the overlay up; the second leave clears it), the drop→open
  path, and the dirty-guard refusal. Native OS file drag can't be
  simulated, so these dispatch real `DragEvent`s carrying a `DataTransfer`
  with a `File` (which makes `types` include `'Files'`). That drives the
  actual handlers, including `f.text()` on drop.
- **Toast auto-dismiss** — shows, then clears within the 2600ms timer.
- **`scrollIntoView`** — find and keyboard nav to an off-screen block
  assert `toBeInViewport()`.

Still genuinely untested, but lower-risk and left for later: `pointercancel`
paths on resize/pane-drag (aborted gestures), and the clipboard *fallback*
branch in Copy (`execCommand` path when `navigator.clipboard` throws).

### 3.3 Chromium only **[RESOLVED — Firefox + WebKit projects added]**

`playwright.config.ts` now runs all three engines locally and in CI
(`test.yml` installs chromium, firefox, webkit). Everything passed on
first cross-engine run except two harness limits, both handled:
- the clipboard-readback test is Chromium-only (`test.skip` with reason)
  — Playwright cannot grant clipboard permissions elsewhere; the app's
  copy itself works under a real user gesture;
- three-engine parallel runs contend enough that smooth-scroll/synthetic-
  event timing occasionally slips on Firefox — one local retry added
  (CI already had two) and the keyboard-scroll assertion got a longer
  window. Real regressions still fail every retry.

### 3.4 The jsdom boot test stubs layout **[verify]**

`app.test.ts` replaces `Element.prototype.getBoundingClientRect` globally
with a fixed rect, because jsdom has no layout engine. That's necessary
for the app to boot, but it means any assertion depending on real
geometry is meaningless there. Geometry belongs in Playwright — just
don't let that stub grow into something load-bearing.

### 3.5 The VS Code integration suite has never been executed **[verify]**

*What it is.* `packages/app-extension/test-integration/buffer-seam.test.ts`
(via `npm run test:vscode`, `@vscode/test-cli` + `@vscode/test-electron`) is
the only layer that touches a real `TextDocument` and a real `WorkspaceEdit` —
it exists to settle §7.5's last assumption, that `positionAt` agrees with the
character offsets `core` computes. It typechecks and bundles, and the run
proceeds all the way to VS Code's download step, which the sandbox it was
written in refuses (403 from the egress proxy for
`update.code.visualstudio.com`). So **every assertion in that file is
unexecuted**.

*Why it matters.* An unrun test is not evidence, and this one is carrying the
weight of a bug that shipped to a user. There's also an ordinary risk that it
fails on mechanics rather than substance the first time (the tdd `suite`/`test`
globals, the CJS bundle, the untitled-document lifecycle).

*Suggested direction.* CI runs it under `xvfb-run` on every push
(`.github/workflows/test.yml`), so the first real run is the next push — watch
that job, and fix forward there. Anyone with unrestricted network can settle it
locally in one command: `npm run test:vscode`. Close this entry when a green
run exists, and record where.

---

## 4. Brittleness and maintenance

### 4.1 E2E assertions are coupled to the sample's literal text **[RESOLVED — coupling made explicit and fail-fast]**

~40 of the 50 e2e cases run against the boot sample (`src/sample.ts`) and
assert on literal strings inside it, so a demo edit can silently break
unrelated interaction tests.

Chose the *guard* resolution over a full fixture swap, deliberately: a
swap would migrate 40 tests and entangle with history state (loading a
fixture via Apply in `beforeEach` pushes an undo entry, breaking the "undo
disabled at start" test), which is disproportionate and flaky-prone for a
chore. Instead `e2e/fixture.ts` lists every marker the suite depends on,
and a guard test asserts the boot sample still contains all of them. If
the sample drifts, that one guard fails naming exactly what's missing —
instead of a dozen cryptic failures. A real fixture swap remains possible
later; the marker list is the head start, and the history wrinkle is
noted here so it isn't rediscovered.

### 4.2 `index.html` ↔ `dom.ts` element IDs are coupled by convention only **[RESOLVED — boot-time assertion + a shared contract]**

Took the "explicit assertion pass at boot" option. `dom.ts` now exports
`REQUIRED_EDITOR_IDS` (the shared-editor ids, minus the optional
`#undoBtn`/`#redoBtn` that the extension omits) and `assertRequiredIds(ids)`,
which throws one message naming every missing element. Each frontend calls it
first thing at boot with the editor ids plus its own extras (standalone: the
source pane + header buttons; webview: `#resyncBtn`). A renamed/absent id now
fails loudly and specifically instead of a cryptic null-deref on first use.

Tests: `app.test.ts` asserts `index.html` satisfies the contract and that a
missing id is named (mutation-checked by renaming `#sheet`); `extension.test.ts`
already asserts the webview HTML carries the same ids. Not covered: `dom.ts`
still *reads* `#rowsHost`/`#inspector`/`#sheet` at module-load — the assertion
runs after, so it catches the miss before first render but the const holds
null in between. Making those lazy is a larger refactor, deliberately not done.

### 4.3 Line endings **[RESOLVED]**

Added `.gitattributes` with `* text=auto eol=lf`. The repo already stored
LF (only `core.autocrlf` was converting working trees to CRLF), so
`git add --renormalize .` was a content no-op — this makes checkouts LF
too, deterministically, without rewriting history.

---

## 5. CI **[RESOLVED — workflows added]**

`.github/workflows/test.yml` (push + PR) runs typecheck → unit → e2e;
`.github/workflows/release.yml` (`v*` tags) verifies the tag matches the
extension version, runs typecheck + unit, then builds the standalone
single-file HTML and the extension `.vsix` and attaches both to a GitHub
Release (softprops/action-gh-release, matching l10n-helper's setup).
`npm run typecheck` is its own CI step (a green `npm test` does not imply
the tree typechecks).

Two notes left open deliberately:
- **e2e runs on every push** (not just PRs). Fine for now; if CI minutes
  bite, gate the Playwright job to `pull_request` + tags.
- **`app-standalone` stays `0.0.0`/private** — unversioned; only the
  extension version drives releases.

---

## 6. Documentation drift **[RESOLVED]**

- **PLAN.md's `GridModel` block** now carries a status note marking it as
  the aspirational session-2 shape, stating the shipped shape
  (`{kind, el, spec, isCol, nestedRows}`), pointing at
  `packages/core/src/types.ts`, and naming what doesn't exist yet
  (`role`, precomputed `title`/`hint`, `CondRegion`, `RowNode.items`).
- **The "embedded in its development history" line** is corrected — PLAN.md
  now points at `prototype/prototype-tests.js` /
  `prototype/prototype-core.js` and notes the port to Vitest.
- **`README.md`** expanded from two lines to cover the workspace layout,
  develop/test/build commands (including that `npm test` ≠ typecheck), and
  the single-file build.

---

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

### 7.2 "Saved to persist" cue **[RESOLVED]**

The webview shows a one-time toast — "Applied to the editor — press Ctrl+S
to save" — on the first canvas edit of a session (`webview/main.ts`, on the
first `applied` message). Gentle and where the user is looking (the panel),
rather than a VS Code modal.

### 7.3 Extension tests — sync logic covered; VS Code wiring still not **[RESOLVED — wiring covered with a mocked `vscode`]**

**Update:** `host/extension.test.ts` (13 cases, mutation-checked) now covers
the adapter itself against a `vi.mock`ed `vscode` module: command
registration, the no-editor path, panel options, the webview HTML contract
(nonce-locked CSP **and the element ids `dom.ts` resolves at boot — the
extension-side answer to §4.2**), event routing filtered to the panel's
document, `applyEdits` → `WorkspaceEdit` span building, reveal, and that
disposal detaches every listener. What remains genuinely uncovered is only
the real-Electron layer (an actual `WorkspaceEdit` reaching a real buffer),
which mostly exercises VS Code itself — still deferred, as below.

### 7.4 `applyEdits` isn't serialized — a concurrent-edit race can false-diverge **[RESOLVED — the whole controller is serial now]**

**Fixed.** `Session.enqueue` chains *every* entry point — webview messages and
the editor-side events (`onSave`, `onDocChange`, the live-sync timer, `reload`)
— so nothing observes the buffer mid-apply. `applying` became `applyDepth`, a
counter, so an overlapping apply can't clear the flag early. `onSave` /
`onDocChange` / `reload` now return their queued turn, which is also how the
tests await them. Covered by new `session.test.ts` cases (a save fired
mid-apply sends the buffer the apply produced; a live refresh queued behind an
apply sees the settled text).

The version-based mechanics this entry describes are gone entirely — §9.7
replaced them with content identity before this fix landed, so the specific
"predicted `baseVersion` vs a still-N `docVersion`" symptom below is no longer
reachable. What remained, and is now closed, was the underlying
non-serialisation.

**One part of this entry stands, unchanged and by design:** "out of sync" fires
on any document change the canvas didn't author, so a formatter or another
extension touching the buffer is a legitimate divergence. Since auto-follow is
now the default (§9.6) that resolves itself instead of blocking, and a change
that lands *alongside* our own edit is caught by the settled-buffer comparison
(§7.5).

*(Original entry below, kept for the reasoning.)*

*What it is.* The extension's out-of-sync guard is version-based
(`session.ts:114`): a canvas edit carries the `baseVersion` it was computed
against, and `applyCanvasEdits` refuses it (`diverged` + `OUT_OF_SYNC`) if
`baseVersion !== docVersion()`. The webview keeps the two in step by
**optimistically** bumping `sync.version++` right after posting each batch
(`webview-host.ts:38`), which is what lets a run of *sequential* canvas-only
edits sail through with no manual HTML change. But the host dispatches webview
messages **without awaiting** — `void session.onMessage(msg)`
(`extension.ts:103`) — and `applyCanvasEdits` reads `docVersion()` for its
check while VS Code only bumps `doc.version` when `workspace.applyEdit`
*resolves* (`extension.ts:67`). So if two `applyEdits` messages are queued
before the first's async apply resolves:
- edit 1 suspends at `await applyEdit` — `docVersion` still N;
- edit 2's check runs with `baseVersion` N+1 (correctly predicted) against a
  still-N `docVersion` → **false mismatch → spurious "out of sync"**, with no
  manual/external edit involved.

The same non-serialization corrupts the `applying` flag, which is a boolean not
a counter (`session.ts:37`): edit 2's `finally` can clear `applying` while edit
1's own `onDidChangeTextDocument` is still pending, so a self-authored change
reads as user divergence. Same root cause, second symptom.

*Why it matters.* It's a **false** block: the canvas is actually fine, but the
user is told to Resync. Recovery is non-destructive (Resync re-sends identical
source, no work lost), and reachability is **low today** because the extension's
keyboard is nav-only (`main.ts:31` — no keyboard-driven resize/nudge), so edits
are click/drag-paced by both human timing *and* the postMessage round-trip; you
need two `applyEdits` in one host event-loop turn. But it's a structural race,
and any future rapid-edit path (keyboard nudge, batched ops, autoclick) makes it
easy to hit.

*Also worth recording (separate, already-true):* "out of sync" fires on *any*
document change the canvas didn't author — so **format-on-save, an
auto-formatter, or another extension** touching the buffer legitimately
diverges you. "Assuming no manual edits" is not the full safe-condition; "no
external buffer changes" is. That part is by-design, not a bug — noting it so
it isn't rediscovered as one.

*Suggested direction — verify first.* The whole finding rests on the VS Code
timing assumption (`doc.version` bumps on `applyEdit` *resolve*, not at call).
Confirm that empirically (an Electron integration test, or an F5 repro firing
two canvas edits within a tick) before building a fix. If confirmed, the fix is
small: **serialize `applyEdits`** in `Session` (chain them on a promise queue so
each batch's version check runs only after the prior apply resolved), and/or
make `applying` a **counter** so overlapping edits don't clear it early. Both
belong in the pure `Session` controller, so they're unit-testable
(`session.test.ts`) without Electron. Cross-check against §7.3's note that the
real-buffer layer stays uncovered.

### 7.5 Column resize occasionally corrupts a class in the extension — guarded, drift now caught at the source **[RESOLVED in code; one verification still owed]**

**Fixed — the drift can no longer accumulate.** The leading hypothesis below
(the webview's local source and the buffer drifting apart because something
else rewrote the document alongside our `WorkspaceEdit`) is now checked
directly instead of being caught two edits later. `applyCanvasEdits` computes
`predicted = applyEdits(text, edits)` — the same batch on the same base text,
so exactly what the canvas now holds — and compares it to the buffer that
actually settled. If they differ, the canvas is resent (`sendSource(true)`)
rather than confirmed, so it can never carry a stale source into the next
edit's offsets. Unit-covered and mutation-checked (`session.test.ts`, "a buffer
that settles differently from the edit resyncs the canvas"; reverting the
comparison fails exactly that case).

`core/edits.ts` is published as its own entry point
(`@bootstrap-visualizer/core/edits`) so the Node host can reuse `applyEdits`
without pulling `@angular/compiler` into its bundle — measured: importing the
package index took the host bundle from 16 kB to 942 kB; the subpath keeps it
at 19 kB.

**Still owed — the caveat below, about `positionAt` agreeing with our char
offsets, is now *testable* but has not been *run*.** The integration suite
(`packages/app-extension/test-integration/buffer-seam.test.ts`, run by
`npm run test:vscode`) exercises exactly it against a real `TextDocument`:
class edit, multi-edit column move, CRLF, an astral character before the edit
point, a foreign edit racing ours, and a formatter mutating the buffer right
after our apply. It typechecks and bundles, but **it has never executed** — the
sandbox this was written in blocks the VS Code download
(`update.code.visualstudio.com`, 403 at the egress proxy). CI runs it under
`xvfb-run` on every push, so its first real run is there. Until that run is
green, treat the `positionAt` assumption as *asserted but unconfirmed* — see
§3.5.

*(Original entry below, kept for the analysis.)*

*Symptom (reported).* In the extension, resizing e.g. `<div class="col-sm-2">`
sometimes wrote broken HTML like `<div class=col-sm-42">` — the opening quote
gone and the old digit glued on. That exact shape means the applied span was
shifted one char left (started on the opening quote, ended before the last
value char): an **offset desync** between the offsets the canvas computed and
where they landed in the buffer.

*What was ruled out.* The core edit construction is provably correct: a scan of
**every** `col-*` element in both `examples/` files (122 columns, LF **and**
CRLF) through `setWidthToken` → `writeClass` produced zero broken results, as
did clean/`@if`/`@for`/`*ngIf`/CRLF/attr-order variants. The standalone writes
`state.src` in exactly one place (`apply()`), re-parsing in the same step, so
its model offsets can't go stale against the source it splices. So the
corruption is **not** in `core` and not in the standalone — it's at the
extension's apply seam, where webview offsets are replayed onto the VS Code
document via `positionAt`. Couldn't be reproduced from code here (needs the live
webview/Electron; `positionAt`↔`getText` are consistent per the API, so plain
CRLF alone doesn't explain it — a missed divergence or a stale sync is the more
likely culprit, cf. §7.4).

*What was done (v0.0.11 / v0.0.12).* Defense-in-depth so it can't corrupt
regardless of trigger: every edit carries `Edit.old` (the exact text it expects
at its span) plus `before`/`after` (a little context on each side), stamped in
`applyOps` from the source it was computed against; the extension's
`applyCanvasEdits` verifies all three against the current buffer and, on any
mismatch, refuses the batch as a divergence (resync). The `before`/`after`
context was added (v0.0.12) because the first cut only checked `old`, which is
**empty for an insertion** (Add column/row) and so matched anywhere — a drifted
insertion slipped through and spliced a new column into the middle of a `</div>`
(`</d …new col… iv>`). Covered by `session.test.ts` (replacement + insertion,
matching → applies, drifted → diverged/nothing applied).

*Leading hypothesis (from the report: extension, "after several edits").* The
webview keeps its own `state.src` and applies each edit locally *and* replays it
onto the buffer, trusting the two to stay identical. They drift if the buffer's
result ever differs from the webview's local `applyEdits` — most plausibly a
**formatter / auto-close-tag / another extension reacting to our
`WorkspaceEdit`**. Such a change fires `onDidChangeTextDocument`, but if it lands
*during* our apply it's masked by the `applying` flag (§ `Session.applying`), so
the webview is never told it diverged and keeps a now-stale source. Over several
edits the drift compounds until an edit lands one char off → the corrupted
class. The new `old` guard turns that into a refuse-and-resync at the first
mismatch, which also stops the compounding.

*Caveat / still open.* The guard only catches desyncs where the buffer
**content** differs from `old` at raw char offsets. It assumes `positionAt`
agrees with those char offsets (true per the VS Code API); if some
`positionAt`/EOL edge disagreed, the `old` check (via `substring`) could pass
while the `WorkspaceEdit` still landed wrong. To close this: reproduce in a real
extension host (a sequence of resizes, ideally with a formatter/auto-close
enabled) and confirm the guard fires; if root-causing to formatter drift,
consider re-syncing the webview source after an apply that changed the buffer
beyond our own edit (e.g. `applied` carrying the buffer text / a checksum), or
narrowing what the `applying` flag suppresses. If it recurs for a user, the
resync toast is now the signal that the guard caught it.

---

*(original entry, kept for context)*

The fiddliest part — the host↔webview sync (reveal-echo suppression,
version guard, divergence, edits-out) — is extracted into a pure `Session`
controller (`host/session.ts`; `extension.ts` is a thin VS Code adapter)
and unit-tested (`host/session.test.ts`, 13 cases, mutation-checked). This
was prompted by shipping exactly such a bug (the row-instead-of-column
reveal echo, fixed in v0.0.2), now regression-covered. Runs in the normal
`npm test` (CI included).

Still **not** covered: the VS Code wiring itself — command registration,
the real webview handshake, an actual `WorkspaceEdit` reaching the buffer.
That needs an Electron integration harness (`@vscode/test-cli` /
`-electron`, as l10n-helper uses). Lower value than the controller tests
(it mostly exercises VS Code, and can't easily drive the webview canvas),
so deferred.

## 8. Grid-fidelity gaps (deferred features)

### 8.1 `d-*` responsive show/hide utilities **[RESOLVED — hidden columns take zero grid space]**

Shipped the faithful version (not the dimmed one first floated — a dimmed
column still occupies its slot, so the layout would lie). `colSpec` now parses
`d-*` into a `ColSpec.display` map and `isHiddenAt(spec, bp)` reads it via the
mobile-first `effectiveAt` cascade. In the render layer a column hidden at the
current breakpoint contributes 0 to `computeWidths`/`rowFill`. Rather than omit
it entirely, it's drawn as a **thin dashed line on the seam** where the column
sits (`renderHiddenCol`): `flex:0 0 0` and `pointer-events:none`, so it adds
*zero* width to the row (no false overflow/wrap) and never blocks a neighbour's
resize handle — you just see the column is there. It still carries dropzones
(spread to either side of the seam since it's zero-width) so a column can be
dropped on the left or right of a hidden column — including a hidden *last*
column, where no visible column would otherwise provide a "drop after" zone.
Fully reactive to the breakpoint
switch — flip to a size where the column shows and it reappears as a real column
with the fill updated (that's also where you'd select/edit it). Covered by core
tests (parse + cascade) and an e2e (hidden at md → line + 8/12; shown at lg →
real column + 12/12). Still out of scope: editing visibility (add/remove
`d-none`), and non-column `d-*` on whole rows/content.

_Original plan below, for reference._

Bootstrap's display utilities (`d-none`, `d-md-block`, `d-lg-none`, …)
hide/show an element per breakpoint, mobile-first — e.g. `d-none d-lg-block`
is a desktop-only column (the sample uses exactly that on a `col-lg-3`).
The tool doesn't model this: a column hidden at the current breakpoint is
still drawn and still counted in `N/12`, so at that size the picture is
wrong and a row can read as a false "overfull → wraps".

**Not a big overhaul** — the mobile-first cascade (`effectiveAt`) already
exists and is generic, so it's reusable for a visibility map. Sketched MVP:
1. Parse `d-*` into a `ColSpec.display` map (like `width`/`offset`); add
   `isHiddenAt(spec, bp)` over `effectiveAt`.
2. Fill math: a column hidden at the current bp contributes 0 (fixes the
   false overfull).
3. Render: keep it on the canvas but **dimmed** with a `hidden <md`-style
   badge; already reactive to the breakpoint switch.
4. Tests: the cascade + the sample's `d-none d-lg-block`; e2e that a hidden
   column is dimmed and excluded from the sum at that bp.

Deliberately out of the MVP: **faithful collapse** (hidden column takes zero
canvas width, like the `@if`-hidden strip — needs a render path); **editing
visibility** (a button to add/remove `d-none` — new edit op); non-column
`d-*` (hiding whole rows/content).

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

### 8.3 An `@if` directly inside an `@if`/`@else` branch loses its nesting **[RESOLVED — `El.condPath`]**

**Fixed:** `El.cond` became `El.condPath` — the chain of enclosing branches,
outermost first — and the parser now *prepends* to it instead of skipping an
already-tagged element. Grouping and rendering walk that chain by depth: one
recursive helper in core (`walkCond`, used by all three collectors) and the
matching recursion in the three render walks (`renderTopRows`, `renderRowBody`,
the nested-rows loop in `renderCol`). A region box now draws inside its
enclosing box, sized relative to that box's span rather than the row's, so the
proportions stay true at every level. `condKey` keys on the whole chain (minus
structural `*ngIf` links), so a column can't hop out of an inner block while
staying in the outer one. All three defects below are covered by tests: the
model cases in `core/src/model.test.ts` ("@if nested directly inside another
@if branch"), the tagging in `core/src/parser.test.ts`, and the nested-box DOM
in `app-standalone/src/app.test.ts`. *Original report below.*

*What.* `El.cond` (`types.ts`) held **one** `{region, branch}` tag, and
`parser.ts:133` only set it when empty ("innermost region wins"). So a
conditional block written directly inside another branch —

```html
<div class="row">
  @if (a) {
    @if (b) { <div class="col-6">A</div> }
    <div class="col-3">B</div>
  } @else { <div class="col-12">C</div> }
</div>
```

— tags `col-6` with the **inner** region only. Its membership of `@if (a)` is
gone, and `groupChildren`/`renderRowBody` (which walk source children in
maximal same-region *runs*) see two unrelated sibling regions.

*Verified behaviour* (repro run against the tree, three separate defects):
1. **Not nested.** The canvas draws two side-by-side `.cond-box`es —
   `@if (b)` and `@if (a)/@else` — instead of the inner box sitting inside the
   outer one.
2. **Wrong content shown (correctness, not layout).** Toggle the outer region
   to `@else` and the shown columns are `col-6` + `col-12`: `col-6` lives
   inside the `@if (a)` branch that was just switched away, so it must not
   render at all. The fill pill counts it too.
3. **Duplicate chips.** With the nested block inside the `@else`, the outer
   region is split into two runs by the interposed inner run, so
   `RowNode.conds` lists it **twice** — two chips for one `@if`.

The same applies with the nesting in an `@else` branch, and to `*ngIf` on an
element inside a branch (`tagNgIf` has the same `if (el.cond) continue`).
An `@if` nested *inside a column* (`<div class="col">@if (b) { … }</div>`) is
fine — the element tree already separates the levels; only a block directly
inside a branch, at the same tree level, is affected.

*Suggested direction.* Make the tag a **path**, not a single value:
`El.condPath?: CondTag[]` ordered outermost→innermost (parser prepends as the
`collectIf` recursion unwinds, instead of the `if (!el.cond)` skip). Then
- **model**: `groupChildren` / `findRows` / `collectNestedRows` become
  depth-aware — group by `condPath[depth]`, and recurse into the active
  branch's run at `depth + 1`. `CondRegion` gains children so `RowNode.conds` /
  `ColNode.conds` describe a tree rather than a flat list; grouping by subtree
  rather than by run also fixes defect 3.
- **render**: `renderRowBody` recurses, nesting `.cond-box` inside `.cond-box`;
  the existing span-sum + `denom` width math already composes if applied per
  level.
- **edits**: `condKey` (`editor/src/edits.ts:30`) should key on the whole path,
  so a move across *any* brace boundary is blocked (today it compares the
  innermost tag only).

Not a small change (core types + parser + model, editor render + edits, plus
tests), which is why it's filed rather than patched. Worth confirming first
whether nested `@if` is common enough in the maintainer's templates to justify
it now — defect 2 is the one that argues for "yes", since it silently shows
columns that Angular wouldn't render.

*Known limitation of the fix:* a nested region whose branch shows **nothing**
puts its chip in the row's top-edge strip, same as a hidden top-level one —
so you can still toggle it back, but the strip doesn't show which region it
was nested in. Only visible when an inner branch is empty/hidden; left as is.

### 8.4 Inserted markup always uses `\n`, even in a CRLF document **[RESOLVED — `detectEol`]**

Fixed: `detectEol(src)` sits next to `detectIndentUnit` in `core/src/edits.ts`
(CRLF only when it's the document's actual convention — a stray CRLF in a
mostly-LF file, or vice versa, doesn't flip it), the editor detects it per
`apply` into `state.eol`, and all five builders join with it instead of `'\n'`.
`elementCutRange` now takes the `\r` along with the `\n` it already swallowed,
so a delete or a move no longer leaves the previous line ending in a lone `\r`
— that second half was the one that actually corrupted the file rather than
just making the diff noisy. Covered by `detectEol` unit tests, a CRLF cut-range
test in `core/src/edits.test.ts`, and end-to-end assertions in
`app-standalone/src/app.test.ts` that add / add-row / split / move / delete all
leave a CRLF document with no mixed endings (and an LF document with no `\r`).
Mostly benefits the extension, which reads the editor buffer directly and so
sees the file's real line endings. *Original report below.*

*What.* The indent unit is now detected from the document (§8.5), but the
*line ending* still isn't: every builder in `editor/src/edits.ts` (`splitCol`,
`addColAfter`, `addColToRow`, `addRowAfter`, and `moveCol`'s re-insert)
hardcodes `'\n'`. In a CRLF file each inserted line therefore ends LF while
everything around it ends CRLF.

*Why it matters.* Invisible in the editor, loud in `git diff` / review, and
some formatters will rewrite the whole file on next save. Same class of
complaint as the tab/space one — "match the document, don't impose a style".
The parser already asks the compiler for `preserveLineEndings: true`, so this
is the one place the document's own convention is dropped.

*Suggested direction.* Detect alongside the indent unit — `detectEol(src)`
returning `'\r\n'` if CRLF lines outnumber LF ones, else `'\n'` — hang it on
`state.eol` next to `state.indentUnit` (set in the same place in `apply`), and
have the builders join with it. Cheap; the only care needed is that
`elementCutRange`'s `cutStart` already swallows a preceding `\n` but not the
`\r` before it, so a delete/move in a CRLF file leaves a stray `\r` — worth
checking in the same pass.

### 8.5 Inserted markup matched neither the file's indent character nor width **[RESOLVED — `detectIndentUnit`]**

Fixed: `detectIndentUnit(src)` in `core/src/edits.ts` infers one level of
indentation from the document (a tab if the file indents with tabs, else its
narrowest space indent, two spaces when there's nothing to learn from). The
editor computes it per `apply` into `state.indentUnit`, and every builder uses
it instead of a hardcoded `'  '` / `'    '`; `rowChildIndent` takes it for the
empty-row fallback.

Root cause: the *base* indent was always copied correctly from a sibling
(`elementCutRange` reads spaces and tabs alike), but the step to the next level
in was literal two spaces — so a tab-indented file got `\t\t<div…>` followed by
`\t\t  <!-- new column -->`. The reported "moving a column introduces spaces"
was the one move path that also indents from scratch: `rowChildIndent`'s
fallback when the destination row has no element child to copy from (moving a
column into an empty row). Covered by unit tests on `detectIndentUnit` /
`rowChildIndent` and by end-to-end assertions in `app-standalone/src/app.test.ts`
that a tab document stays tab-only after add / split / add-row / move.

*Not made a setting on purpose:* detection is right for every consistently
indented file, and a setting would need a per-file override to be useful (a
workspace is rarely uniform). Revisit only if a real file infers wrongly —
the fallback order is documented above, so a bad inference is diagnosable.

## 9. Extension behaviour & settings

### 9.1 Tier-1 settings (user-scoped) **[DONE — shipped]**

Four `contributes.configuration` settings, defaults matching today's
behaviour so no one is surprised:
- **default breakpoint** (seed for `state.bp`, today `md`) — *one-way*:
  the in-canvas breakpoint switch is inspection, flipping it must not
  persist ("looked at xs once" ≠ "always open at xs").
- **stretch to fit** and **tint overfull** — *two-way*: the canvas
  checkbox **is** the setting. Flipping it writes to user settings
  (`config.update(..., Global)`) via a host message, and is remembered
  on next open, any project.
- **dialect for new classes** (BS5 vs BS3) — seeds `docBs3` only when a
  file has no grid classes to detect from; existing `col-md-*` / `col-xs-*`
  still win.

Scope: `application` (user-only, not settable in a repo `.vscode`), per the
maintainer's call — including dialect, even though it's the one that could
plausibly vary per project (per-file auto-detection covers most real cases).
Read at panel open, not live (`onDidChangeConfiguration` easy to add later).
Mechanism: host reads config → hands it to `Session` → `Session` posts a
one-time `config` message before the first `setSource` → webview applies it
via a small `applyOpenConfig(cfg)` in the editor package (jsdom-testable).
Standalone never receives it; keeps its own defaults.

### 9.2 "Open Grid Visualizer" spawns a new panel every time **[RESOLVED — single reusable panel]**

Fixed: `openPanel` keeps one `active` canvas. If it exists, `bind(editor)`
re-points it at the current document and reveals it (focused) instead of
spawning another. The bound document is a mutable `doc` every port and
listener reads, so reassigning it re-points them all at once — no re-wiring;
`Session.reload()` resends the new file's source and resets transient sync
state. `onDidDispose` clears `active` so the next open builds fresh. Covered
by extension-wiring tests (one panel on re-open, routing follows the new
file, reveal called, fresh panel after close). Focus jumps to the canvas on
reuse, per the maintainer's call.

### 9.3 Back-to-back canvas edits falsely diverged (issue #1) **[RESOLVED — message queue in Session]**

Fixed: `Session.onMessage` now serializes handling through a promise
queue, so each webview message waits for the previous one's full effect
(including the `await ports.applyEdit(...)` buffer write) before the next
is handled. Root cause was that VS Code delivers `onDidReceiveMessage`
fire-and-forget: a second canvas edit (Add column twice, or two drags)
started `applyCanvasEdits` while the first's `applyEdit` was still in
flight, so its optimistic `baseVersion` was checked against a `docVersion()`
that hadn't yet incremented — read as stale and refused as "diverged",
forcing a manual save between every edit. Covered by new
`session.test.ts` cases (two/many rapid edits both apply; a genuinely
stale edit is still refused; the queue survives a throwing handler); the
test harness's `applyEdit` was made genuinely async to model the real
round-trip the synchronous mock had been hiding.

### 9.4 `onSave`/`onDocChange` bypass the message queue **[RESOLVED — folded into the same queue]**

**Fixed.** The decision this entry asked for was made the strict way: editor
events fold into `Session.enqueue` alongside webview messages, so the whole
controller is serial and ordering is a property of the code rather than of how
VS Code interleaves events with our awaits. The narrow window described below
(a save resending a buffer that's about to change) is closed rather than argued
to be benign, and the new `session.test.ts` "editor events are serialised with
canvas edits" cases pin it.

*(Original entry below.)*

*What.* The 9.3 fix serializes the *webview message* stream, but
`onSave` and `onDocChange` (fired from VS Code editor events, not webview
messages) still call `sendSource`/post divergence synchronously, outside
the queue. *Why it matters.* If the user saves the document while a canvas
edit's `applyEdit` is mid-flight (`applying === true`), `onSave` could
`sendSource` a buffer that's about to change, racing the in-flight apply.
It's a narrow window and largely self-healing (the next `setSource`
re-syncs), which is why it's a verify rather than a fix. **Narrowed by
9.7:** with sync decided by content, the in-flight apply overwrites
`syncedText` with the settled buffer afterwards, so the worst case is one
momentarily stale render — not a false divergence. *Suggested direction.*
Decide whether editor-event handlers should also fold into the same queue
(making the whole controller strictly serial), or whether the content and
context guards already make this benign — confirm with a targeted test
before adding machinery.

### 9.5 Divergence warned on every keystroke **[RESOLVED — edge-triggered]**

Fixed: `Session` now tracks a `diverged` flag and posts `{type:'diverged'}`
only on the false→true edge (`markDiverged`), clearing it in `sendSource`
(the single resync point: save / discard / reload / failed-apply, which is
exactly when the webview drops its own diverged state). Before, `onDocChange`
posted on every buffer change, so a typing burst in the editor re-toasted
"Resync" on every character — the visible half of issue #1's friction. The
two `applyCanvasEdits` refusal paths route through `markDiverged` too, so the
flag stays accurate across a refused stale/misplaced edit. Covered by new
`session.test.ts` cases (a burst flags once; a save/discard re-arms it).

### 9.6 Auto-resync on external edits instead of blocking **[IMPLEMENTED — `liveSync`, now the default]**

**Update 2 — the default flipped to on.** `bootstrapVisualizer.liveSync`
now defaults to **true**. The argument that settled it: in the extension the
canvas holds no unsaved state of its own — every canvas edit goes straight to
the buffer — so following the buffer can never cost the user work, which makes
parking a cost with no matching benefit. It was also punishing the *documented*
undo path: undo in the extension is the editor's own undo (PLAN.md decision
§6), which arrives as an external document change and therefore parked the
canvas every single time. Covered by "the editor's own undo does not park the
canvas" in `session.test.ts`. Park-and-warn stays available by setting it to
false, and now has a visible state to go with it (`.diverged` styling in
`packages/editor/src/styles.css` — before this it set a body class that no
stylesheet defined, so the only signal was a toast that faded).

**Update 1 (maintainer reversed the earlier decline):** shipped as an
**opt-in** setting `bootstrapVisualizer.liveSync` (default **off** at the
time — save-to-sync was the default). When on, `Session.onDocChange` debounces (~400 ms) and calls
`sendSource(keepSelection=true)` instead of `markDiverged`, so the canvas
follows the (dirty) editor and never parks. Safe because: the tolerant parser +
`apply()`'s last-good-view guard keep a half-typed buffer from breaking the
canvas, and the per-edit `old`/`before`/`after` context guard still refuses a
canvas edit that races an un-synced change. Selection is kept where its path
still resolves (`apply({keepSel:true})`). Covered by `session.test.ts`
(off→parks; on→debounced refresh with `keepSelection`; burst→one refresh; save
cancels a pending refresh).

**Deferred refinement — don't refresh mid-drag/resize:** a live refresh guards
on `applying` (a canvas edit in-flight) but not on a webview drag/resize gesture,
which the host can't see. Only reachable if an *external* tool changes the buffer
while you're mid-gesture on the canvas (rare — you're dragging, not typing); a
mid-gesture re-render would replace the element under the pointer and drop the
gesture (no corruption, just a lost drag). Fix if it bites: have the webview
**defer** an incoming `setSource` while `resize.active` / `dnd.src` is set and
apply it once the gesture ends. Left for later on purpose.

*(Fixed: `onSave` now keeps the selection too — `sendSource(true)` — so save and
live refresh behave the same; only a fresh load / discard / reload starts the
canvas empty.)*

*Original decline (kept for context):* Saving the editor already auto-syncs the
canvas, so save-to-sync was considered good enough and the mid-typing
convenience not worth the complexity — until the back-to-back-edit friction made
the live option worth having behind a flag.

*What.* Today a manual edit to the buffer under the canvas flags divergence
and **blocks** all canvas edits until the user saves or clicks Resync
(`canApplyEdit` returns false while `sync.diverged`). Proposal: instead of
parking, **auto-refresh the canvas from the buffer** shortly after the user
stops typing — the same `sendSource` path `onSave` already uses — so the
canvas simply stays live with the editor and the Resync step disappears even
without a save.

*Why it's safe in principle.* The editor buffer is already the source of
truth, and the per-edit anti-corruption guard (`old`/`before`/`after` context
check in `applyCanvasEdits`) already refuses any edit computed against a stale
source — so following the buffer can't corrupt it. Divergence-blocking is a
coarse *earlier* guard; auto-resync replaces "freeze and ask" with "keep up".

*Why it needs a decision, not just a patch:*
- **Cost.** Re-parsing runs `@angular/compiler`; refreshing on every keystroke
  is wasteful. Needs a debounce (~300–500 ms idle) so it fires once per pause.
- **In-progress gestures.** Must not refresh mid-drag/resize (`resize.active`,
  or a live dnd) — a re-render would yank the gesture. Hold the refresh until
  the gesture ends.
- **Selection preservation.** `apply({fromSource})` already re-resolves the
  selection path and drops it if gone; confirm that a hand-edit that keeps the
  selected column intact doesn't visibly drop the selection. A content-keyed
  re-select may be worth it.
- **Keep a manual fallback.** If a re-parse throws (mid-typing invalid HTML),
  don't blow away the canvas — keep the last good render and fall back to the
  existing diverged/Resync affordance until the source parses again.

*Suggested shape.* In `Session`: on `onDocChange` (not applying), start/restart
a debounce timer; when it fires and no gesture is active, `sendSource`. Keep
`markDiverged` as the fallback for the "re-parse failed" and "refused stale
edit" cases only. The debounce/timer is injected as a port so it stays
unit-testable (fake timer), consistent with the rest of `Session`.

### 9.7 Sync is decided by content, not `doc.version` **[RESOLVED — `syncedText`]**

Fixed: `Session` now tracks `syncedText` — the buffer text the canvas is known
to agree with (set in `sendSource`, re-read from `docText()` after each canvas
edit lands) — and decides both "may this canvas edit apply?" and "did the user
change the document under us?" by comparing it to `docText()`. The document
`version` is gone from the protocol (`setSource`/`applied`/`applyEdits`), from
`SessionPorts` (`docVersion`), and from the webview's `SyncState`.

*Root cause it removes.* The webview stamped each outgoing edit with the
document version and then **guessed the next one** (`sync.version++` in
`webview-host.ts`), on the assumption that one `applyEdit` bumps `doc.version`
by exactly one. The host refused anything whose `baseVersion` didn't match. The
guess is a claim about VS Code internals we never verified — and a column drag
sends **two** edits in one `WorkspaceEdit` (`moveCol`: cut + insert), so any
per-text-edit bump made it wrong. The authoritative version only came back in
the `applied` round-trip, so the failure was timing-dependent: a second drag or
a fast offset click fired before that confirmation arrived was refused as
diverged, while the same action a moment later worked. Reported as "drag one
column, drag another immediately → asks to Resync" and the same for rapid
offset steps.

*Why content is the right question.* Versions count *that* something happened,
never *what*: they can't distinguish our own write from the user's, they never
come back down when an edit is undone, and keeping a mirror of them in the
webview means guessing. Comparing the text answers what actually matters. Note
the test harness had encoded the same wrong assumption (`version++` per apply),
so no test could have caught it — the harness now really splices edits into its
buffer, so `docText()` is what a real buffer would hold.

*Behaviour change (deliberate).* Typing a character and deleting it — or undoing
a hand-edit back to the original text — now returns the canvas to sync instead
of parking it until a save: `onDocChange` sees the buffer equal to `syncedText`
and, if it had parked, resends the (identical) source to clear the webview's
warning. The `old`/`before`/`after` per-edit context guards are unchanged and
still stand behind this as the byte-level safety net.

*Residual gaps (small, deliberate):*
- `syncedText` is `null` until the first `sendSource`, and an `applyEdits`
  arriving before then is let through to the context guards rather than refused.
  Unreachable in practice (the webview posts `ready` first, which sends source),
  but it's a permissive default worth knowing about.
- The comparison is a full string compare per document change. Negligible for
  template-sized files; if a very large file ever makes it show up, compare
  lengths first or hash.
- 9.4 (editor-event handlers bypassing the message queue) is *narrower* now but
  not gone: `onSave` racing an in-flight `applyEdit` can still `sendSource` a
  buffer that's about to change. It's now self-correcting — the apply overwrites
  `syncedText` with the settled buffer — so the window costs at most one stale
  render, not a false divergence.

*(Last bullet superseded: §9.4 is closed — editor events share the queue, so
`onSave` can no longer race an in-flight apply at all.)*

---

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

### 9.9 Only two settings are live; the rest are still read once **[decide]**

*What it is.* `onDidChangeConfiguration` (`extension.ts`, gated by
`isLiveSetting`) forwards *only* the two class-convention settings to an open
panel, as a `classConvention` message. The other five are still read once at
panel open (§9.1).

*Why it matters.* It's an asymmetry someone will trip on ("I changed the
dialect and nothing happened"). The convention had to be live for a specific
reason — the panel *writes* it too, so a panel holding a stale copy would
clobber an edit made in settings.json — and re-seeding the whole `OpenConfig`
mid-session would instead yank the breakpoint and view toggles back from under
someone who changed them on the canvas. Hence a separate message rather than a
second `config`.

*Suggested direction.* If the others should be live too, each needs its own
answer to "what if the user has since changed it on the canvas?" — dialect and
`liveSync` are safe to re-apply, breakpoint and the view toggles are not.

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

### 10.1 A class edit rewrites the whole attribute value **[decide]**

*What it is.* `classEdit` (`packages/core/src/edits.ts`) replaces the class
attribute's entire *value span* with `newTokens.join(' ')`, even when one token
changed. Verified: `writeClass`/`classEdit` take the token list from
`setWidthToken`/`setOffsetToken` and re-serialise all of it.

*Why it matters.* The value is rebuilt, so the author's own whitespace inside it
is not preserved: a class list wrapped across several lines (common on Angular
elements with a dozen utility classes) collapses onto one line the first time
you touch the width. That contradicts what the surgical-edit rule promises the
user — "we change what you changed" — and it makes each undo step and each
`WorkspaceEdit` larger than the edit really is. It also widens the window in
which a concurrent edit to the same attribute conflicts.

*Suggested direction.* Diff old tokens against new and emit token-level spans:
replace the changed token in place, insert a new one before the closing quote
(with one separating space), delete a removed one together with one adjacent
separator. `classEdit` already returns an `Edit`, so the signature would become
`Edit[]`; `applyEdits` orders a batch already. The 157-case contract asserts
*resulting source*, mostly via `writeClass`, so most of it should hold
unchanged — which is exactly the safety net that makes this worth doing. Watch
the no-attribute and unquoted-value branches, which stay whole-span.

### 10.2 Selection and collapse state don't survive an edit **[decide]**

*What it is.* Selection is a path (`state.sel.path`, `[rowIdx, colIdx, …]`) and
is re-resolved against a freshly built model after every apply. Two consequences,
both verified in the code:
- `moveCol` and `deleteEl` (`packages/editor/src/edits.ts`) set `state.sel =
  null` outright, so the column you just dragged is deselected the moment it
  lands — the inspector empties and a follow-up nudge needs a re-click.
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
the mapped offset — which would also let `moveCol` keep the moved column
selected instead of clearing. For collapse, key on the same mapped-offset
identity, and drop keys that no longer resolve so the set stops growing.

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

## 11. Parse fidelity

### 11.1 An unclosed element's span is a guess, and structural edits trusted it **[RESOLVED — `El.unclosed` + a per-element guard]**

*What it was.* Every structural edit (move, delete, split, insert-beside) cuts
and splices by `el.end`. That offset is only meaningful when the parser actually
found a closing tag, and there are two everyday ways it doesn't:

- **The compiler path, with no error reported.** Verified against
  `@angular/compiler`: `<div class="row"><div class="col-6">x</div>` parses
  **clean** — `errors` is empty, so nothing fell back — and the row's span is
  `[0, 17)`, its open tag and nothing else. Its own column sits *outside* it.
  Deleting that row would have spliced out `<div class="row">` alone and
  orphaned the column; moving it would have carried the open tag away from its
  contents. No warning anywhere, from a parse that reported no problem.
- **The fallback path.** On a real parse error (a closing tag matching nothing
  open, say) `parseTemplateLegacy` runs, and anything still open at EOF gets
  `end = src.length`. Deleting such a row deletes the rest of the file.

The extension's `old`/`before`/`after` guard did *not* protect against this: it
verifies the text at the offsets, not that the offsets mean what the canvas
drew. The text matches perfectly — it's the span that's wrong.

*Fixed.* `El.unclosed` marks every element whose end the parser had to guess
(both legacy cases, plus the compiler-path safety net), and `RootEl.degraded`
marks a tree that came from the fallback at all. `canCutElement`
(`packages/core/src/edits.ts`) is the rule; `spansAreSafe` in
`packages/editor/src/edits.ts` guards every structural op against *all* the
elements it touches — a move checks its destination as well as its source — and
explains the refusal in a toast. The canvas shows a standing notice while the
tree is degraded (`renderParseNotice`), so a best-effort structure is never
mistaken for the real one.

**Deliberately still allowed on an unclosed element: width and offset edits.**
Its class attribute value span was read straight off the open tag, which the
parser did see, so those stay exact — you can keep using the steppers on a
column you're in the middle of typing. Only cutting is held back. Covered in
`parser.test.ts` (both paths, plus no false positives on void/self-closing
elements or well-formed documents) and in `app.test.ts` (each structural op
refused and the source byte-identical; the width edit still applying;
mutation-checked).

*Residual, worth knowing.* The guard is per element by design: an unclosed
*descendant* is carried as text either way, and an unclosed *ancestor* doesn't
make this element's own tags less real. If a case turns up where a wrong
*nesting* (rather than a wrong end) drives a bad edit, that's a different guard
and this entry doesn't cover it.

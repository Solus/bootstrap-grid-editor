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

### 8.1 `d-*` responsive show/hide utilities **[deferred — planned, not urgent]**

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

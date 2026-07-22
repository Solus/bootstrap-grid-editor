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

### 1.2 Control flow: flattened for now; `CondRegion` + frontend UX deferred **[DEFERRED — its own session]**

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

### 1.3 Dirty-guard responsibility is split between two layers **[decide]**

Resize (`dnd.ts`) and drag-start (`dnd.ts`) check `state.dirty`
themselves and toast early. Every other edit path — steppers, keyboard
width, split, add, delete, nudge, move — has no local check and relies
entirely on the guard inside `apply()` (`state.ts`).

Both layers work, and there are now tests for both (see §3.1 for how that
gap was found). But the asymmetry is accidental rather than designed: the
two early checks exist because those paths need to *abort an interaction*
before it starts, not because the `apply()` guard is insufficient.

Worth a deliberate decision, because the extension will add a third entry
point (editor buffer sync) with the same question. Suggested: keep
`apply()` as the single authoritative guard, and document the two early
checks as UX affordances that must stay redundant with it — never as the
only protection.

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

### 2.4 Schematic guesses in `computeWidths` **[decide]**

`col-auto` is drawn as 2 units and a non-col child as 12
(`render.ts:computeWidths`). Both are eyeballed constants that feed the
fill sum, so a row's reported total can be off in ways the `~` prefix
hints at but doesn't quantify. Fine for a schematic; worth revisiting if
the fill number is ever treated as authoritative.

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

### 3.3 Chromium only **[decide]**

`playwright.config.ts` defines one project. HTML5 drag & drop and pointer
capture are the two things most likely to differ across engines, and both
are load-bearing here. Adding Firefox and WebKit projects is a two-line
change plus browser downloads; worth it before the extension ships, since
the VS Code webview is Chromium but a browser-hosted standalone app isn't.

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

### 4.2 `index.html` ↔ `dom.ts` element IDs are coupled by convention only **[decide]**

`dom.ts` resolves `#src`, `#rowsHost`, `#inspector`, `#sheet` and a dozen
more by string at module load. Nothing checks the markup still contains
them. A typo in either file is a runtime failure, not a compile error.

The jsdom boot test catches it *today* — a missing element throws during
first render — but that's incidental, not by design. If this gets
formalized, the honest version is a single `ids.ts` shared by a generated
`index.html`, or an explicit assertion pass at boot.

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

### 7.1 The webview bundle ships `@angular/compiler` **[decide]**

The webview bundle is ~508 kB (141 kB gzipped) because the shared editor
imports `core`, which imports `@angular/compiler` for the parser. Every
webview load pays for the whole Angular parser.

Options: (a) accept it — it's a one-time load, gzipped it's ~140 kB;
(b) move parsing to the **extension host** (Node) and send the `GridModel`
(or the `El` tree) to the webview over `postMessage`, so the webview
bundles no parser. (b) is the real fix but a meaningful change — it
crosses the core/host boundary and the model would have to be serializable
(it currently holds `parent` back-references and live `El` nodes). Worth
doing before the extension ships for real; not blocking.

### 7.2 No explicit "saved to persist" cue **[chore]**

Canvas edits apply to the buffer immediately (decision §7), so the buffer
goes dirty; VS Code's dirty dot is the only cue. A gentle one-time hint
("canvas edits go to the editor — Ctrl+S to persist") on the first edit of
a session would help discoverability. Minor.

### 7.3 Extension tests — sync logic covered; VS Code wiring still not **[partly done]**

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

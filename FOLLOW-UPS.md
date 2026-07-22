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

### 1.1 `core` doesn't precompute what PLAN.md says frontends must not re-derive **[decide]**

PLAN.md's "Non-negotiables" say frontends never re-derive what `core`
precomputes on the model — role, title, hint, dynamic flags. Today
`core` precomputes **none** of that onto `GridModel`. The model is
`{kind, el, spec, isCol, nestedRows}`, and the app calls `colTitle`,
`contentHint`, `isContainerCol`, `elementTitle`, `colSequence` and
`rowHasControlFlow` **per node, per render pass**
(`packages/app-standalone/src/render.ts:62,66,177,243,255,314`).

This is a faithful port — the prototype did exactly this — so it isn't a
regression. But the rule as written is currently unenforceable, and the
second frontend (the extension webview) will have to make the same calls,
which is precisely the duplication the rule exists to prevent.

Two ways out, and they pull in different directions:

- **Enrich the model** during `buildModel` so `role`/`title`/`hint`/
  `dynamic` are fields. Matches PLAN.md; makes the extension trivially
  thin. Costs: model building gets more expensive, and every field is
  computed whether or not a frontend uses it.
- **Relax the rule** to "frontends don't reimplement core's logic" —
  calling a core function at render time is fine, reimplementing
  `isContainerCol` in the webview is not. Cheaper, and arguably what the
  rule was really protecting.

My lean: the second, with the rule reworded. The first is the kind of
eager computation that gets regretted once a large template is open. But
this is a PLAN.md-level call, not mine.

**Where:** `PLAN.md` "The insulation principle" / "Non-negotiables";
`packages/core/src/model.ts`.

### 1.2 `CondRegion` is unimplemented and `@if` fill is knowingly wrong **[decide]**

PLAN.md drafts `CondRegion` / `CondBranch` and flags them as
"finalize against real parser output". Nothing in `core` models them.
Today a row containing `@if/@else` parses all branches as simultaneous
columns, so its fill sum double-counts; the UI compensates by showing an
italic `~unreliable` pill instead of a false "wraps" warning
(`model.ts:rowHasControlFlow`, `render.ts:rowFill`).

That's a deliberate, tested workaround, not a bug — but it means the fill
number shown for those rows is meaningless rather than merely
approximate. Once `@angular/compiler` gives real control-flow nodes, decide
whether to compute per-branch sums (`max` across branches is probably the
useful answer) or keep the pill.

PLAN.md also notes `@if` wraps whole **rows** in real templates, so
`CondRegion` needs to appear at top level and inside a column's sequence,
not just inside a row's `items`. That shape can't be settled until
session 2 has real AST output in hand.

### 1.4 The `El` span shape is part of the parser-swap contract **[verify]**

The parser swap's stated safety net is the 157 core tests. But those are
not the whole contract. The frontends read raw `El` span fields
**directly**, not through `GridModel`: `.start`, `.end`, `.openEnd`,
`.contentStart`, `.contentEnd` (~40 reads across
`app-standalone/src/edits.ts`, `render.ts`, `selection.ts`), plus
`.children`, `.attrs`, `.tag`. Every surgical edit, the source-highlight
band, and the caret→canvas sync depend on those offsets meaning exactly
what `parseTemplate` makes them mean today.

The session-2 `@angular/compiler` adapter must reproduce that `El` shape
and offset semantics, or the app breaks even with all 157 core tests
green. TypeScript catches a *renamed or removed* field (El is shared),
but not a field that is present yet semantically off — e.g. `contentEnd`
landing a few chars early on a self-closing tag, or `openEnd` excluding
the `>`. The 157 tests assert on spans in only ~16 places, all in
core; the frontend's dependence is covered only by the app-standalone
Playwright suite.

Concretely for session 2: **run `npm run test:all` (unit + e2e), not just
`npm test`, as the regression gate.** A green core suite is necessary but
not sufficient. Better still, add a couple of core-level tests pinning
the span semantics the frontend leans on (`openEnd` includes the `>`;
`contentStart`/`contentEnd` bound exactly the inner text; void and
self-closing elements collapse the content span) so a bad adapter fails
in `core` rather than only in a browser.

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

### 4.3 Line endings **[chore]**

`core.autocrlf` is on, so files check out CRLF. I verified the whole unit
suite passes under CRLF (several cases compare multi-line strings), so
this is fine today. A `.gitattributes` pinning `*.ts text eol=lf` would
make it deterministic rather than verified-once.

---

## 5. CI (when it gets wired)

Per PLAN.md, `test.yml` on push/PR and `release.yml` on `v*` tags. Notes
for whoever writes them:

- **E2E needs `npx playwright install --with-deps chromium`**, which
  makes that job substantially slower than the unit run. Suggested split:
  unit on every push, e2e on PRs and tags only.
- **`npm run typecheck` is not currently part of any test command.** It
  covers four projects (core, core specs, app, e2e specs) and should be
  its own CI step — `npm test` passing does not mean the tree typechecks.
- **Release versioning** comes from `packages/app-extension/package.json`
  (CLAUDE.md), which doesn't exist yet — `packages/app-extension/` is
  still just a `.gitkeep`. Nothing can be tagged until session 3.
- `app-standalone` is `0.0.0` and private. Decide whether it gets
  versioned in step with the extension or stays unversioned.

---

## 6. Documentation drift **[chore]**

- **PLAN.md's `GridModel` block is a draft that no longer matches the
  code.** It documents `RowNode.items`, `CondRegion`/`CondBranch`, and
  `ColNode.role`/`title`/`hint`/`sequence`/`dynamic`. None of those exist
  as model fields in `packages/core/src/types.ts`. Two near-misses worth
  naming so nobody assumes more overlap than there is: `ColSeqItem`
  exists as a *type* but is computed on demand by `colSequence()` rather
  than stored on `ColNode`; and `ContentHint` exists as a return type of
  `contentHint()`, not as a `hint` field. Either annotate the PLAN.md
  block as aspirational-for-session-2 or point it at `types.ts`.
- **PLAN.md says the ~157 tests are "embedded in its development
  history"**, which wasn't true of this repo — they arrived separately as
  `prototype/prototype-tests.js`. Worth correcting so the next reader
  doesn't go looking through git log for them.
- **`README.md` is two lines** and doesn't mention the workspace layout,
  how to run either suite, or how to build the single-file app.

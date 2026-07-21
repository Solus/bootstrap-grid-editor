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

### 2.1 `nudgeCol` / `nudgeRow` ignore their `node` argument **[decide]**

Both take a node parameter and never read it — they operate on
`state.sel` instead (`edits.ts:158,169`; the prototype did the same). I
kept the signature and named the parameter `_node` to make it visible.

They're only ever called when `node` *is* the selection, so it's correct
today. But it's a trap: any future caller passing a node that isn't
selected gets a silent no-op or, worse, moves the wrong element. Either
drop the parameter or make the functions actually use it. I'd use it —
the state dependency is invisible from the call site.

### 2.2 `fmtEff` was dead code and is not ported **[verify]**

The prototype defines `fmtEff` (grid-draft.html:1895) and never calls it.
It formats an effective width for display — `'12/12 (no col class)'`,
`'equal share'`, `'auto (content width)'` — which is friendlier than what
the inspector currently shows (`'equal'`, `'auto'`, `'12'`).

I dropped it as dead. But it looks like a half-landed feature rather than
an accident, so: was it meant to be wired into the inspector? If yes,
that's a small missing feature, not dead code.

### 2.3 Two ported assertions are weaker than their names **[chore]**

Ported as-is rather than silently strengthened, per the rule against
altering tests to suit a change:

- `'blank-line comment not carried in cut range'`
  (`core/src/edits.test.ts`) is an `A || B` disjunction satisfiable by
  either branch, so it can't distinguish some failure modes.
- `'row reorder swaps content'` had an always-true conjunct
  (`m2[0].cols[0].el.children.length >= 0 &&`). I dropped the dead term
  and kept the real check.

Strengthening the first is a behavior discussion — decide what it should
actually assert, then change it deliberately.

### 2.4 Schematic guesses in `computeWidths` **[decide]**

`col-auto` is drawn as 2 units and a non-col child as 12
(`render.ts:computeWidths`). Both are eyeballed constants that feed the
fill sum, so a row's reported total can be off in ways the `~` prefix
hints at but doesn't quantify. Fine for a schematic; worth revisiting if
the fill number is ever treated as authoritative.

### 2.5 `colSequence` / `nestedRows` index alignment **[verify]**

`renderCol` walks `colSequence` and pulls from `nestedRows` by an
incrementing index, assuming the two agree order-for-order. There's a
test that the *counts* match
(`titles.test.ts: 'sequence rows match findRows count'`) but nothing
verifies *alignment* on a structure where they could diverge — e.g. rows
nested at different depths under mixed wrappers. Probably fine, since
both walk source order; unproven.

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

### 3.2 Interactive paths still untested **[verify]**

Playwright covers resize, drag & drop, keyboard, undo/redo, dirty cycle,
find, inspector, breakpoints, collapse, and file I/O. Still uncovered:

- **Pane resizer** drag (`source-pane.ts:wirePaneResizer`).
- **File drag & drop onto the window** — the `dragenter`/`dragleave`
  depth counter and `#dropHint` overlay (`file-io.ts:wireFileDrag`).
  The depth counter is the fiddly part and is exactly the kind of thing
  that breaks silently.
- **Toast auto-dismiss** timing.
- **`scrollIntoView`** behavior on find/keyboard navigation.

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

### 4.1 E2E assertions are coupled to the sample's literal text **[chore]**

36 assertions in `e2e/app.spec.ts` reference exact strings from
`src/sample.ts` (`'col-md-4 col-lg-3'`, `'field020'`,
`'formControlName="code"'`). Editing the sample — which is a demo asset,
so it *will* be edited — breaks tests for reasons unrelated to the code.

Options: freeze a dedicated e2e fixture template separate from the demo
sample, or accept the coupling and treat the sample as a test fixture
that happens to also be the demo. I lean fixture; the sample's job is to
show off features, and those two jobs will conflict.

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

# Bootstrap Visualizer — Build Plan

A visual editor for Bootstrap grid layouts (rows/columns) in Angular
templates. It renders a schematic of a template's grid, lets you
resize/split/move/offset columns, and writes the changes back to the
HTML **surgically** — preserving formatting, comments, and Angular
directives.

Ships as two products from one shared codebase:
- **Standalone app** — paste/open an HTML template, edit visually, copy/download.
- **VS Code extension** — the active editor is the source; edits apply to the buffer.

A complete, working single-file prototype lives at
`prototype/grid-draft.html` (~2500 lines). It is the **reference
implementation**. Its ~157-case test suite lives alongside it as
`prototype/prototype-tests.js` (run against `prototype/prototype-core.js`);
those cases are ported to Vitest in `packages/core` and are the behavioral
contract. This project ports the prototype into a proper monorepo — it is a
*lift*, not a rewrite.

---

## Architecture

Three packages, npm workspaces:

- **`core`** — pure TypeScript. Parser, grid model, classification,
  grid-class math, fill computation, search, edit operations. **No DOM,
  no VS Code, no framework.** Runs in Node (tests) and browser (bundled).
  Only runtime dependency (eventually): `@angular/compiler`.
- **`app-standalone`** — vanilla TS + DOM, built with Vite. The browser
  UI. Imports `core`. Builds to a **single self-contained HTML file**
  (double-click to open) as well as a normal static site.
- **`app-extension`** — VS Code extension. Host code + a webview that
  reuses `app-standalone`'s rendering over `core`.

### The one fundamental difference between the frontends
Only the two ends of the pipe differ; everything valuable is shared:
- **Source in:** standalone reads its textarea; extension reads the
  active editor document.
- **Edits out:** standalone writes the textarea / Copy / Download;
  extension applies workspace edits to the buffer.

`core` speaks **strings and offsets**: "HTML in → GridModel" and "apply
this edit at this span → new HTML". Each frontend adapts its
environment to that contract. Canvas rendering and the inspector are
mostly shared (the extension webview is a browser).

### The insulation principle
Rendering, inspector, fill, search, and edits all talk to **`GridModel`**,
never to the parser's AST. This is what lets us swap the parser and add
project-aware enrichment later without rippling changes outward.
Everything a frontend needs to render (role, title, hint, dynamic
flags) is **precomputed on the node** by `core` during model-building,
so frontends stay thin and identical.

---

## GridModel (draft — finalize against real parser output)

> **Status:** this block is the *aspirational* shape, to be finalized in
> session 2 against real `@angular/compiler` output. It is **not** what the
> code ships today. The current model — a faithful lift of the prototype —
> is `{kind, el, spec, isCol, nestedRows}`; the authoritative definitions
> are in `packages/core/src/types.ts`. `role`, precomputed `title`/`hint`,
> `CondRegion`/`CondBranch`, and `RowNode.items` below do **not** exist yet
> (they are computed on demand by `core` functions, not stored on nodes).
> See `FOLLOW-UPS.md` §1.1–1.2 for the open decisions.

```ts
type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
type WidthValue = number | 'equal' | 'auto';   // 'equal' = bare col/col-md; null key = undeclared

interface ColSpec {
  width:  Partial<Record<Breakpoint, WidthValue>>;   // only declared bps stored
  offset: Partial<Record<Breakpoint, number>>;       // cascade is computed, never stored
}

interface SourceSpan { start: number; end: number; openEnd: number; }
interface ClassAttr  { value: string; valueStart: number; valueEnd: number; quote: '"' | "'" | ''; }
interface TitleRef   { text: string; full: string; source: 'comment' | 'legend'; }
interface ContentHint { text: string; kind: 'control' | 'i18n' | 'tag'; tag?: string; }
interface DynamicFlags { interpolatedClass: boolean; ngClassBinding: boolean; }

interface RowNode {
  kind: 'row';
  span: SourceSpan;
  title: TitleRef | null;
  items: RowItem[];              // columns AND conditional regions, in source order
  classAttr: ClassAttr | null;
}

type RowItem = ColNode | CondRegion;

interface ColNode {
  kind: 'col';
  span: SourceSpan;
  spec: ColSpec;
  role: 'content' | 'container';  // container = only rows + headings (legend/h1-6) + spacers inside
  title: TitleRef | null;
  hint: ContentHint | null;
  sequence: ColSeqItem[];         // nested rows + section separators, in order
  classAttr: ClassAttr | null;
  dynamic: DynamicFlags;
}

type ColSeqItem =
  | { kind: 'row'; row: RowNode }
  | { kind: 'separator'; text: string; full: string };  // mid-col legend / wrapper sectionTitle

interface CondRegion { kind: 'cond'; span: SourceSpan; branches: CondBranch[]; }
interface CondBranch { label: string; condition: string | null; items: RowItem[]; }
```

**Key decision:** `CondRegion` sits at the same level as `ColNode` in
`items[]` (not flattened away) — this represents both whole-row swaps
and in-row branches, and lets fill compute per-branch sums.

**Open item (deferred to the parser phase):** `@if` also wraps whole
**rows** in real templates (confirmed — e.g. `@if (featureModeEnabled)`
around alternate layouts). So `CondRegion` must also be able to appear
at the top level / inside a column's `sequence`, not only inside a
row's `items`. Finalize the exact shape once `@angular/compiler` output
is in hand — do not guess now.

---

## Domain rules the prototype already implements (must be preserved)

- **Rows** = `.row` / `.form-row`. **Columns** = children with
  `col*`/`offset*` classes.
- **Container vs content column:** a column is a *container* (structural
  scaffolding) when it leads to nested rows and every element child is a
  row, a heading (`legend`/`h1`–`h6`), a spacer (`br`/`hr`), or a
  wrapper element whose subtree contains rows — with no loose content
  text. Otherwise *content*. A leading legend titles the container.
- **Titles:** comment directly adjacent above the element (blank line
  breaks the association), else the first heading child (its text, else
  last segment of its i18n key). Comments are carried with the element
  on move/delete.
- **Content hints:** search non-row descendants (depth 3) — a form
  control's name (`formControlName` / `[formControl]`) beats an i18n key
  (`app-i18n` / `lc-l10n`, last segment) beats the first tag. Show the
  providing element's tag as the type (`text-input · field004`).
- **Section separators:** mid-column legends and wrapper `sectionTitle`
  attributes render as labeled dividers between nested rows, in source
  order.
- **Bootstrap dialects:** both modern (`col-6`, `col-md-4`, `offset-md-2`)
  and Bootstrap 3 (`col-xs-6`, `col-sm-offset-4`) are recognized. Edits
  **preserve the existing token's dialect**; new tokens follow the
  document's detected dialect. Explicit `offset-*-0` is used to cancel
  an inherited nonzero offset.
- **Width edits target the defining token** across the mobile-first
  cascade (editing at a breakpoint the element doesn't declare edits the
  token that actually supplies the effective value); per-breakpoint
  overrides are created deliberately, not as a side effect.
- **Equal-width / `col-auto` columns refuse edge-drag resize** (no fixed
  width to drag) — handled via the stepper instead.
- **Row fill:** widths + offsets summed per breakpoint. Neutral pill at
  ≤12, amber "wraps" warning when >12 (optional row tint). Rows
  containing `@if/@else` show an italic `~unreliable` pill (branches
  double-count), never a false warning.
- **Edits are surgical:** rewrite only the class attribute's value span,
  or move/insert element text with its adjacent title comment. Never
  regenerate the document.

---

## Build sequence

Progress is tracked with checkboxes: `[x]` done, `[ ]` outstanding. A
session is checked only when every box under it is.

- [x] **Session 1 — scaffold + port core (against the existing hand-rolled parser)**
  - [x] Root workspace config, `tsconfig.base.json`, per-package configs.
  - [x] Lift the prototype's `<script id="core">` into `packages/core/src/*`,
        split by concern (see file map in README / repo structure).
  - [x] Port the test suite to **Vitest**, co-located `*.test.ts`. Keep the
        hand-rolled parser for now so tests go **green immediately**.
  - [x] Stand up `app-standalone` (Vite): port `<script id="app">` into
        `render/inspector/source-pane/find/file-io/keyboard`, extract inline
        CSS. Reach feature parity with the prototype.

  Delivered on `main`: core lifted, 157-case Vitest suite green, standalone
  app at parity, plus a Playwright suite for the interactive surface. Open
  questions and deferred decisions are logged in `FOLLOW-UPS.md`.

- [ ] **Session 2 — parser swap (with the green tests as the safety net)**

  *Goal.* Replace the hand-rolled `parser.ts` with an adapter over
  `@angular/compiler`'s `parseTemplate()` that walks its AST into the **same
  `GridModel`** everything downstream already consumes. Render, inspector,
  edits, find, and the frontends stay untouched — that insulation is the
  whole point of Session 1's structure. `core` stays framework-free;
  `@angular/compiler` is a parsing dependency, nothing more.

  *Why.* The real compiler handles what the tolerant parser only
  approximates: `@if/@else/@for` as genuine nodes; correct interpolation and
  binding edge cases (`{{ a < b }}`); structured bindings that sharpen
  field/label recognition; guaranteed accurate source spans; and acceptance
  of any valid Angular syntax.

  - [ ] **Work**
    - [ ] Add `@angular/compiler` to `packages/core`; write `parser.ts` (or a
          new `parser/angular.ts`) exposing the **same surface** the model
          builder uses today — a tree of `El` nodes with faithful
          `start/openEnd/end/contentStart/contentEnd` offsets. Map the
          compiler's spans onto the `El` shape's exact semantics (see risk).
    - [ ] Keep `buildModel` and the classification/title/hint/edit code
          as-is; only the tree it consumes changes.
    - [ ] Run the 157-case suite continuously as a **regression guard**. Do
          not weaken a test to make the new parser pass — if behavior
          genuinely changes, discuss it first (per `CLAUDE.md`).
  - [ ] **Decisions to finalize (deferred from Session 1)**
    - [ ] **`CondRegion` shape** (`FOLLOW-UPS.md` §1.2). Settle how
          conditional regions are modeled — and whether the `@if` fill number
          becomes meaningful (per-branch sums, `max` across branches) or
          keeps the honest `~unreliable` pill. Finalize against **real** AST
          output, not a guess; `CondRegion` must be able to appear at the top
          level and inside a column's sequence, not only inside a row's
          `items`.
    - [ ] **The insulation-principle rule** (`FOLLOW-UPS.md` §1.1). Settle
          whether `core` precomputes `role`/`title`/`hint`/`dynamic` onto the
          model, or the rule is reworded to "frontends don't *reimplement*
          core's logic".
  - [ ] **Guard against the main risk — span fidelity** (`FOLLOW-UPS.md`
        §1.4). The surgical edits slice source at exact offsets, so the
        adapter must reproduce the `El` span *semantics* precisely (does
        `openEnd` include the `>`; do `contentStart/contentEnd` bound exactly
        the inner text; do void/self-closing elements collapse the content
        span). TypeScript catches a renamed field but not one present yet
        semantically off.
    - [ ] Add core-level span-semantics tests **up front**, so a bad mapping
          fails fast in `core` rather than only in a browser.
    - [ ] Gate on `npm run test:all` (unit + e2e), not just `npm test` — the
          frontend's dependence on span semantics is exercised only by the
          Playwright suite.

  *Done when.* The Angular-backed parser is in place; the 157-case suite and
  the Playwright suite both pass; `CondRegion` and the insulation rule are
  resolved (in code and in `FOLLOW-UPS.md`); any intentional behavior change
  is documented with new tests. *Out of scope:* the extension (Session 3)
  and enrichment (Session 4+).

- [ ] **Session 3 — extension**
  - [ ] Activation, webview panel, editor↔canvas sync. Design already agreed:
        canvas refreshes from source on **save**; canvas edits sync via
        **Apply → editor buffer** (not disk), with **guard-and-warn** if the
        source diverged, a **Discard** to reset the canvas, and a post-Apply
        toast reminding the user to Save. Apply as **minimal workspace edits**
        (replay ops), not whole-document replacement.

- [ ] **Session 4+ — enrichment (strictly additive, extension-only)**
  - [ ] Resolve i18n keys → real translated labels from locale files.
  - [ ] Resolve component tags → their TS classes / `@Input`s.
  - [ ] Cross-check `formControlName` against the backing `FormGroup`.
  - Rule: **read the user's code, never run their toolchain.** `core`
    stays HTML-only; enrichment lives only in the extension frontend and
    is always optional (fall back to the key/tag if resolution fails).

---

## CI / CD (GitHub Actions — later phase, once there's something to build)

Cannot be wired until sessions 1–3 create the build scripts and the
extension package. Add the test-on-push part as soon as session 1's
Vitest suite exists; add build-and-publish once the extension exists.

**Two triggers, deliberately different:**
- **On every push / PR** → run the **Vitest suite only**. Fast feedback;
  no artifacts. A red suite fails the check.
- **On a version tag (`v*`)** → run tests, then **build both
  artifacts** and **publish them to a GitHub Release**:
  - `app-standalone` → the single self-contained HTML.
  - `app-extension` → the `.vsix` (via `vsce package`).

**Artifacts live in GitHub Releases, NOT committed to the repo.**
Committing build outputs bloats git history and risks a
commit→build→commit loop. The tag-triggered workflow attaches the
`.vsix` and HTML to the Release for that tag; users download from the
Releases page. (If in-tree files are ever truly wanted, a CI-only
`builds` branch is the safer form — but Releases is the default.)

**Versioning:** the `.vsix` version comes from
`packages/app-extension/package.json`. The release is driven by the git
tag. Keep the tag and that `package.json` version in sync (see
`CLAUDE.md` → "Releasing a version"). Tag `v1.2.3` ⇒ extension version
`1.2.3` ⇒ Release `v1.2.3` with both artifacts attached.

Rough workflow shape (finalize during the CI phase):
- `.github/workflows/test.yml` — on: [push, pull_request] → install, `npm test`.
- `.github/workflows/release.yml` — on: push tags `v*` → install, test,
  build standalone, `vsce package`, create Release, upload both assets.

---

## Non-negotiables

- **`core` has no DOM and no VS Code imports.** If a function needs
  either, it belongs in a frontend, not `core`.
- **Frontends never re-derive** what `core` precomputes on the model.
- **Edits are span-based descriptions** returned by `core`; the frontend
  applies them. No string-scanning or class math in frontend code.
- **The test suite is the contract.** Port all ~157 cases; a passing
  suite is what makes the parser swap safe. Add tests with new behavior.
- **Preserve the user's source byte-for-byte outside the edited span.**

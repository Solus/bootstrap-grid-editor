/* Shared shapes for the parse tree and the grid model.
   These describe what the hand-rolled parser actually produces today.
   PLAN.md's richer GridModel (precomputed role/title/hint, CondRegion)
   is deliberately NOT modelled here — it is finalized in session 2
   against real @angular/compiler output. */

/* ── parse tree ──────────────────────────────────────────────────── */

/** One attribute on an open tag, with the source span of its *value*.
    valueStart/valueEnd are -1 and value is null for a bare attribute
    (`disabled`). `quote` is '' for an unquoted value. */
export interface Attr {
  name: string;
  valueStart: number;
  valueEnd: number;
  value: string | null;
  quote: '"' | "'" | '';
}

/** An element node. Every offset indexes into the original source, so
    edits can rewrite exact spans instead of regenerating the document.

    start ── openEnd ─────────────── contentEnd ── end
    <div class="row">   children…    </div>
                    └ contentStart

    For void and self-closing elements contentStart === contentEnd === openEnd. */
export interface El {
  tag: string;
  attrs: Attr[];
  children: El[];
  start: number;
  openEnd: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  selfClosing?: boolean;
  parent: El | null;
  /** Set on the top-level elements of an `@if` branch (the parser flattens
      the branches into siblings but tags them). `region` keys into
      `RootEl.condRegions`; `branch` is the branch index. */
  cond?: { region: string; branch: number };
}

/** The synthetic document root. Spans the whole source; has no open tag.
    Carries the `@if` region registry the tags on `El.cond` point into. */
export interface RootEl extends El {
  tag: '#root';
  condRegions: Record<string, CondRegionMeta>;
}

/* ── conditional regions (@if / @else) ───────────────────────────── */

/** One branch of an `@if`: its label (`@if (x)`, `@else if (y)`, `@else`) and
    condition text (null for the bare `@else`). Empty branches are recorded
    here even though they contribute no element. */
export interface CondBranchMeta {
  index: number;
  label: string;
  condition: string | null;
}

/** Full branch list for one `@if` region — built by the parser (incl. empty
    branches), so `buildModel` can reconstruct the toggle even when the active
    branch has no columns. */
export interface CondRegionMeta {
  region: string;
  branches: CondBranchMeta[];
  /** True for a `*ngIf` region: the condition is an attribute on the element
      itself (its span includes it), so the element is self-contained and can
      be moved freely — unlike an inline `@if`/`@else` *block*, whose `{}`
      braces surround the element. Absent/false for block regions. */
  structural?: boolean;
}

/** A conditional region as the model exposes it: its branches plus which one
    is currently shown. `buildModel` emits only the active branch's cols. */
export interface CondRegion {
  region: string;
  branches: CondBranchMeta[];
  activeIndex: number;
}

/* ── grid classes ────────────────────────────────────────────────── */

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

/** A declared column width: a 1–12 span, `col-auto`, or a bare
    `col`/`col-md` meaning "share the row equally". */
export type WidthValue = number | 'equal' | 'auto';

/** Only *declared* breakpoints are stored. The mobile-first cascade is
    computed on demand (see effectiveAt / definingBp), never baked in. */
export interface ColSpec {
  width: Partial<Record<Breakpoint, WidthValue>>;
  offset: Partial<Record<Breakpoint, number>>;
  /** Per-breakpoint visibility from `d-*` utilities: `true` = shown,
      `false` = hidden (`d-none`). Absent at a breakpoint means inherit from
      the nearest smaller one (mobile-first), like width/offset. */
  display?: Partial<Record<Breakpoint, boolean>>;
}

/* ── grid model ──────────────────────────────────────────────────── */

export interface RowNode {
  kind: 'row';
  el: El;
  cols: ColNode[];
  /** `@if` regions among this row's columns (active branch's cols are already
      in `cols`; this drives the branch toggle). Absent when there are none. */
  conds?: CondRegion[];
}

export interface ColNode {
  kind: 'col';
  el: El;
  spec: ColSpec;
  /** False for a row child carrying no col-/offset- class at all. */
  isCol: boolean;
  nestedRows: RowNode[];
  /** `@if` regions among this column's nested rows (see RowNode.conds). */
  conds?: CondRegion[];
}

export type GridNode = RowNode | ColNode;

/** Path into the model tree: [rowIdx, colIdx, rowIdx, colIdx, …]. */
export type NodePath = number[];

export interface NodeRef {
  path: NodePath;
  kind: 'row' | 'col';
}

/* ── titles, hints & structure ───────────────────────────────────── */

/** A label with both its display form and its source form — for an i18n
    key these differ (`sectionF` vs `demo.editor.sectionF`). */
export interface Label {
  text: string;
  full: string;
}

export interface ContentHint {
  text: string;
  kind: 'control' | 'i18n' | 'tag';
  /** Tag of the element that supplied the name, shown as the type badge. */
  tag?: string;
}

/** One step in a column's inner structure, in source order: a nested row,
    or a labeled divider between rows. `direct` marks a separator that came
    from a direct heading child — the renderer skips the one already
    consumed as the column's own title. */
export type ColSeqItem =
  | { kind: 'row'; el: El }
  | { kind: 'sep'; text: string; full: string; direct: boolean };

/* ── edits ───────────────────────────────────────────────────────── */

/** A span-based edit: replace source [start, end) with `text`. An insertion
    has start === end; a deletion has text === ''. The unit every edit
    operation produces — a frontend applies a batch by splicing them into a
    string (standalone) or replaying them onto a document (extension). Edits
    in a batch must not overlap; `applyEdits` orders them. */
export interface Edit {
  start: number;
  end: number;
  text: string;
  /** The exact source text this edit expects to find at [start, end), captured
      when the edit was built. Lets the applier verify the offsets still line up
      before splicing — so an offset desync (e.g. the extension's buffer having
      drifted from the canvas's source) is refused instead of corrupting the
      file. Optional: absent edits skip the check. */
  old?: string;
  /** A few chars of context just before `start` / just after `end`, as they
      were when the edit was built. Verified alongside `old` so an *insertion*
      (start === end, empty `old`, which would otherwise match anywhere) is also
      caught when it would land at a drifted offset — e.g. inside a `</div>`. */
  before?: string;
  after?: string;
}

/** Where to cut an element out of the source, and what to paste back.
    - cutStart..cutEnd  → remove for a delete or the lift half of a move
                          (swallows the preceding newline and indentation)
    - textStart..el.end → the text to re-insert, title comments included */
export interface CutRange {
  cutStart: number;
  cutEnd: number;
  textStart: number;
  indent: string;
}

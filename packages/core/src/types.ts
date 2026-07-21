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
}

/** The synthetic document root. Spans the whole source; has no open tag. */
export interface RootEl extends El {
  tag: '#root';
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
}

/* ── grid model ──────────────────────────────────────────────────── */

export interface RowNode {
  kind: 'row';
  el: El;
  cols: ColNode[];
}

export interface ColNode {
  kind: 'col';
  el: El;
  spec: ColSpec;
  /** False for a row child carrying no col-/offset- class at all. */
  isCol: boolean;
  nestedRows: RowNode[];
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

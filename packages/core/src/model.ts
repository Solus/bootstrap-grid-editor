/* The grid model: rows, columns and the classification rules that decide
   what a column *is*. Everything downstream (render, inspector, fill,
   search, edits) talks to this, never to the parse tree directly. */

import { classTokens, colSpec, hasClass, isColTokens } from './classes.js';
import type {
  ColNode, CondRegion, CondRegionMeta, El, NodeRef, RootEl, RowNode,
} from './types.js';

export function isRowEl(el: El): boolean {
  return hasClass(el, 'row') || hasClass(el, 'form-row');
}

export function isHeadingEl(el: El): boolean {
  return /^(legend|h[1-6])$/i.test(el.tag);
}

export function isSpacerEl(el: El): boolean {
  return /^(br|hr)$/i.test(el.tag);
}

export function subtreeHasRow(el: El): boolean {
  return el.children.some(c => isRowEl(c) || subtreeHasRow(c));
}

/* ── building ────────────────────────────────────────────────────── */

/** Per-build state: which branch is active for each `@if` region, and the
    region registry (branch labels/conditions) from the parsed root. */
export interface CondCtx {
  active: Record<string, number>;
  regions: Record<string, CondRegionMeta>;
}
const NO_COND: CondCtx = { active: {}, regions: {} };

/** Walk a flat child list as the *tree* its `@if`s describe.

    At `depth`, each maximal run of consecutive children sharing a region is
    that region; only the run members belonging to its active branch survive,
    and those are re-walked at `depth + 1` so an `@if` written directly inside
    a branch nests inside it instead of reading as a sibling region. Children
    with nothing at this depth are unconditional here and pass straight through.

    `onActive` sees every child active at *every* depth, in source order;
    `onRegion` sees each region once, outermost first. The three collectors
    below (row columns, top-level rows, a column's nested rows) differ only in
    what they do with those. The renderer walks the same shape from `condPath`
    to draw the boxes, so the two stay in step. */
export function walkCond(
  children: El[], ctx: CondCtx, depth: number,
  onActive: (el: El) => void,
  onRegion: (region: CondRegion) => void = () => {},
): void {
  let i = 0;
  while (i < children.length) {
    const tag = children[i]!.condPath?.[depth];
    if (!tag) { onActive(children[i]!); i++; continue; }
    const { region } = tag;
    const run: El[] = [];
    while (i < children.length && children[i]!.condPath?.[depth]?.region === region) {
      run.push(children[i]!);
      i++;
    }
    const activeIndex = ctx.active[region] ?? 0;
    onRegion({ region, branches: ctx.regions[region]?.branches ?? [], activeIndex });
    walkCond(run.filter(e => e.condPath![depth]!.branch === activeIndex),
      ctx, depth + 1, onActive, onRegion);
  }
}

/** Build the grid model. `active` maps each `@if` region key to the branch
    index to show (default 0); only the active branch's columns/rows appear in
    the model, with the region metadata attached as `conds` for the toggle. */
export function buildModel(root: El, active: Record<string, number> = {}): RowNode[] {
  const ctx: CondCtx = { active, regions: (root as RootEl).condRegions ?? {} };
  return findRows(root, [], ctx);
}

/** Collect rows whose nearest grid ancestor is `el`, region-aware: a run of
    `@if`-branch children (whole conditional rows, or wrappers of rows) emits
    only the active branch's rows — same rule as columns and nested rows. The
    renderer reconstructs box positions from the tagged source tree, so no
    extra metadata is returned here. */
export function findRows(el: El, out: RowNode[] = [], ctx: CondCtx = NO_COND): RowNode[] {
  walkCond(el.children, ctx, 0, c => {
    if (isRowEl(c)) out.push(buildRow(c, ctx));
    else findRows(c, out, ctx);
  });
  return out;
}

export function buildRow(el: El, ctx: CondCtx = NO_COND): RowNode {
  const { active, conds } = groupChildren(el.children, ctx);
  const node: RowNode = { kind: 'row', el, cols: active.map(c => buildCol(c, ctx)) };
  if (conds.length) node.conds = conds;
  return node;
}

export function buildCol(el: El, ctx: CondCtx = NO_COND): ColNode {
  const tokens = classTokens(el);
  const { rows, conds } = collectNestedRows(el, ctx);
  const node: ColNode = {
    kind: 'col', el,
    spec: colSpec(tokens),
    isCol: isColTokens(tokens),
    nestedRows: rows,
  };
  if (conds.length) node.conds = conds;
  return node;
}

/** Split a flat child list into the active-branch children (in source order,
    interleaved with untagged children) and the `@if` regions found, nested
    regions included. */
function groupChildren(children: El[], ctx: CondCtx): { active: El[]; conds: CondRegion[] } {
  const active: El[] = [];
  const conds: CondRegion[] = [];
  walkCond(children, ctx, 0, e => active.push(e), r => conds.push(r));
  return { active, conds };
}

/** A column's nested rows, region-aware: `@if`-of-rows inside the column is
    grouped to the active branch and surfaced as `ColNode.conds`. */
function collectNestedRows(el: El, ctx: CondCtx): { rows: RowNode[]; conds: CondRegion[] } {
  const rows: RowNode[] = [];
  const conds: CondRegion[] = [];
  walkCond(el.children, ctx, 0, c => {
    if (isRowEl(c)) rows.push(buildRow(c, ctx));
    else {
      // a wrapper element: its own children start a fresh condPath level
      const sub = collectNestedRows(c, ctx);
      rows.push(...sub.rows);
      conds.push(...sub.conds);
    }
  }, r => conds.push(r));
  return { rows, conds };
}

/* ── classification ──────────────────────────────────────────────── */

/** The element's own text outside its child elements, comments stripped. */
export function looseText(src: string, el: El): string {
  let txt = '', pos = el.contentStart;
  for (const c of el.children) {
    txt += src.slice(pos, c.start);
    pos = c.end;
  }
  txt += src.slice(pos, el.contentEnd);
  return txt.replace(/<!--[\s\S]*?-->/g, '');
}

/** Angular 17 control-flow blocks (@if/@else/@for/@switch) make a row's
    fill sum unreliable — all branches parse as simultaneous columns, so
    they double-count. Rows like this show `~unreliable`, never a warning. */
export function rowHasControlFlow(src: string, el: El): boolean {
  return /@(if|else|for|switch)\b/.test(looseText(src, el));
}

/** `@for`/`@switch` are still flattened (branches double-count) → unreliable
    fill. `@if` is now modeled (per-branch), so it is handled separately. */
export function rowHasForOrSwitch(src: string, el: El): boolean {
  return /@(for|switch)\b/.test(looseText(src, el));
}

/** The row's own text mentions `@if` (a control-flow `@if`, not modeled into
    a CondRegion — e.g. all-branches-empty, or the legacy parse fallback). */
export function rowMentionsIf(src: string, el: El): boolean {
  return /@if\b/.test(looseText(src, el));
}

/** A "container" column is structural scaffolding: it leads to nested rows,
    every element child is a row, a heading (legend/h1-h6 as section title),
    a spacer (br/hr), or a wrapper whose subtree contains rows (panel
    sections, fieldsets, ng-container…), and it has no loose content text.
    Anything else is a *content* column. */
/** Angular control-flow scaffolding as it appears in loose text: a block
    header (`@if (x) {`, `@else {`, `@for (…) {`, `@case ('x') {`, …) or a
    closing `}`. Amended container rule: this text is structure, not content —
    an `@if` wrapping a column's rows must not demote it to a content col. */
const CTRL_FLOW_SYNTAX = /@[a-z]+\b[^{}]*\{|\}/gi;

export function isContainerCol(src: string, el: El): boolean {
  if (!el.children.length) return false;
  if (!el.children.some(c => isRowEl(c) || subtreeHasRow(c))) return false;
  if (!el.children.every(c =>
      isRowEl(c) || isHeadingEl(c) || isSpacerEl(c) || subtreeHasRow(c))) return false;
  return looseText(src, el).replace(CTRL_FLOW_SYNTAX, '').trim() === '';
}

/* ── lookup ──────────────────────────────────────────────────────── */

/** Small stable hash, used for identity tracking across re-parses. */
export function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The deepest row/col in the model whose source span contains `pos`. */
export function nodeAtOffset(model: RowNode[], pos: number): NodeRef | null {
  let best: NodeRef | null = null;
  (function walk(rlist: RowNode[], base: number[]) {
    rlist.forEach((r, i) => {
      const p = base.concat(i);
      if (pos >= r.el.start && pos < r.el.end) {
        best = { path: p, kind: 'row' };
        r.cols.forEach((c, ci) => {
          if (pos >= c.el.start && pos < c.el.end) {
            best = { path: p.concat(ci), kind: 'col' };
            walk(c.nestedRows, p.concat(ci));
          }
        });
      }
    });
  })(model, []);
  return best;
}

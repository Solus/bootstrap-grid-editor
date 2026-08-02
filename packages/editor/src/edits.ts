/* Edit operations.

   Every one of these expresses its change as a batch of core `Edit`
   descriptors (a span + replacement text) and hands it to `applyOps`. No
   grid-class math happens here — the token arithmetic all lives in core, and
   the span edits are what the host adapter replays outward. */

import {
  canCutElement, childIndent, classEdit, classTokens, effectiveAt, definingBp,
  elementCutRange, halveWidthTokenStr, halvedWidthTokens, mergeClasses, newColMarkup,
  newRowMarkup, rowChildIndent, setOffsetToken, setWidthToken, widthTokenBp,
} from '@bootstrap-visualizer/core';
import type {
  Breakpoint, ColNode, Edit, El, NodePath, RowNode, WidthValue,
} from '@bootstrap-visualizer/core';
import {
  applyOps, conventionNewColTokens, fallbackTier, newColClassList, newRowClassList,
  newRowColClassList, resolvePath, rowOfSel, scaffoldAt, state,
} from './state.js';
import { toast } from './dom.js';

/** Which `@if` branch an element belongs to, or null if the element is free to
    move (outside any `@if`, or carrying its own `*ngIf`). Two columns can only
    be reordered / a column moved between them when their branch context
    matches — a plain text swap across an `@if {}` boundary would move a column
    across the braces. A `*ngIf` element is exempt: the condition is an
    attribute inside its own tag, so the element is self-contained and moving it
    crosses no braces — it behaves like a plain element (and is still blocked
    from swapping *into* an inline `@if` block, whose key it will never match).

    Nested `@if`s make this a *path*: two columns match only when they sit in
    the same branch at every level, so a column can't hop out of (or into) an
    inner block while staying in the outer one. Structural (`*ngIf`) links are
    dropped from the key wherever they appear in the chain, for the reason
    above — what's left is the block braces the text would have to cross. */
function condKey(el: El): string | null {
  const blocks = (el.condPath ?? [])
    .filter(t => !state.root?.condRegions[t.region]?.structural);
  if (!blocks.length) return null;
  return blocks.map(t => `${t.region}:${t.branch}`).join('|');
}

const CROSS_BRANCH_MSG = "Can't move a column across an @if branch boundary — switch to that branch first.";

const UNCLOSED_MSG =
  'This element has no closing tag, so the canvas can’t tell where it ends — ' +
  'fix the markup and the structural edits come back. Width and offset still work.';

/** Guard for the edits that act on an element's *span* (move, delete, split,
    insert beside). When the markup didn't parse, the tolerant fallback ends an
    unclosed element wherever it had to stop — the enclosing close tag, or EOF —
    so cutting or inserting by that span would touch a part of the file the user
    never saw on the canvas. Refuse those, with a reason; the class edits, whose
    spans come from the open tag, stay available (`canCutElement`).

    Every op guards *all* the elements it touches, not just the selected one: a
    move splices at its destination as much as it cuts at its source. */
function spansAreSafe(...els: (El | null | undefined)[]): boolean {
  if (els.every(el => !el || canCutElement(el))) return true;
  toast(UNCLOSED_MSG, 'warn');
  return false;
}

/* ── quick edits (the "Effective at …" steppers) ─────────────────── */

/** Target the token that DEFINES the effective value at the current view
    breakpoint (cascade-aware); only create a new token when none exists
    at any tier. */
export function quickWidth(node: ColNode, dir: number): void {
  const eff = effectiveAt(node.spec.width, state.bp);
  if (eff === 'equal' || eff === 'auto') return;
  const cur = eff === null ? 12 : eff;
  const next = Math.min(12, Math.max(1, cur + dir));
  if (next === cur) return;
  const bp = definingBp(node.spec.width, state.bp) || fallbackTier(node, rowOfSel());
  const tokens = setWidthToken(classTokens(node.el), bp, next, state.docBs3);
  applyOps(classEdit(state.src, node.el, tokens));
}

export function quickOffset(node: ColNode, dir: number): void {
  const cur = effectiveAt(node.spec.offset, state.bp) || 0;
  const next = Math.min(11, Math.max(0, cur + dir));
  if (next === cur) return;
  // Mirror quickWidth: edit the tier that *defines* the effective offset (the
  // nearest token at or below the view breakpoint), and when it reaches 0 just
  // remove that token. So +/- only ever touches the one breakpoint already in
  // the column (or the closest to it) — never invents a new tier's -0 token.
  const bp = definingBp(node.spec.offset, state.bp) || fallbackTier(node, rowOfSel());
  const tokens = setOffsetToken(classTokens(node.el), bp, next, state.docBs3);
  applyOps(classEdit(state.src, node.el, tokens));
}

/* ── explicit per-breakpoint edits (the "All breakpoints" grids) ──── */

/** Editing a breakpoint with no token creates an override there, seeded
    from the inherited value when it's numeric. */
export function stepWidth(
  node: ColNode, bp: Breakpoint, dir: number, steps: (WidthValue | null)[],
): void {
  const cur = node.spec.width[bp] !== undefined ? node.spec.width[bp]! : null;
  let next: WidthValue | null;
  if (cur === null) {
    const inh = effectiveAt(node.spec.width, bp);
    if (typeof inh === 'number') {
      next = Math.min(12, Math.max(1, inh + dir));
    } else {
      const i = Math.min(steps.length - 1, Math.max(0, 0 + dir));
      next = steps[i]!;
    }
  } else {
    let i = steps.findIndex(s => s === cur);
    if (i < 0) i = 0;
    i = Math.min(steps.length - 1, Math.max(0, i + dir));
    next = steps[i]!;
  }
  const tokens = setWidthToken(classTokens(node.el), bp, next, state.docBs3);
  applyOps(classEdit(state.src, node.el, tokens));
}

export function changeOffset(node: ColNode, bp: Breakpoint, dir: number): void {
  const own = node.spec.offset[bp];
  const cur = own !== undefined ? own : (effectiveAt(node.spec.offset, bp) || 0);
  const next = Math.min(11, Math.max(0, cur + dir));
  if (next === cur) return;
  // Setting 0 at a tier that has no own token but inherits a nonzero offset
  // → explicit offset-*-0 to cancel the inheritance (rather than a no-op).
  const inheritsNonzero = own === undefined && cur !== 0;
  const keepZero = next === 0 && inheritsNonzero;
  const tokens = setOffsetToken(classTokens(node.el), bp,
                                next === 0 ? 0 : next, state.docBs3, keepZero);
  applyOps(classEdit(state.src, node.el, tokens));
}

/* ── structural edits ────────────────────────────────────────────── */

export function splitCol(node: ColNode): void {
  const el = node.el;
  if (!spansAreSafe(el)) return;      // inserts the new column at el.end
  const tokens = classTokens(el);
  const hasW = tokens.some(t => widthTokenBp(t) != null);
  let firstTokens: string[], secondClasses: string[];
  if (hasW) {
    // halve every defined tier: col-sm-8 col-lg-6 → col-sm-4 col-lg-3 + col-sm-4 col-lg-3
    firstTokens = tokens.map(t => widthTokenBp(t) != null ? halveWidthTokenStr(t, 'ceil') : t);
    secondClasses = halvedWidthTokens(tokens, 'floor');
  } else {
    firstTokens = tokens;
    secondClasses = conventionNewColTokens(null, rowOfSel());
  }
  // the half is a newly created column, so it carries the convention too
  secondClasses = mergeClasses(secondClasses, state.newColClasses.tokens);
  const { indent } = elementCutRange(state.src, el);
  const newColHtml = newColMarkup(secondClasses, scaffoldAt(indent));
  // insert the new column after the original, and (if it has widths) halve
  // the original's classes — both against the original source; applyEdits
  // orders them, so no length-delta juggling is needed
  const edits: Edit[] = [{ start: el.end, end: el.end, text: newColHtml }];
  if (hasW) edits.push(...classEdit(state.src, el, firstTokens));
  applyOps(edits);
}

export function addColAfter(node: ColNode): void {
  const el = node.el;
  if (!spansAreSafe(el)) return;
  const { indent } = elementCutRange(state.src, el);
  const html = newColMarkup(newColClassList(classTokens(el), rowOfSel()), scaffoldAt(indent));
  applyOps([{ start: el.end, end: el.end, text: html }]);
}

export function addColToRow(rowNode: RowNode): void {
  const rowEl = rowNode.el;
  const lastCol = rowNode.cols[rowNode.cols.length - 1];
  // the insertion point is the last column's end (or inside the row's open tag)
  if (!spansAreSafe(rowEl, lastCol?.el)) return;
  const indent = rowChildIndent(state.src, rowEl, state.indentUnit);
  const cls = newColClassList(lastCol ? classTokens(lastCol.el) : null, rowNode);
  const html = newColMarkup(cls, scaffoldAt(indent));
  // insert after the last *shown* column so a conditional row adds into the
  // active branch (rowEl.children is every flattened branch); for a plain row
  // this is the same as the last child.
  const at = lastCol ? lastCol.el.end : rowEl.contentStart;
  applyOps([{ start: at, end: at, text: html }]);
}

export function addRowAfter(rowNode: RowNode): void {
  const el = rowNode.el;
  if (!spansAreSafe(el)) return;
  const { indent } = elementCutRange(state.src, el);
  const html = newRowMarkup(newRowClassList(), newRowColClassList(),
                            scaffoldAt(indent), { lead: 'blank-line' });
  applyOps([{ start: el.end, end: el.end, text: html }]);
}

/** Add a nested row *inside* a column — the other half of "add column to a
    row", and what lets a page be built downward from an empty column instead
    of only sideways from an existing row. */
export function addRowToCol(colNode: ColNode): void {
  const el = colNode.el;
  const lastRow = colNode.nestedRows[colNode.nestedRows.length - 1];
  // the insertion point is the last nested row's end, or the column's own
  // content end — both are spans the parser has to have got right
  if (!spansAreSafe(el, lastRow?.el)) return;
  // a void or self-closing element (<input class="col-6" />) has no inside
  if (el.selfClosing || el.end === el.openEnd) {
    toast('<' + el.tag + '> has no closing tag to put a row inside.', 'warn');
    return;
  }
  // append after the last *shown* nested row so a conditional column adds into
  // the active branch; with none, go in as the column's last child — after any
  // content it already has, never before it
  const at = lastRow ? lastRow.el.end : el.contentEnd;
  const indent = lastRow
    ? elementCutRange(state.src, lastRow.el).indent
    : childIndent(state.src, el, state.indentUnit);
  const html = newRowMarkup(newRowClassList(), newRowColClassList(), scaffoldAt(indent),
                            { lead: lastRow ? 'blank-line' : 'newline' });
  applyOps([{ start: at, end: at, text: html }]);
}

/** Add a row at the end of the document — the entry point for a template that
    has no grid yet, or for adding to the bottom without selecting first. */
export function addRowAtEnd(): void {
  const last = state.model[state.model.length - 1];
  if (last) { addRowAfter(last); return; }
  // Nothing to anchor to: append at the end of the file. For a template that
  // is a fragment (the usual case) that's exactly right; for one wrapped in a
  // <form> the row lands after the wrapper, where the user can see it and move
  // it — better than guessing which element was meant.
  const src = state.src;
  const lead = src === '' || src.endsWith('\n') ? 'none' : 'newline';
  const html = newRowMarkup(newRowClassList(), newRowColClassList(),
                            scaffoldAt(''), { lead });
  applyOps([{ start: src.length, end: src.length, text: html }]);
  toast('Added a row at the end of the document.');
}

export function deleteEl(node: RowNode | ColNode): void {
  // Without this, deleting an element the parser ended at EOF deletes the rest
  // of the file — the single most destructive thing a guessed span can do.
  if (!spansAreSafe(node.el)) return;
  const { cutStart, cutEnd } = elementCutRange(state.src, node.el);
  state.sel = null;
  applyOps([{ start: cutStart, end: cutEnd, text: '' }]);
}

/* ── reordering ──────────────────────────────────────────────────── */

/** Move the selected column one place in `dir` (-1 left, +1 right).
    Operates on the current selection — every caller invokes it on the
    selected column, and the swap needs the selection's path, not just a
    node (a ColNode doesn't carry its position). */
export function nudgeCol(dir: number): void {
  if (!state.sel) return;
  const parentPath = state.sel.path.slice(0, -1);
  const idx = state.sel.path[state.sel.path.length - 1]!;
  const row = resolvePath(parentPath);
  const to = idx + dir;
  if (!row || row.kind !== 'row' || to < 0 || to >= row.cols.length) return;
  const a = row.cols[idx]!.el, b = row.cols[to]!.el;
  if (condKey(a) !== condKey(b)) { toast(CROSS_BRANCH_MSG, 'warn'); return; }
  swapSiblings(a, b, parentPath.concat(to), 'col');
}

/** Swap the selected row with an adjacent sibling row (reorder within its
    container). Selection-based, for the same reason as nudgeCol. */
export function nudgeRow(dir: number): void {
  if (!state.sel) return;
  const parent = state.sel.path.slice(0, -1);
  const idx = state.sel.path[state.sel.path.length - 1]!;
  const parentNode = parent.length ? resolvePath(parent) : null;
  const siblings: RowNode[] = parent.length
    ? (parentNode && parentNode.kind === 'col' ? parentNode.nestedRows : [])
    : state.model;
  const to = idx + dir;
  if (to < 0 || to >= siblings.length) return;
  const a = siblings[idx]!.el, b = siblings[to]!.el;
  // don't drag a row through an @if brace (same rule as columns)
  if (condKey(a) !== condKey(b)) { toast(CROSS_BRANCH_MSG, 'warn'); return; }
  swapSiblings(a, b, parent.concat(to), 'row');
}

function swapSiblings(
  elA: El, elB: El, selPath: NodePath, selKind: 'row' | 'col',
): void {
  if (!spansAreSafe(elA, elB)) return;   // both texts are cut and re-spliced
  const [first, second] = elA.start < elB.start ? [elA, elB] : [elB, elA];
  const rFirst = elementCutRange(state.src, first);
  const rSecond = elementCutRange(state.src, second);
  const tFirst = state.src.slice(rFirst.textStart, first.end);
  const tSecond = state.src.slice(rSecond.textStart, second.end);
  state.sel = { path: selPath.slice(), kind: selKind };
  // swap the two element texts in place — non-overlapping spans, applyEdits
  // orders them
  applyOps([
    { start: rFirst.textStart, end: first.end, text: tSecond },
    { start: rSecond.textStart, end: second.end, text: tFirst },
  ]);
}

export function moveCol(srcPath: NodePath, dstRowPath: NodePath, dstIndex: number): void {
  const srcNode = resolvePath(srcPath);
  const dstRow = resolvePath(dstRowPath);
  if (!srcNode || !dstRow || dstRow.kind !== 'row') return;
  // moving into itself / into own nested row → refuse
  const inSelf = dstRowPath.join(',').startsWith(srcPath.join(',') + ',') ||
                 dstRowPath.join(',') === srcPath.join(',');
  if (inSelf) return;

  const el = srcNode.el;

  // Don't move across an @if branch boundary (a plain text splice would land
  // the column outside/inside the wrong `{}`). Allow moves whose source and
  // destination share the same branch context (incl. both outside any @if).
  const dstKey = dstIndex < dstRow.cols.length
    ? condKey(dstRow.cols[dstIndex]!.el)
    : condKey(dstRow.cols[dstRow.cols.length - 1]?.el ?? el);
  if (condKey(el) !== dstKey) { toast(CROSS_BRANCH_MSG, 'warn'); return; }

  // the column is cut from here and spliced in beside the target — every one
  // of those spans has to be one the parser actually read
  const target = dstIndex < dstRow.cols.length
    ? dstRow.cols[dstIndex]!.el
    : dstRow.cols[dstRow.cols.length - 1]?.el;
  if (!spansAreSafe(el, dstRow.el, target)) return;

  const { cutStart, cutEnd, textStart } = elementCutRange(state.src, el);
  const elText = state.src.slice(textStart, el.end);

  // insertion point in ORIGINAL coordinates
  const indent = rowChildIndent(state.src, dstRow.el, state.indentUnit);
  let insertAt: number;
  if (dstIndex < dstRow.cols.length) {
    insertAt = elementCutRange(state.src, target!).cutStart;
  } else {
    // after the last *shown* column (active branch), not the last flattened one
    insertAt = target ? target.end : dstRow.el.contentStart;
  }
  // same-row same-position no-op
  if (insertAt >= cutStart && insertAt <= cutEnd) return;

  const insText = state.eol + indent + elText;
  state.sel = null;
  // remove the element from its old spot and insert it at the new one — two
  // non-overlapping edits (the no-op guard above ensures insertAt is outside
  // the cut range); applyEdits orders them
  applyOps([
    { start: cutStart, end: cutEnd, text: '' },
    { start: insertAt, end: insertAt, text: insText },
  ]);
}

/* Edit operations.

   Every one of these expresses its change as a batch of core `Edit`
   descriptors (a span + replacement text) and hands it to `applyOps`. No
   grid-class math happens here — the token arithmetic all lives in core, and
   the span edits are what the host adapter replays outward. */

import {
  classEdit, classTokens, effectiveAt, definingBp, elementCutRange,
  halveWidthTokenStr, halvedWidthTokens, rowChildIndent, setOffsetToken,
  setWidthToken, widthTokenBp,
} from '@bootstrap-visualizer/core';
import type {
  Breakpoint, ColNode, Edit, El, NodePath, RowNode, WidthValue,
} from '@bootstrap-visualizer/core';
import {
  applyOps, conventionNewColTokens, fallbackTier, resolvePath, rowOfSel, state,
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
  applyOps([classEdit(state.src, node.el, tokens)]);
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
  applyOps([classEdit(state.src, node.el, tokens)]);
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
  applyOps([classEdit(state.src, node.el, tokens)]);
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
  applyOps([classEdit(state.src, node.el, tokens)]);
}

/* ── structural edits ────────────────────────────────────────────── */

export function splitCol(node: ColNode): void {
  const el = node.el;
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
  const { indent } = elementCutRange(state.src, el);
  const newColHtml = '\n' + indent +
    '<div class="' + secondClasses.join(' ') + '">\n' + indent + '  <!-- new column -->\n' + indent + '</div>';
  // insert the new column after the original, and (if it has widths) halve
  // the original's classes — both against the original source; applyEdits
  // orders them, so no length-delta juggling is needed
  const edits: Edit[] = [{ start: el.end, end: el.end, text: newColHtml }];
  if (hasW) edits.push(classEdit(state.src, el, firstTokens));
  applyOps(edits);
}

export function addColAfter(node: ColNode): void {
  const el = node.el;
  const { indent } = elementCutRange(state.src, el);
  const cls = conventionNewColTokens(classTokens(el), rowOfSel()).join(' ');
  const html = '\n' + indent +
    '<div class="' + cls + '">\n' + indent + '  <!-- new column -->\n' + indent + '</div>';
  applyOps([{ start: el.end, end: el.end, text: html }]);
}

export function addColToRow(rowNode: RowNode): void {
  const rowEl = rowNode.el;
  const indent = rowChildIndent(state.src, rowEl);
  const lastCol = rowNode.cols[rowNode.cols.length - 1];
  const cls = conventionNewColTokens(lastCol ? classTokens(lastCol.el) : null, rowNode).join(' ');
  const html = '\n' + indent +
    '<div class="' + cls + '">\n' + indent + '  <!-- new column -->\n' + indent + '</div>';
  // insert after the last *shown* column so a conditional row adds into the
  // active branch (rowEl.children is every flattened branch); for a plain row
  // this is the same as the last child.
  const at = lastCol ? lastCol.el.end : rowEl.contentStart;
  applyOps([{ start: at, end: at, text: html }]);
}

export function addRowAfter(rowNode: RowNode): void {
  const el = rowNode.el;
  const { indent } = elementCutRange(state.src, el);
  const html = '\n\n' + indent + '<div class="row">\n' +
    indent + '  <div class="col">\n' + indent + '    <!-- new column -->\n' + indent + '  </div>\n' +
    indent + '</div>';
  applyOps([{ start: el.end, end: el.end, text: html }]);
}

export function deleteEl(node: RowNode | ColNode): void {
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

  const { cutStart, cutEnd, textStart } = elementCutRange(state.src, el);
  const elText = state.src.slice(textStart, el.end);

  // insertion point in ORIGINAL coordinates
  const indent = rowChildIndent(state.src, dstRow.el);
  let insertAt: number;
  if (dstIndex < dstRow.cols.length) {
    const target = dstRow.cols[dstIndex]!.el;
    insertAt = elementCutRange(state.src, target).cutStart;
  } else {
    // after the last *shown* column (active branch), not the last flattened one
    const lastActive = dstRow.cols[dstRow.cols.length - 1];
    insertAt = lastActive ? lastActive.el.end : dstRow.el.contentStart;
  }
  // same-row same-position no-op
  if (insertAt >= cutStart && insertAt <= cutEnd) return;

  const insText = '\n' + indent + elText;
  state.sel = null;
  // remove the element from its old spot and insert it at the new one — two
  // non-overlapping edits (the no-op guard above ensures insertAt is outside
  // the cut range); applyEdits orders them
  applyOps([
    { start: cutStart, end: cutEnd, text: '' },
    { start: insertAt, end: insertAt, text: insText },
  ]);
}

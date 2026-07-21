/* Edit operations.

   Every one of these builds a new source string from a core-produced span
   edit and hands it to `apply`. No grid-class math happens here — the
   token arithmetic all lives in core. */

import {
  classTokens, effectiveAt, definingBp, elementCutRange, halveWidthTokenStr,
  halvedWidthTokens, rowChildIndent, setOffsetToken, setWidthToken, splice,
  widthTokenBp, writeClass,
} from '@bootstrap-visualizer/core';
import type {
  Breakpoint, ColNode, El, NodePath, RowNode, WidthValue,
} from '@bootstrap-visualizer/core';
import {
  apply, conventionNewColTokens, fallbackTier, resolvePath, rowOfSel, state,
} from './state.js';

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
  apply(writeClass(state.src, node.el, tokens));
}

export function quickOffset(node: ColNode, dir: number): void {
  const cur = effectiveAt(node.spec.offset, state.bp) || 0;
  const next = Math.min(11, Math.max(0, cur + dir));
  if (next === cur) return;
  const defBp = definingBp(node.spec.offset, state.bp);
  const bp = defBp || fallbackTier(node, rowOfSel());
  // Going to 0 at the view breakpoint while a *smaller* tier still supplies
  // a nonzero offset → write an explicit offset-*-0 at the view breakpoint
  // instead of editing/removing the lower token.
  let targetBp: Breakpoint = bp, keepZero = false;
  if (next === 0) {
    const belowDef = definingBp(node.spec.offset, state.bp);
    if (belowDef && belowDef !== state.bp) { targetBp = state.bp; keepZero = true; }
  }
  const tokens = setOffsetToken(classTokens(node.el), targetBp,
                                next === 0 ? 0 : next, state.docBs3, keepZero);
  apply(writeClass(state.src, node.el, tokens));
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
  apply(writeClass(state.src, node.el, tokens));
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
  apply(writeClass(state.src, node.el, tokens));
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
  let src2 = hasW ? writeClass(state.src, el, firstTokens) : state.src;
  const delta = src2.length - state.src.length;
  const insertAt = el.end + delta;
  const { indent } = elementCutRange(state.src, el);
  const newColHtml = '\n' + indent +
    '<div class="' + secondClasses.join(' ') + '">\n' + indent + '  <!-- new column -->\n' + indent + '</div>';
  src2 = splice(src2, insertAt, insertAt, newColHtml);
  apply(src2);
}

export function addColAfter(node: ColNode): void {
  const el = node.el;
  const { indent } = elementCutRange(state.src, el);
  const cls = conventionNewColTokens(classTokens(el), rowOfSel()).join(' ');
  const html = '\n' + indent +
    '<div class="' + cls + '">\n' + indent + '  <!-- new column -->\n' + indent + '</div>';
  apply(splice(state.src, el.end, el.end, html));
}

export function addColToRow(rowNode: RowNode): void {
  const rowEl = rowNode.el;
  const indent = rowChildIndent(state.src, rowEl);
  const lastCol = rowNode.cols[rowNode.cols.length - 1];
  const cls = conventionNewColTokens(lastCol ? classTokens(lastCol.el) : null, rowNode).join(' ');
  const html = '\n' + indent +
    '<div class="' + cls + '">\n' + indent + '  <!-- new column -->\n' + indent + '</div>';
  const last = rowEl.children[rowEl.children.length - 1];
  const at = last ? last.end : rowEl.contentStart;
  apply(splice(state.src, at, at, html));
}

export function addRowAfter(rowNode: RowNode): void {
  const el = rowNode.el;
  const { indent } = elementCutRange(state.src, el);
  const html = '\n\n' + indent + '<div class="row">\n' +
    indent + '  <div class="col">\n' + indent + '    <!-- new column -->\n' + indent + '  </div>\n' +
    indent + '</div>';
  apply(splice(state.src, el.end, el.end, html));
}

export function deleteEl(node: RowNode | ColNode): void {
  const { cutStart, cutEnd } = elementCutRange(state.src, node.el);
  state.sel = null;
  apply(splice(state.src, cutStart, cutEnd, ''));
}

/* ── reordering ──────────────────────────────────────────────────── */

export function nudgeCol(_node: ColNode, dir: number): void {
  if (!state.sel) return;
  const parentPath = state.sel.path.slice(0, -1);
  const idx = state.sel.path[state.sel.path.length - 1]!;
  const row = resolvePath(parentPath);
  const to = idx + dir;
  if (!row || row.kind !== 'row' || to < 0 || to >= row.cols.length) return;
  swapSiblings(row.cols[idx]!.el, row.cols[to]!.el, parentPath.concat(to), 'col');
}

/** Swap a row with an adjacent sibling row (reorder within its container). */
export function nudgeRow(_node: RowNode, dir: number): void {
  if (!state.sel) return;
  const parent = state.sel.path.slice(0, -1);
  const idx = state.sel.path[state.sel.path.length - 1]!;
  const parentNode = parent.length ? resolvePath(parent) : null;
  const siblings: RowNode[] = parent.length
    ? (parentNode && parentNode.kind === 'col' ? parentNode.nestedRows : [])
    : state.model;
  const to = idx + dir;
  if (to < 0 || to >= siblings.length) return;
  swapSiblings(siblings[idx]!.el, siblings[to]!.el, parent.concat(to), 'row');
}

function swapSiblings(
  elA: El, elB: El, selPath: NodePath, selKind: 'row' | 'col',
): void {
  const [first, second] = elA.start < elB.start ? [elA, elB] : [elB, elA];
  const rFirst = elementCutRange(state.src, first);
  const rSecond = elementCutRange(state.src, second);
  const tFirst = state.src.slice(rFirst.textStart, first.end);
  const tSecond = state.src.slice(rSecond.textStart, second.end);
  let s = state.src;
  s = splice(s, rSecond.textStart, second.end, tFirst);   // later range first
  s = splice(s, rFirst.textStart, first.end, tSecond);
  state.sel = { path: selPath.slice(), kind: selKind };
  apply(s);
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
  const { cutStart, cutEnd, textStart } = elementCutRange(state.src, el);
  const elText = state.src.slice(textStart, el.end);

  // insertion point in ORIGINAL coordinates
  const indent = rowChildIndent(state.src, dstRow.el);
  let insertAt: number;
  if (dstIndex < dstRow.cols.length) {
    const target = dstRow.cols[dstIndex]!.el;
    insertAt = elementCutRange(state.src, target).cutStart;
  } else {
    const last = dstRow.el.children[dstRow.el.children.length - 1];
    insertAt = last ? last.end : dstRow.el.contentStart;
  }
  // same-row same-position no-op
  if (insertAt >= cutStart && insertAt <= cutEnd) return;

  let s = state.src;
  const insText = '\n' + indent + elText;
  if (insertAt > cutEnd) {
    s = splice(s, insertAt, insertAt, insText);      // later position first
    s = splice(s, cutStart, cutEnd, '');
  } else {
    s = splice(s, cutStart, cutEnd, '');
    s = splice(s, insertAt, insertAt, insText);
  }
  state.sel = null;
  apply(s);
}

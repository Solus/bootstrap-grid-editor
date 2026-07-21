/* Canvas rendering: the schematic of rows and columns.

   Everything here reads the GridModel and the precomputed helpers from
   core — no grid-class math and no source scanning lives in this file. */

import {
  BP_LABEL, classIsInterpolated, classValue, colSequence, colTitle, contentHint,
  effectiveAt, elementTitle, hasDynamicClassBinding, hashStr, isContainerCol,
  rowHasControlFlow,
} from '@bootstrap-visualizer/core';
import type { Breakpoint, ColNode, NodePath, RowNode } from '@bootstrap-visualizer/core';
import { $, mkBadge, mkTypeBadge, rowsHost, sheet } from './dom.js';
import { SHEET_WIDTH, state, resolvePath, type Selection } from './state.js';
import { computeFind, updateFindCount } from './find.js';
import { renderInspector } from './inspector.js';
import { attachResize, makeDropzone, startColDrag } from './dnd.js';
import { select } from './selection.js';

/* ── width & fill maths ──────────────────────────────────────────── */

interface ColWidth {
  span: number | 'auto';
  offset: number;
  kind: 'plain' | 'equal' | 'auto' | 'set';
}

export function computeWidths(rowNode: RowNode, bp: Breakpoint): ColWidth[] {
  const infos = rowNode.cols.map(c => ({
    w: effectiveAt(c.spec.width, bp),
    o: effectiveAt(c.spec.offset, bp) || 0,
  }));
  let equals = 0, used = 0;
  for (const i of infos) {
    if (typeof i.w === 'number') used += i.w + i.o;
    else if (i.w === 'auto') used += 2 + i.o;       // schematic guess for auto
    else if (i.w === null) used += 12 + i.o;        // non-col child: full width
    else { equals++; used += i.o; }                 // 'equal'
  }
  const leftover = Math.max(12 - used, equals);     // at least 1 each
  const perEq = equals ? Math.max(1, Math.floor(leftover / equals)) : 0;

  return infos.map(i => ({
    span: i.w === 'equal' ? perEq
        : i.w === 'auto' ? 'auto'
        : i.w === null ? 12
        : i.w,
    offset: i.o,
    kind: i.w === null ? 'plain' : (i.w === 'equal' ? 'equal' : (i.w === 'auto' ? 'auto' : 'set')),
  }));
}

/** Fill sum for a row at the current breakpoint: spans + offsets.
    approx: contains auto/equal columns (their spans are schematic).
    unreliable: contains @if/@else — branches counted as simultaneous. */
export function rowFill(rowNode: RowNode) {
  const widths = computeWidths(rowNode, state.bp);
  let sum = 0, approx = false;
  widths.forEach(w => {
    sum += (w.span === 'auto' ? 2 : w.span) + (w.offset || 0);
    if (w.span === 'auto' || w.kind === 'equal') approx = true;
  });
  return { widths, sum, approx, unreliable: rowHasControlFlow(state.src, rowNode.el) };
}

function summarize(colNode: ColNode): { tag?: string; text?: string; styled?: boolean; type?: string } {
  const hint = contentHint(state.src, colNode.el);
  if (hint) {
    if (hint.kind === 'tag') return { tag: hint.text };
    return { text: hint.text, styled: true, type: hint.tag };
  }
  let txt = '', pos = colNode.el.contentStart;
  for (const c of colNode.el.children) {
    txt += state.src.slice(pos, c.start);
    pos = c.end;
  }
  txt += state.src.slice(pos, colNode.el.contentEnd);
  txt = txt.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
  if (txt) return { text: txt.length > 34 ? txt.slice(0, 34) + '…' : txt };
  return { text: 'empty' };
}

/* ── identity ────────────────────────────────────────────────────── */

/** Identity for collapse state: hash of the row's exact source text plus an
    occurrence counter to tell identical rows apart. Computed for the whole
    model in one deterministic pass so identities don't depend on what's
    currently collapsed. */
export function computeRowIds(): Map<string, string> {
  const ids = new Map<string, string>(), counts = new Map<string, number>();
  (function walk(rlist: RowNode[], base: NodePath) {
    rlist.forEach((r, i) => {
      const p = base.concat(i);
      const h = hashStr(state.src.slice(r.el.start, r.el.end));
      const n = counts.get(h) ?? 0;
      counts.set(h, n + 1);
      ids.set(p.join(','), h + ':' + n);
      r.cols.forEach((c, ci) => walk(c.nestedRows, p.concat(ci)));
    });
  })(state.model, []);
  return ids;
}

export function pathEq(sel: Selection | null, path: NodePath, kind: 'row' | 'col'): boolean {
  return !!sel && sel.kind === kind && sel.path.join(',') === path.join(',');
}

/* ── the render pass ─────────────────────────────────────────────── */

export function render(): void {
  state._rowIds = computeRowIds();
  computeFind();
  renderRuler();
  renderCanvas();
  renderInspector();
  renderHeader();
  updateFindCount();
}

export function renderHeader(): void {
  $<HTMLButtonElement>('#undoBtn').disabled = !(state.hIndex > 0);
  $<HTMLButtonElement>('#redoBtn').disabled = !(state.hIndex < state.history.length - 1);
  $('#bpNote').textContent = BP_LABEL[state.bp];
  document.querySelectorAll<HTMLElement>('#bpSwitch button').forEach(b =>
    b.classList.toggle('active', b.dataset.bp === state.bp));
  sheet.style.maxWidth = SHEET_WIDTH[state.bp] + 'px';
}

function renderRuler(): void {
  const r = $('#ruler');
  if (r.children.length) return;
  for (let i = 1; i <= 12; i++) {
    const d = document.createElement('div');
    d.textContent = String(i);
    r.appendChild(d);
  }
}

function renderCanvas(): void {
  rowsHost.innerHTML = '';
  if (!state.model.length) {
    const d = document.createElement('div');
    d.className = 'empty-canvas';
    d.innerHTML = 'No <code>.row</code> elements found.<br>' +
      'Paste an Angular/Bootstrap template on the left and press <b>Apply changes</b>,<br>' +
      'or hit <b>Load sample</b> in the header.';
    rowsHost.appendChild(d);
    return;
  }
  state.model.forEach((row, i) => rowsHost.appendChild(renderRow(row, [i], false)));
}

function renderRow(rowNode: RowNode, path: NodePath, _nested: boolean): HTMLElement {
  const rowDiv = document.createElement('div');
  rowDiv.className = 'g-row';
  rowDiv.dataset.path = path.join(',');
  if (pathEq(state.sel, path, 'row')) rowDiv.classList.add('selected');
  if (state._findSet?.has('row:' + path.join(','))) rowDiv.classList.add('find-hit');

  const key = state._rowIds.get(path.join(',')) || path.join(',');
  const isCollapsed = state.collapsed.has(key);
  if (isCollapsed) rowDiv.classList.add('collapsed');

  const label = document.createElement('div');
  label.className = 'row-label';
  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.textContent = isCollapsed ? '▸' : '▾';
  chev.title = isCollapsed ? 'Expand row' : 'Collapse row';
  chev.addEventListener('click', e => {
    e.stopPropagation();
    if (state.collapsed.has(key)) state.collapsed.delete(key);
    else state.collapsed.add(key);
    render();
  });
  label.appendChild(chev);
  label.appendChild(document.createTextNode('ROW'));
  const rTitle = elementTitle(state.src, rowNode.el);
  if (rTitle) {
    const t = document.createElement('span');
    t.className = 'row-title';
    t.textContent = ' · ' + rTitle;
    label.appendChild(t);
    label.title = rTitle;
  }
  if (isCollapsed) {
    const s = document.createElement('span');
    s.className = 'row-sum';
    s.textContent = ' (' + rowNode.cols.length + ' col' + (rowNode.cols.length === 1 ? '' : 's') + ')';
    label.appendChild(s);
  }
  rowDiv.appendChild(label);

  const fill = rowFill(rowNode);
  const pill = document.createElement('span');
  pill.className = 'fill-pill';
  if (fill.unreliable) {
    pill.classList.add('unreliable');
    pill.textContent = '~' + fill.sum + '/12';
    pill.title = 'Contains @if/@else — all branches counted, sum unreliable';
  } else if (fill.sum > 12) {
    pill.classList.add('over');
    pill.textContent = '⚠ ' + fill.sum + '/12 → wraps';
    pill.title = 'Columns + offsets exceed 12 at ' + state.bp + ' — row wraps';
    if (state.tintOverfull) rowDiv.classList.add('overfull');
  } else {
    pill.textContent = (fill.approx ? '~' : '') + fill.sum + '/12';
    if (fill.approx) pill.title = 'Contains auto/equal columns — approximate';
  }
  rowDiv.appendChild(pill);

  rowDiv.addEventListener('click', e => {
    e.stopPropagation();
    select({ path, kind: 'row' });
  });

  if (isCollapsed) return rowDiv;

  const widths = fill.widths;
  rowNode.cols.forEach((col, ci) => {
    rowDiv.appendChild(renderCol(col, widths[ci]!, path.concat(ci), ci,
                                 ci === rowNode.cols.length - 1));
  });
  if (!rowNode.cols.length) {
    rowDiv.appendChild(makeDropzone(path, 0, 'flexzone'));
  }
  return rowDiv;
}

function renderCol(
  colNode: ColNode, w: ColWidth, path: NodePath, index: number, isLast: boolean,
): HTMLElement {
  const colDiv = document.createElement('div');
  colDiv.className = 'g-col';
  colDiv.dataset.path = path.join(',');
  const spanNum = w.span === 'auto' ? 2 : w.span;
  const pct = (v: number) => (v / 12 * 100).toFixed(4) + '%';
  colDiv.style.flex = '0 0 ' + pct(Math.min(spanNum, 12));
  colDiv.style.maxWidth = pct(Math.min(spanNum, 12));
  if (w.offset) colDiv.style.marginLeft = pct(w.offset);

  const editable = !classIsInterpolated(colNode.el);
  if (!editable || hasDynamicClassBinding(colNode.el)) colDiv.classList.add('dynamic');
  const container = isContainerCol(state.src, colNode.el);
  if (container) colDiv.classList.add('container');
  if (pathEq(state.sel, path, 'col')) colDiv.classList.add('selected');
  if (state._findSet?.has('col:' + path.join(','))) colDiv.classList.add('find-hit');

  const inner = document.createElement('div');
  inner.className = 'g-col-inner';

  // header: type badge (always) + comment title, or positional number
  const head = document.createElement('div');
  head.className = 'col-head';
  head.appendChild(mkTypeBadge(container ? 'COL ⊞' : 'COL'));
  const title = colTitle(state.src, colNode.el);
  if (title) {
    const t = document.createElement('div');
    t.className = 'col-title';
    t.textContent = title.text;
    t.title = title.full;
    head.appendChild(t);
  } else {
    const n = document.createElement('div');
    n.className = 'col-num';
    n.textContent = '#' + (index + 1);
    head.appendChild(n);
  }
  inner.appendChild(head);

  // secondary line: content hint (content cols only) + classes
  const sub = document.createElement('div');
  sub.className = 'col-sub';
  const cls = classValue(colNode.el) || '(no class)';
  if (!container) {
    const sum = summarize(colNode);
    const hintText = sum.tag || sum.text || '';
    if (sum.tag || sum.styled) {
      if (sum.type) {
        sub.appendChild(document.createTextNode(sum.type + ' · '));
      }
      const t = document.createElement('span');
      t.className = 'tagname';
      t.textContent = hintText;
      sub.appendChild(t);
      sub.appendChild(document.createTextNode(' · ' + cls));
    } else {
      sub.textContent = hintText + ' · ' + cls;
    }
  } else {
    sub.textContent = cls;
  }
  sub.title = cls;
  inner.appendChild(sub);

  // badges
  const badges = document.createElement('div');
  badges.className = 'col-badges';
  if (colNode.el.attrs.find(a => a.name.toLowerCase() === '*ngfor')) {
    badges.appendChild(mkBadge('×n *ngFor', ''));
  }
  if (colNode.el.attrs.find(a => a.name.toLowerCase() === '*ngif')) {
    badges.appendChild(mkBadge('*ngIf', ''));
  }
  if (hasDynamicClassBinding(colNode.el) || !editable) {
    badges.appendChild(mkBadge('dyn', 'warn'));
  }
  if (badges.children.length) colDiv.appendChild(badges);

  // nested rows, interleaved with section separators (mid-column legends,
  // titled wrapper components) in source order
  if (colNode.nestedRows.length) {
    const nest = document.createElement('div');
    nest.className = 'nested';
    const seq = colSequence(state.src, colNode.el);
    const titleFromHeading = title && !elementTitle(state.src, colNode.el);
    let ri = 0, skippedTitle = false;
    for (const item of seq) {
      if (item.kind === 'row') {
        if (ri < colNode.nestedRows.length) {
          nest.appendChild(renderRow(colNode.nestedRows[ri]!, path.concat(ri), true));
          ri++;
        }
      } else {
        if (item.direct && titleFromHeading && !skippedTitle) {
          skippedTitle = true;          // this heading is already the block title
          continue;
        }
        const sep = document.createElement('div');
        sep.className = 'nested-sep';
        sep.textContent = item.text;
        sep.title = item.full;
        nest.appendChild(sep);
      }
    }
    inner.appendChild(nest);
  }

  const wl = document.createElement('div');
  wl.className = 'width-label';
  wl.textContent = w.span === 'auto' ? 'auto' : (w.offset ? `+${w.offset} / ` : '') + w.span + '/12';
  colDiv.appendChild(wl);

  colDiv.appendChild(inner);

  // overlay dropzones: left gap = insert before me; last column also owns
  // the insert-at-end zone on its right edge
  const rowPath = path.slice(0, -1);
  colDiv.appendChild(makeDropzone(rowPath, index, 'left'));
  if (isLast) colDiv.appendChild(makeDropzone(rowPath, index + 1, 'right'));

  // edge-drag resize (independent: only this column changes)
  if (editable) attachResize(colDiv, colNode, path, w);

  colDiv.addEventListener('click', e => {
    e.stopPropagation();
    select({ path, kind: 'col' });
  });

  startColDrag(colDiv, path);
  return colDiv;
}

export type { ColWidth };

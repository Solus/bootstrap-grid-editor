/* Canvas rendering: the schematic of rows and columns.

   Everything here reads the GridModel and the precomputed helpers from
   core — no grid-class math and no source scanning lives in this file. */

import {
  BP_LABEL, classIsInterpolated, classValue, colSequence, colTitle, contentHint,
  effectiveAt, elementTitle, hasDynamicClassBinding, hashStr, isContainerCol,
  rowHasForOrSwitch, rowMentionsIf,
} from '@bootstrap-visualizer/core';
import type {
  Breakpoint, ColNode, CondRegion, El, NodePath, RowNode,
} from '@bootstrap-visualizer/core';
import { $, mkBadge, mkTypeBadge, rowsHost, sheet } from './dom.js';
import { SHEET_WIDTH, setActiveBranch, state, resolvePath, type Selection } from './state.js';
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
    unreliable: has @for/@switch (branches double-count), or a bare @if that
    isn't modeled into a CondRegion. A modeled @if is per-branch: `cols` is
    already the active branch only, so the sum is real. */
export function rowFill(rowNode: RowNode) {
  const widths = computeWidths(rowNode, state.bp);
  let sum = 0, approx = false;
  widths.forEach(w => {
    sum += (w.span === 'auto' ? 2 : w.span) + (w.offset || 0);
    if (w.span === 'auto' || w.kind === 'equal') approx = true;
  });
  const modeledIf = !!(rowNode.conds && rowNode.conds.length);
  const unreliable = rowHasForOrSwitch(state.src, rowNode.el) ||
    (rowMentionsIf(state.src, rowNode.el) && !modeledIf);
  return { widths, sum, approx, unreliable };
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

/** The `@if` branch toggle: one compact chip per region showing which branch
    is currently displayed. Clicking cycles to the next state (a pure view
    change, not a document edit):
    - `@if`/`@else[ if]` with a trailing `@else` always shows one branch, so it
      cycles through the branches.
    - `@if` with no trailing `@else` can also show *nothing* (Angular renders
      nothing when false), so a single `@if` toggles show ↔ hide, and an
      `@else if` chain with no final `@else` cycles branches then hide. */
function renderBranchBar(conds: CondRegion[]): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'branch-bar';
  for (const region of conds) bar.appendChild(renderBranchChip(region));
  return bar;
}

/** The single cycling toggle chip for one `@if` region — used both as a flat
    bar entry and as a `.cond-box` header. */
function renderBranchChip(region: CondRegion): HTMLButtonElement {
  const n = region.branches.length;
  const hasElse = n > 0 && region.branches[n - 1]!.condition === null;
  const shown = region.activeIndex >= 0;
  const face = region.branches[shown ? region.activeIndex : 0];

  const chip = document.createElement('button');
  chip.className = 'branch-chip' + (shown ? ' active' : ' off');
  // a single @if reads as a visibility toggle (◉ shown / ○ hidden); a
  // multi-branch @if reads as a switch (⇄).
  const glyph = n <= 1 ? (shown ? '◉' : '○') : '⇄';
  chip.textContent = glyph + ' ' + keyword(face?.label ?? '@if');
  chip.title = branchTip(region, shown, hasElse);
  chip.addEventListener('click', e => {
    e.stopPropagation();
    setActiveBranch(region.region, nextBranch(region.activeIndex, n, hasElse));
  });
  return chip;
}

/** Compact form of a branch header: `@if (x)` → `@if`, `@else if (y)` →
    `@else if`, `@else` → `@else`. The full condition lives in the tooltip. */
function keyword(label: string): string {
  return label.replace(/\s*\(.*/s, '').trim() || label;
}

/** Next state when the chip is clicked. `cur` is -1 (hidden) or a branch index.
    With a trailing `@else` a branch always shows, so cycle 0…n-1. Without one,
    the sequence gains a hidden state: 0…n-1 → hidden → 0. */
function nextBranch(cur: number, n: number, hasElse: boolean): number {
  if (hasElse) return ((cur < 0 ? 0 : cur) + 1) % n;
  const next = cur + 1;
  return next >= n ? -1 : next;   // wrap past the last branch → hidden
}

function branchTip(region: CondRegion, shown: boolean, hasElse: boolean): string {
  if (!shown) return 'Hidden (no branch shown) — click to show';
  const b = region.branches[region.activeIndex]!;   // label e.g. "@if (x)" / "@else"
  const verb = region.branches.length > 1 ? 'switch branch'
             : hasElse ? 'switch' : 'hide';
  return 'Showing ' + b.label + ' — click to ' + verb;
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
  // undo/redo buttons are optional chrome — the extension omits them (native
  // editor undo). Guard so the shared render works with or without them.
  const undoBtn = document.querySelector<HTMLButtonElement>('#undoBtn');
  const redoBtn = document.querySelector<HTMLButtonElement>('#redoBtn');
  if (undoBtn) undoBtn.disabled = !(state.hIndex > 0);
  if (redoBtn) redoBtn.disabled = !(state.hIndex < state.history.length - 1);
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

  renderRowBody(rowDiv, rowNode, fill.widths, path);
  return rowDiv;
}

/** Lay out a row's columns, wrapping each `@if` region's active branch in a
    labeled bounding box (`.cond-box`) whose header is the toggle chip. Walks
    the row's *source* children so a hidden region (activeIndex -1, no columns)
    still renders its box + chip and can be toggled back on. Untagged columns
    render directly into the row, exactly as before. */
function renderRowBody(
  host: HTMLElement, rowNode: RowNode, widths: ColWidth[], path: NodePath,
): void {
  const cols = rowNode.cols;
  if (!cols.length && !rowNode.conds?.length) {
    host.appendChild(makeDropzone(path, 0, 'flexzone'));
    return;
  }
  // active/untagged columns keyed by their source element, with their width +
  // flat index (the index is the model path segment).
  type Hit = { node: ColNode; w: ColWidth; idx: number };
  const byEl = new Map<El, Hit>();
  cols.forEach((c, i) => byEl.set(c.el, { node: c, w: widths[i]!, idx: i }));
  const regionMeta = new Map((rowNode.conds ?? []).map(c => [c.region, c]));
  const last = cols.length - 1;
  const footprint = (w: ColWidth) => Math.min(w.span === 'auto' ? 2 : w.span, 12) + (w.offset || 0);

  const children = rowNode.el.children;
  let i = 0;
  while (i < children.length) {
    const region = children[i]!.cond?.region;
    if (!region) {
      const hit = byEl.get(children[i]!);   // plain column (non-col child: skipped)
      if (hit) host.appendChild(renderCol(hit.node, hit.w, path.concat(hit.idx), hit.idx, hit.idx === last));
      i++;
      continue;
    }
    // one @if/*ngIf region: gather this run of consecutive branch children that
    // belong to the active branch (only those are in byEl).
    const hits: Hit[] = [];
    while (i < children.length && children[i]!.cond?.region === region) {
      const hit = byEl.get(children[i]!);
      if (hit) hits.push(hit);
      i++;
    }
    const box = document.createElement('div');
    box.className = 'cond-box';
    const cr = regionMeta.get(region);
    if (cr) box.appendChild(renderBranchChip(cr));
    if (hits.length) {
      // size the box to its branch's combined span so it sits inline where the
      // content is; its columns are then laid out relative to that span.
      const span = hits.reduce((s, h) => s + footprint(h.w), 0);
      box.style.flex = '0 0 ' + (Math.min(span / 12, 1) * 100).toFixed(4) + '%';
      box.style.maxWidth = (Math.min(span / 12, 1) * 100).toFixed(4) + '%';
      hits.forEach(h =>
        box.appendChild(renderCol(h.node, h.w, path.concat(h.idx), h.idx, h.idx === last, span)));
    } else {
      box.classList.add('empty');
      const empty = document.createElement('div');
      empty.className = 'cond-empty';
      empty.textContent = 'hidden';
      box.appendChild(empty);
    }
    host.appendChild(box);
  }
}

function renderCol(
  colNode: ColNode, w: ColWidth, path: NodePath, index: number, isLast: boolean,
  denom = 12,
): HTMLElement {
  const colDiv = document.createElement('div');
  colDiv.className = 'g-col';
  colDiv.dataset.path = path.join(',');
  const spanNum = w.span === 'auto' ? 2 : w.span;
  // widths are relative to `denom` — 12 for a row, or a region box's own span
  // sum so a boxed branch's columns keep their true proportions inline.
  const pct = (v: number) => (Math.min(v / denom, 1) * 100).toFixed(4) + '%';
  colDiv.style.flex = '0 0 ' + pct(spanNum);
  colDiv.style.maxWidth = pct(spanNum);
  if (w.offset) colDiv.style.marginLeft = (w.offset / denom * 100).toFixed(4) + '%';

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
  // a modeled *ngIf column is already framed by its region box + toggle chip,
  // so the badge would be redundant; show it only when it isn't modeled.
  if (colNode.el.attrs.find(a => a.name.toLowerCase() === '*ngif') && !colNode.el.cond) {
    badges.appendChild(mkBadge('*ngIf', ''));
  }
  if (hasDynamicClassBinding(colNode.el) || !editable) {
    badges.appendChild(mkBadge('dyn', 'warn'));
  }
  if (badges.children.length) colDiv.appendChild(badges);

  // nested rows, interleaved with section separators (mid-column legends,
  // titled wrapper components) in source order
  if (colNode.nestedRows.length || colNode.conds?.length) {
    const nest = document.createElement('div');
    nest.className = 'nested';
    if (colNode.conds?.length) nest.appendChild(renderBranchBar(colNode.conds));
    const seq = colSequence(state.src, colNode.el);
    const titleFromHeading = title && !elementTitle(state.src, colNode.el);
    // Pair sequence rows to nestedRows by identity, not by position. findRows
    // recurses into headings but colSequence emits a heading as a sep and
    // stops, so a row nested inside a heading is in nestedRows yet absent from
    // the sequence. A positional counter would then misalign every following
    // row (wrong element, wrong path) and drop one — see the divergence test
    // in core/titles.test.ts. Looking each row up by its element keeps the
    // path correct for well-formed and malformed input alike.
    const indexByEl = new Map(colNode.nestedRows.map((r, i) => [r.el, i]));
    const rendered = new Set<number>();
    let skippedTitle = false;
    for (const item of seq) {
      if (item.kind === 'row') {
        const i = indexByEl.get(item.el);
        if (i !== undefined && !rendered.has(i)) {
          nest.appendChild(renderRow(colNode.nestedRows[i]!, path.concat(i), true));
          rendered.add(i);
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
    // Any nested rows the sequence never surfaced (e.g. inside a heading)
    // still render, at their own path, so none are silently lost.
    colNode.nestedRows.forEach((r, i) => {
      if (!rendered.has(i)) nest.appendChild(renderRow(r, path.concat(i), true));
    });
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

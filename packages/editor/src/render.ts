/* Canvas rendering: the schematic of rows and columns.

   Everything here reads the GridModel and the precomputed helpers from
   core — no grid-class math and no source scanning lives in this file. */

import {
  BP_LABEL, classIsInterpolated, classValue, colSequence, colTitle, contentHint,
  effectiveAt, elementTitle, hasDynamicClassBinding, hashStr, isContainerCol,
  isHiddenAt, isRowEl, rowHasForOrSwitch, rowMentionsIf,
} from '@bootstrap-visualizer/core';
import type {
  Breakpoint, ColNode, CondRegion, El, NodePath, RootEl, RowNode,
} from '@bootstrap-visualizer/core';
import { $, mkBadge, mkTypeBadge, rowsHost, sheet, toast } from './dom.js';
import { SHEET_WIDTH, setActiveBranch, state, type Selection } from './state.js';
import { computeFind, updateFindCount } from './find.js';
import { renderInspector } from './inspector.js';
import { attachResize, makeDropzone, startColDrag } from './dnd.js';
import { select } from './selection.js';

/* ── width & fill maths ──────────────────────────────────────────── */

interface ColWidth {
  span: number | 'auto';
  offset: number;
  kind: 'plain' | 'equal' | 'auto' | 'set';
  /** Hidden at the current breakpoint by a `d-*` utility: takes no grid width
      and is not drawn. */
  hidden: boolean;
}

export function computeWidths(rowNode: RowNode, bp: Breakpoint): ColWidth[] {
  const infos = rowNode.cols.map(c => ({
    w: effectiveAt(c.spec.width, bp),
    o: effectiveAt(c.spec.offset, bp) || 0,
    hidden: isHiddenAt(c.spec, bp),
  }));
  let equals = 0, used = 0;
  for (const i of infos) {
    if (i.hidden) continue;                         // d-* hidden: no footprint
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
    hidden: i.hidden,
  }));
}

/** Fill sum for a row at the current breakpoint: spans + offsets.
    approx: contains a column whose width is guessed — auto, equal, or a
    non-col child drawn full width (their spans are schematic).
    unreliable: has @for/@switch (branches double-count), or a bare @if that
    isn't modeled into a CondRegion. A modeled @if is per-branch: `cols` is
    already the active branch only, so the sum is real. */
export function rowFill(rowNode: RowNode) {
  const widths = computeWidths(rowNode, state.bp);
  let sum = 0, approx = false;
  widths.forEach(w => {
    if (w.hidden) return;                            // d-* hidden: not in the sum
    sum += (w.span === 'auto' ? 2 : w.span) + (w.offset || 0);
    // auto/equal have no fixed width; a non-col child ('plain') is drawn full
    // width as a guess too — all three make the sum an estimate, so flag it so
    // the pill shows the ~ (the 'plain' case used to stay silent).
    if (w.span === 'auto' || w.kind === 'equal' || w.kind === 'plain') approx = true;
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
/** The single cycling toggle chip for one `@if` region — the `.cond-box`
    header, for both in-row column regions and in-column row regions. */
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
  let text = glyph + ' ' + keyword(face?.label ?? '@if');
  // a hidden chip sits detached from its content (row strip / thin line), so
  // a short condition snippet identifies which @if it is; the full text stays
  // in the tooltip. Shown chips ride their box and stay compact.
  if (!shown && face?.condition) {
    const cond = face.condition;
    text += ' (' + (cond.length > 24 ? cond.slice(0, 23) + '…' : cond) + ')';
  }
  chip.textContent = text;
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
  if (!shown) {
    const full = region.branches[0]?.label ?? '@if';
    return 'Hidden: ' + full + ' renders nothing — click to show';
  }
  const b = region.branches[region.activeIndex]!;   // label e.g. "@if (x)" / "@else"
  const verb = region.branches.length > 1 ? 'switch branch'
             : hasElse ? 'switch' : 'hide';
  return 'Showing ' + b.label + ' — click to ' + verb;
}

/* ── the render pass ─────────────────────────────────────────────── */

export function render(): void {
  // Backstop: a bug anywhere in the render pass must not throw into the caller
  // (a keyboard handler, a host message, a drag) and wedge the app. On failure
  // the last good canvas stays on screen and the user gets a quiet notice,
  // rather than an uncaught error. Per-row failures are caught closer in
  // `renderRow` so one bad row is skipped without losing the rest.
  try {
    state._rowIds = computeRowIds();
    computeFind();
    renderRuler();
    renderCanvas();
    renderInspector();
    renderHeader();
    updateFindCount();
  } catch (err) {
    console.error('[bootstrap-visualizer] render failed', err);
    toast('Something went wrong drawing the canvas', 'warn');
  }
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
  // the bp width is a proportion cue, not a semantic constraint — stretch
  // lets the sheet use however much panel the user has given the canvas
  sheet.style.maxWidth = state.stretchSheet ? '100%' : SHEET_WIDTH[state.bp] + 'px';
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
  if (state.root) {
    const byEl = new Map(state.model.map((r, i) => [r.el, i]));
    renderTopRows(rowsHost, state.root, byEl);
  }
  if (!rowsHost.children.length) {
    const d = document.createElement('div');
    d.className = 'empty-canvas';
    d.innerHTML = 'No <code>.row</code> elements found.<br>' +
      'Paste an Angular/Bootstrap template on the left and press <b>Apply changes</b>,<br>' +
      'or hit <b>Load sample</b> in the header.';
    rowsHost.appendChild(d);
  }
}

/** Render the top-level rows, mirroring findRows' walk over the source tree
    so `@if`-of-rows regions group into a bounding box: a run of same-region
    branch children renders as a `.cond-box.rows` with the toggle chip (only
    the active branch's rows are in the model); a run with nothing shown
    collapses to the thin chip-only strip at its source position. */
function renderTopRows(host: HTMLElement, el: El, byEl: Map<El, number>): number {
  const children = el.children;
  let emitted = 0;
  let i = 0;
  while (i < children.length) {
    const c = children[i]!;
    const region = c.cond?.region;
    const cr = region ? topCondRegion(region) : null;
    if (!cr) {
      emitted += renderRowOrDescend(host, c, byEl);
      i++;
      continue;
    }
    const box = document.createElement('div');
    box.className = 'cond-box rows';
    box.appendChild(renderBranchChip(cr));
    let shown = 0;
    while (i < children.length && children[i]!.cond?.region === cr.region) {
      shown += renderRowOrDescend(box, children[i]!, byEl);
      i++;
    }
    if (shown) {
      host.appendChild(box);
      emitted += shown;
    } else {
      const strip = document.createElement('div');
      strip.className = 'cond-strip';
      strip.appendChild(box.firstChild!);   // just the chip
      host.appendChild(strip);
    }
  }
  return emitted;
}

/** A model row renders; an inactive branch row is skipped (its columns must
    not leak in); any other element may wrap rows deeper down — descend with
    the same grouping walk. */
function renderRowOrDescend(into: HTMLElement, c: El, byEl: Map<El, number>): number {
  const idx = byEl.get(c);
  if (idx !== undefined) {
    into.appendChild(renderRow(state.model[idx]!, [idx], false));
    return 1;
  }
  if (isRowEl(c)) return 0;               // hidden/inactive branch row
  if (!c.children.length) return 0;
  return renderTopRows(into, c, byEl);
}

/** Region metadata for a top-level run, straight from the parse registry —
    top-level regions hang on no RowNode/ColNode, unlike in-row/in-column. */
function topCondRegion(region: string): CondRegion | null {
  const meta = (state.root as RootEl | null)?.condRegions?.[region];
  if (!meta) return null;
  return { region, branches: meta.branches, activeIndex: state.activeBranch[region] ?? 0 };
}

/** Guard around one row's render: a failure drawing a single row must not
    blank the whole canvas. On error, skip just that row with an inline marker
    and keep drawing the rest — the robustness contract of "skip what it can't
    draw, render everything else accurately". */
function renderRow(rowNode: RowNode, path: NodePath, nested: boolean): HTMLElement {
  try {
    return renderRowInner(rowNode, path, nested);
  } catch (err) {
    console.error('[bootstrap-visualizer] failed to render row', path.join(','), err);
    const ph = document.createElement('div');
    ph.className = 'g-row render-error';
    ph.dataset.path = path.join(',');
    ph.textContent = '⚠ This row couldn’t be drawn — skipped.';
    return ph;
  }
}

function renderRowInner(rowNode: RowNode, path: NodePath, _nested: boolean): HTMLElement {
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
    // "~" and "may wrap" when the overflow rests on a guessed width — the row
    // might not actually wrap if the guess is too wide (FOLLOW-UPS §2.4)
    pill.textContent = '⚠ ' + (fill.approx ? '~' : '') + fill.sum + '/12 → ' +
      (fill.approx ? 'may wrap' : 'wraps');
    pill.title = fill.approx
      ? 'Estimated columns + offsets exceed 12 at ' + state.bp + ' — the row may wrap'
      : 'Columns + offsets exceed 12 at ' + state.bp + ' — row wraps';
    if (state.tintOverfull) rowDiv.classList.add('overfull');
  } else {
    pill.textContent = (fill.approx ? '~' : '') + fill.sum + '/12';
    if (fill.approx) pill.title = 'Contains a column with no fixed width (auto, equal, or a non-column child) — approximate';
  }
  // the row's top-edge strip: hidden-region chips (prepended by
  // renderRowBody) followed by the fill pill
  const flags = document.createElement('div');
  flags.className = 'row-flags';
  flags.appendChild(pill);
  rowDiv.appendChild(flags);

  rowDiv.addEventListener('click', e => {
    e.stopPropagation();
    select({ path, kind: 'row' });
  });

  if (isCollapsed) return rowDiv;

  renderRowBody(rowDiv, rowNode, fill.widths, path, flags);
  return rowDiv;
}

/** Lay out a row's columns, wrapping each `@if` region's active branch in a
    labeled bounding box (`.cond-box`) whose header is the toggle chip. Walks
    the row's *source* children so a hidden region (activeIndex -1, no columns)
    still renders its box + chip and can be toggled back on. Untagged columns
    render directly into the row, exactly as before. */
function renderRowBody(
  host: HTMLElement, rowNode: RowNode, widths: ColWidth[], path: NodePath,
  flags: HTMLElement,
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

  // a d-* column hidden at the current breakpoint occupies no width at all but
  // is drawn as a thin marker in place (renderHiddenCol) so you can see it's
  // there; dragging other columns still works via their own dropzones.
  const emit = (h: Hit, into: HTMLElement, denom?: number) => into.appendChild(
    h.w.hidden
      ? renderHiddenCol(h.node, path.concat(h.idx), h.idx, h.idx === last)
      : renderCol(h.node, h.w, path.concat(h.idx), h.idx, h.idx === last, denom));

  const children = rowNode.el.children;
  let i = 0;
  while (i < children.length) {
    const region = children[i]!.cond?.region;
    if (!region) {
      const hit = byEl.get(children[i]!);   // plain column (non-col child: skipped)
      if (hit) emit(hit, host);
      i++;
      continue;
    }
    // one @if/*ngIf region: gather this run of consecutive branch children that
    // belong to the active branch (only those are in byEl).
    const branchCols: Hit[] = [];
    while (i < children.length && children[i]!.cond?.region === region) {
      const hit = byEl.get(children[i]!);
      if (hit) branchCols.push(hit);
      i++;
    }
    const cr = regionMeta.get(region);
    if (!cr) continue;
    if (!branchCols.length) {
      // the @if branch shows nothing: zero grid footprint, so the remaining
      // columns lay out as Angular would render them. The toggle chip
      // relocates to the row's top-edge strip; has-flags caps the label width.
      flags.insertBefore(renderBranchChip(cr), flags.lastChild);
      host.classList.add('has-flags');
      continue;
    }
    // size the box to its branch's *visible* span so it sits inline where the
    // content is; its columns are laid out relative to that span (hidden cols
    // contribute a thin marker, not span).
    const box = document.createElement('div');
    box.className = 'cond-box';
    box.appendChild(renderBranchChip(cr));
    const span = branchCols.reduce((s, h) => s + (h.w.hidden ? 0 : footprint(h.w)), 0) || 1;
    box.style.flex = '0 0 ' + (Math.min(span / 12, 1) * 100).toFixed(4) + '%';
    box.style.maxWidth = (Math.min(span / 12, 1) * 100).toFixed(4) + '%';
    for (const h of branchCols) emit(h, box, span);
    host.appendChild(box);
  }
}

/** A `d-*` column hidden at the current breakpoint: a thin dashed line where
    the column sits, rather than omitting it. Zero width at rest (adds nothing
    to the row's layout or fill) but carries dropzones so columns can be dropped
    on either side of it — crucial when it's the last column in the row, since
    then no visible column provides a "drop after" zone. The dropzones only
    activate during a drag, when the marker also widens (CSS) to separate them;
    resize handles are disabled then, so there's no click conflict. */
function renderHiddenCol(
  colNode: ColNode, path: NodePath, index: number, isLast: boolean,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'g-col-hidden';
  el.dataset.path = path.join(',');
  el.title = 'Column hidden here by a d-* utility (' + (classValue(colNode.el) || '(no class)') +
    ') — no grid space at ' + state.bp + '; shows at a larger breakpoint';
  const rowPath = path.slice(0, -1);
  el.appendChild(makeDropzone(rowPath, index, 'left'));
  if (isLast) el.appendChild(makeDropzone(rowPath, index + 1, 'right'));
  return el;
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
    const regionMeta = new Map((colNode.conds ?? []).map(c => [c.region, c]));
    const rendered = new Set<number>();
    let skippedTitle = false;
    let s = 0;
    while (s < seq.length) {
      const item = seq[s]!;
      if (item.kind !== 'row') {
        if (item.direct && titleFromHeading && !skippedTitle) {
          skippedTitle = true;          // this heading is already the block title
          s++;
          continue;
        }
        const sep = document.createElement('div');
        sep.className = 'nested-sep';
        sep.textContent = item.text;
        sep.title = item.full;
        nest.appendChild(sep);
        s++;
        continue;
      }
      const cr = item.el.cond ? regionMeta.get(item.el.cond.region) : undefined;
      if (!cr) {
        const i = indexByEl.get(item.el);
        if (i !== undefined && !rendered.has(i)) {
          nest.appendChild(renderRow(colNode.nestedRows[i]!, path.concat(i), true));
          rendered.add(i);
        }
        s++;
        continue;
      }
      // an @if-of-rows region: box the run of consecutive same-region rows
      // (the sequence carries every branch's rows; only the active branch's
      // are in nestedRows). A run with nothing shown collapses to a thin
      // chip-only strip — near-zero footprint, still toggleable in place.
      const box = document.createElement('div');
      box.className = 'cond-box rows';
      box.appendChild(renderBranchChip(cr));
      let shown = 0;
      while (s < seq.length) {
        const it = seq[s]!;
        if (it.kind !== 'row' || it.el.cond?.region !== cr.region) break;
        const i = indexByEl.get(it.el);
        if (i !== undefined && !rendered.has(i)) {
          box.appendChild(renderRow(colNode.nestedRows[i]!, path.concat(i), true));
          rendered.add(i);
          shown++;
        }
        s++;
      }
      if (!shown) {
        const strip = document.createElement('div');
        strip.className = 'cond-strip';
        strip.appendChild(box.firstChild!);   // just the chip, no box
        nest.appendChild(strip);
        continue;
      }
      nest.appendChild(box);
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

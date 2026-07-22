/* The inspector pane: what the selected block is, its effective width and
   offset at the view breakpoint, the full per-breakpoint grids, and the
   actions available on it. */

import {
  BPS, classIsInterpolated, classValue, colTitle, definingBp, effectiveAt,
  hasDynamicClassBinding, isContainerCol,
} from '@bootstrap-visualizer/core';
import type { ColNode, RowNode, WidthValue } from '@bootstrap-visualizer/core';
import { escapeHtml, inspector } from './dom.js';
import { resolvePath, state } from './state.js';
import { render } from './render.js';
import {
  addColAfter, addColToRow, addRowAfter, changeOffset, deleteEl, nudgeCol,
  quickOffset, quickWidth, splitCol, stepWidth,
} from './edits.js';

export function renderInspector(): void {
  const node = state.sel && resolvePath(state.sel.path);
  inspector.innerHTML = '';
  if (!node) {
    const d = document.createElement('div');
    d.className = 'insp-empty';
    d.innerHTML = 'Select a column or row on the canvas.' +
      '<br><br>Drag a column onto the amber slots to move it — within a row or into another row.';
    inspector.appendChild(d);
  } else if (node.kind === 'col') renderColInspector(node);
  else renderRowInspector(node);
  renderViewSection();
}

function renderViewSection(): void {
  const vs = sec('View');
  const lab = document.createElement('label');
  lab.className = 'view-opt';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.tintOverfull;
  cb.addEventListener('change', () => {
    state.tintOverfull = cb.checked;
    render();
  });
  lab.appendChild(cb);
  lab.appendChild(document.createTextNode(' Tint overfull rows'));
  lab.title = 'Amber border on rows whose columns exceed 12 — off by default since wrapping can be intentional';
  vs.appendChild(lab);
}

function sec(title: string | null): HTMLElement {
  const s = document.createElement('div');
  s.className = 'insp-section';
  if (title) {
    const t = document.createElement('div');
    t.className = 'insp-title'; t.textContent = title;
    s.appendChild(t);
  }
  inspector.appendChild(s);
  return s;
}

function renderColInspector(node: ColNode): void {
  const el = node.el;
  const editable = !classIsInterpolated(el);

  const head = sec('Column');
  const title = colTitle(state.src, el);
  if (title) {
    const kv0 = document.createElement('div');
    kv0.className = 'insp-kv';
    kv0.innerHTML = 'title <b>' + escapeHtml(title.text) + '</b>' +
      (title.full !== title.text
        ? ' <span style="color:var(--faint)">(' + escapeHtml(title.full) + ')</span>'
        : '');
    head.appendChild(kv0);
  }
  const kv1 = document.createElement('div');
  kv1.className = 'insp-kv';
  kv1.innerHTML = 'element <b>&lt;' + el.tag + '&gt;</b> · ' +
    (isContainerCol(state.src, el) ? '<b>⊞ container</b> (holds nested rows)' : 'content');
  head.appendChild(kv1);
  const kv2 = document.createElement('div');
  kv2.className = 'insp-kv';
  kv2.innerHTML = 'class <b>' + escapeHtml(classValue(el) || '—') + '</b>';
  head.appendChild(kv2);
  if (!editable) {
    const warn = document.createElement('div');
    warn.className = 'hint';
    warn.textContent = 'Class contains {{ interpolation }} — shown read-only; edit it in the source.';
    head.appendChild(warn);
    return;
  }
  if (hasDynamicClassBinding(el)) {
    const warn = document.createElement('div');
    warn.className = 'hint';
    warn.textContent = 'Also has an [ngClass]/[class] binding; only the static class attribute is edited here.';
    head.appendChild(warn);
  }

  // ── effective values at the current view breakpoint ──
  const es = sec('Effective at ' + state.bp);
  const eg = document.createElement('div');
  eg.className = 'bp-grid';
  es.appendChild(eg);

  const effW = effectiveAt(node.spec.width, state.bp);
  const defW = definingBp(node.spec.width, state.bp);
  const effO = effectiveAt(node.spec.offset, state.bp);
  const defO = definingBp(node.spec.offset, state.bp);

  const wLab = document.createElement('label');
  wLab.textContent = 'width';
  eg.appendChild(wLab);
  const wDisp = (effW === null ? '12' : (effW === 'equal' ? 'equal' : effW === 'auto' ? 'auto' : effW))
              + (defW ? ' @' + defW : '');
  const wSt = stepper(String(wDisp), effW === null,
    () => quickWidth(node, -1), () => quickWidth(node, +1));
  if (effW === 'equal' || effW === 'auto') disableStepper(wSt);
  eg.appendChild(wSt);

  const oLab = document.createElement('label');
  oLab.textContent = 'offset';
  eg.appendChild(oLab);
  const oSt = stepper((effO == null ? '0' : effO) + (defO ? ' @' + defO : ''), effO == null,
    () => quickOffset(node, -1), () => quickOffset(node, +1));
  eg.appendChild(oSt);

  const ehint = document.createElement('div');
  ehint.className = 'hint';
  ehint.textContent = defW || defO
    ? 'These edit the defining token (@' + (defW || defO) + '), wherever it lives — no ' + state.bp + ' overrides are created.'
    : 'No grid classes yet — a new token will follow the row\'s tier and dialect.';
  es.appendChild(ehint);

  // ── all breakpoints (explicit, for overrides and mixed tiers) ──
  const ds = sec(null);
  const det = document.createElement('details');
  det.className = 'insp-details';
  det.open = !!state.inspDetailsOpen;
  det.addEventListener('toggle', () => { state.inspDetailsOpen = det.open; });
  const dsum = document.createElement('summary');
  dsum.textContent = 'All breakpoints';
  det.appendChild(dsum);
  ds.appendChild(det);

  const wt = document.createElement('div');
  wt.className = 'insp-title';
  wt.textContent = 'Width';
  det.appendChild(wt);
  const grid = document.createElement('div');
  grid.className = 'bp-grid';
  det.appendChild(grid);
  const W_STEPS: (WidthValue | null)[] = [null, 'equal', 'auto', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  for (const bp of BPS) {
    const lab = document.createElement('label');
    lab.textContent = (node.spec.width[bp] !== undefined ? '● ' : '') + bp;
    if (node.spec.width[bp] !== undefined) lab.classList.add('def');
    if (bp === state.bp) lab.classList.add('cur');
    grid.appendChild(lab);
    const cur = node.spec.width[bp] !== undefined ? node.spec.width[bp]! : null;
    let disp: string, unset: boolean;
    if (cur !== null) {
      disp = String(cur === 'equal' ? 'equal' : cur === 'auto' ? 'auto' : cur);
      unset = false;
    } else {
      const inh = effectiveAt(node.spec.width, bp);
      const from = definingBp(node.spec.width, bp);
      disp = inh === null ? '—'
        : (inh === 'equal' ? 'equal' : inh === 'auto' ? 'auto' : inh) + ' ↑' + from;
      unset = true;
    }
    grid.appendChild(stepper(disp, unset,
      () => stepWidth(node, bp, -1, W_STEPS),
      () => stepWidth(node, bp, +1, W_STEPS)));
  }

  const ot = document.createElement('div');
  ot.className = 'insp-title';
  ot.textContent = 'Offset';
  det.appendChild(ot);
  const ogrid = document.createElement('div');
  ogrid.className = 'bp-grid';
  det.appendChild(ogrid);
  for (const bp of BPS) {
    const lab = document.createElement('label');
    lab.textContent = (node.spec.offset[bp] !== undefined ? '● ' : '') + bp;
    if (node.spec.offset[bp] !== undefined) lab.classList.add('def');
    if (bp === state.bp) lab.classList.add('cur');
    ogrid.appendChild(lab);
    const cur = node.spec.offset[bp] !== undefined ? node.spec.offset[bp]! : null;
    let disp: string, unset: boolean;
    if (cur !== null) { disp = String(cur); unset = false; }
    else {
      const inh = effectiveAt(node.spec.offset, bp);
      const from = definingBp(node.spec.offset, bp);
      disp = inh == null ? '—' : inh + ' ↑' + from;
      unset = true;
    }
    ogrid.appendChild(stepper(disp, unset,
      () => changeOffset(node, bp, -1),
      () => changeOffset(node, bp, +1)));
  }
  const dhint = document.createElement('div');
  dhint.className = 'hint';
  dhint.textContent = '● = defined at that breakpoint; gray ↑ values are inherited. Editing an inherited row creates an explicit override at that breakpoint.';
  det.appendChild(dhint);

  // actions
  const as = sec('Actions');
  const act = document.createElement('div');
  act.className = 'insp-actions';
  as.appendChild(act);
  actBtn(act, 'Split in two', () => splitCol(node));
  actBtn(act, 'Add column after', () => addColAfter(node));
  actBtn(act, '◀ Move', () => nudgeCol(-1));
  actBtn(act, 'Move ▶', () => nudgeCol(+1));
  const del = actBtn(act, 'Delete', () => deleteEl(node));
  del.classList.add('danger');
}

function renderRowInspector(node: RowNode): void {
  const head = sec('Row');
  const kv = document.createElement('div');
  kv.className = 'insp-kv';
  kv.innerHTML = 'class <b>' + escapeHtml(classValue(node.el)) + '</b> · ' +
    node.cols.length + ' column' + (node.cols.length === 1 ? '' : 's');
  head.appendChild(kv);

  const as = sec('Actions');
  const act = document.createElement('div');
  act.className = 'insp-actions';
  as.appendChild(act);
  actBtn(act, 'Add column', () => addColToRow(node));
  actBtn(act, 'Add row after', () => addRowAfter(node));
  const del = actBtn(act, 'Delete row', () => deleteEl(node));
  del.classList.add('danger');
}

/* ── small controls ──────────────────────────────────────────────── */

function stepper(
  display: string, unset: boolean, onMinus: () => void, onPlus: () => void,
): HTMLElement {
  const w = document.createElement('div');
  w.className = 'stepper';
  const minus = document.createElement('button');
  minus.textContent = '−';
  minus.addEventListener('click', onMinus);
  const val = document.createElement('div');
  val.className = 'val' + (unset ? ' unset' : '');
  val.textContent = display;
  const plus = document.createElement('button');
  plus.textContent = '+';
  plus.addEventListener('click', onPlus);
  w.append(minus, val, plus);
  return w;
}

function disableStepper(st: HTMLElement): void {
  st.querySelectorAll('button').forEach(b => b.disabled = true);
}

function actBtn(host: HTMLElement, label: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', fn);
  host.appendChild(b);
  return b;
}

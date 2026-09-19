/* The inspector pane: what the selected block is, its effective width and
   offset at the view breakpoint, the full per-breakpoint grids, and the
   actions available on it. */

import {
  BPS, classIsInterpolated, classValue, colTitle, definingBp, effectiveAt,
  hasDynamicClassBinding, isContainerCol,
} from '@bootstrap-visualizer/core';
import type { ColNode, RowNode, WidthValue } from '@bootstrap-visualizer/core';
import { escapeHtml, inspector } from './dom.js';
import {
  canPersistPrefs, dialectLabel, newColClassList, newRowClassList, persistViewPref,
  resolvePath, rowOfSel, setClassConvention, state,
} from './state.js';
import { render } from './render.js';
import {
  addColAfter, addColToRow, addRowAfter, addRowAtEnd, addRowToCol, changeOffset,
  deleteEl, nudgeCol, nudgeRow, quickOffset, quickWidth, splitCol, stepWidth,
} from './edits.js';
import { icon, type IconName } from './icons.js';

export function renderInspector(): void {
  const node = state.sel && resolvePath(state.sel.path);
  rememberFieldFocus();
  inspector.innerHTML = '';
  if (!node) {
    const d = document.createElement('div');
    d.className = 'insp-empty';
    d.innerHTML = 'Select a column or row on the canvas.' +
      '<br><br>Drag a column onto the amber slots to move it — within a row or into another row.';
    inspector.appendChild(d);
    const as = sec('Start here');
    const act = document.createElement('div');
    act.className = 'insp-actions';
    as.appendChild(act);
    actBtn(act, 'Add row', () => addRowAtEnd(), 'addRow');
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = state.model.length
      ? 'Adds a row after the last one in the document.'
      : 'Adds the first row at the end of the document — then build it out from there.';
    as.appendChild(hint);
  } else if (node.kind === 'col') renderColInspector(node);
  else renderRowInspector(node);
  renderViewSection();
  renderConventionSection();
  restoreFieldFocus();
}

function renderViewSection(): void {
  const vs = sec('View');
  // both persist: flipping the checkbox is remembered (the extension writes
  // it to user settings; the standalone just keeps it for the session).
  vs.appendChild(viewOpt('Tint overfull rows',
    'Amber border on rows whose columns exceed 12 — off by default since wrapping can be intentional',
    () => state.tintOverfull, v => persistViewPref('tintOverfull', v)));
  vs.appendChild(viewOpt('Stretch to fit',
    'Let the sheet use the whole canvas panel instead of the breakpoint\'s representative width — proportions are unchanged',
    () => state.stretchSheet, v => persistViewPref('stretchSheet', v)));
}

/* ── the class convention for created rows / columns ─────────────── */

/** Extra classes every row and column the canvas *creates* carries. The canvas
    computes the grid classes; this is the rest of what the project's markup
    always has on them (`clearfix`), so a page can be built without
    going back to fix every class attribute by hand. */
function renderConventionSection(): void {
  const cs = sec('New rows & columns');
  cs.appendChild(convField('row', 'Extra classes on new rows', state.newRowClasses.raw));
  cs.appendChild(convField('col', 'Extra classes on new columns', state.newColClasses.raw));

  const prev = document.createElement('div');
  prev.className = 'insp-kv';
  // built by calling the same functions the edits call — never a second
  // implementation of what gets written
  prev.innerHTML = 'New rows get <b>' + escapeHtml(newRowClassList().join(' ')) + '</b>' +
    ' · new columns get <b>' +
    escapeHtml(newColClassList(null, rowOfSel()).join(' ')) + '</b>';
  cs.appendChild(prev);

  const ignored = [...state.newRowClasses.dropped, ...state.newColClasses.dropped];
  if (ignored.length) {
    const warn = document.createElement('div');
    warn.className = 'hint';
    warn.textContent = 'Ignored: ' + [...new Set(ignored)].join(', ') +
      ' — the canvas writes the grid classes itself (col-*, offset-*), and every row '
      + 'always gets `row`.';
    cs.appendChild(warn);
  }
  if (!canPersistPrefs()) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Applies to this session only — not saved.';
    cs.appendChild(hint);
  }
}

function convField(kind: 'row' | 'col', label: string, value: string): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'conv-field';
  const t = document.createElement('span');
  t.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = kind === 'row' ? 'e.g. clearfix' : 'e.g. px-2';
  input.dataset.conv = kind;
  // Commit on change (blur/Enter), not per keystroke: each commit is a write to
  // the user's settings, and with the settings watcher live a per-character
  // write would echo straight back into the field being typed in.
  input.addEventListener('change', () => {
    setClassConvention(kind, input.value);
    render();
  });
  wrap.append(t, input);
  return wrap;
}

/* The inspector is rebuilt wholesale on every render, which a text field
   notices and a checkbox doesn't: a live-sync refresh mid-typing would take
   the caret away. Remember where it was and put it back. */
let pendingFocus: { conv: string; start: number; end: number } | null = null;

function rememberFieldFocus(): void {
  const el = document.activeElement;
  pendingFocus = el instanceof HTMLInputElement && el.dataset.conv
    ? { conv: el.dataset.conv, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 }
    : null;
}

function restoreFieldFocus(): void {
  if (!pendingFocus) return;
  const { conv, start, end } = pendingFocus;
  pendingFocus = null;
  const input = inspector.querySelector<HTMLInputElement>(`input[data-conv="${conv}"]`);
  if (!input) return;
  input.focus();
  input.setSelectionRange(start, end);
}

function viewOpt(
  text: string, title: string, get: () => boolean, set: (v: boolean) => void,
): HTMLElement {
  const lab = document.createElement('label');
  lab.className = 'view-opt';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = get();
  cb.addEventListener('change', () => { set(cb.checked); render(); });
  lab.appendChild(cb);
  lab.appendChild(document.createTextNode(' ' + text));
  lab.title = title;
  return lab;
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
    warn.textContent = 'This also has an [ngClass] binding — the canvas only changes the '
      + 'plain class attribute, so classes the binding adds won\'t show up here.';
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

  // Which class style the steppers above are about to write, and who decided
  // — the one place a surprising `offset-md-3` can be traced back to a setting
  // rather than read as a bug (FOLLOW-UPS §9.14).
  const vhint = document.createElement('div');
  vhint.className = 'hint dialect-hint';
  vhint.textContent = dialectLabel(state.docBs3) + ' classes — '
    + (state.dialectSource === 'file'
        ? 'detected from this file.'
        : canPersistPrefs()
          ? 'this file doesn\'t say, so your Bootstrap version setting decides.'
          : 'this file doesn\'t say, so the Bootstrap version in the header decides.');
  es.appendChild(vhint);

  const ehint = document.createElement('div');
  ehint.className = 'hint';
  ehint.textContent = defW || defO
    ? 'The + and − buttons change the ' + (defW || defO) + ' class that already sets this, '
      + 'wherever it sits — they won\'t add a new ' + state.bp + ' class.'
    : 'No width or offset classes yet — a new one will use the same breakpoint as the '
      + 'rest of the row.';
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
  dhint.textContent = '● marks a breakpoint with a class of its own. Grey ↑ values carry '
    + 'up from a smaller breakpoint — change one and it gets its own class here.';
  det.appendChild(dhint);

  // actions
  const as = sec('Actions');
  const act = document.createElement('div');
  act.className = 'insp-actions';
  as.appendChild(act);
  actBtn(act, 'Split in two', () => splitCol(node), 'split');
  actBtn(act, 'Add column after', () => addColAfter(node), 'addColAfter');
  actBtn(act, 'Add row inside', () => addRowToCol(node), 'addRowInside');
  actPair(act, ['Move left', 'moveLeft', () => nudgeCol(-1)],
    ['Move right', 'moveRight', () => nudgeCol(+1)]);
  dangerBtn(as, 'Delete', () => deleteEl(node));
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
  actBtn(act, 'Add column', () => addColToRow(node), 'addColToRow');
  actBtn(act, 'Add row after', () => addRowAfter(node), 'addRow');
  // rows stack vertically, so they move up/down (columns move left/right)
  actPair(act, ['Move up', 'moveUp', () => nudgeRow(-1)],
    ['Move down', 'moveDown', () => nudgeRow(+1)]);
  dangerBtn(as, 'Delete row', () => deleteEl(node));
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

/** One action, a full-width line in the list: icon, then label. The icon
    trails instead when `trailing` — the forward half of a pair points the way
    it goes (Move right ▷, Move down ▽). */
function actBtn(
  host: HTMLElement, label: string, fn: () => void, ico?: IconName, trailing = false,
): HTMLButtonElement {
  const b = document.createElement('button');
  const text = document.createElement('span');
  text.textContent = label;
  if (!ico) b.append(text);
  else if (trailing) b.append(text, icon(ico));
  else b.append(icon(ico), text);
  b.addEventListener('click', fn);
  host.appendChild(b);
  return b;
}

type Action = [label: string, ico: IconName, fn: () => void];

/** Two opposite moves, as halves of one line — they're one decision (which
    way?), so they must never wrap apart the way free-flowing buttons did. */
function actPair(host: HTMLElement, back: Action, forward: Action): void {
  const pair = document.createElement('div');
  pair.className = 'insp-pair';
  const [bLabel, bIco, bFn] = back;
  const [fLabel, fIco, fFn] = forward;
  actBtn(pair, bLabel, bFn, bIco);
  actBtn(pair, fLabel, fFn, fIco, true);
  host.appendChild(pair);
}

/** The destructive action, on its own line apart from the list, so reaching
    for the last button in it can't land on a delete. */
function dangerBtn(section: HTMLElement, label: string, fn: () => void): void {
  const wrap = document.createElement('div');
  wrap.className = 'insp-actions insp-danger';
  actBtn(wrap, label, fn, 'delete').classList.add('danger');
  section.appendChild(wrap);
}

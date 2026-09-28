/* The collapsed inspector: a narrow strip of icon buttons in place of the full
   pane, so a narrow panel leaves the canvas most of the room. It shows exactly
   the controls the full inspector shows for the same selection — width and
   offset steppers and the column actions for a column, the row actions for a
   row, "Add row" for nothing — each as an icon with a tooltip. Settings (View,
   the class convention) and the per-breakpoint grids stay in the full pane.

   Tooltips are drawn by the page, not the browser's `title`: an icon-only
   strip is read by hovering along it, and the native tooltip's second of delay
   made that slow. One tooltip element, placed beside whatever is hovered or
   focused; the icons also carry an aria-label, so screen readers get the name
   without it. */

import { classIsInterpolated, definingBp, effectiveAt } from '@bootstrap-visualizer/core';
import type { ColNode, RowNode } from '@bootstrap-visualizer/core';
import { inspector } from './dom.js';
import { state } from './state.js';
import { render } from './render.js';
import {
  addColAfter, addColToRow, addRowAfter, addRowAtEnd, addRowToCol, deleteEl,
  nudgeCol, nudgeRow, quickOffset, quickWidth, splitCol,
} from './edits.js';
import { icon, type IconName } from './icons.js';

/* ── tooltip ─────────────────────────────────────────────────────────── */

let tipEl: HTMLElement | null = null;

function showTip(target: HTMLElement): void {
  const text = target.dataset.tip;
  if (!text) return;
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'ui-tip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
  }
  tipEl.textContent = text;
  // to the left of the target: the strip sits at the window's right edge
  const r = target.getBoundingClientRect();
  tipEl.style.top = (r.top + r.height / 2) + 'px';
  tipEl.style.right = (window.innerWidth - r.left + 8) + 'px';
  tipEl.classList.add('show');
}

/** Hide the tooltip — also called before every re-render, since the element it
    points at is about to be replaced. */
export function hideTip(): void {
  tipEl?.classList.remove('show');
}

/** Give an element the page's tooltip, on hover and on keyboard focus. */
export function withTip<T extends HTMLElement>(el: T, text: string): T {
  el.dataset.tip = text;
  el.setAttribute('aria-label', text);
  el.addEventListener('pointerenter', () => showTip(el));
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', () => showTip(el));
  el.addEventListener('blur', hideTip);
  return el;
}

/* ── the strip ───────────────────────────────────────────────────────── */

/** An icon button with a tooltip. `small` is the steppers' size. */
export function railBtn(
  host: HTMLElement, label: string, ico: IconName, fn: () => void,
  opts: { small?: boolean; danger?: boolean; disabled?: boolean } = {},
): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'rail-btn' + (opts.small ? ' sm' : '') + (opts.danger ? ' danger' : '');
  b.append(icon(ico));
  b.disabled = !!opts.disabled;
  b.addEventListener('click', fn);
  host.appendChild(withTip(b, label));
  return b;
}

function sep(host: HTMLElement): void {
  const s = document.createElement('span');
  s.className = 'rail-sep';
  host.appendChild(s);
}

/** A vertical stepper: caption, +, the value (focusable, with a tooltip), −. */
function stepper(
  host: HTMLElement, caption: string, what: string, value: string, tip: string,
  unset: boolean, onMinus: () => void, onPlus: () => void, disabled = false,
): void {
  const w = document.createElement('div');
  w.className = 'rail-step';
  const cap = document.createElement('span');
  cap.className = 'rail-cap';
  cap.textContent = caption;
  cap.setAttribute('aria-hidden', 'true');
  w.appendChild(cap);
  railBtn(w, 'Increase ' + what, 'plus', onPlus, { small: true, disabled });
  const val = document.createElement('span');
  val.className = 'rail-val' + (unset ? ' unset' : '') + (value.length > 2 ? ' long' : '');
  val.textContent = value;
  val.tabIndex = 0;
  w.appendChild(withTip(val, tip));
  railBtn(w, 'Decrease ' + what, 'minus', onMinus, { small: true, disabled });
  host.appendChild(w);
}

export function renderRail(node: ColNode | RowNode | null): void {
  const rail = document.createElement('div');
  rail.className = 'rail';
  inspector.appendChild(rail);

  railBtn(rail, 'Expand inspector', 'panelOpen', () => {
    state.inspCollapsed = false;
    render();
  });
  sep(rail);

  if (!node) {
    railBtn(rail, 'Add row', 'addRow', () => addRowAtEnd());
  } else if (node.kind === 'row') {
    railBtn(rail, 'Add column', 'addColToRow', () => addColToRow(node));
    railBtn(rail, 'Add row after', 'addRow', () => addRowAfter(node));
    sep(rail);
    railBtn(rail, 'Move up', 'moveUp', () => nudgeRow(-1));
    railBtn(rail, 'Move down', 'moveDown', () => nudgeRow(+1));
    sep(rail);
    railBtn(rail, 'Delete row', 'delete', () => deleteEl(node), { danger: true });
  } else if (classIsInterpolated(node.el)) {
    // the full inspector shows no controls here either — just say why
    const lock = document.createElement('span');
    lock.className = 'rail-lock';
    lock.tabIndex = 0;
    lock.append(icon('lock'));
    rail.appendChild(withTip(lock, 'Class contains {{ interpolation }} — edit it in the source'));
  } else {
    renderColRail(rail, node);
  }
}

function renderColRail(rail: HTMLElement, node: ColNode): void {
  const bp = state.bp;
  const bpLab = document.createElement('span');
  bpLab.className = 'rail-bp';
  bpLab.textContent = bp;
  bpLab.tabIndex = 0;
  rail.appendChild(withTip(bpLab, 'Width and offset below are at the ' + bp + ' breakpoint'));

  // the same values, and the same rules, as the full inspector's "Effective at"
  const effW = effectiveAt(node.spec.width, bp);
  const defW = definingBp(node.spec.width, bp);
  const effO = effectiveAt(node.spec.offset, bp);
  const defO = definingBp(node.spec.offset, bp);
  const from = (def: string | null) => def ? ', set by its ' + def + ' class' : '';

  const wVal = effW === null ? '12' : effW === 'equal' ? '=' : String(effW);
  const wSays = effW === null ? '12 (no width class)'
    : effW === 'equal' ? 'equal share of the row' : String(effW);
  stepper(rail, 'W', 'width at ' + bp, wVal, 'Width at ' + bp + ': ' + wSays + from(defW),
    effW === null, () => quickWidth(node, -1), () => quickWidth(node, +1),
    effW === 'equal' || effW === 'auto');

  const oVal = effO == null ? '0' : String(effO);
  stepper(rail, 'Off', 'offset at ' + bp, oVal,
    'Offset at ' + bp + ': ' + (effO == null ? '0 (no offset class)' : oVal) + from(defO),
    effO == null, () => quickOffset(node, -1), () => quickOffset(node, +1));

  sep(rail);
  railBtn(rail, 'Split in two', 'split', () => splitCol(node));
  railBtn(rail, 'Add column after', 'addColAfter', () => addColAfter(node));
  railBtn(rail, 'Add row inside', 'addRowInside', () => addRowToCol(node));
  sep(rail);
  railBtn(rail, 'Move left', 'moveLeft', () => nudgeCol(-1));
  railBtn(rail, 'Move right', 'moveRight', () => nudgeCol(+1));
  sep(rail);
  railBtn(rail, 'Delete', 'delete', () => deleteEl(node), { danger: true });
}

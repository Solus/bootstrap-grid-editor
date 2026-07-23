/* Drag & drop plumbing and edge-drag resize.

   Both end in a core-produced edit: moveCol splices element text, resize
   rewrites one class attribute value. */

import {
  classEdit, classTokens, definingBp, setWidthToken,
} from '@bootstrap-visualizer/core';
import type { ColNode, NodePath } from '@bootstrap-visualizer/core';
import { toast } from './dom.js';
import { applyOps, canApplyEdit, fallbackTier, resize, resolvePath, state } from './state.js';
import { moveCol } from './edits.js';
import { render, type ColWidth } from './render.js';

export const dnd: { src: NodePath | null } = { src: null };

export function makeDropzone(rowPath: NodePath, index: number, posCls?: string): HTMLElement {
  const z = document.createElement('div');
  z.className = 'dropzone ' + (posCls || '');
  z.addEventListener('dragover', e => {
    if (!dnd.src) return;
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    z.classList.add('over');
  });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    z.classList.remove('over');
    if (dnd.src) moveCol(dnd.src, rowPath, index);
  });
  return z;
}

/** Make a rendered column draggable. */
export function startColDrag(colDiv: HTMLElement, path: NodePath): void {
  colDiv.draggable = true;
  colDiv.addEventListener('dragstart', e => {
    if (resize.active) { e.preventDefault(); return; }
    // Early abort so a doomed gesture never starts — deliberately redundant
    // with the authoritative guard inside apply() (FOLLOW-UPS §1.3).
    const guard = canApplyEdit();
    if (!guard.ok) {
      e.preventDefault();
      toast(guard.reason, 'warn');
      return;
    }
    e.stopPropagation();
    dnd.src = path;
    colDiv.classList.add('dragging');
    document.body.classList.add('dnd');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', path.join(',')); } catch { /* ignore */ }
    }
  });
  colDiv.addEventListener('dragend', () => {
    colDiv.classList.remove('dragging');
    document.body.classList.remove('dnd');
    dnd.src = null;
  });
}

/* ── edge-drag resize ────────────────────────────────────────────── */

export function attachResize(
  colDiv: HTMLElement, colNode: ColNode, path: NodePath, w: ColWidth,
): void {
  const h = document.createElement('div');
  colDiv.appendChild(h);

  // equal-width / auto columns have no fixed width to drag — refuse with
  // an explanation instead of silently converting them to numeric
  if (w.kind === 'equal' || w.kind === 'auto') {
    const label = w.kind === 'equal' ? 'equal-width' : 'auto-width';
    h.className = 'col-resize no-resize';
    h.title = label + ' — resize with the stepper';
    h.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      toast(w.kind === 'equal'
        ? 'col is equal-width (auto-sized) — set a fixed width with the stepper or +/−'
        : 'col-auto is content-sized — set a fixed width with the stepper or +/−', 'warn');
    });
    return;
  }

  h.className = 'col-resize';
  h.title = 'Drag to resize';

  h.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Early abort so a doomed gesture never starts — deliberately redundant
    // with the authoritative guard inside apply() (FOLLOW-UPS §1.3).
    const guard = canApplyEdit();
    if (!guard.ok) {
      toast(guard.reason, 'warn');
      return;
    }
    const rowDiv = colDiv.closest('.g-row');
    if (!rowDiv) return;
    const unit = rowDiv.getBoundingClientRect().width / 12;
    if (unit <= 0) return;
    const startSpan = w.span === 'auto' ? 2 : w.span;
    const st = { x: e.clientX, span: startSpan, cur: startSpan };
    resize.active = true;
    colDiv.classList.add('resizing');
    document.body.classList.add('resizing');
    h.setPointerCapture(e.pointerId);

    const pct = (v: number) => (v / 12 * 100).toFixed(4) + '%';
    const wl = colDiv.querySelector<HTMLElement>(':scope > .width-label');

    const onMove = (ev: PointerEvent) => {
      const d = Math.round((ev.clientX - st.x) / unit);
      const next = Math.min(12, Math.max(1, st.span + d));
      if (next === st.cur) return;
      st.cur = next;
      colDiv.style.flex = '0 0 ' + pct(next);
      colDiv.style.maxWidth = pct(next);
      if (wl) wl.textContent = (w.offset ? `+${w.offset} / ` : '') + next + '/12';
    };
    const onUp = (ev: PointerEvent) => {
      h.releasePointerCapture(ev.pointerId);
      h.removeEventListener('pointermove', onMove);
      h.removeEventListener('pointerup', onUp);
      h.removeEventListener('pointercancel', onUp);
      resize.active = false;
      colDiv.classList.remove('resizing');
      document.body.classList.remove('resizing');
      state.sel = { path: path.slice(), kind: 'col' };
      if (st.cur !== st.span) {
        const bp = definingBp(colNode.spec.width, state.bp)
                || fallbackTier(colNode, resolvePath(path.slice(0, -1)));
        const tokens = setWidthToken(classTokens(colNode.el), bp, st.cur, state.docBs3);
        applyOps([classEdit(state.src, colNode.el, tokens)]);
      } else {
        render();
      }
    };
    h.addEventListener('pointermove', onMove);
    h.addEventListener('pointerup', onUp);
    h.addEventListener('pointercancel', onUp);
  });
}

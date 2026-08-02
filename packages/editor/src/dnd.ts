/* Drag & drop plumbing and edge-drag resize.

   Both end in a core-produced edit: moveCol splices element text, resize
   rewrites one class attribute value. */

import {
  classEdit, classTokens, definingBp, setWidthToken,
} from '@bootstrap-visualizer/core';
import type { ColNode, NodePath } from '@bootstrap-visualizer/core';
import { rowsHost, toast } from './dom.js';
import { applyOps, canApplyEdit, fallbackTier, resize, resolvePath, state } from './state.js';
import { moveCol } from './edits.js';
import { render, type ColWidth } from './render.js';

export const dnd: { src: NodePath | null } = { src: null };

/* Auto-scroll + leave-cancel tuning. */
const EDGE = 48;          // px from the panel's top/bottom edge that auto-scrolls
const MAX_SPEED = 20;     // px/frame at the very edge (ramps down toward EDGE)
const LEAVE_GRACE = 150;  // ms an edge overshoot may last before the drag cancels

let scrollPanel: HTMLElement | null = null;   // the .canvas-scroll to auto-scroll
let dragPointerY = 0;                         // last pointer Y seen during a drag
let autoScrollRAF = 0;
let leaveTimer = 0;

/** Keep a native column drag droppable across the whole window, and let you
    reach an off-screen drop target in a tall document. Call once at startup
    (both frontends do, alongside the other wiring).

    A native HTML5 drop only fires where some `dragover` handler called
    `preventDefault`. Our dropzones do — but the instant the pointer crosses a
    gap between them, strays over the inspector/header, or leaves the window and
    comes back, the drag is marked non-droppable, and after such an excursion
    Chromium won't re-arm the drop even once you return over a zone. Accepting
    `dragover` at the document level for the duration of the gesture keeps a
    valid drop target under the pointer the whole time; each dropzone still owns
    the actual placement (its `drop` stops propagation). The paired `drop` guard
    swallows a release that lands off every zone, so the drag payload can't fall
    through to a native text-drop (e.g. into the source textarea).

    Two scroll helpers ride on the same gesture because native DnD does NOT
    auto-scroll a nested `overflow` container: edge auto-scroll (reliable —
    hover the top/bottom edge and the canvas scrolls) and wheel-scroll
    (best-effort — native DnD delivers `wheel` inconsistently, so it's a bonus,
    not the primary path). */
export function wireDragSurface(): void {
  scrollPanel = (rowsHost.closest('.canvas-scroll') ?? rowsHost) as HTMLElement;

  document.addEventListener('dragover', e => {
    if (!dnd.src) return;
    e.preventDefault();
    dragPointerY = (e as DragEvent).clientY;
    if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = 0; }   // re-entry cancels a pending leave
    startAutoScroll();
  });
  document.addEventListener('drop', e => { if (dnd.src) e.preventDefault(); });
  document.addEventListener('dragend', stopAutoScroll);

  // Best-effort wheel-scroll while dragging (see the note above); a normal wheel
  // (no drag) falls through to native scrolling.
  document.addEventListener('wheel', e => {
    if (!dnd.src || !scrollPanel) return;
    scrollPanel.scrollTop += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  // Leaving the canvas panel cancels the drag. Native DnD dies silently the
  // moment the pointer crosses out of the webview iframe (into the source
  // editor, say) — `dragend` never reaches us, so the dropzones stay lit and
  // the column dimmed, as if still awaiting a drop. We treat leaving the panel
  // as a clean cancel and reset here, so nothing looks stuck. The
  // `contains(relatedTarget)` check ignores moves onto a child (a dropzone).
  // The LEAVE_GRACE delay lets a fast drag briefly overshoot the top/bottom
  // edge (to engage auto-scroll) and return without cancelling — the re-entry
  // `dragover` above clears the pending cancel.
  const panel = scrollPanel;
  panel.addEventListener('dragleave', e => {
    if (!dnd.src) return;
    const to = (e as DragEvent).relatedTarget as Node | null;
    if (to && panel.contains(to)) return;   // moved onto a child, not out
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => { leaveTimer = 0; cancelColDrag(); }, LEAVE_GRACE);
  });
}

/** Scroll the canvas while the pointer sits near an edge, driven by rAF (not by
    `dragover`) so it keeps scrolling even when the pointer is held still. */
function startAutoScroll(): void {
  if (autoScrollRAF || typeof requestAnimationFrame !== 'function') return;
  autoScrollRAF = requestAnimationFrame(autoScrollTick);
}

function autoScrollTick(): void {
  autoScrollRAF = 0;
  if (!dnd.src || !scrollPanel) return;                 // drag ended → stop looping
  const r = scrollPanel.getBoundingClientRect();
  let v = 0;
  if (dragPointerY < r.top + EDGE) v = -edgeSpeed(r.top + EDGE - dragPointerY);
  else if (dragPointerY > r.bottom - EDGE) v = edgeSpeed(dragPointerY - (r.bottom - EDGE));
  if (v) scrollPanel.scrollTop += v;
  autoScrollRAF = requestAnimationFrame(autoScrollTick);
}

function edgeSpeed(dist: number): number {
  return Math.ceil(Math.min(1, dist / EDGE) * MAX_SPEED);
}

function stopAutoScroll(): void {
  if (autoScrollRAF) { cancelAnimationFrame(autoScrollRAF); autoScrollRAF = 0; }
}

/** Return the canvas to its resting state after a column drag ends without a
    real drop (see wireDragSurface). Class-only reset — no model change, so no
    re-render needed; idempotent, so a later real `dragend` is harmless. */
function cancelColDrag(): void {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = 0; }
  stopAutoScroll();
  if (!dnd.src) return;
  dnd.src = null;
  document.body.classList.remove('dnd');
  document.querySelectorAll('.g-col.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.dropzone.over').forEach(el => el.classList.remove('over'));
}

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
      // A custom MIME type, NOT text/plain: the reorder reads dnd.src, never the
      // payload, so the data is only here because some browsers won't start a
      // drag without any. text/plain would get inserted verbatim wherever the
      // drag lands on a native text target — the source <textarea>, or (worse,
      // and beyond our reach outside the webview) VS Code's own editor. A
      // custom type is invisible to those, so nothing gets typed in.
      try { e.dataTransfer.setData('application/x-grid-col', path.join(',')); } catch { /* ignore */ }
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
        applyOps(classEdit(state.src, colNode.el, tokens));
      } else {
        render();
      }
    };
    h.addEventListener('pointermove', onMove);
    h.addEventListener('pointerup', onUp);
    h.addEventListener('pointercancel', onUp);
  });
}

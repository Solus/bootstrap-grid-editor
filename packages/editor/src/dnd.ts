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

/** Keep a native column drag droppable across the whole window. Call once at
    startup (both frontends do, alongside the other wiring).

    A native HTML5 drop only fires where some `dragover` handler called
    `preventDefault`. Our dropzones do — but the instant the pointer crosses a
    gap between them, strays over the inspector/header, or leaves the window and
    comes back, the drag is marked non-droppable, and after such an excursion
    Chromium won't re-arm the drop even once you return over a zone (the
    reported bug). Accepting `dragover` at the document level for the duration
    of the gesture keeps a valid drop target under the pointer the whole time;
    each dropzone still owns the actual placement (its `drop` stops
    propagation), so this only fills the gaps and stays inert whenever no column
    is being dragged. The paired `drop` guard swallows a release that lands off
    every zone, so the drag payload can't fall through to a native text-drop
    (e.g. getting inserted into the source textarea). */
export function wireDragSurface(): void {
  document.addEventListener('dragover', e => { if (dnd.src) e.preventDefault(); });
  document.addEventListener('drop', e => { if (dnd.src) e.preventDefault(); });

  // Leaving the canvas panel cancels the drag. Native DnD dies silently the
  // moment the pointer crosses out of the webview iframe (into the source
  // editor, say) — `dragend` never reaches us, so the dropzones stay lit and
  // the column dimmed, as if still awaiting a drop. Rather than try to survive
  // that crossing (native DnD can't, out of an iframe), we treat leaving the
  // panel as a clean cancel and reset here, so nothing looks stuck. The
  // `contains(relatedTarget)` check ignores moves onto a child (a dropzone),
  // firing only when the pointer truly leaves the panel.
  const panel = rowsHost.closest('.canvas-scroll') ?? rowsHost;
  panel.addEventListener('dragleave', e => {
    if (!dnd.src) return;
    const to = (e as DragEvent).relatedTarget as Node | null;
    if (!to || !panel.contains(to)) cancelColDrag();
  });
}

/** Return the canvas to its resting state after a column drag ends without a
    real drop (see wireDragSurface). Class-only reset — no model change, so no
    re-render needed; idempotent, so a later real `dragend` is harmless. */
function cancelColDrag(): void {
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

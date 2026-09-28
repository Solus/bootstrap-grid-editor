/* Shared canvas chrome wiring both frontends need: the breakpoint switch, the
   Bootstrap version chip, and the click-background-to-deselect behaviour.
   Requires the host HTML to provide #bpSwitch, #dialectChip and #rowsHost. */

import { BPS } from '@bootstrap-visualizer/core';
import { $, rowsHost } from './dom.js';
import { render } from './render.js';
import { setDialectPref, state } from './state.js';
import { clearSelection } from './selection.js';
import { icon, type IconName } from './icons.js';

export function wireBreakpointSwitch(): void {
  const host = $('#bpSwitch');
  BPS.forEach(bp => {
    const b = document.createElement('button');
    b.textContent = bp;
    b.dataset.bp = bp;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => { state.bp = bp; render(); });
    host.appendChild(b);
  });
}

/** The header's Bootstrap version chip: says which class style the canvas is
    writing, and switches it where that's the user's call. Built once here;
    `renderHeader` keeps its label and enabled state current, since both follow
    the open document.

    Only a document whose own classes don't say is switchable — flipping the
    chip on a document that has declared its dialect would write the other
    style's tokens alongside the existing ones, which is broken markup in
    either framework. There it reads as a status light instead, marked
    `aria-disabled` rather than `disabled`: the two look alike and neither
    acts, but a truly disabled button leaves the tab order, and would take the
    chip's own explanation of *why* it can't be switched with it. The click
    handler guards the same condition, so a keyboard Enter does nothing
    either. */
export function wireDialectChip(): void {
  const host = $('#dialectChip');
  const b = document.createElement('button');
  b.addEventListener('click', () => {
    if (state.dialectSource !== 'setting') return;
    setDialectPref(state.docBs3 ? 'bootstrap5' : 'bootstrap3');
    render();
  });
  host.appendChild(b);
}

/** Put an icon in front of each named toolbar button's label. The buttons
    are the host HTML's own; a frontend passes the ones it has. */
export function iconizeButtons(icons: Record<string, IconName>): void {
  for (const [id, name] of Object.entries(icons)) {
    $('#' + id).prepend(icon(name));
  }
}

/** Inspector width limits. Below the minimum the action labels and the
    width/offset steppers start to cramp; the maximum is also capped at half
    the window, so widening the inspector can't take over the canvas. */
export const INSPECTOR_MIN_W = 200;
export const INSPECTOR_MAX_W = 420;

/** The divider on the inspector's left edge: drag to resize the inspector,
    double-click to put it back to the stylesheet's default width. The width
    lasts as long as the page (not persisted). */
export function wireInspectorResizer(): void {
  const handle = $('#inspectorResizer');
  const insp = $('#inspector');
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('active');
    document.body.classList.add('pane-resizing');
    const mainRect = insp.parentElement!.getBoundingClientRect();
    const maxW = Math.max(INSPECTOR_MIN_W, Math.min(INSPECTOR_MAX_W, mainRect.width * 0.5));
    const onMove = (ev: PointerEvent) => {
      // the inspector sits at the right edge, so its width is measured from there
      const w = Math.min(maxW, Math.max(INSPECTOR_MIN_W, mainRect.right - ev.clientX));
      insp.style.flexBasis = w + 'px';
    };
    const onUp = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      handle.classList.remove('active');
      document.body.classList.remove('pane-resizing');
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
  handle.addEventListener('dblclick', () => { insp.style.flexBasis = ''; });
}

/** Clicking the canvas background clears the selection. */
export function wireCanvasBackground(): void {
  rowsHost.addEventListener('click', () => clearSelection());
}

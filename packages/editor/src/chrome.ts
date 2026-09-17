/* Shared canvas chrome wiring both frontends need: the breakpoint switch, the
   Bootstrap version chip, and the click-background-to-deselect behaviour.
   Requires the host HTML to provide #bpSwitch, #dialectChip and #rowsHost. */

import { BPS } from '@bootstrap-visualizer/core';
import { $, rowsHost } from './dom.js';
import { render } from './render.js';
import { setDialectPref, state } from './state.js';
import { clearSelection } from './selection.js';

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

/** Clicking the canvas background clears the selection. */
export function wireCanvasBackground(): void {
  rowsHost.addEventListener('click', () => clearSelection());
}

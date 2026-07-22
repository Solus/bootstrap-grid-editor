/* Shared canvas chrome wiring both frontends need: the breakpoint switch and
   the click-background-to-deselect behaviour. Requires the host HTML to
   provide #bpSwitch and #rowsHost. */

import { BPS } from '@bootstrap-visualizer/core';
import { $, rowsHost } from './dom.js';
import { render } from './render.js';
import { state } from './state.js';
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

/** Clicking the canvas background clears the selection. */
export function wireCanvasBackground(): void {
  rowsHost.addEventListener('click', () => clearSelection());
}

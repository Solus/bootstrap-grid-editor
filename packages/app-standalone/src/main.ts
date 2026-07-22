/* Entry point: build the breakpoint switch, wire the panes, and load the
   sample so the canvas is never empty on first open. */

import '@bootstrap-visualizer/editor/styles.css';
import { BPS } from '@bootstrap-visualizer/core';
import {
  $, apply, clearSelection, render, rowsHost, setHost, state, wireKeyboard,
} from '@bootstrap-visualizer/editor';
import { standaloneHost } from './standalone-host.js';
import { wireSourcePane } from './source-pane.js';
import { wireFileIo } from './file-io.js';
import { SAMPLE } from './sample.js';

function wireBreakpointSwitch(): void {
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

/* Clicking the canvas background clears the selection. */
function wireCanvasBackground(): void {
  rowsHost.addEventListener('click', () => clearSelection());
}

setHost(standaloneHost);   // the textarea end of the pipe; must precede any apply()
wireBreakpointSwitch();
wireSourcePane();
wireFileIo();
wireKeyboard();
wireCanvasBackground();

apply(SAMPLE, { keepSel: false });

/* Entry point: build the breakpoint switch, wire the panes, and load the
   sample so the canvas is never empty on first open. */

import './styles.css';
import { BPS } from '@bootstrap-visualizer/core';
import { $, rowsHost } from './dom.js';
import { apply, setHost, state } from './state.js';
import { standaloneHost } from './standalone-host.js';
import { render } from './render.js';
import { positionBand } from './selection.js';
import { wireSourcePane } from './source-pane.js';
import { wireFileIo } from './file-io.js';
import { wireKeyboard } from './keyboard.js';
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
  rowsHost.addEventListener('click', () => {
    state.sel = null;
    state._bandLines = null;
    positionBand();
    render();
  });
}

setHost(standaloneHost);   // the textarea end of the pipe; must precede any apply()
wireBreakpointSwitch();
wireSourcePane();
wireFileIo();
wireKeyboard();
wireCanvasBackground();

apply(SAMPLE, { keepSel: false });

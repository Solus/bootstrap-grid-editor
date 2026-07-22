/* Entry point: wire the shared chrome and the standalone panes, then load
   the sample so the canvas is never empty on first open. */

import '@bootstrap-visualizer/editor/styles.css';
import {
  apply, setHost, wireBreakpointSwitch, wireCanvasBackground, wireKeyboard,
} from '@bootstrap-visualizer/editor';
import { standaloneHost } from './standalone-host.js';
import { wireSourcePane } from './source-pane.js';
import { wireFileIo } from './file-io.js';
import { SAMPLE } from './sample.js';

setHost(standaloneHost);   // the textarea end of the pipe; must precede any apply()
wireBreakpointSwitch();
wireSourcePane();
wireFileIo();
wireKeyboard();
wireCanvasBackground();

apply(SAMPLE, { keepSel: false });

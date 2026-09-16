/* Entry point: wire the shared chrome and the standalone panes, then load
   the sample so the canvas is never empty on first open. */

import '@bootstrap-visualizer/editor/styles.css';
import {
  apply, assertRequiredIds, REQUIRED_EDITOR_IDS, setHost, wireBreakpointSwitch,
  wireCanvasBackground, wireDialectChip, wireDragSurface, wireKeyboard,
} from '@bootstrap-visualizer/editor';
import { standaloneHost } from './standalone-host.js';
import { wireSourcePane } from './source-pane.js';
import { wireFileIo } from './file-io.js';
import { SAMPLE } from './sample.js';

/** Ids only the standalone page provides, on top of the shared editor set:
    the source pane, its band, and the header buttons wired below. */
const STANDALONE_IDS = [
  'src', 'srcPane', 'srcWrap', 'srcBand', 'paneResizer',
  'applyBtn', 'revertBtn', 'copyBtn', 'downloadBtn', 'openBtn', 'sampleBtn',
  'fileInput', 'fileName',
];
assertRequiredIds([...REQUIRED_EDITOR_IDS, ...STANDALONE_IDS]);

setHost(standaloneHost);   // the textarea end of the pipe; must precede any apply()
wireBreakpointSwitch();
wireDialectChip();
wireSourcePane();
wireFileIo();
wireKeyboard();
wireCanvasBackground();
wireDragSurface();

apply(SAMPLE, { keepSel: false });

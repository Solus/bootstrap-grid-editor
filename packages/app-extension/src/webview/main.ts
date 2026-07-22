/* Webview entry: the shared editor running inside the VS Code webview.

   Mirrors app-standalone's main, but the "source in / edits out" ends are the
   postMessage bridge instead of the textarea. No source pane, no file-io —
   the editor document is the source. */

import '@bootstrap-visualizer/editor/styles.css';
import {
  apply, setHost, wireBreakpointSwitch, wireCanvasBackground, wireKeyboard,
} from '@bootstrap-visualizer/editor';
import { createWebviewHost } from './webview-host.js';
import type { HostMessage, WebviewMessage } from '../shared/protocol.js';

interface VsCodeApi {
  postMessage(msg: WebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const post = (m: WebviewMessage) => vscode.postMessage(m);

setHost(createWebviewHost(post));
wireBreakpointSwitch();
wireKeyboard();
wireCanvasBackground();

window.addEventListener('message', (e: MessageEvent<HostMessage>) => {
  const msg = e.data;
  if (msg.type === 'setSource') {
    // fromSource: this is the document arriving, not a canvas edit
    apply(msg.text, { keepSel: false, fromSource: true });
  }
});

post({ type: 'ready' });

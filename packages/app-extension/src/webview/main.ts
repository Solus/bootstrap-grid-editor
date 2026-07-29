/* Webview entry: the shared editor running inside the VS Code webview.

   Mirrors app-standalone's main, but the "source in / edits out" ends are the
   postMessage bridge instead of the textarea, and undo/redo is the editor's
   native undo (decision §6) — so keyboard is nav-only. */

import '@bootstrap-visualizer/editor/styles.css';
import {
  apply, applyOpenConfig, assertRequiredIds, REQUIRED_EDITOR_IDS, selectAtOffset,
  setHost, toast, wireBreakpointSwitch, wireCanvasBackground, wireDragSurface,
  wireKeyboardNav,
} from '@bootstrap-visualizer/editor';
import { createWebviewHost, type SyncState } from './webview-host.js';
import type { HostMessage, WebviewMessage } from '../shared/protocol.js';

// #resyncBtn is the webview's only extra element beyond the shared editor set
assertRequiredIds([...REQUIRED_EDITOR_IDS, 'resyncBtn']);

interface VsCodeApi {
  postMessage(msg: WebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const post = (m: WebviewMessage) => vscode.postMessage(m);
const sync: SyncState = { version: -1, diverged: false };
let firstEdit = true;   // show the "save to persist" cue once per session

setHost(createWebviewHost(post, sync));
wireBreakpointSwitch();
wireKeyboardNav();          // no undo/redo — that's the editor's native undo
wireCanvasBackground();
wireDragSurface();

document.getElementById('resyncBtn')
  ?.addEventListener('click', () => post({ type: 'discard' }));

window.addEventListener('message', (e: MessageEvent<HostMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'config':
      // arrives once, before the first setSource → seeds the canvas defaults
      applyOpenConfig(msg.config);
      break;
    case 'setSource':
      sync.version = msg.version;
      sync.diverged = false;
      document.body.classList.remove('diverged');
      // fromSource: this is the document arriving, not a canvas edit. A live-sync
      // refresh sets keepSelection so the canvas holds its selection where the
      // path still resolves (apply nulls it only if it no longer does).
      apply(msg.text, { keepSel: msg.keepSelection ?? false, fromSource: true });
      break;
    case 'applied':
      sync.version = msg.version;   // our edit landed; stay in step
      if (firstEdit) {              // gentle one-time reminder that it's unsaved
        firstEdit = false;
        toast('Applied to the editor — press Ctrl+S to save');
      }
      break;
    case 'diverged':
      sync.diverged = true;
      document.body.classList.add('diverged');
      toast('Editor changed — Resync to update the canvas', 'warn');
      break;
    case 'selectAt':
      selectAtOffset(msg.offset);   // editor caret → canvas (no reveal back)
      break;
  }
});

post({ type: 'ready' });

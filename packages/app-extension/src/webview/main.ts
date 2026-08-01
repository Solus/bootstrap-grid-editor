/* Webview entry: the shared editor running inside the VS Code webview.

   Mirrors app-standalone's main, but the "source in / edits out" ends are the
   postMessage bridge instead of the textarea, and undo/redo is the editor's
   native undo (decision §6) — so keyboard is nav-only. */

import '@bootstrap-visualizer/editor/styles.css';
import {
  apply, applyOpenConfig, assertRequiredIds, readClassConvention, REQUIRED_EDITOR_IDS,
  renderInspector, selectAtOffset, setHost, toast, wireBreakpointSwitch,
  wireCanvasBackground, wireDragSurface, wireKeyboardNav,
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
const sync: SyncState = { diverged: false };
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
    case 'classConvention':
      // the user edited the convention in settings while the panel was open —
      // only that, so nothing else they've changed on the canvas is disturbed
      readClassConvention(msg.config);
      renderInspector();
      break;
    case 'setSource':
      sync.diverged = false;
      document.body.classList.remove('diverged');
      // fromSource: this is the document arriving, not a canvas edit. A live-sync
      // refresh sets keepSelection so the canvas holds its selection where the
      // path still resolves (apply nulls it only if it no longer does).
      apply(msg.text, { keepSel: msg.keepSelection ?? false, fromSource: true });
      // A resync the user should know about (an edit that didn't land) says so
      // *after* the canvas is showing the buffer again, so the message and what
      // they're looking at agree. A silent refresh carries no notice.
      if (msg.notice) toast(msg.notice, 'warn');
      break;
    case 'applied':
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

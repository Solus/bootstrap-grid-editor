/* The standalone source pane's highlight band and caret→canvas reverse-sync
   — the textarea-specific "reveal" behind the host's revealSource. None of
   this exists in the extension, where the editor is the source pane. */

import type { El } from '@bootstrap-visualizer/core';
import { $, resolvePath, selectAtOffset, state } from '@bootstrap-visualizer/editor';
import { srcTA } from './dom.js';

const LINE_H = 20, PAD_TOP = 10;

export function highlightInSource(el: El): void {
  // No focus steal: an unfocused textarea still renders the selection
  // (inactive gray) and scrolls — keyboard focus stays on the canvas
  // so arrow-key navigation keeps working after a click.
  srcTA.setSelectionRange(el.start, Math.min(el.openEnd, el.end));
  const startLine = state.src.slice(0, el.start).split('\n').length - 1;
  const endLine = state.src.slice(0, el.end).split('\n').length - 1;
  srcTA.scrollTop = Math.max(0, startLine * LINE_H - srcTA.clientHeight / 2);
  state._bandLines = [startLine, endLine];
  positionBand();
}

export function positionBand(): void {
  const band = $('#srcBand');
  if (!state._bandLines || !state.sel || state.dirty) {
    $('#srcWrap').classList.remove('src-band-on');
    return;
  }
  const [a, b] = state._bandLines;
  const top = PAD_TOP + a * LINE_H - srcTA.scrollTop;
  band.style.top = top + 'px';
  band.style.height = ((b - a + 1) * LINE_H) + 'px';
  $('#srcWrap').classList.add('src-band-on');
}

/* Reverse selection sync: caret in the source textarea → canvas block. The
   shared selectAtOffset does the selection (no reveal — the caret stays put);
   we add the source-band on top. */
export function syncSelFromCaret(): void {
  if (state.dirty) return;                      // offsets map to canvas state only
  if (!selectAtOffset(srcTA.selectionStart)) return;
  const node = state.sel && resolvePath(state.sel.path);
  if (node) {                                   // band only; don't move the caret
    const sl = state.src.slice(0, node.el.start).split('\n').length - 1;
    const el2 = state.src.slice(0, node.el.end).split('\n').length - 1;
    state._bandLines = [sl, el2];
    positionBand();
  }
}

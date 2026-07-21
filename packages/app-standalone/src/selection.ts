/* Selection, the source-pane highlight band, and the reverse sync that
   maps a caret position in the source back to a canvas block. */

import { nodeAtOffset } from '@bootstrap-visualizer/core';
import type { El } from '@bootstrap-visualizer/core';
import { $, rowsHost, srcTA } from './dom.js';
import { resolvePath, state, type Selection } from './state.js';
import { render } from './render.js';
import { expandAncestors } from './find.js';

export function select(sel: Selection): void {
  state.sel = sel;
  render();
  const node = resolvePath(sel.path);
  if (node) highlightInSource(node.el);
}

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

/* ── reverse selection sync: caret in source → canvas block ──────── */

export function syncSelFromCaret(): void {
  if (state.dirty) return;                      // offsets map to canvas state only
  const hit = nodeAtOffset(state.model, srcTA.selectionStart);
  if (!hit) return;                             // caret outside any grid element
  if (state.sel && state.sel.kind === hit.kind &&
      state.sel.path.join(',') === hit.path.join(',')) return;
  expandAncestors(hit.path);
  state.sel = hit;
  render();                                     // no select(): keep caret untouched
  const node = resolvePath(hit.path);
  if (node) {                                   // band only; don't move the caret
    const sl = state.src.slice(0, node.el.start).split('\n').length - 1;
    const el2 = state.src.slice(0, node.el.end).split('\n').length - 1;
    state._bandLines = [sl, el2];
    positionBand();
  }
  const el = rowsHost.querySelector('[data-path="' + hit.path.join(',') + '"]');
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

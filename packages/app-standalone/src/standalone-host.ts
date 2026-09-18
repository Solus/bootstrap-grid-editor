/* The standalone frontend's host adapter — the textarea end of the pipe.

   Source in: the textarea (Apply / file load / sample) calls the engine's
   `apply(..., {fromSource:true})`. Edits out: nothing leaves the page, so
   `commit` just syncs the textarea to the applied source and clears the
   dirty state. The guard is "textarea edited but not Applied". */

import type { Edit, El } from '@bootstrap-visualizer/core';
import { $, DIRTY_MSG, state, type Host } from '@bootstrap-visualizer/editor';
import { srcTA } from './dom.js';
import { highlightInSource, positionBand } from './source-band.js';

/** Shown when the canvas has nothing to draw. Names this frontend's own ways
    in: the source pane, the header's sample. */
const EMPTY_CANVAS_HINT =
  'Paste an Angular/Bootstrap template on the left and press <b>Apply changes</b>,<br>' +
  'or hit <b>Load sample</b> in the header.';

export const standaloneHost: Host = {
  canApplyEdit() {
    return state.dirty ? { ok: false, reason: DIRTY_MSG } : { ok: true };
  },

  commit(newSrc: string, _edits: Edit[] | null) {
    // No external target: the applied source *is* the document. Sync the
    // textarea to it and clear the unapplied-edits state.
    srcTA.value = newSrc;
    state.dirty = false;
    $('#srcPane').classList.remove('src-dirty');
    $<HTMLButtonElement>('#revertBtn').disabled = true;
  },

  revealSource(el: El | null) {
    if (el) highlightInSource(el);
    else { state._bandLines = null; positionBand(); }
  },

  emptyCanvasHint() { return EMPTY_CANVAS_HINT; },
};

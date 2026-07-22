/* The standalone frontend's host adapter — the textarea end of the pipe.

   Source in: the textarea (Apply / file load / sample) calls the engine's
   `apply(..., {fromSource:true})`. Edits out: nothing leaves the page, so
   `commit` just syncs the textarea to the applied source and clears the
   dirty state. The guard is "textarea edited but not Applied". */

import type { Edit, El } from '@bootstrap-visualizer/core';
import { $, srcTA } from './dom.js';
import { DIRTY_MSG, state, type Host } from './state.js';
import { highlightInSource, positionBand } from './source-band.js';

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
};

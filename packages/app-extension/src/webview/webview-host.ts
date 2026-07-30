/* The extension webview's host adapter — the postMessage end of the pipe.

   Source in: `setSource` from the host → apply(fromSource). Edits out: a
   canvas edit → commit → post `applyEdits`; the host decides whether the
   buffer still matches what the canvas computed against, and replays it.
   Reveal out: a selection → post `reveal`. Guard: refuse canvas edits once
   the host says the buffer diverged (the user edited the editor), until a
   save or discard resyncs. */

import type { Edit, El } from '@bootstrap-visualizer/core';
import type { Host } from '@bootstrap-visualizer/editor';
import type { WebviewMessage } from '../shared/protocol.js';

/** Mutable sync state shared with the message loop in main.ts. */
export interface SyncState {
  /** The editor changed under the canvas; canvas edits are held. */
  diverged: boolean;
}

const DIVERGED_REASON =
  'The editor changed under the canvas — save it, or Discard, to resync.';

export function createWebviewHost(
  post: (m: WebviewMessage) => void, sync: SyncState,
): Host {
  return {
    canApplyEdit() {
      return sync.diverged ? { ok: false, reason: DIVERGED_REASON } : { ok: true };
    },

    commit(_newSrc: string, edits: Edit[] | null) {
      // Only canvas edits (edits != null) leave; a full-document replace comes
      // from setSource itself, not from the canvas.
      if (!edits) return;
      post({ type: 'applyEdits', edits });
    },

    revealSource(el: El | null) {
      if (el) post({ type: 'reveal', start: el.start, end: el.end });
    },

    persistViewPref(pref, value) {
      post({ type: 'setConfig', pref, value });
    },
  };
}

/* The extension webview's host adapter — the postMessage end of the pipe.

   First slice: read-only. The canvas renders the active document and a canvas
   selection reveals the element in the editor (revealSource → post 'reveal').
   Canvas *edits* are refused for now — applying them to the buffer, plus the
   undo/redo model, is the next slice (a deliberate decision, FOLLOW-UPS
   §1.2-adjacent). So canApplyEdit says no and commit never fires. */

import type { Edit, El } from '@bootstrap-visualizer/core';
import type { Host } from '@bootstrap-visualizer/editor';
import type { WebviewMessage } from '../shared/protocol.js';

const READ_ONLY_REASON = 'Editing from the canvas is coming in the next step.';

export function createWebviewHost(post: (m: WebviewMessage) => void): Host {
  return {
    canApplyEdit() {
      return { ok: false, reason: READ_ONLY_REASON };
    },

    commit(_newSrc: string, _edits: Edit[] | null) {
      // Unreachable while canApplyEdit refuses; the edits-out path lands in
      // the next slice (post { type: 'applyEdits', … }).
    },

    revealSource(el: El | null) {
      if (el) post({ type: 'reveal', start: el.start, end: el.end });
    },
  };
}

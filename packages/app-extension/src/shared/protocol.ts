/* The message contract between the extension host (Node) and the webview
   (browser). Imported by both sides so the shapes stay in step.

   Only the two ends of the pipe cross this boundary: source in (host →
   webview) and edits / reveal out (webview → host). Everything else is the
   shared editor running inside the webview. */

import type { Edit } from '@bootstrap-visualizer/core';

/** Host → webview. */
export type HostMessage =
  /** Full document text — sent on open, and on save (the canvas refreshes
      from source on save). `version` is the document version this reflects;
      the webview keeps it to stamp its outgoing edits. Clears divergence. */
  | { type: 'setSource'; text: string; version: number }
  /** A canvas edit was applied to the buffer; the document is now at
      `version`. Lets the webview advance its synced version without a
      re-render (it already has the edited source locally). */
  | { type: 'applied'; version: number }
  /** The document changed underneath the canvas (the user edited the editor).
      The webview guards further canvas edits until a save or a discard. */
  | { type: 'diverged' }
  /** The editor caret moved to `offset` — select the matching canvas block
      (reverse of reveal). */
  | { type: 'selectAt'; offset: number };

/** Webview → host. */
export type WebviewMessage =
  /** The webview has loaded and is ready to receive the first setSource. */
  | { type: 'ready' }
  /** Apply a canvas edit to the editor document as minimal workspace edits.
      `baseVersion` is the document version the edits were computed against,
      so the host can guard-and-warn if the buffer has since diverged. */
  | { type: 'applyEdits'; edits: Edit[]; baseVersion: number }
  /** Reveal an element's source span in the editor (the revealSource end). */
  | { type: 'reveal'; start: number; end: number }
  /** Reset the canvas to the current buffer (discard divergence). */
  | { type: 'discard' };

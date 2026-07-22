/* The message contract between the extension host (Node) and the webview
   (browser). Imported by both sides so the shapes stay in step.

   Only the two ends of the pipe cross this boundary: source in (host →
   webview) and edits/reveal out (webview → host). Everything else is the
   shared editor running inside the webview. */

import type { Edit } from '@bootstrap-visualizer/core';

/** Host → webview. */
export type HostMessage =
  /** Full document text — sent on open and whenever the saved source
      changes (the canvas refreshes from source on save). `version` lets the
      webview detect divergence for its edit guard. */
  | { type: 'setSource'; text: string; version: number };

/** Webview → host. */
export type WebviewMessage =
  /** The webview has loaded and is ready to receive the first setSource. */
  | { type: 'ready' }
  /** Apply a canvas edit to the editor document as minimal workspace edits.
      `baseVersion` is the document version the edits were computed against,
      so the host can guard-and-warn if the buffer has since diverged. */
  | { type: 'applyEdits'; edits: Edit[]; baseVersion: number }
  /** Reveal an element's source span in the editor (the revealSource end). */
  | { type: 'reveal'; start: number; end: number };

/* The message contract between the extension host (Node) and the webview
   (browser). Imported by both sides so the shapes stay in step.

   Only the two ends of the pipe cross this boundary: source in (host →
   webview) and edits / reveal out (webview → host). Everything else is the
   shared editor running inside the webview. */

import type { Breakpoint, Edit } from '@bootstrap-visualizer/core';

/** The user's settings the host seeds the canvas with at open. Wire form of
    the editor's OpenConfig (kept here so `shared`/`host` don't import the DOM
    editor package). */
export interface ConfigWire {
  breakpoint?: Breakpoint;
  stretchSheet?: boolean;
  tintOverfull?: boolean;
  dialect?: 'bootstrap5' | 'bootstrap3';
  /** Host-side behaviour (not a webview render setting): when true, an external
      editor edit refreshes the canvas after a short debounce instead of parking
      it until save. Read by the `Session`, not the webview. */
  liveSync?: boolean;
}

/** Host → webview. */
export type HostMessage =
  /** The user's settings, sent once before the first setSource so the canvas
      opens with them applied. */
  | { type: 'config'; config: ConfigWire }
  /** Full document text — sent on open, on save, and (with liveSync) on a
      debounced external edit. `version` is the document version this reflects;
      the webview keeps it to stamp its outgoing edits. Clears divergence.
      `keepSelection` (live-sync refreshes only) tells the canvas to keep its
      selection where the path still resolves instead of clearing it. */
  | { type: 'setSource'; text: string; version: number; keepSelection?: boolean }
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
  | { type: 'discard' }
  /** The user flipped a sticky view toggle (stretch/tint) in the canvas —
      write it back to their settings so it's remembered. */
  | { type: 'setConfig'; pref: 'stretchSheet' | 'tintOverfull'; value: boolean };

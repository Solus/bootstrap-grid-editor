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
      debounced external edit. Clears divergence. `keepSelection` (live-sync
      refreshes only) tells the canvas to keep its selection where the path
      still resolves instead of clearing it. */
  | { type: 'setSource'; text: string; keepSelection?: boolean }
  /** A canvas edit reached the buffer. The webview already has the edited
      source locally, so this is only a confirmation (it drives the one-time
      "press Ctrl+S" cue) — the host tracks what's in sync, not the webview. */
  | { type: 'applied' }
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
      The host decides whether it's safe (it holds the text the canvas is in
      sync with) and guard-and-warns if the buffer has since diverged; each
      edit also carries the text it expects at its span. */
  | { type: 'applyEdits'; edits: Edit[] }
  /** Reveal an element's source span in the editor (the revealSource end). */
  | { type: 'reveal'; start: number; end: number }
  /** Reset the canvas to the current buffer (discard divergence). */
  | { type: 'discard' }
  /** The user flipped a sticky view toggle (stretch/tint) in the canvas —
      write it back to their settings so it's remembered. */
  | { type: 'setConfig'; pref: 'stretchSheet' | 'tintOverfull'; value: boolean };

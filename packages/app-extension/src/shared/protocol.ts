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
  /** Extra classes every row / column the canvas *creates* carries, on top of
      the grid classes it computes (e.g. `clearfix`). */
  newRowClasses?: string;
  newColumnClasses?: string;
  /** Host-side behaviour (not a webview render setting): when true (the shipped
      default), an external editor edit refreshes the canvas after a short
      debounce instead of parking it until save. Read by the `Session`, not the
      webview. */
  liveSync?: boolean;
}

/** Host → webview. */
export type HostMessage =
  /** The user's settings, sent once before the first setSource so the canvas
      opens with them applied. */
  | { type: 'config'; config: ConfigWire }
  /** A setting the canvas follows all session — the class convention or the
      Bootstrap version — changed in the user's settings while the panel was
      open. Deliberately *not* a second `config`: re-seeding the whole open
      config would yank the breakpoint and view toggles back from under someone
      who has changed them on the canvas since. */
  | { type: 'liveSettings'; config: ConfigWire }
  /** Full document text — sent on open, on save, on a debounced external
      edit, and whenever the canvas has to be pulled back to the buffer (a
      refused edit, or a buffer that settled differently from what the canvas
      predicted). Clears divergence. `keepSelection` tells the canvas to keep
      its selection where the path still resolves instead of clearing it;
      `notice` is a message to toast once the new source is in, for a resync
      the user should know about (an edit that didn't land). A silent resync
      leaves it unset. */
  | { type: 'setSource'; text: string; keepSelection?: boolean; notice?: string }
  /** A canvas edit reached the buffer *and* the buffer settled on exactly the
      text those edits describe, so this is only a confirmation (it drives the
      one-time "press Ctrl+S" cue). When the buffer settled on something else —
      a formatter or another extension rewrote it alongside our edit — the host
      sends `setSource` instead, so the canvas can never drift from the file. */
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
  /** The user changed a sticky setting in the canvas (a view toggle, or the
      class convention) — write it back to their settings so it's
      remembered. */
  | { type: 'setConfig'; change: PrefChange };

/** A setting the canvas can write back. Structurally the editor package's
    `PrefChange`; redeclared here because `shared`/`host` must not import the
    DOM editor package (same reason `ConfigWire` mirrors `OpenConfig`). */
export type PrefChange =
  | { pref: 'stretchSheet' | 'tintOverfull'; value: boolean }
  | { pref: 'newRowClasses' | 'newColumnClasses'; value: string }
  | { pref: 'dialect'; value: 'bootstrap5' | 'bootstrap3' };

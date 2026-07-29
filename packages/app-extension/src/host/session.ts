/* The extension's sync controller — the host↔webview logic, extracted from
   the VS Code wiring so it can be unit-tested without an editor.

   extension.ts supplies the ports (post a message, reveal a range, apply an
   edit, read the document) and translates VS Code events into these method
   calls. All the state and decisions live here.

   Sync model (PLAN.md §3/§6): the editor document is the source of truth. The
   canvas renders it; canvas edits apply to the buffer as workspace edits. On
   save the canvas refreshes. If the user edits the document under the canvas,
   the webview is told it diverged. */

import type { Edit } from '@bootstrap-visualizer/core';
import type { ConfigWire, HostMessage, WebviewMessage } from '../shared/protocol.js';

/** Everything the session needs from its VS Code environment. */
export interface SessionPorts {
  post(msg: HostMessage): void;
  reveal(start: number, end: number): void;
  /** Apply the edits to the buffer; resolves true on success. */
  applyEdit(edits: Edit[]): Promise<boolean>;
  docText(): string;
  docVersion(): number;
  warn(message: string): void;
  /** The user's settings to seed the canvas with at open. */
  config(): ConfigWire;
  /** Persist a sticky view toggle the user flipped in the canvas. */
  setConfig(pref: 'stretchSheet' | 'tintOverfull', value: boolean): void;
}

export const OUT_OF_SYNC =
  'The canvas is out of sync with the editor — Resync (or save) first.';
export const APPLY_FAILED = 'Could not apply the canvas edit.';

export class Session {
  /** Our own buffer edits must not read as user divergence. */
  private applying = false;
  /** The span the canvas last asked us to reveal. Setting the editor
      selection to it echoes a selection change; that echo must not bounce
      back as a caret move (the caret lands on the element's exclusive end,
      which resolves to the parent — the row-instead-of-column bug). */
  private revealed: { start: number; end: number } | null = null;
  /** Serializes message handling. `onDidReceiveMessage` in extension.ts is
      fire-and-forget — VS Code doesn't wait for one message's handler to
      finish before delivering the next. Without this queue, two canvas
      edits fired back-to-back (e.g. clicking "Add column" twice, or two
      drags) would both start `applyCanvasEdits` concurrently: the second's
      `baseVersion` (the webview bumps it optimistically per edit) would be
      checked against `docVersion()` before the first edit's `await
      ports.applyEdit(...)` actually landed, so it looked stale and got
      refused as "diverged" — issue #1. Chaining through this queue makes
      each message wait for the previous one's full effect (including the
      buffer write) before the next is handled. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly ports: SessionPorts) {}

  /** The editor document changed (not via our own apply → divergence). */
  onDocChange(): void {
    if (this.applying) return;
    this.ports.post({ type: 'diverged' });
  }

  /** The document was saved → refresh the canvas from source. */
  onSave(): void {
    this.sendSource();
  }

  /** Re-point at the bound document (which a reused panel may have just
      swapped for a different one): drop transient sync state and resend the
      source, so the canvas shows the new file cleanly. */
  reload(): void {
    this.applying = false;
    this.revealed = null;
    this.sendSource();
  }

  /** The editor selection moved to these offsets (start/end of the range and
      the active caret). */
  onEditorSelection(start: number, end: number, active: number): void {
    // Applying a canvas edit (e.g. a column move) shifts the buffer and nudges
    // the editor caret, which fires this event. That's our own side effect,
    // not the user moving the caret — ignore it, or it would bounce back as a
    // selectAt and deselect what the canvas just acted on.
    if (this.applying) return;
    if (this.revealed && this.revealed.start === start && this.revealed.end === end) {
      this.revealed = null;       // swallow the echo of our own reveal
      return;
    }
    this.ports.post({ type: 'selectAt', offset: active });
  }

  /** Queue this message behind any still-in-flight ones (see `queue`), then
      handle it. Returns the settled handling promise, not the queue chain
      itself, so a later caller awaiting a specific message doesn't hang on
      whatever comes after it — and one message's failure never wedges the
      queue for the rest. */
  onMessage(msg: WebviewMessage): Promise<void> {
    const turn = this.queue.then(() => this.handle(msg));
    this.queue = turn.then(() => undefined, () => undefined);
    return turn;
  }

  private async handle(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        // config first, so the canvas applies the user's settings before it
        // renders the first source
        this.ports.post({ type: 'config', config: this.ports.config() });
        this.sendSource();
        break;
      case 'setConfig':
        this.ports.setConfig(msg.pref, msg.value);
        break;
      case 'reveal':
        this.revealed = { start: msg.start, end: msg.end };
        this.ports.reveal(msg.start, msg.end);
        break;
      case 'discard':
        this.sendSource();          // reset the canvas to the buffer
        break;
      case 'applyEdits':
        await this.applyCanvasEdits(msg.edits, msg.baseVersion);
        break;
    }
  }

  private sendSource(): void {
    this.ports.post({
      type: 'setSource',
      text: this.ports.docText(),
      version: this.ports.docVersion(),
    });
  }

  private async applyCanvasEdits(edits: Edit[], baseVersion: number): Promise<void> {
    if (baseVersion !== this.ports.docVersion()) {
      this.ports.post({ type: 'diverged' });
      this.ports.warn(OUT_OF_SYNC);
      return;
    }
    // Guard against a silent offset desync: even at the right version, applying
    // by raw offset corrupts the file if the buffer no longer matches what the
    // canvas computed the edit against. Each edit carries the text it expects at
    // its span plus a little context on each side; if any doesn't match, refuse
    // the batch and resync rather than splice into the wrong place. The context
    // is what catches a misplaced *insertion* (empty `old` matches anywhere).
    const text = this.ports.docText();
    const misplaced = edits.some(e =>
      (e.old != null && text.substring(e.start, e.end) !== e.old) ||
      (e.before != null && text.substring(e.start - e.before.length, e.start) !== e.before) ||
      (e.after != null && text.substring(e.end, e.end + e.after.length) !== e.after));
    if (misplaced) {
      this.ports.post({ type: 'diverged' });
      this.ports.warn(OUT_OF_SYNC);
      return;
    }
    this.applying = true;
    try {
      const ok = await this.ports.applyEdit(edits);
      if (ok) this.ports.post({ type: 'applied', version: this.ports.docVersion() });
      else { this.ports.warn(APPLY_FAILED); this.sendSource(); }
    } finally {
      this.applying = false;
    }
  }
}

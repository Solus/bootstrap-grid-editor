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
    if (this.revealed && this.revealed.start === start && this.revealed.end === end) {
      this.revealed = null;       // swallow the echo of our own reveal
      return;
    }
    this.ports.post({ type: 'selectAt', offset: active });
  }

  async onMessage(msg: WebviewMessage): Promise<void> {
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

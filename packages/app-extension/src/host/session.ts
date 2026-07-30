/* The extension's sync controller — the host↔webview logic, extracted from
   the VS Code wiring so it can be unit-tested without an editor.

   extension.ts supplies the ports (post a message, reveal a range, apply an
   edit, read the document) and translates VS Code events into these method
   calls. All the state and decisions live here.

   Sync model (PLAN.md §3/§6): the editor document is the source of truth. The
   canvas renders it; canvas edits apply to the buffer as workspace edits. On
   save the canvas refreshes. If the user edits the document under the canvas,
   the webview is told it diverged — unless the `liveSync` setting is on, in
   which case the canvas instead refreshes from the (dirty) buffer after a short
   debounce (see `onDocChange`).

   "In sync" is decided by *content*, not by `doc.version` (see `syncedText`).
   Versions only count that something happened, never what: they can't tell our
   own write from the user's, they never come back down when an edit is undone,
   and advancing one in step with VS Code means guessing how many it bumps per
   `applyEdit` — a guess that was wrong for multi-edit batches (a column drag)
   and refused the next canvas edit as a false divergence. Comparing the buffer
   to the text the canvas last agreed with answers the actual question. */

import type { Edit } from '@bootstrap-visualizer/core';
import type { ConfigWire, HostMessage, WebviewMessage } from '../shared/protocol.js';

/** Everything the session needs from its VS Code environment. */
export interface SessionPorts {
  post(msg: HostMessage): void;
  reveal(start: number, end: number): void;
  /** Apply the edits to the buffer; resolves true on success. */
  applyEdit(edits: Edit[]): Promise<boolean>;
  docText(): string;
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
  /** The buffer text the canvas is known to agree with — set every time we
      send the source, and re-read from the buffer after each canvas edit
      lands. Anything else in the buffer means the user changed it under us.
      `null` until the first send (nothing to compare against yet). */
  private syncedText: string | null = null;
  /** Serializes message handling. `onDidReceiveMessage` in extension.ts is
      fire-and-forget — VS Code doesn't wait for one message's handler to
      finish before delivering the next. Without this queue, two canvas
      edits fired back-to-back (e.g. clicking "Add column" twice, or two
      drags) would both start `applyCanvasEdits` concurrently, and the second
      would read the buffer before the first's `await ports.applyEdit(...)`
      landed — so it looked out of sync and got refused (issue #1). Chaining
      through this queue makes each message wait for the previous one's full
      effect (including the buffer write) before the next is handled. */
  private queue: Promise<void> = Promise.resolve();
  /** Whether the canvas is currently known to be diverged from the buffer.
      Tracked so we post `diverged` only on the false→true edge: the editor
      fires a change per keystroke, and re-posting on each one made the webview
      re-toast "Resync" on every character typed (the "asks too often"
      friction). Cleared whenever we resend the source (save / discard / reload
      / failed-apply), which is exactly when the webview drops its own diverged
      state. */
  private diverged = false;
  /** Pending debounced live-sync refresh (see `onDocChange`). */
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  /** How long after the last keystroke a live-sync refresh fires. */
  private static readonly LIVE_DEBOUNCE = 400;

  constructor(private readonly ports: SessionPorts) {}

  /** The editor document changed. Only a change that leaves the buffer holding
      text the canvas hasn't seen is a divergence.

      Two behaviours, chosen by the `liveSync` setting (read live so toggling it
      takes effect without reopening):
      - off (default): park the canvas — mark it diverged and let the user save
        or Resync. Safe and quiet, but blocks canvas edits meanwhile.
      - on: keep the canvas following the editor — debounce, then resend the
        (possibly dirty) source so the canvas refreshes. The tolerant parser and
        `apply()`'s last-good-view guard keep a half-typed buffer from breaking
        the canvas, and the edit context guards still refuse a canvas edit that
        races an un-synced change. */
  onDocChange(): void {
    // Mid-apply the buffer passes through intermediate states (VS Code can fire
    // a change per text edit in one batch) — those aren't ours to react to; the
    // apply itself records the settled text.
    if (this.applying) return;
    if (this.ports.docText() === this.syncedText) {
      // The buffer holds exactly what the canvas has: our own write, or a user
      // edit typed and undone back to the same text. Not a divergence — and if
      // we'd already parked, un-park by resending (identical) source, which is
      // what clears the webview's warning.
      if (this.diverged) this.sendSource(true);
      return;
    }
    if (this.ports.config().liveSync) { this.scheduleLiveResync(); return; }
    this.markDiverged();
  }

  /** Debounce a live-sync refresh, collapsing a typing burst into one resend. */
  private scheduleLiveResync(): void {
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => {
      this.liveTimer = null;
      // A canvas edit is mid-flight — its own apply keeps things in step; retry
      // after it lands so the refresh reflects the final buffer.
      if (this.applying) { this.scheduleLiveResync(); return; }
      this.sendSource(true);   // refresh from the buffer, keeping the selection
    }, Session.LIVE_DEBOUNCE);
  }

  /** Tell the webview it has diverged — but only once per divergence episode,
      so a burst of buffer changes doesn't spam the warning. */
  private markDiverged(): void {
    if (this.diverged) return;
    this.diverged = true;
    this.ports.post({ type: 'diverged' });
  }

  /** The document was saved → refresh the canvas from source, keeping the
      selection where its path still resolves (a save shouldn't cost you the
      column you had selected). */
  onSave(): void {
    this.sendSource(true);
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
        await this.applyCanvasEdits(msg.edits);
        break;
    }
  }

  /** Resend the buffer to the canvas — a full resync. `keepSelection` is set
      only by a live-sync refresh, so the canvas keeps its selection where the
      path still resolves; save / discard / reload / load leave it unset and the
      canvas starts fresh. */
  private sendSource(keepSelection = false): void {
    // Any immediate resend supersedes a pending live-sync one.
    if (this.liveTimer) { clearTimeout(this.liveTimer); this.liveTimer = null; }
    // Resending the source is exactly a resync: the webview clears its diverged
    // state on `setSource`, so clear ours in step — the next real buffer change
    // is then a fresh false→true edge that posts `diverged` again.
    this.diverged = false;
    const text = this.ports.docText();
    this.syncedText = text;      // this is now what the canvas agrees with
    this.ports.post(keepSelection
      ? { type: 'setSource', text, keepSelection: true }
      : { type: 'setSource', text });
  }

  /** Cancel any pending live-sync refresh (panel closing / re-pointing). */
  dispose(): void {
    if (this.liveTimer) { clearTimeout(this.liveTimer); this.liveTimer = null; }
  }

  private async applyCanvasEdits(edits: Edit[]): Promise<void> {
    const text = this.ports.docText();
    // The canvas computed these edits against the source it last agreed with;
    // if the buffer no longer holds exactly that, the user changed it underneath
    // and every offset here may be stale. (`syncedText` is null only before the
    // first send — nothing to compare against, so let the guards below decide.)
    if (this.syncedText != null && text !== this.syncedText) {
      this.markDiverged();
      this.ports.warn(OUT_OF_SYNC);
      return;
    }
    // Second line of defence against a silent offset desync: applying by raw
    // offset corrupts the file if the buffer doesn't match what the canvas
    // computed the edit against. Each edit carries the text it expects at its
    // span plus a little context on each side; if any doesn't match, refuse the
    // batch and resync rather than splice into the wrong place. The context is
    // what catches a misplaced *insertion* (empty `old` matches anywhere).
    const misplaced = edits.some(e =>
      (e.old != null && text.substring(e.start, e.end) !== e.old) ||
      (e.before != null && text.substring(e.start - e.before.length, e.start) !== e.before) ||
      (e.after != null && text.substring(e.end, e.end + e.after.length) !== e.after));
    if (misplaced) {
      this.markDiverged();
      this.ports.warn(OUT_OF_SYNC);
      return;
    }
    this.applying = true;
    try {
      const ok = await this.ports.applyEdit(edits);
      if (ok) {
        // Read the settled buffer back rather than assuming our edits produced
        // it — this is what the next canvas edit is checked against.
        this.syncedText = this.ports.docText();
        this.ports.post({ type: 'applied' });
      }
      else { this.ports.warn(APPLY_FAILED); this.sendSource(); }
    } finally {
      this.applying = false;
    }
  }
}

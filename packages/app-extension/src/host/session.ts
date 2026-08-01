/* The extension's sync controller — the host↔webview logic, extracted from
   the VS Code wiring so it can be unit-tested without an editor.

   extension.ts supplies the ports (post a message, reveal a range, apply an
   edit, read the document) and translates VS Code events into these method
   calls. All the state and decisions live here.

   Sync model (PLAN.md §3/§6): the editor document is the source of truth. The
   canvas renders it; canvas edits apply to the buffer as workspace edits. On
   save the canvas refreshes. If the user edits the document under the canvas
   the canvas follows it after a short debounce (`liveSync`, on by default) —
   with that setting off, the webview is told it diverged and parks instead
   (see `onDocChange`).

   "In sync" is decided by *content*, not by `doc.version` (see `syncedText`).
   Versions only count that something happened, never what: they can't tell our
   own write from the user's, they never come back down when an edit is undone,
   and advancing one in step with VS Code means guessing how many it bumps per
   `applyEdit` — a guess that was wrong for multi-edit batches (a column drag)
   and refused the next canvas edit as a false divergence. Comparing the buffer
   to the text the canvas last agreed with answers the actual question.

   Two invariants hold the seam together, and every method here exists to keep
   one of them true:
   1. **The canvas never shows what the file doesn't have.** Every path that
      ends without the canvas's edit in the buffer — refused, failed, or
      applied into a buffer that settled differently — pulls the canvas back
      to the buffer (`sendSource`). The webview applies its edit locally the
      moment it posts it, so anything less would leave a phantom on screen.
   2. **Everything that touches sync state is serialised** (`enqueue`), editor
      events included. Ordering is then a property of the controller rather
      than of how VS Code happens to interleave events with our own awaits. */

import { applyEdits } from '@bootstrap-visualizer/core/edits';
import type { Edit } from '@bootstrap-visualizer/core';
import type {
  ConfigWire, HostMessage, PrefChange, WebviewMessage,
} from '../shared/protocol.js';

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
  /** Persist a sticky setting the user changed in the canvas. */
  setConfig(change: PrefChange): void;
}

/** Shown on the canvas when an edit is refused. It names what happened to the
    edit (it didn't land) and what was done about it (the canvas now shows the
    file again) — the user's next action is simply to redo it, not to hunt for
    a Resync button. */
export const OUT_OF_SYNC =
  'That edit didn’t fit the file as it now reads — the canvas has been ' +
  'refreshed from the editor. Try it again.';
export const APPLY_FAILED = 'Could not apply the canvas edit.';

export class Session {
  /** How many canvas edits are mid-apply. A counter, not a flag: a second
      edit's `finally` must not clear the state while the first is still in
      flight (it would let our own buffer change read as user divergence).
      With `enqueue` serialising everything it stays 0 or 1 today, but the
      counter is what makes that a fact rather than an assumption. */
  private applyDepth = 0;
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
  /** Serializes everything that reads or writes sync state. `onDidReceiveMessage`
      in extension.ts is fire-and-forget — VS Code doesn't wait for one message's
      handler to finish before delivering the next. Without this queue, two canvas
      edits fired back-to-back (e.g. clicking "Add column" twice, two drags, or
      one key-repeat on the width stepper) would both start `applyCanvasEdits`
      concurrently, and the second would read the buffer before the first's
      `await ports.applyEdit(...)` landed — so it looked out of sync and got
      refused (issue #1).

      The editor-side events (`onSave`, `onDocChange`, the live-sync timer) go
      through the same queue, not just webview messages: a save landing while an
      apply is mid-flight used to resend a buffer that was about to change,
      racing the apply (FOLLOW-UPS §9.4). Queued, it simply runs after and sends
      the settled text. */
  private queue: Promise<void> = Promise.resolve();
  /** Whether the canvas is currently known to be diverged from the buffer.
      Tracked so we post `diverged` only on the false→true edge: the editor
      fires a change per keystroke, and re-posting on each one made the webview
      re-toast "Resync" on every character typed (the "asks too often"
      friction). Cleared whenever we resend the source (save / discard / reload
      / a refused or drifted edit), which is exactly when the webview drops its
      own diverged state. Only reachable with `liveSync` off — with it on, an
      external change refreshes the canvas instead of parking it. */
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
      - on (default): keep the canvas following the editor — debounce, then
        resend the (possibly dirty) source so the canvas refreshes. The canvas
        holds no unsaved state of its own — every canvas edit goes straight to
        the buffer — so following it can never cost the user work, and the
        editor's own undo stops parking the canvas every time. The tolerant
        parser and `apply()`'s last-good-view guard keep a half-typed buffer
        from breaking the canvas, and the edit guards still refuse a canvas
        edit that races an un-synced change.
      - off: park the canvas — mark it diverged and let the user save or
        Resync. Quieter while someone types under the canvas, at the cost of
        blocking canvas edits meanwhile.

      Like the other editor-event entry points, this returns the queued turn so
      a caller can wait for it (the tests do); extension.ts fires and forgets. */
  onDocChange(): Promise<void> {
    // Queued, so a change fired *during* our own apply (VS Code emits one per
    // text edit in a batch) is handled after that apply has recorded the
    // settled text — at which point it reads as ours and not as divergence.
    return this.enqueue(() => this.handleDocChange());
  }

  private handleDocChange(): void {
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

  /** Debounce a live-sync refresh, collapsing a typing burst into one resend.
      The resend is queued like everything else, so one landing on top of an
      in-flight canvas edit sends the settled buffer rather than racing it. */
  private scheduleLiveResync(): void {
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => {
      this.liveTimer = null;
      void this.enqueue(() => this.sendSource(true));   // keep the selection
    }, Session.LIVE_DEBOUNCE);
  }

  /** Tell the webview it has diverged — but only once per divergence episode,
      so a burst of buffer changes doesn't spam the warning. */
  private markDiverged(): void {
    if (this.diverged) return;
    this.diverged = true;
    this.ports.post({ type: 'diverged' });
  }

  /** The user's class convention changed in settings while the panel is open →
      push just that to the canvas. Not queued: it touches no sync state and no
      document text, so it has nothing to order against. */
  onClassConventionChange(): void {
    const { newRowClasses, newColumnClasses } = this.ports.config();
    this.ports.post({ type: 'classConvention', config: { newRowClasses, newColumnClasses } });
  }

  /** The document was saved → refresh the canvas from source, keeping the
      selection where its path still resolves (a save shouldn't cost you the
      column you had selected). */
  onSave(): Promise<void> {
    return this.enqueue(() => this.sendSource(true));
  }

  /** Re-point at the bound document (which a reused panel may have just
      swapped for a different one): drop transient sync state and resend the
      source, so the canvas shows the new file cleanly. Queued, so an edit
      still in flight against the previous document settles first. */
  reload(): Promise<void> {
    return this.enqueue(() => {
      this.revealed = null;
      this.sendSource();
    });
  }

  /** The editor selection moved to these offsets (start/end of the range and
      the active caret). */
  onEditorSelection(start: number, end: number, active: number): void {
    // Applying a canvas edit (e.g. a column move) shifts the buffer and nudges
    // the editor caret, which fires this event. That's our own side effect,
    // not the user moving the caret — ignore it, or it would bounce back as a
    // selectAt and deselect what the canvas just acted on.
    if (this.applyDepth > 0) return;
    if (this.revealed && this.revealed.start === start && this.revealed.end === end) {
      this.revealed = null;       // swallow the echo of our own reveal
      return;
    }
    this.ports.post({ type: 'selectAt', offset: active });
  }

  /** Queue this message behind any still-in-flight work (see `queue`), then
      handle it. Returns the settled handling promise, not the queue chain
      itself, so a later caller awaiting a specific message doesn't hang on
      whatever comes after it. */
  onMessage(msg: WebviewMessage): Promise<void> {
    return this.enqueue(() => this.handle(msg));
  }

  /** Run `turn` after everything already queued. The chain itself swallows
      failures, so one turn throwing never wedges the queue for the rest;
      the returned promise still rejects for whoever awaited that turn. */
  private enqueue(turn: () => void | Promise<void>): Promise<void> {
    const done = this.queue.then(turn);
    this.queue = done.then(() => undefined, () => undefined);
    return done;
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
        this.ports.setConfig(msg.change);
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
      by every resync that happens *under* the user (live refresh, save, a
      refused or drifted edit), so they don't lose the column they were working
      on; discard / reload / load leave it unset and the canvas starts fresh.
      `notice` is toasted on the canvas once the new source is in — set it for
      a resync the user needs to know about (their edit didn't land), leave it
      unset for one that just keeps the canvas honest. */
  private sendSource(keepSelection = false, notice?: string): void {
    // Any immediate resend supersedes a pending live-sync one.
    if (this.liveTimer) { clearTimeout(this.liveTimer); this.liveTimer = null; }
    // Resending the source is exactly a resync: the webview clears its diverged
    // state on `setSource`, so clear ours in step — the next real buffer change
    // is then a fresh false→true edge that posts `diverged` again.
    this.diverged = false;
    const text = this.ports.docText();
    this.syncedText = text;      // this is now what the canvas agrees with
    const msg: Extract<HostMessage, { type: 'setSource' }> = { type: 'setSource', text };
    if (keepSelection) msg.keepSelection = true;
    if (notice) msg.notice = notice;
    this.ports.post(msg);
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
      this.refuse();
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
      this.refuse();
      return;
    }
    // What the buffer should read once these edits land — the same batch
    // applied to the same base text, so this is exactly the source the canvas
    // now holds. Computed *before* the apply, while `text` is still the base.
    const predicted = applyEdits(text, edits);
    this.applyDepth++;
    try {
      const ok = await this.ports.applyEdit(edits);
      if (!ok) { this.ports.warn(APPLY_FAILED); this.sendSource(true); return; }
      // Read the settled buffer back rather than assuming our edits produced
      // it. If something else rewrote the document alongside our edit — a
      // formatter, auto-close-tag, another extension reacting to the
      // WorkspaceEdit — the buffer and the canvas now hold different text, and
      // every offset the canvas computes next is stale. That drift used to go
      // unnoticed until some later edit was refused by the `old`/context guard
      // (FOLLOW-UPS §7.5); catching it here keeps the two in step instead, with
      // nothing for the user to do.
      const settled = this.ports.docText();
      if (settled !== predicted) { this.sendSource(true); return; }
      this.syncedText = settled;
      this.ports.post({ type: 'applied' });
    } finally {
      this.applyDepth--;
    }
  }

  /** An edit that can't be applied safely: say so on the canvas and pull it
      back to the buffer. The webview has already applied that edit locally, so
      resending is what stops the canvas showing a change the file never got
      (invariant 1) — and it leaves the canvas editable again, rather than
      parked until the user finds Resync. */
  private refuse(): void {
    this.sendSource(true, OUT_OF_SYNC);
  }
}

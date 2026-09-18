import { afterEach, describe, expect, it, vi } from 'vitest';
import { APPLY_FAILED, OUT_OF_SYNC, Session } from './session.js';
import type { HostMessage } from '../shared/protocol.js';

/* A fake VS Code environment: records what the session posts / reveals / warns,
   and simulates the buffer. `applyEdit` really splices the edits into the text,
   so `docText()` afterwards is what a real buffer would hold — which is exactly
   what the session's in-sync check reads. `setText` stands for the user editing
   the document in the editor.

   `liveSync` defaults to **true**, matching the shipped setting default: an
   external change refreshes the canvas. The cases that exercise park-and-warn
   pass `liveSync: false` explicitly.

   Every editor-event entry point (`onSave`, `onDocChange`, `reload`) returns
   its queued turn, so these tests await it the same way they await a message.
   Nothing in Session runs synchronously with the event any more — that
   serialisation is the point (FOLLOW-UPS §9.4). */
function harness(opts: { text?: string; liveSync?: boolean } = {}) {
  const posts: HostMessage[] = [];
  const reveals: Array<[number, number]> = [];
  const warns: string[] = [];
  const configWrites: Array<[string, boolean | string]> = [];
  const histories: string[] = [];
  let text = opts.text ?? '<div class="row"><div class="col">x</div></div>';
  let onHistory: (() => void) | null = null;
  let applyOk = true;
  let applyCount = 0;
  let onApply: (() => void) | null = null;
  let throwNextPost = false;

  const session = new Session({
    post: m => {
      if (throwNextPost) { throwNextPost = false; throw new Error('post failed'); }
      posts.push(m);
    },
    reveal: (s, e) => reveals.push([s, e]),
    applyEdit: async edits => {
      // a real vscode.workspace.applyEdit() genuinely resolves asynchronously
      // (it round-trips through the editor) — the await here matters: it's what
      // lets a second, concurrently-dispatched message observe the *old* buffer
      // before this one lands (see the ordering describe block).
      await Promise.resolve();
      if (!applyOk) return false;
      applyCount++;
      // splice last span first so the earlier offsets stay valid
      text = [...edits].sort((a, b) => b.start - a.start)
        .reduce((t, e) => t.slice(0, e.start) + e.text + t.slice(e.end), text);
      onApply?.();       // the onDidChangeTextDocument our edit causes
      return true;
    },
    docText: () => text,
    warn: m => warns.push(m),
    config: () => ({ breakpoint: 'lg' as const, tintOverfull: true,
      liveSync: opts.liveSync ?? true }),
    setConfig: change => { configWrites.push([change.pref, change.value]); },
    history: async dir => {
      // the editor's undo runs in the renderer: the buffer change and the
      // caret move it causes arrive as events before the command resolves
      await Promise.resolve();
      histories.push(dir);
      onHistory?.();
    },
  });

  return {
    session, posts, reveals, warns, configWrites, histories,
    /** What the editor's undo does to the buffer (and the events it fires). */
    duringHistory: (fn: () => void) => { onHistory = fn; },
    /** The user edits the document in the editor. */
    setText: (t: string) => { text = t; },
    failNextApply: () => { applyOk = false; },
    throwOnNextPost: () => { throwNextPost = true; },
    duringApply: (fn: () => void) => { onApply = fn; },
    text: () => text,
    applyCount: () => applyCount,
    types: () => posts.map(p => p.type),
  };
}

afterEach(() => vi.useRealTimers());

describe('Session — source in', () => {
  it('ready sends config first, then the current document', async () => {
    const h = harness({ text: '<p>hi</p>' });
    await h.session.onMessage({ type: 'ready' });
    // config must precede setSource so the canvas seeds before its first render
    expect(h.posts).toEqual([
      { type: 'config', config: { breakpoint: 'lg', tintOverfull: true, liveSync: true } },
      { type: 'setSource', text: '<p>hi</p>' },
    ]);
  });

  it('setConfig routes a canvas view-toggle back to the host', async () => {
    const h = harness();
    await h.session.onMessage(
      { type: 'setConfig', change: { pref: 'stretchSheet', value: true } });
    expect(h.configWrites).toEqual([['stretchSheet', true]]);
  });

  it('save refreshes from source, keeping the selection', async () => {
    const h = harness();
    await h.session.onSave();
    // keepSelection: a save shouldn't drop the column you had selected
    expect(h.posts).toEqual([
      { type: 'setSource', text: expect.any(String), keepSelection: true },
    ]);
  });

  it('discard resets the canvas to the buffer', async () => {
    const h = harness();
    await h.session.onMessage({ type: 'discard' });
    expect(h.types()).toEqual(['setSource']);
  });
});

describe('Session — reveal / selection sync', () => {
  it('reveal asks the editor to reveal, without echoing a message', async () => {
    const h = harness();
    await h.session.onMessage({ type: 'reveal', start: 5, end: 20 });
    expect(h.reveals).toEqual([[5, 20]]);
    expect(h.posts).toHaveLength(0);
  });

  it('swallows the selection echo of its own reveal (the row-instead-of-column bug)', async () => {
    const h = harness();
    await h.session.onMessage({ type: 'reveal', start: 5, end: 20 });
    // the editor selection settles on exactly the revealed span
    h.session.onEditorSelection(5, 20, 20);
    expect(h.posts.some(p => p.type === 'selectAt')).toBe(false);
  });

  it('a real caret move (different span) selects the matching block', async () => {
    const h = harness();
    await h.session.onMessage({ type: 'reveal', start: 5, end: 20 });
    h.session.onEditorSelection(30, 30, 30);   // caret moved elsewhere
    expect(h.posts).toContainEqual({ type: 'selectAt', offset: 30 });
  });

  it('a caret move with no prior reveal selects', () => {
    const h = harness();
    h.session.onEditorSelection(12, 12, 12);
    expect(h.posts).toContainEqual({ type: 'selectAt', offset: 12 });
  });

  it('only the immediate echo is swallowed; a later identical selection is real', async () => {
    const h = harness();
    await h.session.onMessage({ type: 'reveal', start: 5, end: 20 });
    h.session.onEditorSelection(5, 20, 20);    // echo → swallowed
    h.session.onEditorSelection(5, 20, 20);    // user genuinely re-selects that span
    expect(h.posts.filter(p => p.type === 'selectAt')).toHaveLength(1);
  });
});

describe('Session — edits out', () => {
  it('applies a canvas edit and confirms', async () => {
    const h = harness({ text: 'ab' });
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    expect(h.posts).toContainEqual({ type: 'applied' });
    expect(h.text()).toBe('xab');
    expect(h.warns).toHaveLength(0);
  });

  it('applies when the edit still matches the buffer (old verified)', async () => {
    const h = harness({ text: '<div class="col">x</div>' });
    await h.session.onMessage({
      type: 'applyEdits',
      edits: [{ start: 12, end: 15, text: 'col-4', old: 'col' }],   // "col" is at 12..15
    });
    expect(h.posts).toContainEqual({ type: 'applied' });
    expect(h.warns).toHaveLength(0);
  });

  it('refuses an edit whose span no longer matches the buffer (anti-corruption)', async () => {
    // The offsets were computed against a different source: old says "col" while
    // the buffer holds col-sm-2 there. Splicing by raw offset would produce
    // broken HTML (e.g. class=col-sm-42"); refuse instead.
    const h = harness({ text: '<div class="col-sm-2">x</div>' });
    await h.session.onMessage({
      type: 'applyEdits',
      edits: [{ start: 11, end: 14, text: 'col-sm-4', old: 'col' }],
    });
    expect(h.applyCount()).toBe(0);              // nothing applied
    expect(h.posts.some(p => p.type === 'applied')).toBe(false);
    // and the canvas is pulled back to the buffer, told why: the webview
    // already applied that edit locally, so leaving it parked would leave a
    // change on screen the file never got
    expect(h.posts).toContainEqual({
      type: 'setSource', text: '<div class="col-sm-2">x</div>',
      keepSelection: true, notice: OUT_OF_SYNC,
    });
  });

  it('refuses a misplaced insertion via its context (anti-corruption)', async () => {
    // Add column is an insertion: start === end, old === '' (matches anywhere).
    // Its before/after context is what catches a drifted insertion point — here
    // the buffer no longer has the expected text around the offset, so applying
    // would splice a new column into the middle of a </div>. Refuse instead.
    const h = harness({ text: '<div class="row"><div class="col">x</div></div>' });
    await h.session.onMessage({
      type: 'applyEdits',
      edits: [{ start: 8, end: 8, text: '<new/>', before: '</div>', after: '\n  <div' }],
    });
    expect(h.applyCount()).toBe(0);              // nothing applied
    expect(h.posts.some(p => p.type === 'applied')).toBe(false);
    expect(h.posts).toContainEqual({
      type: 'setSource', text: '<div class="row"><div class="col">x</div></div>',
      keepSelection: true, notice: OUT_OF_SYNC,
    });
  });

  it('after a refusal the canvas is editable again — the next edit applies', async () => {
    // The whole point of resyncing instead of parking: one edit that didn't fit
    // must not cost the user their session. The resend puts the canvas back on
    // the buffer, and the edit they retry against *that* lands.
    const h = harness({ text: '<p>a</p>' });
    await h.session.onMessage({ type: 'ready' });
    await h.session.onMessage({
      type: 'applyEdits', edits: [{ start: 0, end: 3, text: '<b>', old: '<i>' }],
    });
    expect(h.applyCount()).toBe(0);

    await h.session.onMessage({
      type: 'applyEdits', edits: [{ start: 0, end: 3, text: '<b>', old: '<p>' }],
    });
    expect(h.posts).toContainEqual({ type: 'applied' });
    expect(h.text()).toBe('<b>a</p>');
  });

  it('a buffer that settles differently from the edit resyncs the canvas', async () => {
    // Something else rewrote the document alongside our edit — a formatter, an
    // auto-close-tag extension, anything reacting to the WorkspaceEdit. The
    // canvas holds the text *it* predicted, which the buffer no longer matches.
    // Left alone the two drift until some later edit is refused (FOLLOW-UPS
    // §7.5); instead the canvas is put back on the buffer straight away.
    const h = harness({ text: '<p>a</p>' });
    await h.session.onMessage({ type: 'ready' });
    h.duringApply(() => h.setText('<p>  formatted  </p>'));
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 3, end: 4, text: 'b' }] });

    expect(h.posts.some(p => p.type === 'applied')).toBe(false);
    expect(h.posts).toContainEqual(
      { type: 'setSource', text: '<p>  formatted  </p>', keepSelection: true });
  });

  it('an unchanged buffer after our own edit is not drift', async () => {
    // The everyday case must stay silent: the buffer settles on exactly what
    // the edits describe, so it confirms rather than resyncing.
    const h = harness({ text: '<p>a</p>' });
    await h.session.onMessage({ type: 'ready' });
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 3, end: 4, text: 'b' }] });

    expect(h.posts).toContainEqual({ type: 'applied' });
    expect(h.posts.filter(p => p.type === 'setSource')).toHaveLength(1);   // just the ready one
    expect(h.text()).toBe('<p>b</p>');
  });

  it('applies an insertion whose context still matches', async () => {
    const text = '<div class="row"><div class="col">x</div></div>';
    const h = harness({ text });
    // insert right after the inner </div> (offset 41), context taken from `text`
    const at = text.indexOf('</div></div>') + '</div>'.length;   // 41
    await h.session.onMessage({
      type: 'applyEdits',
      edits: [{ start: at, end: at, text: '<x/>',
        before: text.slice(at - 6, at), after: text.slice(at, at + 6) }],
    });
    expect(h.posts).toContainEqual({ type: 'applied' });
    expect(h.warns).toHaveLength(0);
  });

  it('refuses an edit once the user has changed the buffer (guard-and-resync)', async () => {
    const h = harness({ text: '<p>a</p>' });
    await h.session.onMessage({ type: 'ready' });   // canvas is in sync with <p>a</p>
    h.setText('<p>ab</p>');                         // the user types in the editor
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    expect(h.applyCount()).toBe(0);                 // nothing applied
    expect(h.posts.some(p => p.type === 'applied')).toBe(false);
    expect(h.posts).toContainEqual({
      type: 'setSource', text: '<p>ab</p>', keepSelection: true, notice: OUT_OF_SYNC,
    });
  });

  it('reports a failed apply and re-sends the source', async () => {
    const h = harness();
    h.failNextApply();
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    expect(h.warns).toContain(APPLY_FAILED);
    expect(h.types()).toContain('setSource');
    expect(h.posts.some(p => p.type === 'applied')).toBe(false);
  });
});

describe('Session — back-to-back canvas edits (issue #1)', () => {
  /* VS Code delivers webview messages fire-and-forget: it does not wait for one
     handler to finish before dispatching the next. Two canvas edits in quick
     succession (Add column twice, or two drags) therefore arrive overlapped, and
     the second is only safe to judge once the first has actually landed in the
     buffer. Session serializes handling to make that true. */

  it('two rapid edits both apply — no spurious divergence', async () => {
    const h = harness({ text: 'ab' });
    await h.session.onMessage({ type: 'ready' });
    // dispatched without awaiting the first, exactly as extension.ts does
    const first = h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: '1' }] });
    const second = h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: '2' }] });
    await Promise.all([first, second]);

    expect(h.posts.filter(p => p.type === 'applied')).toHaveLength(2);
    expect(h.text()).toBe('21ab');
    expect(h.posts.some(p => p.type === 'diverged')).toBe(false);
    expect(h.warns).toHaveLength(0);
  });

  it('a multi-edit batch (a column drag) does not block the next edit', async () => {
    // The regression this replaced the version handshake for: a drag is two
    // edits in one WorkspaceEdit (cut + insert). The webview used to guess how
    // far that advanced doc.version, and a second drag fired before the host's
    // confirmation arrived was refused as diverged. Content identity has no
    // such guess to get wrong.
    const h = harness({ text: '<a/><b/>' });
    await h.session.onMessage({ type: 'ready' });
    const drag = h.session.onMessage({ type: 'applyEdits', edits: [
      { start: 0, end: 4, text: '', old: '<a/>' },
      { start: 8, end: 8, text: '<a/>', before: '<a/><b/>', after: '' },
    ] });
    const next = h.session.onMessage({ type: 'applyEdits', edits: [
      { start: 0, end: 4, text: '<c/>', old: '<b/>' },
    ] });
    await Promise.all([drag, next]);

    expect(h.posts.filter(p => p.type === 'applied')).toHaveLength(2);
    expect(h.posts.some(p => p.type === 'diverged')).toBe(false);
    expect(h.text()).toBe('<c/><a/>');
  });

  it('a long run of rapid edits all apply in order', async () => {
    const h = harness({ text: '' });
    await h.session.onMessage({ type: 'ready' });
    const sent = Array.from({ length: 6 }, (_, i) => h.session.onMessage({
      type: 'applyEdits', edits: [{ start: i, end: i, text: String(i) }],
    }));
    await Promise.all(sent);

    expect(h.posts.filter(p => p.type === 'applied')).toHaveLength(6);
    expect(h.text()).toBe('012345');
    expect(h.posts.some(p => p.type === 'diverged')).toBe(false);
  });

  it('serialization does not mask a genuinely stale edit', async () => {
    // Both were computed against the same original text, but the first shifts
    // every offset after it, so the second's span no longer holds what it
    // expects — it must still be refused. The queue removes the false
    // positives; it doesn't weaken the guard.
    const h = harness({ text: '<div class="col">x</div>' });
    await h.session.onMessage({ type: 'ready' });
    const first = h.session.onMessage({
      type: 'applyEdits', edits: [{ start: 0, end: 0, text: '<p/>', after: '<div class="col' }],
    });
    const second = h.session.onMessage({
      type: 'applyEdits', edits: [{ start: 12, end: 15, text: 'col-8', old: 'col' }],
    });
    await Promise.all([first, second]);

    expect(h.posts.filter(p => p.type === 'applied')).toHaveLength(1);
    expect(h.posts.some(p => p.type === 'setSource' && p.notice === OUT_OF_SYNC)).toBe(true);
  });

  it('a queued message still runs after an earlier one throws', async () => {
    const h = harness();
    // `post` blows up on the first message; the queue must not wedge
    const boom = h.session.onMessage({ type: 'discard' });
    h.throwOnNextPost();
    await boom.catch(() => {});
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    expect(h.posts).toContainEqual({ type: 'applied' });
  });
});

describe('Session — divergence (liveSync off: park and warn)', () => {
  it('a user document change flags divergence', async () => {
    const h = harness({ text: '<p>a</p>', liveSync: false });
    await h.session.onSave();               // in sync with <p>a</p>
    h.setText('<p>ab</p>');
    await h.session.onDocChange();
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(1);
  });

  it('a burst of changes flags divergence only once (no per-keystroke re-toast)', async () => {
    // The editor fires onDidChangeTextDocument per keystroke. We must post
    // `diverged` on the false→true edge only, or the webview re-toasts "Resync"
    // on every character typed — the friction issue #1's reporter hit.
    const h = harness({ text: 'a', liveSync: false });
    await h.session.onSave();
    for (let i = 0; i < 5; i++) {
      h.setText('a' + 'x'.repeat(i + 1));
      await h.session.onDocChange();
    }
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(1);
  });

  it('typing and undoing back to the same text returns to sync', async () => {
    // Content identity, not version counting: the buffer holds exactly what the
    // canvas has again, so the canvas un-parks (the resend clears the webview's
    // warning) instead of staying stuck until a save.
    const h = harness({ text: '<p>a</p>', liveSync: false });
    await h.session.onSave();
    h.setText('<p>ax</p>');
    await h.session.onDocChange();               // parked
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(1);

    h.setText('<p>a</p>');                       // the user deletes the x again
    await h.session.onDocChange();
    expect(h.posts.filter(p => p.type === 'setSource')).toHaveLength(2);   // save + un-park

    // and canvas edits work again
    h.setText('<p>a</p>');
    await h.session.onDocChange();
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(1);    // not re-flagged
  });

  it('an in-sync buffer change while not parked posts nothing', async () => {
    const h = harness({ text: 'a', liveSync: false });
    await h.session.onSave();
    await h.session.onDocChange();    // buffer unchanged (e.g. a no-op formatting pass)
    expect(h.posts.filter(p => p.type !== 'setSource')).toHaveLength(0);
  });

  it('a resync re-arms divergence: changes after a save flag it again', async () => {
    const h = harness({ text: 'a', liveSync: false });
    h.setText('ab'); await h.session.onDocChange();   // first episode → 1 diverged
    await h.session.onSave();                        // resync: webview clears diverged, so do we
    h.setText('abc'); await h.session.onDocChange(); // fresh edit → new episode → another diverged
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(2);
  });

  it('a refused edit resyncs rather than parking, and divergence re-arms after it', async () => {
    // A refusal used to park the canvas as diverged. It now resends the buffer,
    // so the canvas is immediately usable again — and because that resend is a
    // resync, a *later* external change is a fresh episode and flags once.
    const h = harness({ text: '<p>a</p>', liveSync: false });
    await h.session.onMessage({ type: 'ready' });
    h.setText('<p>ab</p>');
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    expect(h.posts.some(p => p.type === 'diverged')).toBe(false);
    expect(h.posts.some(p => p.type === 'setSource' && p.notice === OUT_OF_SYNC)).toBe(true);

    h.setText('<p>abc</p>');
    await h.session.onDocChange();
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(1);
  });

  it('our own apply is not divergence (change fires while applying)', async () => {
    const h = harness({ text: 'ab', liveSync: false });
    await h.session.onMessage({ type: 'ready' });
    let change: Promise<void> | null = null;
    h.duringApply(() => { change = h.session.onDocChange(); });   // the change our edit causes
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    await change;                 // queued behind the apply, so it sees the settled buffer
    expect(h.posts.some(p => p.type === 'diverged')).toBe(false);
    expect(h.posts.some(p => p.type === 'applied')).toBe(true);
  });

  it('a change delivered after our apply settles is not divergence either', async () => {
    // Belt and braces: even if the editor delivers the change event late (after
    // applyEdit resolved), the buffer now equals what we recorded, so it can't
    // read as the user editing under us.
    const h = harness({ text: 'ab', liveSync: false });
    await h.session.onMessage({ type: 'ready' });
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    await h.session.onDocChange();
    expect(h.posts.some(p => p.type === 'diverged')).toBe(false);
  });

  it('a caret nudge from our own apply is ignored (keeps the canvas selection)', async () => {
    // applying a move shifts the buffer and moves the editor caret; that echo
    // must not bounce back as a selectAt and deselect the moved column
    const h = harness();
    h.duringApply(() => h.session.onEditorSelection(3, 3, 3));
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    expect(h.posts.some(p => p.type === 'selectAt')).toBe(false);
    expect(h.posts.some(p => p.type === 'applied')).toBe(true);
  });
});

describe('Session — live sync (on by default)', () => {
  it('an external change refreshes the canvas after a debounce, keeping the selection', async () => {
    vi.useFakeTimers();
    const h = harness({ text: '<p>x</p>' });
    h.setText('<p>xy</p>');
    await h.session.onDocChange();
    expect(h.posts).toHaveLength(0);     // debounced — nothing yet
    await vi.advanceTimersByTimeAsync(500);
    expect(h.posts).toContainEqual(
      { type: 'setSource', text: '<p>xy</p>', keepSelection: true });
    expect(h.posts.some(p => p.type === 'diverged')).toBe(false);   // never parked
  });

  it('a typing burst collapses into a single refresh', async () => {
    vi.useFakeTimers();
    const h = harness({ text: 'a' });
    h.setText('ab'); await h.session.onDocChange();
    await vi.advanceTimersByTimeAsync(100);
    h.setText('abc'); await h.session.onDocChange();
    await vi.advanceTimersByTimeAsync(100);
    h.setText('abcd'); await h.session.onDocChange();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.posts.filter(p => p.type === 'setSource')).toHaveLength(1);
  });

  it('a save cancels a pending live refresh (no duplicate resync)', async () => {
    vi.useFakeTimers();
    const h = harness({ text: 'a' });
    h.setText('ab');
    await h.session.onDocChange();       // schedules a live refresh
    await h.session.onSave();            // immediate resync — supersedes it
    await vi.advanceTimersByTimeAsync(500);
    expect(h.posts.filter(p => p.type === 'setSource')).toHaveLength(1);
  });

  it('the editor\'s own undo does not park the canvas', async () => {
    // Undo in the extension *is* the editor's undo (PLAN.md decision §6), so it
    // arrives here as an external document change. With auto-follow on it
    // refreshes the canvas — the reason this is the default.
    vi.useFakeTimers();
    const h = harness({ text: '<p>ab</p>' });
    await h.session.onMessage({ type: 'ready' });
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 4, end: 4, text: 'c' }] });
    h.setText('<p>ab</p>');              // Ctrl+Z in the editor
    await h.session.onDocChange();
    await vi.advanceTimersByTimeAsync(500);

    expect(h.posts.some(p => p.type === 'diverged')).toBe(false);
    expect(h.posts).toContainEqual(
      { type: 'setSource', text: '<p>ab</p>', keepSelection: true });
  });

  it('off: an external change parks the canvas, no auto refresh', async () => {
    const h = harness({ text: 'a', liveSync: false });
    h.setText('ab');
    await h.session.onDocChange();
    expect(h.types()).toEqual(['diverged']);
    expect(h.posts.some(p => p.type === 'setSource')).toBe(false);
  });
});

describe('Session — editor events are serialised with canvas edits', () => {
  /* FOLLOW-UPS §9.4: onSave/onDocChange used to run outside the message queue,
     so a save landing mid-apply could resend a buffer that was about to change.
     They share the queue now, so their view of the buffer is always settled. */

  it('a save fired mid-apply sends the buffer the apply produced', async () => {
    const h = harness({ text: 'ab' });
    await h.session.onMessage({ type: 'ready' });
    let saved: Promise<void> | null = null;
    h.duringApply(() => { saved = h.session.onSave(); });
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    await saved;

    const sends = h.posts.filter(p => p.type === 'setSource');
    expect(sends[sends.length - 1]).toEqual(
      { type: 'setSource', text: 'xab', keepSelection: true });
  });

  it('a live refresh queued behind an apply reflects the applied edit', async () => {
    vi.useFakeTimers();
    const h = harness({ text: 'ab' });
    await h.session.onMessage({ type: 'ready' });
    let changed: Promise<void> | null = null;
    h.duringApply(() => { changed = h.session.onDocChange(); });
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    await changed;
    await vi.advanceTimersByTimeAsync(500);

    // the change was our own, so there is nothing to refresh and nothing to park
    expect(h.posts.some(p => p.type === 'diverged')).toBe(false);
    expect(h.posts.filter(p => p.type === 'setSource')).toHaveLength(1);   // ready only
    expect(h.text()).toBe('xab');
  });
});

describe('Session — undo / redo from the canvas', () => {
  const EDITED = '<div class="row"><div class="col-6">x</div></div>';

  it('runs the editor\'s own undo, then shows the canvas the result', async () => {
    const h = harness();
    await h.session.onMessage({ type: 'ready' });
    // the editor's undo rewrites the buffer and fires a change event
    h.duringHistory(() => { h.setText(EDITED); void h.session.onDocChange(); });

    await h.session.onMessage({ type: 'history', dir: 'undo' });

    expect(h.histories).toEqual(['undo']);
    // the canvas is resent the buffer as it now reads, keeping its selection
    expect(h.posts.at(-1)).toEqual({ type: 'setSource', text: EDITED, keepSelection: true });
  });

  it('redo is the same path', async () => {
    const h = harness();
    await h.session.onMessage({ type: 'ready' });
    await h.session.onMessage({ type: 'history', dir: 'redo' });
    expect(h.histories).toEqual(['redo']);
    expect(h.types().at(-1)).toBe('setSource');
  });

  it('with liveSync off, the buffer change it causes does not park the canvas', async () => {
    const h = harness({ liveSync: false });
    await h.session.onMessage({ type: 'ready' });
    h.duringHistory(() => { h.setText(EDITED); void h.session.onDocChange(); });

    await h.session.onMessage({ type: 'history', dir: 'undo' });
    await h.session.onDocChange();      // let the queued change event run

    // the canvas asked for this change: it is not the user editing under it
    expect(h.types()).not.toContain('diverged');
    expect(h.posts.at(-1)).toEqual({ type: 'setSource', text: EDITED, keepSelection: true });
  });

  it('the caret move the undo causes is not bounced back as a selectAt', async () => {
    const h = harness();
    await h.session.onMessage({ type: 'ready' });
    h.duringHistory(() => h.session.onEditorSelection(5, 5, 5));

    await h.session.onMessage({ type: 'history', dir: 'undo' });

    expect(h.types()).not.toContain('selectAt');
    // and a real caret move afterwards still reaches the canvas
    h.session.onEditorSelection(7, 7, 7);
    expect(h.posts.at(-1)).toEqual({ type: 'selectAt', offset: 7 });
  });

  it('a failing undo still leaves the canvas showing the buffer', async () => {
    const h = harness();
    await h.session.onMessage({ type: 'ready' });
    h.duringHistory(() => { throw new Error('no editor'); });

    await expect(h.session.onMessage({ type: 'history', dir: 'undo' })).rejects.toThrow();

    // the next message is still handled — one failed turn doesn't wedge the queue
    await h.session.onMessage({ type: 'discard' });
    expect(h.types().at(-1)).toBe('setSource');
    // …and a later caret move isn't swallowed (applyDepth was released)
    h.session.onEditorSelection(3, 3, 3);
    expect(h.posts.at(-1)).toEqual({ type: 'selectAt', offset: 3 });
  });
});

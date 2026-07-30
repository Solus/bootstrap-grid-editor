import { afterEach, describe, expect, it, vi } from 'vitest';
import { APPLY_FAILED, OUT_OF_SYNC, Session } from './session.js';
import type { HostMessage } from '../shared/protocol.js';

/* A fake VS Code environment: records what the session posts / reveals / warns,
   and simulates the buffer. `applyEdit` really splices the edits into the text,
   so `docText()` afterwards is what a real buffer would hold — which is exactly
   what the session's in-sync check reads. `setText` stands for the user editing
   the document in the editor. */
function harness(opts: { text?: string; liveSync?: boolean } = {}) {
  const posts: HostMessage[] = [];
  const reveals: Array<[number, number]> = [];
  const warns: string[] = [];
  const configWrites: Array<[string, boolean]> = [];
  let text = opts.text ?? '<div class="row"><div class="col">x</div></div>';
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
      ...(opts.liveSync !== undefined ? { liveSync: opts.liveSync } : {}) }),
    setConfig: (pref, value) => configWrites.push([pref, value]),
  });

  return {
    session, posts, reveals, warns, configWrites,
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
      { type: 'config', config: { breakpoint: 'lg', tintOverfull: true } },
      { type: 'setSource', text: '<p>hi</p>' },
    ]);
  });

  it('setConfig routes a canvas view-toggle back to the host', async () => {
    const h = harness();
    await h.session.onMessage({ type: 'setConfig', pref: 'stretchSheet', value: true });
    expect(h.configWrites).toEqual([['stretchSheet', true]]);
  });

  it('save refreshes from source, keeping the selection', () => {
    const h = harness();
    h.session.onSave();
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
    expect(h.types()).toContain('diverged');
    expect(h.warns).toContain(OUT_OF_SYNC);
    expect(h.applyCount()).toBe(0);              // nothing applied
    expect(h.posts.some(p => p.type === 'applied')).toBe(false);
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
    expect(h.types()).toContain('diverged');
    expect(h.warns).toContain(OUT_OF_SYNC);
    expect(h.applyCount()).toBe(0);              // nothing applied
    expect(h.posts.some(p => p.type === 'applied')).toBe(false);
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

  it('refuses an edit once the user has changed the buffer (guard-and-warn)', async () => {
    const h = harness({ text: '<p>a</p>' });
    await h.session.onMessage({ type: 'ready' });   // canvas is in sync with <p>a</p>
    h.setText('<p>ab</p>');                         // the user types in the editor
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    expect(h.types()).toContain('diverged');
    expect(h.warns).toContain(OUT_OF_SYNC);
    expect(h.applyCount()).toBe(0);                 // nothing applied
    expect(h.posts.some(p => p.type === 'applied')).toBe(false);
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
    expect(h.types()).toContain('diverged');
    expect(h.warns).toContain(OUT_OF_SYNC);
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

describe('Session — divergence', () => {
  it('a user document change flags divergence', () => {
    const h = harness({ text: '<p>a</p>' });
    h.session.onSave();               // in sync with <p>a</p>
    h.setText('<p>ab</p>');
    h.session.onDocChange();
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(1);
  });

  it('a burst of changes flags divergence only once (no per-keystroke re-toast)', () => {
    // The editor fires onDidChangeTextDocument per keystroke. We must post
    // `diverged` on the false→true edge only, or the webview re-toasts "Resync"
    // on every character typed — the friction issue #1's reporter hit.
    const h = harness({ text: 'a' });
    h.session.onSave();
    for (let i = 0; i < 5; i++) { h.setText('a' + 'x'.repeat(i + 1)); h.session.onDocChange(); }
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(1);
  });

  it('typing and undoing back to the same text returns to sync', () => {
    // Content identity, not version counting: the buffer holds exactly what the
    // canvas has again, so the canvas un-parks (the resend clears the webview's
    // warning) instead of staying stuck until a save.
    const h = harness({ text: '<p>a</p>' });
    h.session.onSave();
    h.setText('<p>ax</p>');
    h.session.onDocChange();                     // parked
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(1);

    h.setText('<p>a</p>');                       // the user deletes the x again
    h.session.onDocChange();
    expect(h.posts.filter(p => p.type === 'setSource')).toHaveLength(2);   // save + un-park

    // and canvas edits work again
    h.setText('<p>a</p>');
    h.session.onDocChange();
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(1);    // not re-flagged
  });

  it('an in-sync buffer change while not parked posts nothing', () => {
    const h = harness({ text: 'a' });
    h.session.onSave();
    h.session.onDocChange();          // buffer unchanged (e.g. a no-op formatting pass)
    expect(h.posts.filter(p => p.type !== 'setSource')).toHaveLength(0);
  });

  it('a resync re-arms divergence: changes after a save flag it again', () => {
    const h = harness({ text: 'a' });
    h.setText('ab'); h.session.onDocChange();   // first episode → 1 diverged
    h.session.onSave();                         // resync: webview clears diverged, so do we
    h.setText('abc'); h.session.onDocChange();  // fresh edit → new episode → another diverged
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(2);
  });

  it('a refused edit re-arms after the resync it triggers', async () => {
    // A refused applyEdits both warns and flags divergence; a following buffer
    // change while still diverged must not re-post, but a change after the user
    // resyncs (discard) must.
    const h = harness({ text: '<p>a</p>' });
    await h.session.onMessage({ type: 'ready' });
    h.setText('<p>ab</p>');
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    h.setText('<p>abc</p>');
    h.session.onDocChange();          // still diverged → swallowed
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(1);
    await h.session.onMessage({ type: 'discard' });   // resync
    h.setText('<p>abcd</p>');
    h.session.onDocChange();          // re-armed → posts again
    expect(h.posts.filter(p => p.type === 'diverged')).toHaveLength(2);
  });

  it('our own apply is not divergence (change fires while applying)', async () => {
    const h = harness({ text: 'ab' });
    await h.session.onMessage({ type: 'ready' });
    h.duringApply(() => h.session.onDocChange());   // the buffer change our edit causes
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    expect(h.posts.some(p => p.type === 'diverged')).toBe(false);
    expect(h.posts.some(p => p.type === 'applied')).toBe(true);
  });

  it('a change delivered after our apply settles is not divergence either', async () => {
    // Belt and braces on the `applying` window: even if the editor delivers the
    // change event late (after applyEdit resolved), the buffer now equals what
    // we recorded, so it can't read as the user editing under us.
    const h = harness({ text: 'ab' });
    await h.session.onMessage({ type: 'ready' });
    await h.session.onMessage({ type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }] });
    h.session.onDocChange();
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

describe('Session — live sync (opt-in)', () => {
  it('off by default: an external change parks the canvas, no auto refresh', () => {
    const h = harness({ text: 'a' });                 // no liveSync → off
    h.setText('ab');
    h.session.onDocChange();
    expect(h.types()).toEqual(['diverged']);
    expect(h.posts.some(p => p.type === 'setSource')).toBe(false);
  });

  it('on: an external change refreshes the canvas after a debounce, keeping the selection', () => {
    vi.useFakeTimers();
    const h = harness({ liveSync: true, text: '<p>x</p>' });
    h.setText('<p>xy</p>');
    h.session.onDocChange();
    expect(h.posts).toHaveLength(0);     // debounced — nothing yet
    vi.advanceTimersByTime(500);
    expect(h.posts).toContainEqual(
      { type: 'setSource', text: '<p>xy</p>', keepSelection: true });
    expect(h.posts.some(p => p.type === 'diverged')).toBe(false);   // never parked
  });

  it('on: a typing burst collapses into a single refresh', () => {
    vi.useFakeTimers();
    const h = harness({ liveSync: true, text: 'a' });
    h.setText('ab'); h.session.onDocChange();
    vi.advanceTimersByTime(100);
    h.setText('abc'); h.session.onDocChange();
    vi.advanceTimersByTime(100);
    h.setText('abcd'); h.session.onDocChange();
    vi.advanceTimersByTime(500);
    expect(h.posts.filter(p => p.type === 'setSource')).toHaveLength(1);
  });

  it('a save cancels a pending live refresh (no duplicate resync)', () => {
    vi.useFakeTimers();
    const h = harness({ liveSync: true, text: 'a' });
    h.setText('ab');
    h.session.onDocChange();             // schedules a live refresh
    h.session.onSave();                  // immediate resync — supersedes it
    vi.advanceTimersByTime(500);
    expect(h.posts.filter(p => p.type === 'setSource')).toHaveLength(1);
  });
});

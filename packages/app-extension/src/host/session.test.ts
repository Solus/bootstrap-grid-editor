import { describe, expect, it } from 'vitest';
import { APPLY_FAILED, OUT_OF_SYNC, Session } from './session.js';
import type { HostMessage } from '../shared/protocol.js';

/* A fake VS Code environment: records what the session posts / reveals /
   warns, and simulates the buffer (a successful applyEdit bumps the version
   and can fire a mid-apply document-change hook). */
function harness(opts: { text?: string; version?: number } = {}) {
  const posts: HostMessage[] = [];
  const reveals: Array<[number, number]> = [];
  const warns: string[] = [];
  const configWrites: Array<[string, boolean]> = [];
  let version = opts.version ?? 1;
  let text = opts.text ?? '<div class="row"><div class="col">x</div></div>';
  let applyOk = true;
  let onApply: (() => void) | null = null;

  const session = new Session({
    post: m => posts.push(m),
    reveal: (s, e) => reveals.push([s, e]),
    applyEdit: async () => {
      if (applyOk) { version++; onApply?.(); }   // a real edit bumps version + fires onDidChangeTextDocument
      return applyOk;
    },
    docText: () => text,
    docVersion: () => version,
    warn: m => warns.push(m),
    config: () => ({ breakpoint: 'lg', tintOverfull: true }),
    setConfig: (pref, value) => configWrites.push([pref, value]),
  });

  return {
    session, posts, reveals, warns, configWrites,
    setVersion: (v: number) => { version = v; },
    failNextApply: () => { applyOk = false; },
    duringApply: (fn: () => void) => { onApply = fn; },
    version: () => version,
    types: () => posts.map(p => p.type),
  };
}

describe('Session — source in', () => {
  it('ready sends config first, then the current document', async () => {
    const h = harness({ text: '<p>hi</p>', version: 4 });
    await h.session.onMessage({ type: 'ready' });
    // config must precede setSource so the canvas seeds before its first render
    expect(h.posts).toEqual([
      { type: 'config', config: { breakpoint: 'lg', tintOverfull: true } },
      { type: 'setSource', text: '<p>hi</p>', version: 4 },
    ]);
  });

  it('setConfig routes a canvas view-toggle back to the host', () => {
    const h = harness();
    h.session.onMessage({ type: 'setConfig', pref: 'stretchSheet', value: true });
    expect(h.configWrites).toEqual([['stretchSheet', true]]);
  });

  it('save refreshes from source', () => {
    const h = harness({ version: 7 });
    h.session.onSave();
    expect(h.posts).toEqual([{ type: 'setSource', text: expect.any(String), version: 7 }]);
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
  it('applies a canvas edit and confirms with the new version', async () => {
    const h = harness({ version: 1 });
    await h.session.onMessage({
      type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }], baseVersion: 1,
    });
    expect(h.posts).toContainEqual({ type: 'applied', version: 2 });   // version bumped by the apply
    expect(h.warns).toHaveLength(0);
  });

  it('applies when the edit still matches the buffer (old verified)', async () => {
    const h = harness({ text: '<div class="col">x</div>', version: 1 });
    await h.session.onMessage({
      type: 'applyEdits', baseVersion: 1,
      edits: [{ start: 12, end: 15, text: 'col-4', old: 'col' }],   // "col" is at 12..15
    });
    expect(h.posts).toContainEqual({ type: 'applied', version: 2 });
    expect(h.warns).toHaveLength(0);
  });

  it('refuses an edit whose span no longer matches the buffer (anti-corruption)', async () => {
    // Right version, but the offsets were computed against a different source:
    // old says "col" while the buffer holds col-sm-2 there. Splicing by raw
    // offset would produce broken HTML (e.g. class=col-sm-42"); refuse instead.
    const h = harness({ text: '<div class="col-sm-2">x</div>', version: 1 });
    await h.session.onMessage({
      type: 'applyEdits', baseVersion: 1,
      edits: [{ start: 11, end: 14, text: 'col-sm-4', old: 'col' }],
    });
    expect(h.types()).toContain('diverged');
    expect(h.warns).toContain(OUT_OF_SYNC);
    expect(h.version()).toBe(1);                 // nothing applied
    expect(h.posts.some(p => p.type === 'applied')).toBe(false);
  });

  it('refuses a misplaced insertion via its context (anti-corruption)', async () => {
    // Add column is an insertion: start === end, old === '' (matches anywhere).
    // Its before/after context is what catches a drifted insertion point — here
    // the buffer no longer has the expected text around the offset, so applying
    // would splice a new column into the middle of a </div>. Refuse instead.
    const h = harness({ text: '<div class="row"><div class="col">x</div></div>', version: 1 });
    await h.session.onMessage({
      type: 'applyEdits', baseVersion: 1,
      edits: [{ start: 8, end: 8, text: '<new/>', before: '</div>', after: '\n  <div' }],
    });
    expect(h.types()).toContain('diverged');
    expect(h.warns).toContain(OUT_OF_SYNC);
    expect(h.version()).toBe(1);                 // nothing applied
    expect(h.posts.some(p => p.type === 'applied')).toBe(false);
  });

  it('applies an insertion whose context still matches', async () => {
    const text = '<div class="row"><div class="col">x</div></div>';
    const h = harness({ text, version: 1 });
    // insert right after the inner </div> (offset 41), context taken from `text`
    const at = text.indexOf('</div></div>') + '</div>'.length;   // 41
    await h.session.onMessage({
      type: 'applyEdits', baseVersion: 1,
      edits: [{ start: at, end: at, text: '<x/>',
        before: text.slice(at - 6, at), after: text.slice(at, at + 6) }],
    });
    expect(h.posts).toContainEqual({ type: 'applied', version: 2 });
    expect(h.warns).toHaveLength(0);
  });

  it('refuses a stale edit and warns (guard-and-warn)', async () => {
    const h = harness({ version: 5 });
    await h.session.onMessage({
      type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }], baseVersion: 3,
    });
    expect(h.types()).toContain('diverged');
    expect(h.warns).toContain(OUT_OF_SYNC);
    expect(h.version()).toBe(5);                 // nothing applied
    expect(h.posts.some(p => p.type === 'applied')).toBe(false);
  });

  it('reports a failed apply and re-sends the source', async () => {
    const h = harness({ version: 1 });
    h.failNextApply();
    await h.session.onMessage({
      type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }], baseVersion: 1,
    });
    expect(h.warns).toContain(APPLY_FAILED);
    expect(h.types()).toContain('setSource');
    expect(h.posts.some(p => p.type === 'applied')).toBe(false);
  });
});

describe('Session — divergence', () => {
  it('a user document change flags divergence', () => {
    const h = harness();
    h.session.onDocChange();
    expect(h.posts).toEqual([{ type: 'diverged' }]);
  });

  it('our own apply is not divergence (change fires while applying)', async () => {
    const h = harness({ version: 1 });
    h.duringApply(() => h.session.onDocChange());   // the buffer change our edit causes
    await h.session.onMessage({
      type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }], baseVersion: 1,
    });
    expect(h.posts.some(p => p.type === 'diverged')).toBe(false);
    expect(h.posts.some(p => p.type === 'applied')).toBe(true);
  });

  it('a caret nudge from our own apply is ignored (keeps the canvas selection)', async () => {
    // applying a move shifts the buffer and moves the editor caret; that echo
    // must not bounce back as a selectAt and deselect the moved column
    const h = harness({ version: 1 });
    h.duringApply(() => h.session.onEditorSelection(3, 3, 3));
    await h.session.onMessage({
      type: 'applyEdits', edits: [{ start: 0, end: 0, text: 'x' }], baseVersion: 1,
    });
    expect(h.posts.some(p => p.type === 'selectAt')).toBe(false);
    expect(h.posts.some(p => p.type === 'applied')).toBe(true);
  });
});

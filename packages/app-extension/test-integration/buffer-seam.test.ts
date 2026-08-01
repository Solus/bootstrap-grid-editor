/* The edits-out seam, against a real VS Code.
 *
 * Everything else about the sync loop is covered by `src/host/session.test.ts`
 * with a simulated buffer. What that can't answer is the one assumption the
 * whole design rests on: that the character offsets `core` computes, converted
 * with `TextDocument.positionAt` and applied as a `WorkspaceEdit`, land on
 * exactly those characters in the real buffer. FOLLOW-UPS §7.5 sat on that
 * assumption for four releases because nothing here could execute it.
 *
 * So these run inside an actual extension host: a real `TextDocument`, real
 * workspace edits, driven through `createSessionPorts` — the same factory the
 * extension itself wires its Session with, so a bug in it fails here rather
 * than hiding behind a second copy written for the test.
 *
 * Deliberately *not* covered: the webview. Driving the canvas through a
 * webview from Mocha would test VS Code's iframe plumbing more than our own;
 * the canvas is covered by Playwright in app-standalone. Here the webview is a
 * recording `post`, and what's asserted is the buffer's bytes.
 */

import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { Session } from '../src/host/session.js';
import { createSessionPorts } from '../src/host/extension.js';
import type { Edit } from '@bootstrap-visualizer/core';
import type { HostMessage } from '../src/shared/protocol.js';

/** An untitled document holding `text`, plus a Session wired to it exactly as
    the extension wires its own. Returns the pieces each case drives. */
async function openWith(text: string) {
  const doc = await vscode.workspace.openTextDocument({ content: text, language: 'html' });
  await vscode.window.showTextDocument(doc);
  const posts: HostMessage[] = [];
  const ports = createSessionPorts(() => doc, m => posts.push(m));
  const session = new Session(ports);
  return { doc, posts, session, ports };
}

/** What the canvas would send for an edit batch: the spans, each stamped with
    the text it expects to find there — the same stamping `applyOps` does in the
    editor package (`state.ts`), reproduced here because the canvas isn't in
    this process to do it. */
function stamp(src: string, edits: { start: number; end: number; text: string }[]): Edit[] {
  const CTX = 16;
  return edits.map(e => ({
    ...e,
    old: src.slice(e.start, e.end),
    before: src.slice(Math.max(0, e.start - CTX), e.start),
    after: src.slice(e.end, e.end + CTX),
  }));
}

const sends = (posts: HostMessage[]) =>
  posts.filter((p): p is Extract<HostMessage, { type: 'setSource' }> => p.type === 'setSource');

suite('the buffer seam — canvas offsets reaching a real document', () => {
  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('a class edit rewrites exactly the class value', async () => {
    const text = '<div class="row">\n  <div class="col-6">A</div>\n</div>\n';
    const { doc, posts, session } = await openWith(text);
    await session.onMessage({ type: 'ready' });

    // the span of `col-6` inside the class attribute, as core would compute it
    const start = text.indexOf('col-6');
    await session.onMessage({
      type: 'applyEdits',
      edits: stamp(text, [{ start, end: start + 'col-6'.length, text: 'col-4' }]),
    });

    assert.strictEqual(doc.getText(),
      '<div class="row">\n  <div class="col-4">A</div>\n</div>\n');
    assert.ok(posts.some(p => p.type === 'applied'), 'the edit was confirmed');
  });

  test('a row appended at the very end of the document lands byte-exact', async () => {
    // The offset the "Add row" entry point introduces and no other edit does:
    // an insert *at* doc length. positionAt(text.length) is the one boundary
    // where an off-by-one silently writes inside the last tag instead of after
    // it — and a template with no rows yet is exactly when a user reaches for
    // this button.
    const text = '<form>\n  <p>nothing here yet</p>\n</form>\n';
    const { doc, session } = await openWith(text);
    await session.onMessage({ type: 'ready' });

    const row = '<div class="row">\n  <div class="col">\n    <!-- new column -->\n  </div>\n</div>';
    await session.onMessage({
      type: 'applyEdits',
      edits: stamp(text, [{ start: text.length, end: text.length, text: row }]),
    });

    assert.strictEqual(doc.getText(), text + row);
  });

  test('a column move (cut + insert in one batch) lands byte-exact', async () => {
    // The shape that broke the old version handshake: two spans in one
    // WorkspaceEdit, both computed against the *original* text. VS Code has to
    // apply them against the original positions, not sequentially.
    const text = [
      '<div class="row">',
      '  <div class="col-6">A</div>',
      '  <div class="col-3">B</div>',
      '</div>',
      '',
    ].join('\n');
    const { doc, session } = await openWith(text);
    await session.onMessage({ type: 'ready' });

    const a = '  <div class="col-6">A</div>';
    const b = '  <div class="col-3">B</div>';
    const cutStart = text.indexOf('\n' + a);
    const cutEnd = cutStart + 1 + a.length;
    const insertAt = text.indexOf(b) + b.length;
    await session.onMessage({
      type: 'applyEdits',
      edits: stamp(text, [
        { start: cutStart, end: cutEnd, text: '' },
        { start: insertAt, end: insertAt, text: '\n' + a },
      ]),
    });

    assert.strictEqual(doc.getText(), [
      '<div class="row">',
      '  <div class="col-3">B</div>',
      '  <div class="col-6">A</div>',
      '</div>',
      '',
    ].join('\n'));
  });

  test('CRLF: offsets line up and the line endings survive', async () => {
    // The prime suspect for an offset that means one thing to us and another to
    // the editor: our offsets count \r\n as two characters. If positionAt
    // disagreed, this edit would land a character off per preceding line —
    // exactly the reported `class=col-sm-42"` corruption.
    const text = '<div class="row">\r\n  <div class="col-6">A</div>\r\n</div>\r\n';
    const { doc, session } = await openWith(text);
    await session.onMessage({ type: 'ready' });

    const start = text.indexOf('col-6');
    await session.onMessage({
      type: 'applyEdits',
      edits: stamp(text, [{ start, end: start + 'col-6'.length, text: 'col-8' }]),
    });

    assert.strictEqual(doc.getText(),
      '<div class="row">\r\n  <div class="col-8">A</div>\r\n</div>\r\n');
    assert.ok(!/\r(?!\n)/.test(doc.getText()), 'no orphaned carriage return');
  });

  test('offsets survive characters outside the BMP earlier in the file', async () => {
    // Both JS string offsets and VS Code positions count UTF-16 code units, so
    // an emoji (a surrogate pair) before the edit point must not shift it. If
    // one of them ever counted code points instead, this is where it shows.
    const text = '<div class="row">\n  <div class="col-6">🎉 A</div>\n  <div class="col-3">B</div>\n</div>\n';
    const { doc, session } = await openWith(text);
    await session.onMessage({ type: 'ready' });

    const start = text.indexOf('col-3');
    await session.onMessage({
      type: 'applyEdits',
      edits: stamp(text, [{ start, end: start + 'col-3'.length, text: 'col-5' }]),
    });

    assert.strictEqual(doc.getText(), text.replace('col-3', 'col-5'));
  });

  test('an edit computed before a foreign change is refused, not applied', async () => {
    // Someone else edits the buffer between the canvas computing an edit and
    // the host applying it. Applying by raw offset here is what corrupts a
    // file; the guard has to refuse against a *real* document's text.
    const text = '<div class="row">\n  <div class="col-6">A</div>\n</div>\n';
    const { doc, posts, session } = await openWith(text);
    await session.onMessage({ type: 'ready' });

    const stale = stamp(text, [{
      start: text.indexOf('col-6'), end: text.indexOf('col-6') + 5, text: 'col-4',
    }]);
    // a hand edit lands first, shifting everything after it
    const foreign = new vscode.WorkspaceEdit();
    foreign.insert(doc.uri, new vscode.Position(0, 0), '<!-- note -->\n');
    assert.ok(await vscode.workspace.applyEdit(foreign));

    await session.onMessage({ type: 'applyEdits', edits: stale });

    assert.ok(doc.getText().includes('col-6'), 'the stale edit did not land');
    assert.ok(doc.getText().startsWith('<!-- note -->'), 'the foreign edit is intact');
    const last = sends(posts).pop();
    assert.ok(last, 'the canvas was resynced');
    assert.strictEqual(last.text, doc.getText());
    assert.ok(last.notice, 'and told why');
  });

  test('a buffer that settles differently from the edit resyncs the canvas', async () => {
    // Stands in for a formatter (or auto-close-tag, or any other extension)
    // rewriting the document alongside our WorkspaceEdit: the buffer ends up
    // holding something other than what the canvas predicted. Wrapping the port
    // makes the timing deterministic — the point is what Session does with a
    // real buffer that disagrees, not how the formatter got there.
    const text = '<div class="row">\n  <div class="col-6">A</div>\n</div>\n';
    const { doc, posts, ports } = await openWith(text);
    const session = new Session({
      ...ports,
      applyEdit: async edits => {
        const ok = await ports.applyEdit(edits);
        const formatter = new vscode.WorkspaceEdit();
        formatter.insert(doc.uri, new vscode.Position(0, 0), '<!-- formatted -->\n');
        await vscode.workspace.applyEdit(formatter);
        return ok;
      },
    });
    await session.onMessage({ type: 'ready' });

    const start = text.indexOf('col-6');
    await session.onMessage({
      type: 'applyEdits',
      edits: stamp(text, [{ start, end: start + 5, text: 'col-4' }]),
    });

    assert.ok(!posts.some(p => p.type === 'applied'),
      'a drifted buffer is not confirmed as in sync');
    const last = sends(posts).pop();
    assert.ok(last, 'the canvas was resynced instead');
    assert.strictEqual(last.text, doc.getText());
    assert.ok(doc.getText().includes('col-4'), 'our own edit still landed');
  });

  test('a run of edits stays in sync without a save in between', async () => {
    // The everyday case, end to end: several canvas edits against a real
    // buffer, each computed from the text the previous one produced. Every one
    // must confirm — no false "out of sync" (issue #1).
    const text = '<div class="row">\n  <div class="col-6">A</div>\n</div>\n';
    const { doc, posts, session } = await openWith(text);
    await session.onMessage({ type: 'ready' });

    for (const [from, to] of [['col-6', 'col-5'], ['col-5', 'col-4'], ['col-4', 'col-3']]) {
      const current = doc.getText();
      const start = current.indexOf(from!);
      await session.onMessage({
        type: 'applyEdits',
        edits: stamp(current, [{ start, end: start + from!.length, text: to! }]),
      });
    }

    assert.strictEqual(doc.getText(),
      '<div class="row">\n  <div class="col-3">A</div>\n</div>\n');
    assert.strictEqual(posts.filter(p => p.type === 'applied').length, 3);
    assert.strictEqual(sends(posts).length, 1, 'only the initial send — no resyncs');
  });

  test('the document is left dirty, not saved, by a canvas edit', async () => {
    // Decision §7: canvas edits reach the buffer immediately; persisting stays
    // the user's Ctrl+S.
    const text = '<div class="row"><div class="col-6">A</div></div>';
    const { doc, session } = await openWith(text);
    await session.onMessage({ type: 'ready' });

    const start = text.indexOf('col-6');
    await session.onMessage({
      type: 'applyEdits',
      edits: stamp(text, [{ start, end: start + 5, text: 'col-4' }]),
    });

    assert.ok(doc.isDirty, 'the buffer changed');
  });
});

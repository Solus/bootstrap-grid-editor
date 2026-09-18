/* Wiring tests for the extension host (FOLLOW-UPS §7.3).

   session.test.ts proves the sync *logic*; this file proves the glue that
   was previously only exercised by manual F5: command registration, the
   no-editor path, panel options, the webview HTML contract (CSP + the
   element ids the shared editor resolves at boot), event routing filtered
   to the right document, workspace-edit range building, reveal, and that
   disposal actually detaches every listener.

   `vscode` is a vi.mock stub: documents use opaque `{ offset }` positions —
   the wiring only ever converts offset→position→offset, never inspects
   them, so identity round-tripping is enough. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscodeNs from 'vscode';
import { activate } from './extension.js';

/* ── the vscode stub ─────────────────────────────────────────────── */

vi.mock('vscode', () => {
  type Listener = (e: unknown) => void;
  const mkEvent = () => {
    const ls = new Set<Listener>();
    return {
      on: (cb: Listener) => { ls.add(cb); return { dispose: () => ls.delete(cb) }; },
      fire: (e: unknown) => [...ls].forEach(cb => cb(e)),
      count: () => ls.size,
      clear: () => ls.clear(),
    };
  };
  const saves = mkEvent(), changes = mkEvent(), selections = mkEvent();
  const closes = mkEvent();
  const configChanges = mkEvent();
  const commands = new Map<string, (...a: unknown[]) => unknown>();
  const serializers = new Map<string, { deserializeWebviewPanel(p: unknown, s: unknown): Thenable<void> }>();
  const infoMsgs: string[] = [];
  const warnMsgs: string[] = [];
  const panels: unknown[] = [];
  const applied: { ops: { uri: unknown; range: unknown; text: string }[] }[] = [];
  const config = new Map<string, unknown>();
  const configWrites: { key: string; value: unknown; target: unknown }[] = [];
  const state = {
    activeTextEditor: undefined as unknown,
    visibleTextEditors: [] as unknown[],
    applyHook: null as (() => void) | null,
    workspaceFolders: undefined as unknown,
    applyResult: true,
  };

  class Range {
    constructor(public start: unknown, public end: unknown) {}
  }
  class Selection extends Range {}
  class WorkspaceEdit {
    ops: { uri: unknown; range: unknown; text: string }[] = [];
    replace(uri: unknown, range: unknown, text: string): void {
      this.ops.push({ uri, range, text });
    }
  }
  const Uri = {
    joinPath: (base: { path?: string }, ...parts: string[]) => ({
      path: (base?.path ?? '') + '/' + parts.join('/'),
      toString() { return 'uri:' + this.path; },
    }),
  };

  function createWebviewPanel(
    viewType: string, title: string, _col: unknown, options: unknown,
  ) {
    const posts: unknown[] = [];
    let msgCb: ((m: unknown) => void) | null = null;
    const disposeCbs: (() => void)[] = [];
    let reveals = 0;
    const panel = {
      viewType, title, options,
      posts,
      reveal: () => { reveals++; },
      revealCount: () => reveals,
      webview: {
        html: '',
        cspSource: 'vscode-webview:',
        postMessage: (m: unknown) => { posts.push(m); return Promise.resolve(true); },
        asWebviewUri: (u: { path: string }) => 'webview:' + u.path,
        onDidReceiveMessage: (cb: (m: unknown) => void, _t: unknown, disposables?: { dispose(): void }[]) => {
          msgCb = cb;
          const d = { dispose: () => { msgCb = null; } };
          disposables?.push(d);
          return d;
        },
      },
      receive: (m: unknown) => msgCb?.(m),
      hasMessageListener: () => msgCb != null,
      onDidDispose: (cb: () => void, _t: unknown, subs?: { dispose(): void }[]) => {
        disposeCbs.push(cb);
        const d = { dispose: () => {} };
        subs?.push(d);
        return d;
      },
      dispose: () => disposeCbs.forEach(cb => cb()),
    };
    panels.push(panel);
    return panel;
  }

  return {
    commands: {
      registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => {
        commands.set(id, fn);
        return { dispose: () => commands.delete(id) };
      },
    },
    window: {
      get activeTextEditor() { return state.activeTextEditor; },
      get visibleTextEditors() { return state.visibleTextEditors; },
      createWebviewPanel,
      showInformationMessage: (m: string) => { infoMsgs.push(m); return Promise.resolve(undefined); },
      showWarningMessage: (m: string) => { warnMsgs.push(m); return Promise.resolve(undefined); },
      onDidChangeTextEditorSelection: selections.on,
      registerWebviewPanelSerializer: (
        viewType: string, s: { deserializeWebviewPanel(p: unknown, st: unknown): Thenable<void> },
      ) => { serializers.set(viewType, s); return { dispose: () => serializers.delete(viewType) }; },
    },
    workspace: {
      get workspaceFolders() { return state.workspaceFolders; },
      onDidSaveTextDocument: saves.on,
      onDidChangeTextDocument: changes.on,
      onDidCloseTextDocument: closes.on,
      onDidChangeConfiguration: configChanges.on,
      applyEdit: (e: WorkspaceEdit) => {
        applied.push(e);
        if (state.applyResult) state.applyHook?.();
        return Promise.resolve(state.applyResult);
      },
      getConfiguration: (_section: string, _resource?: unknown) => ({
        get: (key: string) => config.get(key),
        update: (key: string, value: unknown, target: unknown) => {
          configWrites.push({ key, value, target });
          config.set(key, value);
          return Promise.resolve();
        },
      }),
    },
    ViewColumn: { Beside: 2 },
    TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    Range, Selection, WorkspaceEdit, Uri,
    __mock: {
      state, saves, changes, selections, closes, configChanges, commands, serializers,
      infoMsgs, warnMsgs, panels, applied, config, configWrites,
      reset() {
        // dispose any live panel first so extension.ts's module-level `active`
        // canvas clears (its onDidDispose sets active = null) — otherwise the
        // next test would reuse a stale panel instead of creating one
        (panels as FakePanel[]).forEach(p => p.dispose());
        saves.clear(); changes.clear(); selections.clear(); closes.clear();
        configChanges.clear();
        commands.clear(); serializers.clear();
        infoMsgs.length = 0; warnMsgs.length = 0;
        panels.length = 0; applied.length = 0;
        config.clear(); configWrites.length = 0;
        state.activeTextEditor = undefined;
        state.visibleTextEditors = [];
        state.workspaceFolders = undefined;
        state.applyHook = null;
        state.applyResult = true;
      },
    },
  };
});

/* ── harness over the stub ───────────────────────────────────────── */

// the extra export smuggled out of the mock factory
const M = (vscodeNs as unknown as { __mock: MockApi }).__mock;
interface MockApi {
  state: {
    activeTextEditor: unknown; visibleTextEditors: unknown[];
    applyHook: (() => void) | null; applyResult: boolean;
    workspaceFolders: unknown;
  };
  saves: { fire(e: unknown): void; count(): number };
  changes: { fire(e: unknown): void; count(): number };
  selections: { fire(e: unknown): void; count(): number };
  closes: { fire(e: unknown): void; count(): number };
  configChanges: { fire(e: unknown): void; count(): number };
  commands: Map<string, (...a: unknown[]) => unknown>;
  serializers: Map<string, { deserializeWebviewPanel(p: unknown, s: unknown): Thenable<void> }>;
  infoMsgs: string[]; warnMsgs: string[];
  panels: FakePanel[]; applied: { ops: { range: unknown; text: string }[] }[];
  config: Map<string, unknown>;
  configWrites: { key: string; value: unknown; target: unknown }[];
  reset(): void;
}
interface FakePanel {
  viewType: string; title: string;
  options: { enableScripts?: boolean; localResourceRoots?: { path: string }[] };
  posts: { type?: string; [k: string]: unknown }[];
  webview: { html: string };
  receive(m: unknown): void;
  hasMessageListener(): boolean;
  reveal(): void;
  revealCount(): number;
  onDidDispose(cb: () => void): void;
  dispose(): void;
}

/** A fake TextDocument: positions are opaque `{ offset }` wrappers. `path` is
    the URI path (`/`-separated; an untitled document's has no slash). */
function makeDoc(text: string, path = '/tpl.html') {
  const doc = {
    uri: { path },
    version: 1,
    getText: () => text,
    setText: (t: string) => { text = t; doc.version++; },
    positionAt: (offset: number) => ({ offset }),
    offsetAt: (p: { offset: number }) => p.offset,
  };
  return doc;
}

function makeEditor(doc: ReturnType<typeof makeDoc>) {
  return {
    document: doc,
    selection: null as unknown,
    revealed: [] as { range: unknown; how: unknown }[],
    revealRange(range: unknown, how: unknown) { this.revealed.push({ range, how }); },
  };
}

/** activate + run the command against `doc` as the active editor. */
function openWith(doc: ReturnType<typeof makeDoc>) {
  const editor = makeEditor(doc);
  M.state.activeTextEditor = editor;
  M.state.visibleTextEditors = [editor];
  const subscriptions: { dispose(): void }[] = [];
  activate({ subscriptions, extensionUri: { path: '/ext' } } as never);
  M.commands.get('bootstrapGridEditor.open')!();
  return { editor, subscriptions, panel: M.panels[M.panels.length - 1]! };
}

beforeEach(() => M.reset());

/* ── activation & panel ──────────────────────────────────────────── */

describe('activation and the open command', () => {
  it('activate registers the command into subscriptions', () => {
    const subscriptions: { dispose(): void }[] = [];
    activate({ subscriptions, extensionUri: { path: '/ext' } } as never);
    expect(M.commands.has('bootstrapGridEditor.open')).toBe(true);
    // the command plus the webview-panel serializer
    expect(subscriptions.length).toBe(2);
  });

  it('registers a webview serializer that disposes any restored panel', async () => {
    // VS Code restores persisted panels across restarts; we don't rehydrate, so
    // the serializer must dispose the blank restored frame rather than orphan it.
    const subscriptions: { dispose(): void }[] = [];
    activate({ subscriptions, extensionUri: { path: '/ext' } } as never);
    const serializer = M.serializers.get('bootstrapGridEditor');
    expect(serializer).toBeDefined();
    let disposed = false;
    await serializer!.deserializeWebviewPanel({ dispose: () => { disposed = true; } }, undefined);
    expect(disposed).toBe(true);
  });

  it('without an active editor: an info message, no panel', () => {
    const subscriptions: { dispose(): void }[] = [];
    activate({ subscriptions, extensionUri: { path: '/ext' } } as never);
    M.commands.get('bootstrapGridEditor.open')!();
    expect(M.infoMsgs.length).toBe(1);
    expect(M.panels.length).toBe(0);
  });

  it('titles the panel after the file it is bound to', () => {
    const { panel } = openWith(makeDoc('<p>x</p>', '/src/app/dashboard.component.html'));
    expect(panel.title).toBe('dashboard.component.html · Grid');
  });

  it('titles an untitled document by its name, not a blank', () => {
    // an untitled URI's path is just the label — no directory, no slash
    const { panel } = openWith(makeDoc('', 'Untitled-1'));
    expect(panel.title).toBe('Untitled-1 · Grid');
  });

  it('creates a script-enabled panel scoped to dist/webview', () => {
    const { panel } = openWith(makeDoc('<p>x</p>'));
    expect(panel.viewType).toBe('bootstrapGridEditor');
    expect(panel.options.enableScripts).toBe(true);
    expect(panel.options.localResourceRoots?.[0]?.path).toBe('/ext/dist/webview');
  });
});

describe('the webview HTML contract', () => {
  it('locks scripts to a nonce and pins the CSP', () => {
    const { panel } = openWith(makeDoc('<p>x</p>'));
    const html = panel.webview.html;
    const nonce = /nonce-([A-Za-z0-9]{32})/.exec(html)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).toContain(`default-src 'none'`);
    expect(html).toContain('webview:/ext/dist/webview/webview.js');
    expect(html).toContain('webview:/ext/dist/webview/webview.css');
  });

  it('contains every element id the shared editor resolves at boot', () => {
    // dom.ts looks these up by string; the webview also asserts them at boot
    // (assertRequiredIds in webview/main.ts). This mirrors that contract —
    // editor's REQUIRED_EDITOR_IDS plus the webview's own #resyncBtn — from
    // the HTML side. Keep in sync with editor/dom.ts (FOLLOW-UPS §4.2).
    const { panel } = openWith(makeDoc('<p>x</p>'));
    for (const id of ['sheet', 'rowsHost', 'inspector', 'bpSwitch', 'bpNote',
                      'findBox', 'findCount', 'ruler', 'toast', 'resyncBtn']) {
      expect(panel.webview.html).toContain(`id="${id}"`);
    }
  });
});

/* ── routing ─────────────────────────────────────────────────────── */

describe('event routing is filtered to the panel document', () => {
  it('ready → the current document is posted', async () => {
    const doc = makeDoc('<div class="row"></div>');
    const { panel } = openWith(doc);
    panel.receive({ type: 'ready' });
    await vi.waitFor(() => expect(panel.posts).toContainEqual(
      { type: 'setSource', text: '<div class="row"></div>' }));
  });

  // Editor events are queued inside Session (it owns the ordering), so the
  // post lands a microtask later — hence waitFor rather than a bare assert.
  it('a save of this document refreshes the canvas; another does not', async () => {
    const doc = makeDoc('<p>x</p>');
    const { panel } = openWith(doc);
    M.saves.fire(makeDoc('<p>other</p>'));
    M.saves.fire(doc);
    await vi.waitFor(() =>
      expect(panel.posts.filter(p => p.type === 'setSource')).toHaveLength(1));
  });

  it('a buffer change of this document flags divergence; another does not', async () => {
    const doc = makeDoc('<p>x</p>');
    // divergence is the liveSync-off behaviour; with it on the canvas refreshes
    M.config.set('liveSync', false);
    const { panel } = openWith(doc);
    M.changes.fire({ document: makeDoc('<p>other</p>') });
    M.changes.fire({ document: doc });
    await vi.waitFor(() =>
      expect(panel.posts.filter(p => p.type === 'diverged')).toHaveLength(1));
  });

  it('a caret move in this document selects at its offset; another does not', () => {
    const doc = makeDoc('<p>hello</p>');
    const { editor, panel } = openWith(doc);
    editor.selection = { start: { offset: 4 }, end: { offset: 4 }, active: { offset: 4 } };
    M.selections.fire({ textEditor: editor });
    expect(panel.posts).toContainEqual({ type: 'selectAt', offset: 4 });

    const other = makeEditor(makeDoc('<p>other</p>'));
    other.selection = { start: { offset: 1 }, end: { offset: 1 }, active: { offset: 1 } };
    M.selections.fire({ textEditor: other });
    expect(panel.posts.filter(p => p.type === 'selectAt')).toHaveLength(1);
  });
});

/* ── edits out & reveal ──────────────────────────────────────────── */

describe('edits out and reveal', () => {
  it('applyEdits becomes a workspace edit with the exact spans', async () => {
    const doc = makeDoc('<div class="col-6">x</div>');
    const { panel } = openWith(doc);
    M.state.applyHook = () => doc.setText('<div class="col-4">x</div>');
    panel.receive({
      type: 'applyEdits',
      edits: [{ start: 12, end: 17, text: 'col-4' }],
    });
    // the message handler is fire-and-forget; wait for the async apply chain
    await vi.waitFor(() =>
      expect(panel.posts).toContainEqual({ type: 'applied' }));
    expect(M.applied).toHaveLength(1);
    const op = M.applied[0]!.ops[0]!;
    expect(op.text).toBe('col-4');
    expect((op.range as { start: { offset: number }; end: { offset: number } }).start.offset).toBe(12);
    expect((op.range as { start: { offset: number }; end: { offset: number } }).end.offset).toBe(17);
  });

  it('reveal drives the visible editor selection and scroll', async () => {
    const doc = makeDoc('<p>hello world</p>');
    const { editor, panel } = openWith(doc);
    panel.receive({ type: 'reveal', start: 3, end: 8 });
    // onMessage now serializes through a promise queue, so the handler runs on
    // a microtask; wait for its effect rather than asserting synchronously.
    await vi.waitFor(() => expect(editor.revealed).toHaveLength(1));
    expect((editor.selection as { start: { offset: number } }).start.offset).toBe(3);
  });

  it('reveal is a no-op when the document has no visible editor', () => {
    const doc = makeDoc('<p>x</p>');
    const { panel } = openWith(doc);
    M.state.visibleTextEditors = [];
    expect(() => panel.receive({ type: 'reveal', start: 0, end: 1 })).not.toThrow();
  });
});

/* ── settings ────────────────────────────────────────────────────── */

describe('user settings', () => {
  it('seeds the webview from workspace config, before the source', async () => {
    M.config.set('defaultBreakpoint', 'lg');
    M.config.set('stretchToFit', true);
    const { panel } = openWith(makeDoc('<p>x</p>'));
    panel.receive({ type: 'ready' });
    await vi.waitFor(() => expect(panel.posts.some(p => p.type === 'config')).toBe(true));
    const cfgIdx = panel.posts.findIndex(p => p.type === 'config');
    const srcIdx = panel.posts.findIndex(p => p.type === 'setSource');
    expect(cfgIdx).toBeGreaterThanOrEqual(0);
    expect(cfgIdx).toBeLessThan(srcIdx);   // config must arrive before the source
    expect((panel.posts[cfgIdx] as { config: unknown }).config)
      .toMatchObject({ breakpoint: 'lg', stretchSheet: true });
  });

  it('a canvas view-toggle writes back to global user settings', async () => {
    const { panel } = openWith(makeDoc('<p>x</p>'));
    panel.receive({ type: 'setConfig', change: { pref: 'tintOverfull', value: true } });
    // handled on a microtask now (onMessage serializes through a queue)
    await vi.waitFor(() => expect(M.configWrites).toContainEqual(
      { key: 'tintOverfullRows', value: true, target: 1 }));   // 1 = ConfigurationTarget.Global
    expect(M.config.get('tintOverfullRows')).toBe(true);
  });

  it('seeds the canvas with the class convention', async () => {
    M.config.set('newRowClasses', 'clearfix form-group');
    M.config.set('newColumnClasses', 'px-2');
    const { panel } = openWith(makeDoc('<p>x</p>'));
    panel.receive({ type: 'ready' });
    await vi.waitFor(() => expect(panel.posts.some(p => p.type === 'config')).toBe(true));
    const cfg = panel.posts.find(p => p.type === 'config') as { config: unknown };
    expect(cfg.config).toMatchObject({
      newRowClasses: 'clearfix form-group', newColumnClasses: 'px-2',
    });
  });

  it('the class convention is written to the workspace, not the user, when there is one', async () => {
    // it's a property of the project's markup, and it's resource-scoped — a
    // global write would lose to a committed .vscode/settings.json
    M.state.workspaceFolders = [{ uri: {} }];
    const { panel } = openWith(makeDoc('<p>x</p>'));
    panel.receive({ type: 'setConfig', change: { pref: 'newRowClasses', value: 'clearfix' } });
    await vi.waitFor(() => expect(M.configWrites).toContainEqual(
      { key: 'newRowClasses', value: 'clearfix', target: 2 }));   // 2 = Workspace
  });

  it('falls back to user settings for the convention with no workspace open', async () => {
    const { panel } = openWith(makeDoc('<p>x</p>'));
    panel.receive({ type: 'setConfig', change: { pref: 'newColumnClasses', value: 'px-2' } });
    await vi.waitFor(() => expect(M.configWrites).toContainEqual(
      { key: 'newColumnClasses', value: 'px-2', target: 1 }));    // 1 = Global
  });

  it('the header version chip writes the dialect to the workspace settings', async () => {
    // same reasoning as the convention: which Bootstrap a project is on is a
    // property of the project, and the setting is resource-scoped
    M.state.workspaceFolders = [{ uri: {} }];
    const { panel } = openWith(makeDoc('<p>x</p>'));
    panel.receive({ type: 'setConfig', change: { pref: 'dialect', value: 'bootstrap3' } });
    await vi.waitFor(() => expect(M.configWrites).toContainEqual(
      { key: 'dialect', value: 'bootstrap3', target: 2 }));       // 2 = Workspace
  });

  it('the version chip falls back to user settings with no workspace open', async () => {
    const { panel } = openWith(makeDoc('<p>x</p>'));
    panel.receive({ type: 'setConfig', change: { pref: 'dialect', value: 'bootstrap3' } });
    await vi.waitFor(() => expect(M.configWrites).toContainEqual(
      { key: 'dialect', value: 'bootstrap3', target: 1 }));       // 1 = Global
  });

  it('the webview HTML carries the chip\'s mount point', () => {
    // the shared editor asserts this id at boot (REQUIRED_EDITOR_IDS), so a
    // webview shell missing it fails the panel outright
    const { panel } = openWith(makeDoc('<p>x</p>'));
    expect(panel.webview.html).toContain('id="dialectChip"');
  });

  it('a convention edited in settings reaches an already-open panel', async () => {
    const { panel } = openWith(makeDoc('<p>x</p>'));
    panel.receive({ type: 'ready' });
    await vi.waitFor(() => expect(panel.posts.some(p => p.type === 'config')).toBe(true));
    M.config.set('newRowClasses', 'clearfix');
    M.configChanges.fire({ affectsConfiguration: (s: string) => s.endsWith('newRowClasses') });
    const msg = panel.posts.find(p => p.type === 'liveSettings') as { config: unknown };
    expect(msg.config).toMatchObject({ newRowClasses: 'clearfix' });
  });

  it('a dialect edited in settings reaches an already-open panel', async () => {
    // hand-editing .vscode/settings.json is the documented way to commit this
    // for a project, so it can't be a setting that only lands on reopen
    const { panel } = openWith(makeDoc('<p>x</p>'));
    panel.receive({ type: 'ready' });
    await vi.waitFor(() => expect(panel.posts.some(p => p.type === 'config')).toBe(true));
    M.config.set('dialect', 'bootstrap3');
    M.configChanges.fire({ affectsConfiguration: (s: string) => s.endsWith('dialect') });
    const msg = panel.posts.find(p => p.type === 'liveSettings') as { config: unknown };
    expect(msg.config).toMatchObject({ dialect: 'bootstrap3' });
  });

  it('an unrelated settings change does not disturb an open panel', async () => {
    const { panel } = openWith(makeDoc('<p>x</p>'));
    panel.receive({ type: 'ready' });
    await vi.waitFor(() => expect(panel.posts.some(p => p.type === 'config')).toBe(true));
    // re-seeding the whole config would yank the breakpoint the user has since
    // changed on the canvas — only the convention and the dialect are live
    M.configChanges.fire({ affectsConfiguration: (s: string) => s.endsWith('defaultBreakpoint') });
    expect(panel.posts.some(p => p.type === 'liveSettings')).toBe(false);
  });
});

/* ── single reusable panel ───────────────────────────────────────── */

/** Invoke the open command with `doc` as the active editor (a second+ open). */
function runOpenOn(doc: ReturnType<typeof makeDoc>) {
  const editor = makeEditor(doc);
  M.state.activeTextEditor = editor;
  M.state.visibleTextEditors = [editor];
  M.commands.get('bootstrapGridEditor.open')!();
  return editor;
}

describe('one reusable panel', () => {
  it('opening again re-points the single panel at the new file', async () => {
    const docA = makeDoc('<p>A</p>');
    const { panel } = openWith(docA);
    panel.receive({ type: 'ready' });
    expect(M.panels.length).toBe(1);

    const docB = makeDoc('<div class="row">B</div>');
    runOpenOn(docB);

    expect(M.panels.length).toBe(1);          // no second panel spawned
    expect(panel.revealCount()).toBe(1);      // the canvas is brought to front
    // the canvas now shows docB
    await vi.waitFor(() => expect(panel.posts).toContainEqual(
      { type: 'setSource', text: '<div class="row">B</div>' }));

    // routing now follows docB and no longer docA
    const n = panel.posts.filter(p => p.type === 'setSource').length;
    M.saves.fire(docA);
    M.saves.fire(docB);
    await vi.waitFor(() =>
      expect(panel.posts.filter(p => p.type === 'setSource').length).toBe(n + 1));
    // the old file's save was ignored — only docB's resend arrived
    expect(panel.posts.filter(p => p.type === 'setSource').length).toBe(n + 1);
  });

  it('re-pointing renames the tab to the new file', () => {
    const { panel } = openWith(makeDoc('<p>A</p>', '/a/first.component.html'));
    expect(panel.title).toBe('first.component.html · Grid');
    runOpenOn(makeDoc('<p>B</p>', '/b/second.component.html'));
    // same panel, new name — the one signal of which file the canvas shows
    expect(M.panels.length).toBe(1);
    expect(panel.title).toBe('second.component.html · Grid');
  });

  it('after the panel is closed, opening builds a fresh one', () => {
    const { panel } = openWith(makeDoc('<p>x</p>'));
    expect(M.panels.length).toBe(1);
    panel.dispose();
    runOpenOn(makeDoc('<p>y</p>'));
    expect(M.panels.length).toBe(2);          // a new canvas, not a reuse of the disposed one
  });
});

/* ── the bound file closing ──────────────────────────────────────── */

describe('closing the bound file closes the canvas', () => {
  it('the document\'s last editor closing disposes the panel', () => {
    const doc = makeDoc('<p>x</p>');
    const { panel } = openWith(doc);
    let disposed = false;
    panel.onDidDispose(() => { disposed = true; });

    M.closes.fire(doc);

    expect(disposed).toBe(true);
    // the same teardown as the user closing the tab: listeners gone …
    expect(M.saves.count() + M.changes.count() + M.selections.count() + M.closes.count()).toBe(0);
    // … and the next open builds a fresh canvas rather than reviving this one
    runOpenOn(makeDoc('<p>y</p>'));
    expect(M.panels.length).toBe(2);
  });

  it('another document closing leaves the canvas alone', () => {
    const doc = makeDoc('<p>x</p>');
    const { panel } = openWith(doc);
    let disposed = false;
    panel.onDidDispose(() => { disposed = true; });

    M.closes.fire(makeDoc('<p>other</p>', '/other.html'));

    expect(disposed).toBe(false);
    expect(M.closes.count()).toBe(1);
  });

  it('after a re-point, it is the new file whose close counts', () => {
    const docA = makeDoc('<p>A</p>', '/a.html');
    const { panel } = openWith(docA);
    let disposed = false;
    panel.onDidDispose(() => { disposed = true; });
    const docB = makeDoc('<p>B</p>', '/b.html');
    runOpenOn(docB);

    M.closes.fire(docA);                 // the file the canvas has moved off
    expect(disposed).toBe(false);
    M.closes.fire(docB);                 // the file it now shows
    expect(disposed).toBe(true);
  });
});

/* ── disposal ────────────────────────────────────────────────────── */

describe('panel disposal detaches every listener', () => {
  it('save/change/selection/message routing all stop', () => {
    const doc = makeDoc('<p>x</p>');
    const { panel } = openWith(doc);
    expect(M.saves.count() + M.changes.count() + M.selections.count() + M.closes.count()).toBe(4);
    expect(panel.hasMessageListener()).toBe(true);

    panel.dispose();

    expect(M.saves.count() + M.changes.count() + M.selections.count() + M.closes.count()).toBe(0);
    expect(panel.hasMessageListener()).toBe(false);
    // a late save must not reach the disposed panel
    M.saves.fire(doc);
    expect(panel.posts.filter(p => p.type === 'setSource')).toHaveLength(0);
  });
});

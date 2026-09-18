/* Extension host (Node). Activation, the "Open Grid Editor" command, the
   webview panel, and the source-in / edits-out / reveal bridge.

   Sync model (PLAN.md, decisions §3/§6): the editor document is the source of
   truth. The canvas renders it; canvas edits apply to the *buffer* as minimal
   workspace edits (not disk). On save the canvas refreshes from source. If
   the user edits the document under the canvas, the webview is told it has
   diverged and holds further canvas edits until a save or a Discard resyncs.
   Undo is the editor's native undo. */

import * as vscode from 'vscode';
import type {
  ConfigWire, HostMessage, PrefChange, WebviewMessage,
} from '../shared/protocol.js';
import { Session, type SessionPorts } from './session.js';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('bootstrapGridEditor.open', () => openPanel(context)),
    // VS Code persists open webview panels across window restarts and tries to
    // restore them. We deliberately don't rehydrate: a canvas is bound to a
    // specific document that may no longer exist (or be open) on reopen, and a
    // fresh start has no `active` canvas to adopt it — so an unhandled restore
    // shows up as a blank, orphaned panel. Dispose it instead, leaving a clean
    // slate the user reopens from the command. (Needs the
    // `onWebviewPanel:bootstrapGridEditor` activation event so we're alive to
    // handle the restore at all.)
    vscode.window.registerWebviewPanelSerializer('bootstrapGridEditor', {
      deserializeWebviewPanel(panel) {
        panel.dispose();
        return Promise.resolve();
      },
    }),
  );
}

/** The one live canvas, if any. A single reusable panel: re-pointed at the
    current document rather than spawning another (FOLLOW-UPS §9.2). */
interface Canvas {
  panel: vscode.WebviewPanel;
  /** Re-point at a different editor's document and show the canvas. */
  bind(editor: vscode.TextEditor): void;
}
let active: Canvas | null = null;

function openPanel(context: vscode.ExtensionContext): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage(
      'Open an HTML/Angular template first, then run "Open Grid Editor".');
    return;
  }
  // reuse the existing canvas — re-point it at this file — rather than making
  // a second one that would go out of sync
  if (active) {
    active.bind(editor);
    return;
  }
  active = createCanvas(context, editor);
}

function createCanvas(context: vscode.ExtensionContext, initial: vscode.TextEditor): Canvas {
  // The bound document is mutable so one panel can serve any file: every port
  // and listener below reads `doc`, so reassigning it re-points them all.
  let doc = initial.document;

  const panel = vscode.window.createWebviewPanel(
    'bootstrapGridEditor',
    panelTitle(doc),
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
    },
  );
  panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

  // All sync state/decisions live in Session; this wires VS Code to its ports.
  const session = new Session(createSessionPorts(
    () => doc, msg => void panel.webview.postMessage(msg)));

  const disposables: vscode.Disposable[] = [];

  // Cancel any pending live-sync refresh when the panel goes away.
  disposables.push({ dispose: () => session.dispose() });

  // Both handlers are fire-and-forget: Session queues the work and owns the
  // ordering (its `enqueue`), so nothing here needs to wait for it.
  disposables.push(vscode.workspace.onDidSaveTextDocument(saved => {
    if (saved === doc) void session.onSave();
  }));

  disposables.push(vscode.workspace.onDidChangeTextDocument(ev => {
    if (ev.document === doc) void session.onDocChange();
  }));

  disposables.push(vscode.workspace.onDidChangeConfiguration(ev => {
    if (isLiveSetting(ev)) session.onLiveSettingChange();
  }));

  disposables.push(vscode.window.onDidChangeTextEditorSelection(ev => {
    if (ev.textEditor.document !== doc) return;
    const sel = ev.textEditor.selection;
    session.onEditorSelection(
      doc.offsetAt(sel.start), doc.offsetAt(sel.end), doc.offsetAt(sel.active));
  }));

  panel.webview.onDidReceiveMessage(
    (msg: WebviewMessage) => void session.onMessage(msg), undefined, disposables);

  panel.onDidDispose(() => {
    disposables.forEach(d => d.dispose());
    active = null;                 // let the next open build a fresh canvas
  }, null, context.subscriptions);
  context.subscriptions.push(panel);

  return {
    panel,
    bind(editor) {
      doc = editor.document;       // re-point every port/listener at once
      panel.title = panelTitle(doc);
      void session.reload();       // resend the new file's source, reset sync
      panel.reveal();              // bring the canvas to front, focused
    },
  };
}

/** The panel's tab label. It names the bound file because the canvas doesn't
    follow the active editor: one panel is re-pointed by `bind`, so without
    the name here a canvas can sit beside a file it isn't showing with nothing
    to say so. The file name comes first and the marker last because a tab
    truncates from the end — what survives is the part that changes.

    `uri.path` rather than `fileName`: a URI path is `/`-separated on every
    platform, and an untitled document's path (`Untitled-1`) has no separator
    at all, so the last segment is the right answer for both. */
function panelTitle(doc: vscode.TextDocument): string {
  const name = doc.uri.path.split('/').pop() || doc.uri.path;
  return `${name} · Grid`;
}

/** Everything a `Session` needs from VS Code, in one place.

    `doc()` is called per use rather than captured, so a panel re-pointed at
    another file re-points every port at once. Exported because it *is* the
    edits-out seam — the integration suite drives the real thing through this
    factory (a real `TextDocument`, a real `WorkspaceEdit`) instead of
    re-describing how offsets reach the buffer and risking that its copy is the
    one that's right. */
export function createSessionPorts(
  doc: () => vscode.TextDocument, post: (msg: HostMessage) => void,
): SessionPorts {
  return {
    post,
    reveal: (start, end) => revealInEditor(doc(), start, end),
    applyEdit: async edits => {
      const d = doc();
      const edit = new vscode.WorkspaceEdit();
      for (const e of edits) {
        edit.replace(d.uri, new vscode.Range(d.positionAt(e.start), d.positionAt(e.end)), e.text);
      }
      return vscode.workspace.applyEdit(edit);
    },
    docText: () => doc().getText(),
    warn: message => void vscode.window.showWarningMessage(message),
    config: () => readConfig(doc().uri),
    setConfig: change => {
      void vscode.workspace.getConfiguration('bootstrapGridEditor', doc().uri)
        .update(SETTING_KEY[change.pref], change.value, writeTarget(change.pref));
    },
  };
}

/** Canvas preference → the settings key that stores it. An exhaustive map, not
    a conditional: a new preference then fails to compile until it has a home,
    instead of silently writing to the wrong key. */
const SETTING_KEY: Record<PrefChange['pref'], string> = {
  stretchSheet: 'stretchToFit',
  tintOverfull: 'tintOverfullRows',
  newRowClasses: 'newRowClasses',
  newColumnClasses: 'newColumnClasses',
  dialect: 'dialect',
};

/** Where a canvas-written setting goes. The view toggles are personal, so they
    stay user-global. The class convention and the Bootstrap version describe
    the *project's* markup, so they belong to the workspace when there is one
    — and they have to: both are `resource`-scoped, so a value committed in
    `.vscode/settings.json` would shadow a global write and the control would
    appear not to stick. */
function writeTarget(pref: PrefChange['pref']): vscode.ConfigurationTarget {
  const perProject = pref === 'newRowClasses' || pref === 'newColumnClasses' ||
    pref === 'dialect';
  return perProject && vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

/** The settings whose changes reach an already-open canvas: the class
    convention and the Bootstrap version. The rest seed the canvas at open, and
    re-applying them mid-session would yank the breakpoint or a view toggle
    back from under someone who changed it on the canvas.

    These three are live because the canvas *writes* them too — a panel holding
    a stale copy would clobber an edit made in settings.json — and because
    they're the settings a project commits, so editing the file by hand is the
    documented way in, not a corner case. */
export function isLiveSetting(e: { affectsConfiguration(section: string): boolean }): boolean {
  return e.affectsConfiguration('bootstrapGridEditor.newRowClasses') ||
    e.affectsConfiguration('bootstrapGridEditor.newColumnClasses') ||
    e.affectsConfiguration('bootstrapGridEditor.dialect');
}

/** The user's settings, read fresh at panel open. Defaults here mirror the
    package.json contribution defaults (and the canvas built-ins). */
function readConfig(resource?: vscode.Uri): ConfigWire {
  // Scoped to the document: the class convention is `resource`-scoped, so a
  // project's committed .vscode/settings.json is what its own templates get.
  const c = vscode.workspace.getConfiguration('bootstrapGridEditor', resource);
  return {
    breakpoint: c.get<ConfigWire['breakpoint']>('defaultBreakpoint'),
    stretchSheet: c.get<boolean>('stretchToFit'),
    tintOverfull: c.get<boolean>('tintOverfullRows'),
    dialect: c.get<ConfigWire['dialect']>('dialect'),
    newRowClasses: c.get<string>('newRowClasses'),
    newColumnClasses: c.get<string>('newColumnClasses'),
    liveSync: c.get<boolean>('liveSync'),
  };
}

function revealInEditor(doc: vscode.TextDocument, start: number, end: number): void {
  const editor = vscode.window.visibleTextEditors.find(e => e.document === doc);
  if (!editor) return;
  const range = new vscode.Range(doc.positionAt(start), doc.positionAt(end));
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const asset = (name: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', name));
  const scriptUri = asset('webview.js');
  const styleUri = asset('webview.css');
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    // element.style.* set by the renderer is fine; 'unsafe-inline' covers the
    // inspector's inline style="" attributes. Scripts stay nonce-locked.
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Grid Editor</title>
</head>
<body>
  <header>
    <div class="brand"><b>GRID·DRAFT</b><span>Bootstrap grid editor</span></div>
    <div class="bp-switch" id="bpSwitch" role="tablist" aria-label="Breakpoint"></div>
    <div class="bp-note" id="bpNote"></div>
    <div class="dialect-chip" id="dialectChip"></div>
    <div class="spacer"></div>
    <button id="resyncBtn" title="Reset the canvas to the current editor contents">⟳ Resync</button>
  </header>

  <main>
    <section class="pane-canvas">
      <div class="pane-head">Layout — schematic, not a render
        <span class="spacer"></span>
        <span id="findCount"></span>
        <input id="findBox" type="text" placeholder="find… ( / )" spellcheck="false" aria-label="Find field">
      </div>
      <div class="canvas-scroll">
        <div class="sheet" id="sheet">
          <div class="ruler" id="ruler"></div>
          <div class="rows-host" id="rowsHost"></div>
        </div>
      </div>
    </section>

    <aside class="pane-inspector" id="inspector" aria-label="Inspector"></aside>
  </main>

  <div class="toast" id="toast"></div>

  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

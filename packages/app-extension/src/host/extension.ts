/* Extension host (Node). Activation, the "Open Grid Visualizer" command, the
   webview panel, and the source-in / edits-out / reveal bridge.

   Sync model (PLAN.md, decisions §3/§6): the editor document is the source of
   truth. The canvas renders it; canvas edits apply to the *buffer* as minimal
   workspace edits (not disk). On save the canvas refreshes from source. If
   the user edits the document under the canvas, the webview is told it has
   diverged and holds further canvas edits until a save or a Discard resyncs.
   Undo is the editor's native undo. */

import * as vscode from 'vscode';
import type { HostMessage, WebviewMessage } from '../shared/protocol.js';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('bootstrapVisualizer.open', () => openPanel(context)),
  );
}

function openPanel(context: vscode.ExtensionContext): void {
  const sourceEditor = vscode.window.activeTextEditor;
  if (!sourceEditor) {
    void vscode.window.showInformationMessage(
      'Open an HTML/Angular template first, then run "Open Grid Visualizer".');
    return;
  }
  const doc = sourceEditor.document;

  const panel = vscode.window.createWebviewPanel(
    'bootstrapVisualizer',
    'Grid Visualizer',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
    },
  );
  panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

  const disposables: vscode.Disposable[] = [];
  let applying = false;   // our own buffer edits must not read as user divergence

  const sendSource = () =>
    post(panel, { type: 'setSource', text: doc.getText(), version: doc.version });

  disposables.push(vscode.workspace.onDidSaveTextDocument(saved => {
    if (saved === doc) sendSource();          // refresh from source on save
  }));

  disposables.push(vscode.workspace.onDidChangeTextDocument(ev => {
    if (ev.document !== doc || applying) return;
    post(panel, { type: 'diverged' });        // the user edited under the canvas
  }));

  panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
    switch (msg.type) {
      case 'ready':
        sendSource();
        break;
      case 'reveal':
        revealInEditor(doc, msg.start, msg.end);
        break;
      case 'discard':
        sendSource();                         // reset the canvas to the buffer
        break;
      case 'applyEdits':
        if (msg.baseVersion !== doc.version) {
          post(panel, { type: 'diverged' });
          void vscode.window.showWarningMessage(
            'The canvas is out of sync with the editor — Resync (or save) first.');
          return;
        }
        applying = true;
        try {
          const edit = new vscode.WorkspaceEdit();
          for (const e of msg.edits) {
            edit.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
          }
          const ok = await vscode.workspace.applyEdit(edit);
          if (ok) post(panel, { type: 'applied', version: doc.version });
          else { void vscode.window.showWarningMessage('Could not apply the canvas edit.'); sendSource(); }
        } finally {
          applying = false;
        }
        break;
    }
  }, undefined, disposables);

  panel.onDidDispose(() => disposables.forEach(d => d.dispose()), null, context.subscriptions);
  context.subscriptions.push(panel);
}

function post(panel: vscode.WebviewPanel, msg: HostMessage): void {
  void panel.webview.postMessage(msg);
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
  <title>Grid Visualizer</title>
</head>
<body>
  <header>
    <div class="brand"><b>GRID·DRAFT</b><span>Bootstrap grid visualizer</span></div>
    <div class="bp-switch" id="bpSwitch" role="tablist" aria-label="Breakpoint"></div>
    <div class="bp-note" id="bpNote"></div>
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

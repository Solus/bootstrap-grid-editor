/* Extension host (Node). Activation, the "Open Grid Visualizer" command, the
   webview panel, and the source-in / reveal-out message bridge.

   First slice: send the active document to the webview (on open); reveal a
   canvas selection back in the editor. Applying canvas edits to the buffer,
   refreshing on save, and the guard/undo model are the next slice. */

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

  const doc = sourceEditor.document;

  panel.webview.onDidReceiveMessage((msg: WebviewMessage) => {
    switch (msg.type) {
      case 'ready':
        post(panel, { type: 'setSource', text: doc.getText(), version: doc.version });
        break;
      case 'reveal':
        revealInEditor(doc, msg.start, msg.end);
        break;
      case 'applyEdits':
        // next slice: replay msg.edits onto doc as a minimal WorkspaceEdit,
        // guarding on msg.baseVersion vs doc.version
        break;
    }
  }, undefined, context.subscriptions);
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
    // element.style.* set by the renderer is allowed; 'unsafe-inline' covers
    // the inspector's inline style="" attributes. Scripts stay nonce-locked.
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
    <button id="undoBtn" title="Undo (Ctrl+Z)">↶ Undo</button>
    <button id="redoBtn" title="Redo (Ctrl+Y)">↷ Redo</button>
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

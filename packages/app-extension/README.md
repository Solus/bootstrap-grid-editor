# Bootstrap Grid Visualizer

A VS Code extension that renders a schematic of the Bootstrap grid in an
Angular/HTML template and lets you edit it visually — resize, split, move,
and offset columns — writing the changes back to the document **surgically**
(only the edited spans change; formatting, comments, and directives are
preserved).

## Use

1. Open an HTML / Angular template with `.row` / `col-*` markup.
2. Run **Open Grid Visualizer** — from the command palette, the editor
   title bar (the layout icon on `.html` files), or the right-click menu.
3. A canvas opens beside the editor:
   - Click a column/row to select it; the matching source is revealed, and
     moving the editor caret selects the matching block back.
   - Edit with the inspector steppers, drag-resize, or drag-and-drop.
   - Edits apply to the **editor buffer immediately** — press **Ctrl+S** to
     save. Undo with the editor's normal **Ctrl+Z**.
   - If you edit the document directly while the canvas is open, it flags a
     mismatch; click **⟳ Resync** (or save) to refresh the canvas.

## Install (internal `.vsix`)

```sh
# from the repo root
npm install
npm run package -w bootstrap-visualizer-extension   # produces a .vsix
```

Then in VS Code: **Extensions → ⋯ → Install from VSIX…**, or:

```sh
code --install-extension bootstrap-visualizer-extension-0.0.1.vsix
```

## Notes

- The extension is HTML-only: it reads the template, never runs your
  toolchain.
- This build bundles the Angular template compiler into the webview, so the
  panel is a little heavy to load; a lighter build is planned.

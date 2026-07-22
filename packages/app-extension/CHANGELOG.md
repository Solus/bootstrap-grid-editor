# Change Log

## 0.0.1

- Initial internal release.
- Open a webview canvas beside an HTML/Angular template that renders its
  Bootstrap grid schematically.
- Select a column/row on the canvas to reveal it in the editor; moving the
  editor caret selects the matching block back.
- Edit visually — inspector steppers, drag-resize, drag-and-drop, split,
  move, delete — with changes applied to the editor buffer immediately
  (save with Ctrl+S, undo with the editor's native undo).
- Guards against editing the document under the canvas, with a Resync to
  refresh from source.

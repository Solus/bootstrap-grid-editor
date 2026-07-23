# Change Log

## 0.0.4

- Added: an `@if` wrapping nested rows inside a container column now gets
  the same bounding box + toggle chip as in-row regions (was a flat chip
  bar), with an in-place placeholder when hidden.
- Fixed: a column wrapping its rows in `@if` no longer loses its container
  (⊞) status — the `@if (…) { … }` scaffolding is treated as structure,
  not loose content text.

## 0.0.3

- Added: `@if`/`@else`/`@else if` are now modeled as conditional regions.
  The active branch renders inside a labeled bounding box sitting at its
  grid position; the chip on the box's top edge toggles which branch shows
  (`⇄` cycles branches; a lone `@if` toggles visibility `◉`/`○`). The fill
  pill reflects the shown branch's real `N/12` (no more `~unreliable` for
  modeled `@if`). Toggling is view-only — it never edits the document.
- Added: `*ngIf` on a column is modeled the same way, as a single-branch
  show/hide box (`; else tpl` references stay flat).
- Visual edits (resize/add/split/delete/move) work inside the shown branch;
  moving a column across a branch boundary is blocked with a hint.
- `@for`/`@switch` and `*ngFor` remain flattened, as before.

## 0.0.2

- Fixed: clicking a column on the canvas could select its parent row
  instead — the editor reveal was echoing back as a caret move. The
  canvas now stays on the clicked column.

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

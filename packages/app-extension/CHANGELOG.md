# Change Log

## 0.0.13

- Fixed: adding or dragging several columns one after another no longer blocks
  you with a false "the editor changed under the canvas" after the first one.
  Rapid canvas edits are now applied in order, so you can add or move as many
  as you like without having to save in between.
- Fixed: editing the file by hand under the canvas no longer repeats the
  "Resync" warning on every keystroke — it's shown once, when the canvas first
  goes out of sync.

## 0.0.12

- Fixed: the offset stepper (under "Effective at …") now changes only one
  breakpoint — the tier already in the column, or the closest to it — just like
  the width stepper. Stepping it down to 0 removes that offset class instead of
  leaving a leftover like `col-sm-offset-1 col-md-offset-0`.
- Fixed: adding a column (or row) can no longer land in the wrong place. If the
  file changed underneath the canvas, an insertion is now verified against its
  surroundings and refused with a Resync prompt, rather than being spliced into
  the middle of another element.

## 0.0.11

- Fixed: a column resize could occasionally write broken HTML (like
  `class=col-sm-42"`) after a run of edits, if something else changed the file
  underneath the canvas. Edits now carry the exact text they expect to replace
  and are verified against the file before applying — on a mismatch the canvas
  refuses and asks you to Resync, rather than corrupting the class.

## 0.0.10

- Fixed: dragging a column onto text — the editor, or the source pane — no
  longer types stray text (like `1,0`) into it. The drag no longer carries a
  plain-text payload.
- Fixed: a column drag that leaves the canvas now cancels cleanly and the
  canvas returns to its resting state, instead of looking like it's still
  waiting for a drop. Drops are also more forgiving as you move across the
  canvas (over gaps, past the ruler) rather than only landing on a narrow slot.
- Fixed: a `*ngIf` element can now be moved freely. Because the condition lives
  on the element itself (not wrapping braces like an `@if` block), moving it
  carries the `*ngIf` along — so it's no longer blocked as a "branch boundary".

## 0.0.9

- Fixed: reopening VS Code no longer greets you with a blank Grid Visualizer
  panel. A canvas is tied to a specific file, which may not exist on reopen, so
  a panel VS Code restores now closes itself instead of lingering empty (and
  orphaned) — just reopen it from "Open Grid Visualizer".
- Changed: the "Open Grid Visualizer" button icon reads more clearly as a
  responsive grid — two mirrored rows of a wide + a narrow column — instead of
  looking like a camera at small sizes.
- Fixed: the canvas is harder to break. If a single row or an edit can't be
  drawn, that row is skipped in place (or the edit is rejected) with a notice,
  and the rest of the layout still renders — rather than the whole canvas going
  blank.

## 0.0.8

- Added: `d-*` display utilities are now understood. A column hidden at the
  current breakpoint (`d-none`, `d-md-none`, `d-none d-lg-block`, …) takes no
  grid space and drops out of the `N/12` — so the layout and fill match what
  the browser would show. A thin dashed marker sits where the column is, and
  columns can still be dropped on either side of it (including a hidden last
  column). Switch the breakpoint to bring hidden columns back.
- Changed: reopening "Open Grid Visualizer" now reuses the single canvas,
  re-pointing it at the current file, instead of spawning another panel.
- Fixed: moving a column with the inspector's Move buttons no longer
  deselects it, so you can move it again right away.

## 0.0.7

- Added: four settings (Bootstrap Grid Visualizer section) — default
  breakpoint, start stretched to fit, start with overfull rows tinted, and
  the class dialect (Bootstrap 4/5 vs 3) for new columns on a blank file. The
  Stretch and Tint checkboxes in the canvas write themselves back, so they're
  remembered next open.
- Added: a proper extension icon, and a distinctive grid icon for the "Open
  Grid Visualizer" button (was a generic layout icon easily confused with
  VS Code's own editor-layout controls).
- Changed: the fill pill now marks *every* estimated width with `~`, and a row
  that only overflows because of a guessed width reads "→ may wrap" instead of
  a definitive "→ wraps".

## 0.0.6

- Added: a top-level `@if`/`@else` wrapping whole rows (and a row-level
  `*ngIf`) is now a first-class conditional region — the active branch's
  rows render inside the same bounding box + toggle chip as in-row and
  in-column regions, and a hidden region collapses to a thin chip strip
  in place. Every conditional position now shares one look and one
  toggle model.
- Moving a row across an `@if` branch boundary is blocked with a hint,
  matching columns.
- Internal: the extension's VS Code wiring (activation, panel, event
  routing, edit replay, disposal) is now covered by tests.

## 0.0.5

- Changed: a hidden `@if`/`*ngIf` region no longer occupies any grid
  width — the remaining columns lay out exactly as Angular would render
  them (a lone `col-12` spans the full row). Its toggle chip relocates
  to the row's top edge next to the fill pill, labeled with a short
  condition snippet; chips shrink and ellipsize when several stack up.
  In-column hidden regions collapse to a thin chip-only line.
- Added: a "Stretch to fit" View option lets the sheet use the whole
  canvas panel instead of the breakpoint's representative width —
  proportions are unchanged; useful for crowded nested layouts.

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

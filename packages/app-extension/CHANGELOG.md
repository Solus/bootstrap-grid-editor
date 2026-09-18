# Change Log

All notable changes to this extension are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The canvas's "No `.row` elements found" message told you to paste a template
  on the left and press **Apply changes** or **Load sample** — controls that
  exist only in the standalone web app, not in VS Code. It now points at what
  the panel actually has: **Add row** in the inspector, or reopening the Grid
  Editor on a file that has a grid.
- The canvas tab is titled after the file it shows (`dashboard.component.html
  · Grid`) instead of a fixed "Grid Editor", and renames when you run
  **Open Grid Editor** on another file. The one panel is re-pointed rather than
  duplicated, so this is the only place that said which file it was showing.
- Closing the file the canvas is bound to now closes the canvas too. It used to
  stay open over a buffer nobody could see: clicking a column no longer jumped
  to the source, and canvas edits landed in a document with no editor.
- **Open Grid Editor** is now offered in the command palette only while an HTML
  file is active, matching the title-bar and context-menu entries — and if it
  is invoked with another kind of file focused (a keybinding, say), it says so
  instead of opening a blank canvas on that file or re-pointing an open one.
- **Ctrl+Z** and **Ctrl+Y** (or Ctrl+Shift+Z) work with the canvas focused.
  They run the editor's own undo and redo on the file — the same stack as
  typing in it — so a canvas edit can be taken back without first clicking
  into the text editor. The canvas refreshes to the result and keeps its
  selection where it still applies.
- A column stays selected after you drag it somewhere else. It used to be
  deselected the moment it dropped, so the inspector emptied and a follow-up
  nudge or width change meant clicking it again first.

## [0.3.1] - 2026-09-18

### Fixed

- Release packaging only — the extension itself is unchanged from 0.3.0. The
  0.3.0 release reached the Marketplace, but its GitHub Release was left as an
  empty draft, so the `.vsix` and the standalone single-file HTML were never
  downloadable from the repository's Releases page. This version republishes
  the same extension with that fixed.

## [0.3.0] - 2026-09-17

### Fixed

- The **Class style (dialect)** setting now applies to any file whose own
  classes don't settle the question — not just a file with no grid classes at
  all. `col-sm-6` is valid in both Bootstrap 3 and 4/5, so a Bootstrap 3
  project whose template used only classes the two versions share was treated
  as Bootstrap 4/5 and got `offset-sm-3` written into it however the setting
  was set. A file that *shows* its version still decides for itself: `col-xs-*`
  or `col-md-offset-*` means Bootstrap 3, a bare `col`, `col-12`, `col-xl-*` or
  `offset-md-*` means Bootstrap 4/5. Nothing changes for anyone on the default.
- Editing **Class style (dialect)** in your settings now reaches a canvas
  that's already open, the way the class-convention settings do. It used to be
  read only when the panel opened, so changing it — including by committing it
  in `.vscode/settings.json`, which is the documented way to set it for a
  project — appeared to do nothing until you closed and reopened the canvas.

### Added

- A **Bootstrap version** chip in the canvas header, beside the breakpoint
  switch, showing which class style the canvas is writing. On a file whose
  classes don't say, it's a button: switch it and the choice is saved to the
  project's workspace settings, so it can be committed for the team. On a file
  that shows its version, it's a status label — switching there would write
  the other style's classes alongside the existing ones.
- The inspector now names the Bootstrap version in force and what decided it
  — the file itself, or your setting — directly under the width and offset
  steppers, so a class it writes is never unexplained.

### Changed

- The inspector's explanatory text is written in the reader's terms rather than
  the code's: no more "defining token", "tier" or "inherited row". The stepper
  hint now says which class the + and − buttons will change, the breakpoint
  legend explains the ● and ↑ markers in plain words, and the preview of what
  gets created reads "New rows get …" instead of "next row row".
- Column reorder buttons read **Move left** / **Move right**, matching the
  rows' **Move up** / **Move down**.

## [0.2.1] - 2026-08-05

### Fixed

- The screenshots in the Marketplace listing now render. They were packaged with
  README-relative paths that resolved against the repository root instead of the
  extension's subdirectory; the package now pins the correct image base URL.
- The **Class style (dialect)** setting can now be committed per project in
  `.vscode/settings.json`. It was application-scoped (user-global only), so a
  Bootstrap 3 project couldn't share the choice with the team; it is now
  `resource`-scoped like the new-row/column class conventions.

## [0.2.0] - 2026-08-04

First public release.

### Added

- Open a **Grid Editor** canvas beside any Angular/HTML template — from the
  editor title bar, the editor context menu, or the *Open Grid Editor*
  command — that renders the template's Bootstrap grid as an interactive
  schematic.
- **Edit columns visually:** resize by dragging an edge or with the inspector's
  steppers, split a column in two, add or remove an offset, and reorder columns
  by drag-and-drop within a row or into another row.
- **Build structure from the canvas:** add rows and columns, nest a row inside a
  column, and start from a template that has no grid at all.
- **Responsive breakpoints:** switch between `xs`–`xxl` to see how the layout
  reflows at each, and choose the breakpoint the canvas opens at.
- **Angular control flow is first-class:** `@if` / `@else` / `@else if` and
  `*ngIf` are drawn as toggleable conditional regions, so you can preview each
  branch without editing the file.
- **Surgical write-back:** visual edits are applied to your editor buffer
  changing only what changed — formatting, comments, and Angular directives
  outside the edited span are preserved byte-for-byte, and every edit is
  verified against the file before it lands.
- **Live sync** keeps the canvas in step with the editor as you type (toggleable).
- **Bootstrap 3 and 4/5** class dialects, auto-detected from the file and
  configurable for blank templates.
- **Project class conventions:** set extra classes that every new row or column
  should carry (workspace-scoped, committable in `.vscode/settings.json`).

[Unreleased]: https://github.com/Solus/bootstrap-grid-editor/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Solus/bootstrap-grid-editor/releases/tag/v0.3.0
[0.2.1]: https://github.com/Solus/bootstrap-grid-editor/releases/tag/v0.2.1
[0.2.0]: https://github.com/Solus/bootstrap-grid-editor/releases/tag/v0.2.0

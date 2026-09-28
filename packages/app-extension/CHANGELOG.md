# Change Log

All notable changes to this extension are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-09-28

### Changed

- New look: the canvas now follows your VS Code theme (light, dark and high
  contrast).

### Added

- The inspector can be resized by dragging its left edge.
- The inspector can collapse to a narrow strip of icon buttons.

## [0.4.0] - 2026-09-19

### Added

- `order-*` classes are shown: an **order** badge on the column and a
  **reordered** pill on its row.
- **Ctrl+Z** / **Ctrl+Y** undo and redo while the canvas has focus.

### Changed

- The inspector's actions are one per line, with icons.
- The canvas tab is named after the file it shows.

### Fixed

- A dragged column stays selected after the drop.
- Closing the file also closes its canvas.
- **Open Grid Editor** is only offered for HTML files.
- Row status pills show their tooltips again.
- The empty-canvas message points at controls the extension actually has.

## [0.3.1] - 2026-09-18

### Fixed

- Release packaging: the GitHub Release now includes the `.vsix` and the
  standalone HTML. The extension is unchanged from 0.3.0.

## [0.3.0] - 2026-09-17

### Added

- A **Bootstrap version** chip shows which class style the canvas writes, and
  switches it for files that don't declare one.
- The inspector says which Bootstrap version is in force and why.

### Changed

- Clearer wording throughout the inspector.

### Fixed

- The **Class style** setting now applies to every file whose classes don't
  settle the version, and takes effect without reopening the canvas.

## [0.2.1] - 2026-08-05

### Fixed

- Marketplace screenshots now display.
- The **Class style** setting can be set per project.

## [0.2.0] - 2026-08-04

First public release.

### Added

- A **Grid Editor** canvas beside any HTML or Angular template.
- Resize, split, offset and drag-and-drop columns.
- Add rows and columns, including rows nested in a column.
- A breakpoint switch (`xs`–`xxl`).
- `@if` / `@else` and `*ngIf` drawn as toggleable regions.
- Edits change only the affected classes; the rest of the file is untouched.
- Live sync with the editor.
- Bootstrap 3 and 4/5 support.
- Configurable extra classes for new rows and columns.

[Unreleased]: https://github.com/Solus/bootstrap-grid-editor/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/Solus/bootstrap-grid-editor/releases/tag/v0.5.0
[0.4.0]: https://github.com/Solus/bootstrap-grid-editor/releases/tag/v0.4.0
[0.3.1]: https://github.com/Solus/bootstrap-grid-editor/releases/tag/v0.3.1
[0.3.0]: https://github.com/Solus/bootstrap-grid-editor/releases/tag/v0.3.0
[0.2.1]: https://github.com/Solus/bootstrap-grid-editor/releases/tag/v0.2.1
[0.2.0]: https://github.com/Solus/bootstrap-grid-editor/releases/tag/v0.2.0

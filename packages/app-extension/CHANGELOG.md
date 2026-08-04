# Change Log

All notable changes to this extension are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/Solus/bootstrap-grid-editor/releases/tag/v0.2.0

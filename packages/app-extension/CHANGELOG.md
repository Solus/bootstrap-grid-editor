# Change Log

All notable changes to this extension are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The **Class style (dialect)** setting now applies to any file whose own
  classes don't settle the question — not just a file with no grid classes at
  all. `col-sm-6` is valid in both Bootstrap 3 and 4/5, so a Bootstrap 3
  project whose template used only classes the two versions share was treated
  as Bootstrap 4/5 and got `offset-sm-3` written into it however the setting
  was set. A file that *shows* its version still decides for itself: `col-xs-*`
  or `col-md-offset-*` means Bootstrap 3, a bare `col`, `col-xl-*` or
  `offset-md-*` means Bootstrap 4/5. Nothing changes for anyone on the default.

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

[Unreleased]: https://github.com/Solus/bootstrap-grid-editor/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/Solus/bootstrap-grid-editor/releases/tag/v0.2.1
[0.2.0]: https://github.com/Solus/bootstrap-grid-editor/releases/tag/v0.2.0

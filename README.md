# Bootstrap Grid Layout Editor

A visual editor for Bootstrap grid layouts (rows/columns) in HTML and Angular
templates. It renders a schematic of a template's grid, lets you
resize/split/move/offset columns, and writes the changes back to the HTML
**surgically** — preserving formatting, comments, and Angular directives.

Available as a **VS Code extension** and a **standalone web app**. Install the
extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=bero-labs.bootstrap-grid-editor)
(or see [`packages/app-extension`](./packages/app-extension/README.md) for the
listing).

See [`PLAN.md`](./PLAN.md) for the architecture and build sequence,
[`CLAUDE.md`](./CLAUDE.md) for the working agreement, and
[`FOLLOW-UPS.md`](./FOLLOW-UPS.md) for open questions and known gaps.

## Layout

npm workspaces monorepo:

- **`packages/core`** — pure TypeScript: parser, grid model, classification,
  grid-class math, edit operations. No DOM, no VS Code, no framework.
- **`packages/app-standalone`** — the browser UI (vanilla TS + Vite over
  `core`). Builds to a normal static site or a single self-contained HTML
  file.
- **`packages/app-extension`** — the VS Code extension (canvas as a webview
  panel, edits applied to the editor buffer). See its
  [README](./packages/app-extension/README.md).
- **`prototype/`** — the original single-file prototype (the reference
  implementation) and its extracted test suite.

## Develop

```sh
npm install     # install all workspaces
npm run dev     # Vite dev server for the standalone app → http://localhost:5173
```

## Test

```sh
npm test            # Vitest unit + jsdom boot tests (packages/*/src/**/*.test.ts)
npm run test:e2e    # Playwright browser tests (needs: npx playwright install chromium)
npm run test:vscode # the extension's edits against a real VS Code buffer
npm run test:all    # all three
npm run typecheck   # tsc across core, its specs, the app, and the e2e specs
```

`test:vscode` downloads VS Code on first run (cached in `.vscode-test/`) and
launches it, so it needs network access and a display — on a headless machine
run it under `xvfb-run -a`, as CI does.

`npm test` passing does **not** imply the tree typechecks — run `typecheck`
separately (it is not part of the test command).

## Build

```sh
npm run build:single   # one self-contained HTML → packages/app-standalone/dist-single/index.html
                       #   (double-click to open, no server needed)

# the plain site build lives in the app workspace:
npm run build -w @bootstrap-visualizer/app-standalone   # static site → dist/
```

(`npm run build` at the root is the TypeScript project build — `tsc -b` —
not the app's site build.)

Release artifacts are attached to GitHub Releases on a `v*` tag, never
committed to the repo — see `CLAUDE.md` → "Releasing a version".

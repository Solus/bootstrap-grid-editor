# bootstrap-visualizer

A visual editor for Bootstrap grid layouts (rows/columns) in Angular
templates. It renders a schematic of a template's grid, lets you
resize/split/move/offset columns, and writes the changes back to the HTML
**surgically** — preserving formatting, comments, and Angular directives.

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
- **`packages/app-extension`** — the VS Code extension (not yet built).
- **`prototype/`** — the original single-file prototype (the reference
  implementation) and its extracted test suite.

## Develop

```sh
npm install                # install all workspaces
npm run dev -w @bootstrap-visualizer/app-standalone   # Vite dev server
```

## Test

```sh
npm test          # Vitest unit + jsdom boot tests (packages/*/src/**/*.test.ts)
npm run test:e2e  # Playwright browser tests (needs: npx playwright install chromium)
npm run test:all  # both
npm run typecheck # tsc across core, its specs, the app, and the e2e specs
```

`npm test` passing does **not** imply the tree typechecks — run `typecheck`
separately (it is not part of the test command).

## Build

```sh
# from packages/app-standalone
npm run build          # static site        → dist/
npm run build:single   # one self-contained → dist-single/index.html (double-click to open)
```

Release artifacts are attached to GitHub Releases on a `v*` tag, never
committed to the repo — see `CLAUDE.md` → "Releasing a version".

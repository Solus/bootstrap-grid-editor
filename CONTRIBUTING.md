# Contributing

Thanks for your interest. **This is a solo-maintained project and it does not
accept outside pull requests** — changes are made by the maintainer. Bug reports
and ideas are very welcome, though: please [open an
issue](https://github.com/Solus/bootstrap-grid-editor/issues) instead. The most
useful bug report includes a **minimal template snippet that reproduces it**.

The rest of this file orients anyone building or forking the project (it's MIT).
A little orientation goes a long way.

## Architecture in one breath

A monorepo (npm workspaces) with a shared, framework-free core and two frontends:

- **`packages/core`** — parser, grid model, classification, grid-class math, edit
  operations. Pure TypeScript. **Imports no DOM and no `vscode` APIs, ever** — if
  a function needs either, it belongs in a frontend.
- **`packages/editor`** — the shared canvas/inspector UI over `core`.
- **`packages/app-standalone`** — the browser app (Vite).
- **`packages/app-extension`** — the VS Code extension.

Frontends **call** `core`'s functions; they never re-implement its logic. Edits
are span-based descriptions produced by `core` and applied by the frontend —
surgical, preserving the user's source byte-for-byte outside the edited span.
See [`PLAN.md`](./PLAN.md) for the full picture and [`CLAUDE.md`](./CLAUDE.md)
for the working agreement.

## Setup

```sh
npm install     # installs all workspaces
npm run dev     # Vite dev server for the standalone app → http://localhost:5173
```

## Tests — three layers, three questions

```sh
npm test            # Vitest: unit + jsdom boot
npm run test:e2e    # Playwright: the interactive surface (needs: npx playwright install)
npm run test:vscode # a real VS Code buffer, via @vscode/test-electron
npm run test:all    # all three
npm run typecheck   # tsc across every package (not part of `npm test`)
```

`test:vscode` downloads VS Code on first run and needs a display — on a headless
machine run it under `xvfb-run -a`, as CI does.

Each layer builds `packages/core` first (a `pretest*` hook, or `build:tests` for
`test:vscode`), so you never have to remember to. `core` is the one package whose
package entry points at `dist/` rather than `src/` — it's the published library —
so everything downstream imports its *built* output. Without that step a stale
`dist` shows up as a baffling `X is not a function` from code you can see is
right there in `packages/core/src`.

New behaviour comes with new tests in the same change. The ported prototype suite
is the contract — don't weaken a test to make a change pass; if behaviour
genuinely changes, discuss it first.

## Building the extension locally

```sh
npm run vsix -w bootstrap-grid-editor   # produces a .vsix in releases/
```

Install it via **Extensions → ⋯ → Install from VSIX…**.

## Releases

Releases are cut from git tags by CI, not by hand. See the release procedure in
[`CLAUDE.md`](./CLAUDE.md) → "Releasing a version".

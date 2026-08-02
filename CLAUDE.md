# CLAUDE.md — project guide

Read `PLAN.md` first — it is the source of truth for architecture, the
`GridModel`, domain rules, and the build sequence. `CONTRIBUTING.md` covers
setup and the test layers in full. This file is the quick project reference.

## What this project is
A monorepo (npm workspaces) turning a proven single-file prototype
(`prototype/grid-draft.html`) into a shared-core library with two frontends: a
standalone web app and a VS Code extension. Treat the prototype as the
**reference implementation** — port its logic, don't reinvent it. When behavior
is unclear, the prototype's behavior is the spec.

## Non-negotiable boundaries (see PLAN.md "Non-negotiables")
- `packages/core` imports **no DOM and no VS Code** APIs. Ever. If a function
  needs the DOM or `vscode`, it lives in a frontend.
- Frontends **call `core`'s functions; they never re-implement its logic**
  (role, title, hint, classification). Whether `core` precomputes those onto the
  model or computes them on demand is `core`'s choice — today it's on demand
  (`colTitle`, `contentHint`, `isContainerCol`, …).
- Edits are **span-based descriptions** produced by `core` and applied by the
  frontend. No grid-class math or string-scanning in frontend code.
- Edits are **surgical**: change only the class attribute's value span, or move
  element text with its adjacent title comment. Never regenerate the document;
  preserve the user's source byte-for-byte outside the edited span.

## Tests
- Runner is **Vitest**, tests co-located as `*.test.ts`. The ported suite (~157
  cases from the prototype) is the **contract** — keep it green; don't weaken a
  test to make a change pass. If behavior genuinely changes, discuss it first.
  New behavior comes with new tests in the same change.
- Three layers, answering different questions: `npm test` (Vitest, incl. the
  jsdom boot), `npm run test:e2e` (Playwright), `npm run test:vscode` (a real VS
  Code buffer). `npm run test:all` runs all three. Details in `CONTRIBUTING.md`.
- Run the relevant package's tests before considering a change done.

## Commits
- Small, focused commits with clear messages (imperative mood: "Add colSpec
  dialect detection", not "added stuff"). Don't bundle unrelated changes.
- Don't commit `node_modules/`, `dist/`, `*.vsix` (see `.gitignore`).
- **Exception — Claude Code on the web:** those sessions run on a designated
  branch, an end-of-session hook requires a clean tree, and the container is
  ephemeral, so uncommitted work is lost. There, **commit when you finish a
  reviewable slice** and push to the session's branch (never a PR unless asked).

## Releasing a version
Releases are cut from **git tags**; CI builds and publishes artifacts on a `v*`
tag (see `PLAN.md` → CI/CD). To cut a version:
1. Make sure `main` is green and up to date.
2. Bump the version in **`packages/app-extension/package.json`** (the `.vsix`
   version comes from here). Semver: patch/minor/major.
3. Commit the bump on its own: `git commit -m "Release v1.2.3"`.
4. Tag it **matching that version**: `git tag v1.2.3` (tag `vX.Y.Z` must equal
   the `package.json` version — CI assumes they match).
5. Push commit **and** tag: `git push && git push --tags`.
6. CI (`release.yml`) runs tests, builds the standalone HTML and the `.vsix`,
   and attaches both to a GitHub Release (and, with the publish secrets present,
   pushes to the VS Code Marketplace and Open VSX).

Do **not** hand-build and commit the `.vsix` or the HTML — artifacts never go in
the repo. If a release build fails, fix forward and tag a new patch; don't reuse
or move a published tag.

## Follow-ups → `FOLLOW-UPS.md`
Record open questions, deferred decisions, latent bugs, and verification gaps in
`FOLLOW-UPS.md` — the durable backlog we review and implement from. Each entry
says *what it is*, *why it matters*, and *a suggested direction*; tag it
`[decide]` / `[verify]` / `[chore]` under the right section. Verify every
file:line reference against the tree before writing it in.

When you implement or otherwise resolve a follow-up, **collapse it into the
`## Resolved (archive)` section** at the bottom — a single line
(`- **N.M** Title — _resolution_`), not a verbose write-up. Keep its section
number stable so references elsewhere still resolve; the full rationale lives in
git history. The top of the file stays the *live* backlog — open items only.

## Current status
Sessions 1–3 complete and released: shared-core library, parser on
`@angular/compiler`, and the VS Code extension with CI/CD. `@if`/`@else`/
`@else if` and `*ngIf` are first-class toggleable conditional regions. Since
then: a canvas-editing robustness pass, the class-convention feature, token-level
class edits (`FOLLOW-UPS.md` §10.1), and the prerequisites for Marketplace /
Open VSX publication (manifest, licence, listing, guarded CI publish steps) —
publishing itself is pending external setup. Next up (not started): Session 4
enrichment — resolving i18n keys, component tags, and `formControlName` from the
user's project.

# CLAUDE.md — working agreement for this repo

Read `PLAN.md` first — it is the source of truth for architecture, the
`GridModel`, domain rules, and the build sequence. This file is about
*how to work here*, not *what to build*.

## What this project is
A monorepo (npm workspaces) turning a proven single-file prototype
(`prototype/grid-draft.html`) into a shared-core library with two
frontends: a standalone web app and a VS Code extension. Treat the
prototype as the **reference implementation** — port its logic, don't
reinvent it. When behavior is unclear, the prototype's behavior is the
spec.

## How the maintainer likes to work
- **Discuss before building.** For anything beyond a small, obvious
  change, propose the approach and wait for a go-ahead. Don't scaffold
  large structures or make cross-cutting decisions unsolicited.
- **Push back.** If a request or an existing plan looks wrong, say so
  with reasoning and offer alternatives. Don't just implement it.
- **One concern at a time.** Prefer small, reviewable changes over large
  sweeps. Land a thing, verify it, move on.
- **State assumptions.** If you have to assume something to proceed, name
  it in your reply.
- Give your explanations and summaries in a clear, consise language. No need to write too much, unless the user asks for it.

## Capture follow-ups in `FOLLOW-UPS.md`
Whenever implementation or analysis turns up something relevant that
isn't part of the task at hand — an open question, a deferred decision, a
latent bug, a verification gap, a bit of brittleness, doc drift, an
assumption worth revisiting — **write it into `FOLLOW-UPS.md`**, don't
just mention it in passing and let it scroll away. Chat is lossy; that
file is the durable record we review and implement from later.
- Each entry says *what it is*, *why it matters*, and *a suggested
  direction* — written to be argued with, not blindly executed. Tag it
  `[decide]` / `[verify]` / `[chore]` and file it under the right section
  (add one if none fits).
- **Verify before you write.** Every file:line reference, count, or claim
  goes in checked against the tree, not from memory.
- Surfacing it in your reply too is good; the file is what makes it
  survive. Still flag genuinely urgent things loudly — the file is for
  what we'll get to, not a place to bury a real problem.

## Non-negotiable boundaries (see PLAN.md "Non-negotiables")
- `packages/core` imports **no DOM and no VS Code** APIs. Ever. If a
  function needs the DOM or `vscode`, it lives in a frontend.
- Frontends **don't re-derive** what `core` precomputes on the
  `GridModel` (role, title, hint, dynamic flags).
- Edits are **span-based descriptions** produced by `core` and applied
  by the frontend. No grid-class math or string-scanning in frontend
  code.
- Edits are **surgical**: change only the class attribute's value span,
  or move element text with its adjacent title comment. Never regenerate
  the document; preserve the user's source byte-for-byte outside the
  edited span.

## Tests
- Runner is **Vitest**, tests co-located as `*.test.ts`.
- The ported suite (~157 cases from the prototype) is the **contract**.
  Keep it green. When porting the parser (session 2), those tests are
  the regression safety net — do not weaken a test to make a change
  pass; if behavior genuinely changes, discuss it first.
- New behavior comes with new tests in the same change.
- Run the relevant package's tests before considering a change done.

## Commits
- **Never commit without an explicit request from the maintainer.** Not
  after finishing a task, not "to be safe", not because the tree is
  green. Do the work, report it, and leave it staged-or-unstaged for
  review. Only run `git commit` when asked to. (Applies to `git commit`
  specifically; branching or staging to keep the tree tidy is fine.)
- When a commit *is* requested: small, focused commits with clear
  messages (imperative mood: "Add colSpec dialect detection", not "added
  stuff").
- Don't commit `node_modules/`, `dist/`, `*.vsix` (see `.gitignore`).
- Don't bundle unrelated changes into one commit.

## Releasing a version
Releases are cut from **git tags**; CI builds and publishes artifacts to
GitHub Releases on a `v*` tag (see `PLAN.md` → CI/CD). Every commit runs
tests only — tagging is what produces a release. To cut a version:

1. Make sure `main` is green (tests pass) and up to date.
2. Bump the version in **`packages/app-extension/package.json`** (the
   `.vsix` version comes from here). Follow semver: patch for fixes,
   minor for features, major for breaking changes. Keep other packages'
   versions consistent if they're published too.
3. Commit the bump on its own: `git commit -m "Release v1.2.3"`.
4. Tag it **matching that version**: `git tag v1.2.3` (tag `vX.Y.Z` must
   equal the `package.json` version — CI assumes they match).
5. Push commit **and** tag: `git push && git push --tags`.
6. CI (`release.yml`) runs tests, builds the single-HTML standalone and
   the `.vsix`, and attaches both to a GitHub Release named `v1.2.3`.

Do **not** hand-build and commit the `.vsix` or the HTML — artifacts
never go in the repo. If a release build fails, fix forward and tag a
new patch version; don't reuse or move a published tag.

## When unsure
Ask. A short clarifying question is cheaper than a large wrong change.
Uncertainty about the `GridModel` shape, the `@if`/control-flow
representation, or the parser AST should be resolved by looking at real
output and discussing — not by guessing and building on the guess.

## Current status
Session 1 is complete.
Session 2 is in progress.
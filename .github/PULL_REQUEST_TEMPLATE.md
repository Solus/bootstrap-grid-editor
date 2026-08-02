<!-- Keep it short. The reviewer wants the what, the why, and evidence it works. -->

## What & why

<!-- What does this change, and what problem does it solve? -->

## Tests run

<!-- Tick what you ran locally. The three layers answer different questions. -->

- [ ] `npm test` (Vitest — unit + jsdom boot)
- [ ] `npm run test:e2e` (Playwright — interactive surface)
- [ ] `npm run test:vscode` (real VS Code buffer)
- [ ] New behaviour comes with new tests

## Notes

- [ ] `FOLLOW-UPS.md` updated if this surfaced an open question, a deferred decision, or a gap
- [ ] `packages/core` still imports no DOM and no `vscode` APIs

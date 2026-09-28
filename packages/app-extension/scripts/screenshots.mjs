/* Recaptures the README / Marketplace screenshots in media/ from a real VS Code.

   Run with `npm run screenshots -w bootstrap-grid-editor` (it builds the
   extension first). The VS Code setup is in vscode-session.mjs. Each shot is
   the editor area only — the template beside the canvas.

   A shot that can't find what it needs to click fails the run rather than
   saving a wrong picture. */

import { DARK, LIGHT, selectCol, selectNth, session } from './vscode-session.mjs';

console.log('dashboard, dark');
await session({ file: 'dashboard.component.html', theme: DARK }, async ({ canvas, shoot }) => {
  await selectNth(canvas, 3);            // the third KPI card
  await shoot('hero-dashboard.png');
  await canvas.locator('details.insp-details summary').click();
  await shoot('inspector.png');
  await canvas.locator('[aria-label="Collapse inspector"]').click();
  await shoot('inspector-collapsed.png');
});

console.log('dashboard, light');
await session({ file: 'dashboard.component.html', theme: LIGHT }, async ({ canvas, shoot }) => {
  await selectNth(canvas, 3);            // the third KPI card
  await shoot('theme-light.png');
});

console.log('pricing page, breakpoints');
await session({ file: 'pricing-page.component.html', theme: DARK }, async ({ canvas, shoot }) => {
  // nothing is selected here, so the canvas gets the room the inspector would take
  await canvas.locator('[aria-label="Collapse inspector"]').click();
  await shoot('breakpoint-md.png');
  await canvas.locator('#bpSwitch button[data-bp="lg"]').click();
  await shoot('breakpoint-lg.png');
});

console.log('conditional layout');
await session({ file: 'conditional-layout.component.html', theme: DARK, size: [1400, 960] },
  async ({ canvas, shoot }) => {
    await canvas.locator('[aria-label="Collapse inspector"]').click();
    await selectCol(canvas, 'pro-features');
    await shoot('conditional-if.png');
    // the in-row region's chip cycles @if → @else if → @else
    const chip = canvas.locator('.g-row', { hasText: 'usage-meter' }).locator('.branch-chip').first();
    if (!(await chip.count())) throw new Error('no branch chip in the usage row');
    await chip.click();
    await canvas.page().waitForTimeout(500);
    await selectCol(canvas, 'team-features');
    await shoot('conditional-else.png');
  });

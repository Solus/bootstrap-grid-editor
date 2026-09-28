/* Shared by the media scripts (screenshots.mjs, demo-gif.mjs): a real VS Code
   (the one the integration tests download into .vscode-test/) on one example
   file, with a throwaway profile — a fixed theme, the workbench chrome turned
   off — and the Grid Editor canvas open beside the template. Playwright drives
   the window and the canvas webview. */

import { _electron as electron } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(EXT, 'examples');
export const MEDIA = path.join(EXT, 'media');

export const DARK = 'Default Dark Modern';
export const LIGHT = 'Default Light Modern';

/** A VS Code window on one example file, with the canvas open beside it. */
export async function session({ file, theme, breakpoint = 'md', size = [1640, 800] }, shots) {
  const codePath = await downloadAndUnzipVSCode({ cachePath: path.join(EXT, '.vscode-test') });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-shots-'));
  fs.mkdirSync(path.join(tmp, 'user', 'User'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'user', 'User', 'settings.json'), JSON.stringify({
    'workbench.colorTheme': theme,
    // no workbench chrome in the picture: just the editor and the canvas
    'workbench.startupEditor': 'none',
    'workbench.activityBar.location': 'hidden',
    'workbench.statusBar.visible': false,
    'workbench.layoutControl.enabled': false,
    'workbench.tips.enabled': false,
    'window.commandCenter': false,
    'chat.disableAIFeatures': true,
    'security.workspace.trust.enabled': false,
    'git.enabled': false,
    'git.openRepositoryInParentFolders': 'never',
    'extensions.ignoreRecommendations': true,
    'update.mode': 'none',
    'telemetry.telemetryLevel': 'off',
    'editor.minimap.enabled': false,
    'editor.fontSize': 13,
    'bootstrapGridEditor.defaultBreakpoint': breakpoint,
    'bootstrapGridEditor.stretchToFit': true,
  }));

  const app = await electron.launch({
    executablePath: codePath,
    args: [
      EXAMPLES, path.join(EXAMPLES, file),
      '--extensionDevelopmentPath=' + EXT,
      '--user-data-dir=' + path.join(tmp, 'user'),
      '--extensions-dir=' + path.join(tmp, 'extensions'),   // empty: no other extensions
      '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
      // 1:1 pixels whatever the machine's display scaling, so the window gets
      // the size asked for and every capture comes out the same
      '--force-device-scale-factor=1',
    ],
  });
  try {
    const win = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }, [w, h]) => {
      const bw = BrowserWindow.getAllWindows()[0];
      bw.setSize(w, h);
      bw.center();
    }, size);
    await win.waitForSelector('.monaco-editor', { timeout: 60_000 });
    await win.waitForTimeout(1500);

    const command = async (name) => {
      await win.keyboard.press('F1');
      await win.keyboard.type(name);
      await win.waitForTimeout(400);
      await win.keyboard.press('Enter');
      await win.waitForTimeout(600);
    };
    await command('View: Close Primary Side Bar');
    await command('View: Close Secondary Side Bar');
    await command('Open Grid Editor');
    const canvas = await canvasFrame(win);
    // the canvas gets the larger share of the width: it has more to show.
    // Drag the divider between the two editor groups to 42% of the editor area.
    const area = (await win.locator('.part.editor').boundingBox());
    const second = (await win.locator('.part.editor .editor-group-container').nth(1).boundingBox());
    const y = second.y + second.height / 2;
    await win.mouse.move(second.x - 1, y);
    await win.mouse.down();
    await win.mouse.move(area.x + area.width * 0.42, y, { steps: 10 });
    await win.mouse.up();
    await win.waitForTimeout(800);

    const shoot = async (name) => {
      await win.mouse.move(0, 0);           // no stray hover state
      await win.waitForTimeout(400);
      await win.locator('.part.editor').screenshot({ path: path.join(MEDIA, name) });
      console.log('  saved', name);
    };
    await shots({ win, canvas, shoot, command });
  } finally {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The webview frame that holds the canvas, once it has drawn its columns. */
export async function canvasFrame(win) {
  for (let i = 0; i < 80; i++) {
    for (const f of win.frames()) {
      try { if (await f.locator('#rowsHost .g-col').count()) return f; } catch { /* detached */ }
    }
    await win.waitForTimeout(250);
  }
  throw new Error('the canvas never appeared');
}

/** Click the nth column on the canvas (containers excluded), 0-based. */
export async function selectNth(canvas, n) {
  const col = canvas.locator('.g-col:not(.container)').nth(n);
  await col.click({ position: { x: 12, y: 8 } });
  await canvas.page().waitForTimeout(500);
}

/** Click the column whose hint names `text` (its tag, e.g. `pro-features`). */
export async function selectCol(canvas, text) {
  const col = canvas.locator('.g-col:not(.container)', { hasText: text }).first();
  if (!(await col.count())) throw new Error('no column mentions ' + text);
  await col.click({ position: { x: 12, y: 8 } });
  await canvas.page().waitForTimeout(500);
}

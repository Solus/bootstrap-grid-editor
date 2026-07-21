/* Interactive-surface tests.
 *
 * Deliberately scoped to what the jsdom boot test cannot exercise: real
 * pointer input, HTML5 drag & drop, focus and key handling, the clipboard,
 * and the file picker. Rendering assertions live in src/app.test.ts.
 *
 * The source textarea is the assertion target throughout — it holds the
 * document of record, so "did the edit land, and only where intended" is
 * answerable by reading it. */

import { expect, test, type Page } from '@playwright/test';

/** The applied source (canvas state), as the textarea shows it. */
function source(page: Page) {
  return page.locator('#src').inputValue();
}

/** A column locator by the class attribute text shown on its sub-line.
    Resolves to the *nearest* enclosing .g-col: a container column contains
    its nested columns' sub-lines too, so a descendant-based filter would
    match the outer one first. */
function colWithClass(page: Page, cls: string) {
  return page.locator(`.col-sub[title="${cls}"]`).first()
    .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' g-col ')][1]");
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.g-row').first()).toBeVisible();
});

/* ── edge-drag resize ────────────────────────────────────────────── */

test.describe('edge-drag resize', () => {
  test('dragging a column edge rewrites only that width token', async ({ page }) => {
    const before = await source(page);
    expect(before).toContain('col-md-4 col-lg-3');

    const col = colWithClass(page, 'col-md-4 col-lg-3');
    const handle = col.locator('.col-resize');
    const box = (await handle.boundingBox())!;
    const rowBox = (await page.locator('.g-row').nth(1).boundingBox())!;
    const unit = rowBox.width / 12;

    // drag two grid units to the right: col-md-4 -> col-md-6
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + unit * 2, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = await source(page);
    expect(after).toContain('col-md-6 col-lg-3');
    // the lg token and every other row are untouched
    expect(after).not.toContain('col-md-4 col-lg-3');
    expect(after.length).toBe(before.length);
  });

  test('resize targets the defining token, not the view breakpoint', async ({ page }) => {
    // view at md; this column defines width only at sm, so the sm token moves
    await page.locator('#bpSwitch button[data-bp="md"]').click();
    const col = colWithClass(page, 'col-sm-4 col-sm-offset-4');
    const handle = col.locator('.col-resize');
    const box = (await handle.boundingBox())!;
    const rowBox = (await col.locator('xpath=ancestor::div[@class="g-row"][1]').boundingBox())!;
    const unit = rowBox.width / 12;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + unit * 2, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = await source(page);
    expect(after).toContain('col-sm-6 col-sm-offset-4');   // sm edited, BS3 offset intact
    // and no md override was invented on that element (other rows legitimately
    // use col-md-*, so this has to be scoped to the edited element)
    expect(after).not.toContain('col-sm-4 col-sm-offset-4');
    await expect(colWithClass(page, 'col-sm-6 col-sm-offset-4')).toHaveCount(1);
  });

  test('equal-width columns refuse resize and explain why', async ({ page }) => {
    const col = colWithClass(page, 'col');
    const handle = col.locator('.col-resize.no-resize');
    await expect(handle).toHaveCount(1);
    const before = await source(page);

    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    await expect(page.locator('#toast')).toHaveClass(/show/);
    await expect(page.locator('#toast')).toContainText('equal-width');
    expect(await source(page)).toBe(before);
  });

  test('col-auto refuses resize', async ({ page }) => {
    const col = colWithClass(page, 'col-auto');
    const handle = col.locator('.col-resize.no-resize');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator('#toast')).toContainText('content-sized');
  });
});

/* ── drag & drop ─────────────────────────────────────────────────── */

/* Dropzones carry pointer-events:none until a drag is in flight (body.dnd),
   so Playwright's actionability check never clears — force skips it. The
   drag itself is real HTML5 dnd. */
const DROP = { force: true } as const;

test.describe('drag & drop', () => {
  test('dragging a column onto a slot reorders the source', async ({ page }) => {
    const before = await source(page);
    expect(before.indexOf('formControlName="code"'))
      .toBeLessThan(before.indexOf('formControlName="name"'));

    // drop onto the third column's left slot — i.e. after "name".
    // (Dropping on name's own left slot is where "code" already is, and the
    // app correctly treats that as a no-op.)
    const codeCol = colWithClass(page, 'col-md-4 col-lg-3');
    const statusCol = colWithClass(page, 'col-lg-3 offset-lg-0 d-none d-lg-block');
    await codeCol.dragTo(statusCol.locator('.dropzone.left'), DROP);

    const after = await source(page);
    expect(after.indexOf('formControlName="code"'))
      .toBeGreaterThan(after.indexOf('formControlName="name"'));
    // a move, not a copy: both still present exactly once
    expect(after.match(/formControlName="code"/g)).toHaveLength(1);
    expect(after.match(/formControlName="name"/g)).toHaveLength(1);
  });

  test('dropping a column back where it already is changes nothing', async ({ page }) => {
    const before = await source(page);
    const codeCol = colWithClass(page, 'col-md-4 col-lg-3');
    const nameCol = colWithClass(page, 'col-md-8 col-lg-6');
    await codeCol.dragTo(nameCol.locator('.dropzone.left'), DROP);
    expect(await source(page)).toBe(before);
  });

  test('a moved column carries its title comment', async ({ page }) => {
    const cityCol = colWithClass(page, 'col-sm-8 col-sm-offset-0');
    await expect(cityCol.locator('.col-title')).toHaveText('COL-CITY');
    const zipCol = colWithClass(page, 'col-sm-4');

    // zip is the last column of that nested row, so its right slot is
    // "insert at end" — moving city past it
    await cityCol.dragTo(zipCol.locator('.dropzone.right'), DROP);

    const after = await source(page);
    // the comment moved with the element and is still directly above it
    expect(after).toMatch(/<!--COL-CITY-->\s*\n\s*<div class="col-sm-8 col-sm-offset-0">/);
    expect(after.match(/COL-CITY/g)).toHaveLength(1);
    expect(after.indexOf('formControlName="city"'))
      .toBeGreaterThan(after.indexOf('formControlName="zip"'));
  });
});

/* ── keyboard navigation ─────────────────────────────────────────── */

test.describe('keyboard', () => {
  test('arrows walk the model tree', async ({ page }) => {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.g-row.selected')).toHaveCount(1);

    await page.keyboard.press('ArrowRight');            // into the row's first column
    await expect(page.locator('.g-col.selected')).toHaveCount(1);
    await expect(page.locator('#inspector')).toContainText('Effective at md');

    await page.keyboard.press('ArrowUp');               // back out to the row
    await expect(page.locator('.g-row.selected')).toHaveCount(1);
    await expect(page.locator('.g-col.selected')).toHaveCount(0);
  });

  test('+ and - change the selected column width', async ({ page }) => {
    await colWithClass(page, 'col-md-4 col-lg-3').click();
    await page.keyboard.press('+');
    expect(await source(page)).toContain('col-md-5 col-lg-3');
    await page.keyboard.press('-');
    expect(await source(page)).toContain('col-md-4 col-lg-3');
  });

  test('Shift+Arrow moves the selected column', async ({ page }) => {
    const before = await source(page);
    expect(before.indexOf('formControlName="code"'))
      .toBeLessThan(before.indexOf('formControlName="name"'));

    await colWithClass(page, 'col-md-4 col-lg-3').click();
    await page.keyboard.press('Shift+ArrowRight');

    const after = await source(page);
    expect(after.indexOf('formControlName="code"'))
      .toBeGreaterThan(after.indexOf('formControlName="name"'));
  });

  test('Escape clears the selection', async ({ page }) => {
    await page.locator('.g-col').first().click();
    await expect(page.locator('.g-col.selected')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.g-col.selected')).toHaveCount(0);
    await expect(page.locator('.insp-empty')).toBeVisible();
  });

  test('Delete removes the selected column with its comment', async ({ page }) => {
    await colWithClass(page, 'col-sm-8 col-sm-offset-0').click();
    await page.keyboard.press('Delete');
    const after = await source(page);
    expect(after).not.toContain('COL-CITY');
    expect(after).not.toContain('col-sm-8 col-sm-offset-0');
  });

  test('canvas shortcuts do not fire while the textarea has focus', async ({ page }) => {
    await page.locator('.g-col').first().click();
    const colsBefore = await page.locator('.g-col').count();

    // Delete inside the textarea is an ordinary text edit. It must not reach
    // kbNav and delete the selected column, and it must not touch the canvas
    // until Apply.
    await page.locator('#src').click();
    await page.keyboard.press('Delete');

    await expect(page.locator('#srcPane')).toHaveClass(/src-dirty/);
    expect(await page.locator('.g-col').count()).toBe(colsBefore);
    await expect(page.locator('.g-col.selected')).toHaveCount(1);
  });
});

/* ── undo / redo ─────────────────────────────────────────────────── */

test.describe('undo and redo', () => {
  test('Ctrl+Z and Ctrl+Y round-trip an edit', async ({ page }) => {
    const before = await source(page);
    await colWithClass(page, 'col-md-4 col-lg-3').click();
    await page.keyboard.press('+');
    const edited = await source(page);
    expect(edited).not.toBe(before);

    await page.keyboard.press('Control+z');
    expect(await source(page)).toBe(before);

    await page.keyboard.press('Control+y');
    expect(await source(page)).toBe(edited);
  });

  test('undo button disabled at the start of history', async ({ page }) => {
    await expect(page.locator('#undoBtn')).toBeDisabled();
    await colWithClass(page, 'col-md-4 col-lg-3').click();
    await page.keyboard.press('+');
    await expect(page.locator('#undoBtn')).toBeEnabled();
  });
});

/* ── source pane ─────────────────────────────────────────────────── */

test.describe('source pane', () => {
  test('edits are held until Apply', async ({ page }) => {
    const rowsBefore = await page.locator('.g-row').count();
    await page.locator('#src').fill('<div class="row"><div class="col-6">only</div></div>');
    await expect(page.locator('#srcPane')).toHaveClass(/src-dirty/);
    expect(await page.locator('.g-row').count()).toBe(rowsBefore);   // canvas not yet updated

    await page.locator('#applyBtn').click();
    await expect(page.locator('.g-row')).toHaveCount(1);
    await expect(page.locator('#srcPane')).not.toHaveClass(/src-dirty/);
  });

  test('Revert discards unapplied typing', async ({ page }) => {
    const before = await source(page);
    await page.locator('#src').fill('<div class="row"></div>');
    await expect(page.locator('#revertBtn')).toBeEnabled();
    await page.locator('#revertBtn').click();
    expect(await source(page)).toBe(before);
    await expect(page.locator('#revertBtn')).toBeDisabled();
  });

  test('resize is refused while the source is dirty', async ({ page }) => {
    await colWithClass(page, 'col-md-4 col-lg-3').click();
    await page.locator('#src').fill(await source(page) + '\n<!-- typing -->');
    await page.locator('.g-col.selected .col-resize').first().dispatchEvent('pointerdown',
      { button: 0, pointerId: 1 });
    await expect(page.locator('#toast')).toContainText('unapplied edits');
  });

  /* Resize and drag check state.dirty themselves before starting. Every other
     edit path — steppers, keyboard width, split, delete — has no local guard
     and relies entirely on the one inside apply(). These cover that. */
  test('inspector edits are refused while the source is dirty', async ({ page }) => {
    await colWithClass(page, 'col-md-4 col-lg-3').click();
    await page.locator('#src').fill(await source(page) + '\n<!-- typing -->');

    await page.locator('.bp-grid').first().locator('button', { hasText: '+' }).first().click();

    await expect(page.locator('#toast')).toContainText('unapplied edits');
    // the canvas still shows the pre-edit width, and nothing was applied
    await expect(colWithClass(page, 'col-md-4 col-lg-3')).toHaveCount(1);
    await expect(page.locator('#srcPane')).toHaveClass(/src-dirty/);
  });

  test('keyboard edits are refused while the source is dirty', async ({ page }) => {
    await colWithClass(page, 'col-md-4 col-lg-3').click();
    await page.locator('#src').fill(await source(page) + '\n<!-- typing -->');
    await page.locator('.g-col.selected').click();

    await page.keyboard.press('+');

    await expect(page.locator('#toast')).toContainText('unapplied edits');
    await expect(colWithClass(page, 'col-md-4 col-lg-3')).toHaveCount(1);
  });

  test('Ctrl+Enter applies from the textarea', async ({ page }) => {
    await page.locator('#src').fill('<div class="row"><div class="col-4">x</div></div>');
    await page.locator('#src').press('Control+Enter');
    await expect(page.locator('.g-row')).toHaveCount(1);
    await expect(page.locator('.g-col')).toHaveCount(1);
  });

  test('caret position in the source selects the matching block', async ({ page }) => {
    const src = await source(page);
    const at = src.indexOf('formControlName="name"');
    await page.locator('#src').click();
    await page.locator('#src').evaluate((ta: HTMLTextAreaElement, pos) => {
      ta.setSelectionRange(pos, pos);
      ta.dispatchEvent(new Event('click', { bubbles: true }));
    }, at);
    await expect(page.locator('.g-col.selected')).toHaveCount(1);
    await expect(page.locator('.g-col.selected .col-sub')).toHaveAttribute(
      'title', 'col-md-8 col-lg-6');
  });
});

/* ── find ────────────────────────────────────────────────────────── */

test.describe('find', () => {
  test('slash focuses the find box', async ({ page }) => {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(page.locator('#findBox')).toBeFocused();
  });

  test('matches highlight and count', async ({ page }) => {
    await page.locator('#findBox').fill('field020');
    await expect(page.locator('.g-col.find-hit')).toHaveCount(1);
    await expect(page.locator('#findCount')).toContainText('1 hit');
  });

  test('Enter steps through hits and selects them', async ({ page }) => {
    await page.locator('#findBox').fill('section');
    const hits = await page.locator('.g-col.find-hit').count();
    expect(hits).toBeGreaterThan(1);
    await page.locator('#findBox').press('Enter');
    await expect(page.locator('#findCount')).toContainText('1/');
    await page.locator('#findBox').press('Enter');
    await expect(page.locator('#findCount')).toContainText('2/');
  });

  test('finds a container by a separator nested inside it', async ({ page }) => {
    await page.locator('#findBox').fill('sectionTotals');
    await expect(page.locator('.g-col.find-hit')).not.toHaveCount(0);
  });

  test('Escape clears the query', async ({ page }) => {
    await page.locator('#findBox').fill('field020');
    await page.locator('#findBox').press('Escape');
    await expect(page.locator('#findBox')).toHaveValue('');
    await expect(page.locator('.g-col.find-hit')).toHaveCount(0);
  });
});

/* ── inspector interaction ───────────────────────────────────────── */

test.describe('inspector', () => {
  test('steppers edit the defining token', async ({ page }) => {
    await colWithClass(page, 'col-md-4 col-lg-3').click();
    await page.locator('.bp-grid').first().locator('button', { hasText: '+' }).first().click();
    expect(await source(page)).toContain('col-md-5 col-lg-3');
  });

  test('equal-width column disables the width stepper', async ({ page }) => {
    await colWithClass(page, 'col').click();
    const widthStepper = page.locator('.bp-grid').first().locator('.stepper').first();
    await expect(widthStepper.locator('button').first()).toBeDisabled();
  });

  test('interpolated class is read-only', async ({ page }) => {
    await colWithClass(page, 'col-{{ itemSpan }}').click();
    await expect(page.locator('#inspector')).toContainText('shown read-only');
    await expect(page.locator('#inspector')).not.toContainText('Split in two');
  });

  test('Split in two halves every defined tier', async ({ page }) => {
    await colWithClass(page, 'col-md-4 col-lg-3').click();
    await page.locator('#inspector').getByText('Split in two').click();
    const after = await source(page);
    expect(after).toContain('col-md-2 col-lg-2');   // ceil half
    expect(after).toContain('col-md-2 col-lg-1');   // floor half
    expect(after).toContain('<!-- new column -->');
  });

  test('Delete row removes the row', async ({ page }) => {
    const before = await page.locator('.rows-host > .g-row').count();
    // click the row's own padding strip — clicking its centre would land on a
    // column, which stops propagation and selects the column instead
    await page.locator('.rows-host > .g-row').first().click({ position: { x: 300, y: 3 } });
    await expect(page.locator('#inspector')).toContainText('Add row after');
    await page.locator('#inspector').getByText('Delete row').click();
    await expect(page.locator('.rows-host > .g-row')).toHaveCount(before - 1);
  });

  test('tint overfull rows toggles the row border', async ({ page }) => {
    await expect(page.locator('.g-row.overfull')).toHaveCount(0);
    await page.locator('.view-opt input[type="checkbox"]').check();
    await expect(page.locator('.g-row.overfull')).not.toHaveCount(0);
  });
});

/* ── breakpoints & collapse ──────────────────────────────────────── */

test.describe('view controls', () => {
  test('switching breakpoint re-renders widths', async ({ page }) => {
    const sheet = page.locator('#sheet');
    const mdWidth = (await sheet.boundingBox())!.width;
    await page.locator('#bpSwitch button[data-bp="xs"]').click();
    await expect(page.locator('#bpNote')).toHaveText('<576px');
    await expect.poll(async () => (await sheet.boundingBox())!.width).toBeLessThan(mdWidth);
  });

  test('the chevron collapses and expands a row', async ({ page }) => {
    const row = page.locator('.rows-host > .g-row').first();
    await row.locator('.chev').click();
    await expect(row).toHaveClass(/collapsed/);
    await expect(row.locator('.row-sum')).toContainText('col');
    await row.locator('.chev').click();
    await expect(row).not.toHaveClass(/collapsed/);
  });
});

/* ── file in / out ───────────────────────────────────────────────── */

test.describe('file io', () => {
  test('Open loads a template file', async ({ page }) => {
    await page.locator('#fileInput').setInputFiles({
      name: 'my-template.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<div class="row"><div class="col-9">opened</div></div>'),
    });
    await expect(page.locator('.g-col')).toHaveCount(1);
    await expect(page.locator('#fileName')).toContainText('my-template.html');
  });

  test('Download offers the applied source under the opened name', async ({ page }) => {
    await page.locator('#fileInput').setInputFiles({
      name: 'sheet.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<div class="row"><div class="col-9">x</div></div>'),
    });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#downloadBtn').click(),
    ]);
    expect(download.suggestedFilename()).toBe('sheet.html');
  });

  test('Copy puts the applied source on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('#copyBtn').click();
    await expect(page.locator('#toast')).toContainText('Copied');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    // Windows round-trips clipboard text as CRLF regardless of what was
    // written, so compare on normalized line endings.
    expect(clip.replace(/\r\n/g, '\n')).toBe(await source(page));
  });

  test('Load sample restores the demo template', async ({ page }) => {
    await page.locator('#src').fill('<div class="row"></div>');
    await page.locator('#applyBtn').click();
    await page.locator('#sampleBtn').click();
    expect(await source(page)).toContain('container-fluid');
  });
});

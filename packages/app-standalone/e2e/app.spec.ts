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
import { SAMPLE_MARKERS } from './fixture.js';

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

/* FOLLOW-UPS §4.1. Most tests below assert on literals inside the default
   sample (src/sample.ts), a demo asset that will be edited. This guard makes
   that coupling explicit: if the sample drifts, this one test fails naming
   exactly what the suite depends on, instead of a dozen cryptic failures
   elsewhere. Keep e2e/fixture.ts in step with what the specs use. */
test('the boot sample contains every structure the suite depends on', async ({ page }) => {
  const src = await source(page);
  const missing = SAMPLE_MARKERS.filter(m => !src.includes(m));
  expect(missing, `sample is missing markers the e2e suite relies on: ${missing.join(', ')}`)
    .toEqual([]);
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

    // the status column is d-none below lg, so switch to lg to see all three
    await page.locator('#bpSwitch button[data-bp="lg"]').click();

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
    // and the column that moved is the one selected, where it now sits
    await expect(page.locator('.g-col.selected')).toHaveCount(1);
    await expect(page.locator('.g-col.selected')).toHaveText(/code/);
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
    // still selected after the move — the comment didn't throw the anchor off
    await expect(page.locator('.g-col.selected .col-title')).toHaveText('COL-CITY');
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

  test('the offset stepper edits the defining tier and removes it at zero', async ({ page }) => {
    // view md, but the offset is defined only at sm — like resize, the stepper
    // must touch that sm token, never invent an md override or an -0 tier
    await page.locator('#src').fill(
      '<div class="row"><div class="col-md-6 col-sm-offset-1">x</div></div>');
    await page.locator('#applyBtn').click();
    await page.locator('#bpSwitch button[data-bp="md"]').click();
    await colWithClass(page, 'col-md-6 col-sm-offset-1').click();

    const offsetStepper = page.locator('.bp-grid').first().locator('.stepper').nth(1);
    await offsetStepper.locator('button').last().click();          // +  (sm 1 → 2)
    expect(await source(page)).toContain('col-sm-offset-2');
    expect(await source(page)).not.toContain('offset-md');
    expect(await source(page)).not.toContain('col-md-offset');

    // step down to zero: the sm token is removed outright — no -0 tier left
    await offsetStepper.locator('button').first().click();         // −  (2 → 1)
    await offsetStepper.locator('button').first().click();         // −  (1 → 0)
    const after = await source(page);
    expect(after).not.toContain('offset');
    expect(after).toContain('col-md-6');
  });

  test('the header version chip switches what the steppers write', async ({ page }) => {
    // FOLLOW-UPS §9.14: `col-sm-6` is valid in both Bootstrap 3 and 4/5, so the
    // canvas can't tell from the file — the chip is where the user says which,
    // and the offset it then writes has to follow.
    await page.locator('#src').fill(
      '<div class="row"><div class="col-sm-6">x</div></div>');
    await page.locator('#applyBtn').click();

    const chip = page.locator('#dialectChip button');
    await expect(chip).toHaveText('Bootstrap 4/5');
    await expect(chip).toBeEnabled();
    await chip.click();
    await expect(chip).toHaveText('Bootstrap 3');

    await colWithClass(page, 'col-sm-6').click();
    await expect(page.locator('#inspector')).toContainText('Bootstrap 3 classes');
    await page.locator('.bp-grid').first().locator('.stepper').nth(1)
      .locator('button').last().click();                           // offset +
    const after = await source(page);
    expect(after).toContain('col-sm-offset-1');
    expect(after).not.toContain('offset-sm-1');

    // the file now declares a dialect, so it takes the decision back
    await expect(chip).toBeDisabled();
    await expect(chip).toHaveText('Bootstrap 3');
  });

  test('the version chip is a status light on a file that shows its version', async ({ page }) => {
    await page.locator('#src').fill(
      '<div class="row"><div class="col-xs-6">x</div></div>');
    await page.locator('#applyBtn').click();
    const chip = page.locator('#dialectChip button');
    await expect(chip).toHaveText('Bootstrap 3');
    await expect(chip).toBeDisabled();
    // ...but disabled the focusable way. It carries the only explanation of
    // why it can't be switched, and a `disabled` button would take that out of
    // the tab order, so it must stay reachable without a mouse.
    await expect(chip).not.toHaveAttribute('disabled');
    await expect(chip).toHaveAttribute('title', /detected from this file/);
    await chip.focus();
    await expect(chip).toBeFocused();
    // and the handler guards the same condition, so a click that gets through
    // anyway (a keyboard Enter) still does nothing — dispatched directly,
    // since Playwright won't click something it considers disabled
    await chip.dispatchEvent('click');
    await expect(chip).toHaveText('Bootstrap 3');
    await colWithClass(page, 'col-xs-6').click();
    await expect(page.locator('#inspector'))
      .toContainText('Bootstrap 3 classes — detected from this file.');
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

  test('the Move buttons reorder the selected column', async ({ page }) => {
    const before = await source(page);
    expect(before.indexOf('formControlName="code"'))
      .toBeLessThan(before.indexOf('formControlName="name"'));

    await colWithClass(page, 'col-md-4 col-lg-3').click();   // the "code" column
    await page.locator('#inspector').getByText('Move right ▶').click();

    const after = await source(page);
    expect(after.indexOf('formControlName="code"'))
      .toBeGreaterThan(after.indexOf('formControlName="name"'));
    // still selected after the move, so a second Move keeps operating on it
    await expect(page.locator('.g-col.selected')).toHaveCount(1);
  });

  test('the row Move buttons reorder the selected row', async ({ page }) => {
    const before = await source(page);
    expect(before.indexOf('app-page-header'))
      .toBeLessThan(before.indexOf('formControlName="code"'));

    // select the first top-level row via its padding strip (not a column)
    await page.locator('.rows-host > .g-row').first().click({ position: { x: 300, y: 3 } });
    await expect(page.locator('#inspector')).toContainText('Move down');
    await page.locator('#inspector').getByText('Move down ▼').click();

    const after = await source(page);
    expect(after.indexOf('app-page-header'))
      .toBeGreaterThan(after.indexOf('formControlName="code"'));
    // the moved row stays selected
    await expect(page.locator('.g-row.selected')).toHaveCount(1);
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
    await page.locator('.view-opt', { hasText: 'Tint overfull rows' })
      .locator('input[type="checkbox"]').check();
    await expect(page.locator('.g-row.overfull')).not.toHaveCount(0);
  });

  test('a d-* hidden column takes no grid space and drops from the fill (FOLLOW-UPS §8.1)', async ({ page }) => {
    // the sidebar is desktop-only: hidden below lg, so at md the row is just
    // the col-8, and the fill must not count the hidden column
    await page.locator('#src').fill(
      `<div class="row">
         <div class="col-8">main</div>
         <div class="col-4 d-none d-lg-block">sidebar</div>
       </div>`);
    await page.locator('#applyBtn').click();

    const row = page.locator('.g-row').first();
    // default breakpoint is md → the sidebar is hidden: no real column, but a
    // thin zero-width marker sits in its place and the fill excludes it
    await expect(row.locator('.g-col')).toHaveCount(1);
    await expect(row).toContainText('main');
    await expect(row).not.toContainText('sidebar');
    await expect(row.locator('.fill-pill')).toHaveText('8/12');   // 4 not counted
    await expect(row.locator('.g-col-hidden')).toHaveCount(1);

    // switch to lg → the sidebar reappears as a real column, row is full
    await page.locator('#bpSwitch button[data-bp="lg"]').click();
    await expect(row.locator('.g-col')).toHaveCount(2);
    await expect(row.locator('.g-col-hidden')).toHaveCount(0);
    await expect(row).toContainText('sidebar');
    await expect(row.locator('.fill-pill')).toHaveText('12/12');
  });

  test('a column can be dropped past a hidden LAST column (FOLLOW-UPS §8.1)', async ({ page }) => {
    // z is d-none below lg → hidden and last at md. Without the marker's
    // dropzones there'd be no way to drop a column at the end of this row.
    await page.locator('#src').fill(
      `<div class="row">
         <div class="col-4">aaa</div>
         <div class="col-4">bbb</div>
         <div class="col-4 d-none d-lg-block">zzz</div>
       </div>`);
    await page.locator('#applyBtn').click();

    const row = page.locator('.g-row').first();
    await expect(row.locator('.g-col-hidden')).toHaveCount(1);   // z hidden, last
    const before = await source(page);
    expect(before.indexOf('aaa')).toBeLessThan(before.indexOf('zzz'));

    // drag "aaa" onto the hidden marker's right slot → after the hidden column
    await row.locator('.g-col', { hasText: 'aaa' })
      .dragTo(row.locator('.g-col-hidden .dropzone.right'), DROP);

    const after = await source(page);
    expect(after.indexOf('aaa')).toBeGreaterThan(after.indexOf('zzz'));   // moved to the end
    expect(after.match(/aaa/g)).toHaveLength(1);                          // a move, not a copy
  });

  test('a non-column child marks the fill estimate as a guess (FOLLOW-UPS §2.4)', async ({ page }) => {
    // a <legend> in a .row has no col class → drawn full width (12) as a guess.
    // alone it fills the row exactly, so the pill must show the ~ estimate mark
    await page.locator('#src').fill('<div class="row"><legend>Section</legend></div>');
    await page.locator('#applyBtn').click();
    await expect(page.locator('.g-row').first().locator('.fill-pill'))
      .toHaveText(/^~12\/12/);

    // add a real column → the guess pushes it "over 12", but because that
    // rests on a guess the pill says "may wrap", not a definitive "wraps"
    await page.locator('#src').fill(
      '<div class="row"><legend>Section</legend><div class="col-4">a</div></div>');
    await page.locator('#applyBtn').click();
    await expect(page.locator('.g-row').first().locator('.fill-pill'))
      .toHaveText(/~16\/12 → may wrap/);
  });

  test('the row pills can be hovered, so their tooltips show', async ({ page }) => {
    // Each pill explains itself in a `title`; a pill the pointer can't reach
    // never shows it. hover() refuses an element that doesn't receive the
    // pointer ("… intercepts pointer events"), so reaching it is the check.
    await page.locator('#src').fill(
      '<div class="row"><div class="col-8 order-last">a</div><div class="col-6">b</div></div>');
    await page.locator('#applyBtn').click();
    const flags = page.locator('.g-row').first().locator('.row-flags');

    const reordered = flags.locator('.fill-pill.reordered');
    await expect(reordered).toHaveAttribute('title', /canvas shows source order/);
    await reordered.hover({ timeout: 3000 });

    const over = flags.locator('.fill-pill.over');
    await expect(over).toHaveAttribute('title', /row wraps/);
    await over.hover({ timeout: 3000 });
  });

  test('stretch to fit widens the sheet beyond the breakpoint cap', async ({ page }) => {
    // at xs the 400px cap is well below the panel width, so the effect is
    // unambiguous regardless of viewport. The sheet animates max-width
    // (.18s), so poll past the transition rather than reading instantly.
    await page.locator('#bpSwitch button[data-bp="xs"]').click();
    const sheet = page.locator('#sheet');
    const width = async () => (await sheet.boundingBox())!.width;
    await expect.poll(width).toBeLessThanOrEqual(401);
    await page.locator('.view-opt', { hasText: 'Stretch to fit' })
      .locator('input[type="checkbox"]').check();
    await expect.poll(width).toBeGreaterThan(401 * 1.2);
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

/* The sample's @if/@else row is modeled as a branch toggle: only the active
   branch's columns show, and switching is a pure view change. */
test.describe('@if branch toggle', () => {
  test('switching branch changes which columns show', async ({ page }) => {
    // the @if/@else region (the sample also has an earlier single-branch box)
    const box = page.locator('.cond-box', { hasText: 'summary-bar' }).first();
    await expect(box).toBeVisible();
    const chip = box.locator('.branch-chip');
    // default = @if branch; the @else branch's <detail-bar> is hidden
    await expect(chip).toHaveText(/@if\b/);
    await expect(page.locator('.rows-host')).not.toContainText('detail-bar');

    await chip.click();   // one compact chip cycles @if → @else

    await expect(page.locator('.rows-host')).toContainText('detail-bar');
    await expect(chip).toHaveText(/@else/);
    await expect(chip).toHaveClass(/active/);
  });

  test('toggling a branch does not change the source (view-only)', async ({ page }) => {
    const before = await source(page);
    await page.locator('.cond-box').first().locator('.branch-chip').click();
    expect(await source(page)).toBe(before);
    await expect(page.locator('#srcPane')).not.toHaveClass(/src-dirty/);
  });

  test('an @if wrapping nested rows in a container column gets its own box', async ({ page }) => {
    await page.locator('#src').fill(
      `<div class="row"><div class="col-6">
         <div class="row"><div class="col-12">ALWAYS</div></div>
         @if (flag) { <div class="row"><div class="col-3">MAYBE-A</div></div> }
         @else { <div class="row"><div class="col-9">MAYBE-B</div></div> }
       </div></div>`);
    await page.locator('#applyBtn').click();

    const nest = page.locator('.g-col .nested').first();
    const box = nest.locator('.cond-box');
    await expect(box).toBeVisible();
    // the unconditional row sits outside the box; the active branch inside it
    await expect(nest).toContainText('ALWAYS');
    await expect(box).toContainText('MAYBE-A');
    await expect(box).not.toContainText('MAYBE-B');

    await box.locator('.branch-chip').click();   // @if → @else
    await expect(box).toContainText('MAYBE-B');
    await expect(box).not.toContainText('MAYBE-A');
    // the surrounding column keeps its container classification
    await expect(page.locator('.g-col.container').first()).toBeVisible();
  });

  test('a top-level @if-of-rows boxes whole rows and toggles branches', async ({ page }) => {
    await page.locator('#src').fill(
      `<div class="container">
         <div class="row"><div class="col-2">head</div></div>
         @if (compact) { <div class="row"><div class="col-12">COMPACT</div></div> }
         @else {
           <div class="row"><div class="col-6">WIDE-A</div></div>
           <div class="row"><div class="col-6">WIDE-B</div></div>
         }
       </div>`);
    await page.locator('#applyBtn').click();

    // the conditional rows sit inside a box; the plain row outside it
    const box = page.locator('.rows-host > .cond-box');
    await expect(box).toHaveCount(1);
    await expect(box.locator('.g-row')).toHaveCount(1);
    await expect(box).toContainText('COMPACT');
    await expect(page.locator('.rows-host > .g-row')).toHaveCount(1);

    await box.locator('.branch-chip').first().click();   // @if → @else
    await expect(box.locator('.g-row')).toHaveCount(2);
    await expect(box).toContainText('WIDE-A');
    await expect(box).not.toContainText('COMPACT');
  });

  test('a hidden top-level @if collapses to a strip and blocks row moves through it', async ({ page }) => {
    await page.locator('#src').fill(
      `<div class="container">
         <div class="row"><div class="col-2">first</div></div>
         @if (extra) { <div class="row"><div class="col-12">OPTIONAL</div></div> }
         <div class="row"><div class="col-6">last</div></div>
       </div>`);
    await page.locator('#applyBtn').click();

    await page.locator('.rows-host .cond-box .branch-chip').click();   // hide
    // rows-level strip in place, no box, both plain rows still there
    await expect(page.locator('.rows-host > .cond-strip')).toHaveCount(1);
    await expect(page.locator('.rows-host > .cond-box')).toHaveCount(0);
    await expect(page.locator('.rows-host > .g-row')).toHaveCount(2);

    // show it again; moving "first" down would cross the @if brace → blocked
    await page.locator('.rows-host .cond-strip .branch-chip').click();
    await page.locator('.rows-host > .g-row').first().click({ position: { x: 300, y: 3 } });
    await page.locator('#inspector').getByText('Move down ▼').click();
    await expect(page.locator('#toast')).toContainText('branch boundary');
    const src = await source(page);
    expect(src.indexOf('first')).toBeLessThan(src.indexOf('OPTIONAL'));
  });

  test('a single @if (no @else) toggles its column visibility', async ({ page }) => {
    await page.locator('#src').fill(
      `<div class="row">
         <div class="col-4">head</div>
         @if (flag) { <div class="col-8">maybe</div> }
       </div>`);
    await page.locator('#applyBtn').click();

    const row = page.locator('.g-row').first();
    const chip = row.locator('.branch-chip');
    // shown by default: both columns present, region boxed in place
    await expect(row.locator('.g-col')).toHaveCount(2);
    await expect(chip).toHaveText(/@if\b/);
    await expect(row.locator('.cond-box')).toHaveCount(1);

    await chip.click();   // toggle the @if off → its column disappears
    await expect(row.locator('.g-col')).toHaveCount(1);
    await expect(chip).not.toHaveClass(/active/);
    // hidden = zero grid footprint: no box left in the flow, the chip has
    // relocated to the row's top-edge strip
    await expect(row.locator('.cond-box')).toHaveCount(0);
    await expect(row.locator('.row-flags .branch-chip')).toHaveCount(1);

    await chip.click();   // toggle back on
    await expect(row.locator('.g-col')).toHaveCount(2);
    await expect(chip).toHaveClass(/active/);
    await expect(row.locator('.cond-box')).toHaveCount(1);
  });

  test('a *ngIf column moves freely — the condition rides on the element, no braces to cross', async ({ page }) => {
    await page.locator('#src').fill(
      `<div class="row">
         <div class="col-4">head</div>
         <div class="col-8" *ngIf="flag">maybe</div>
       </div>`);
    await page.locator('#applyBtn').click();

    const before = await source(page);
    expect(before.indexOf('head')).toBeLessThan(before.indexOf('maybe'));

    // select the *ngIf column and move it left, before the plain column
    await page.locator('.g-col', { hasText: 'maybe' }).click();
    await page.locator('#inspector').getByText('◀ Move').click();

    // not blocked as a branch crossing (unlike a block @if), and the element
    // actually moved — carrying its *ngIf attribute with it
    await expect(page.locator('#toast')).not.toContainText('branch boundary');
    const after = await source(page);
    expect(after.indexOf('maybe')).toBeLessThan(after.indexOf('head'));
    expect(after).toContain('*ngIf="flag"');
  });

  test('many hidden @ifs share the row strip without overlapping the label', async ({ page }) => {
    // worst case: four hideable @ifs with long conditions on a titled row —
    // chips must shrink into the capped strip, never covering the ROW label
    // (this geometry caught two real bugs: an unbounded strip and an edge-
    // offset miscalculation)
    await page.locator('#src').fill(
      `<!-- Dashboard widgets row with many optional panels -->
       <div class="row">
         @if (user.prefs.showFilterPanel) { <div class="col-2">filters</div> }
         @if (featureFlags.enableStatsWidget) { <div class="col-2">stats</div> }
         <div class="col-12">main content</div>
         @if (user.prefs.sidebarVisibleOnDesktop) { <div class="col-3">sidebar</div> }
         @if (session.isAdminUser) { <div class="col-2">admin</div> }
       </div>`);
    await page.locator('#applyBtn').click();

    const row = page.locator('.g-row').first();
    while (await row.locator('.cond-box .branch-chip').count()) {
      await row.locator('.cond-box .branch-chip').first().click();
    }
    await expect(row.locator('.row-flags .branch-chip')).toHaveCount(4);

    const label = (await row.locator('.row-label').boundingBox())!;
    const strip = (await row.locator('.row-flags').boundingBox())!;
    expect(label.x + label.width).toBeLessThanOrEqual(strip.x + 1);
    const rowBox = (await row.boundingBox())!;
    expect(strip.x + strip.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
  });

  test('a hidden @if frees its width for the remaining columns', async ({ page }) => {
    // reality check: with the @if off, Angular renders only the col-12 —
    // it must be free to span the full row on the canvas too
    await page.locator('#src').fill(
      `<div class="row">
         @if (flag) { <div class="col-4">maybe</div> }
         <div class="col-12">main</div>
       </div>`);
    await page.locator('#applyBtn').click();

    const row = page.locator('.g-row').first();
    const main = row.locator('.g-col', { hasText: 'main' });
    const rowWidth = (await row.boundingBox())!.width;

    // shown: col-4 (boxed) + col-12 → the col-12 wraps, still ~full width
    await expect(row.locator('.cond-box')).toHaveCount(1);

    await row.locator('.branch-chip').click();   // hide the @if
    await expect(row.locator('.cond-box')).toHaveCount(0);
    // the remaining column now spans essentially the whole row
    const w = (await main.boundingBox())!.width;
    expect(w).toBeGreaterThan(rowWidth * 0.95);
  });
});

/* FOLLOW-UPS §2.5. A row nested inside a heading is collected by findRows
   but not emitted by colSequence, so positional pairing in renderCol used
   to misalign the nested rows — wrong element at the wrong path, one row
   dropped. Loading a template that triggers it and checking the nested
   rows render at correct, clickable paths locks the identity-based fix. */
test.describe('heading-nested rows (colSequence/nestedRows divergence)', () => {
  // an unclosed <legend> makes the tolerant parser swallow the first nested
  // row into the heading; a well-formed sibling row follows it
  const TEMPLATE = `<div class="row">
  <div class="col-6">
    <legend>Section
    <div class="row"><div class="col-6">INSIDE</div></div>
    <div class="row"><div class="col-6">SIBLING</div></div>
  </div>
</div>`;

  test.beforeEach(async ({ page }) => {
    await page.locator('#src').fill(TEMPLATE);
    await page.locator('#applyBtn').click();
  });

  test('every nested row renders — none is dropped', async ({ page }) => {
    const nested = page.locator('.g-col .nested > .g-row');
    await expect(nested).toHaveCount(2);
    await expect(page.locator('.g-col .nested')).toContainText('INSIDE');
    await expect(page.locator('.g-col .nested')).toContainText('SIBLING');
  });

  test('each nested row selects the element under its own path', async ({ page }) => {
    // click the row whose column reads SIBLING; the inspector must describe
    // that row, not the heading-nested one — proof the path is not misaligned
    const sibling = page.locator('.g-col .nested > .g-row')
      .filter({ hasText: 'SIBLING' });
    await sibling.click({ position: { x: 5, y: 3 } });
    await expect(page.locator('.g-row.selected')).toHaveText(/SIBLING/);
    await expect(page.locator('.g-row.selected')).not.toHaveText(/INSIDE/);
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

  test('Copy puts the applied source on the clipboard', async ({ page, context, browserName }) => {
    // Playwright can only grant clipboard permissions on Chromium; the app's
    // copy works in real browsers (user gesture), it's the readback that the
    // harness can't do elsewhere. Verify on Chromium only.
    test.skip(browserName !== 'chromium', 'clipboard permission grants are Chromium-only');
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

/* ── FOLLOW-UPS §3.2: interactive paths the earlier suites missed ──── */

test.describe('pane resizer', () => {
  test('dragging the divider resizes the source pane and flags the drag', async ({ page }) => {
    const pane = page.locator('#srcPane');
    const before = (await pane.boundingBox())!.width;
    const rz = page.locator('#paneResizer');
    const box = (await rz.boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + box.height / 2, { steps: 8 });
    // the drag is in progress — both flags are set
    await expect(rz).toHaveClass(/active/);
    await expect(page.locator('body')).toHaveClass(/pane-resizing/);
    await page.mouse.up();

    await expect(rz).not.toHaveClass(/active/);
    await expect(page.locator('body')).not.toHaveClass(/pane-resizing/);
    expect((await pane.boundingBox())!.width).toBeGreaterThan(before + 120);
  });

  test('the JS clamps the pane width at both ends', async ({ page }) => {
    // Assert on the inline flexBasis the handler sets, not the rendered
    // width: .pane-src also has CSS min-width/max-width, which would clamp
    // the rendered box even if the JS clamp were removed. flexBasis is the
    // JS output alone.
    const pane = page.locator('#srcPane');
    const rz = page.locator('#paneResizer');
    const main = (await page.locator('main').boundingBox())!;
    const flexBasis = () => pane.evaluate(el => parseFloat((el as HTMLElement).style.flexBasis));

    const drag = async (toX: number) => {
      const box = (await rz.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(toX, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
    };

    await drag(main.x - 400);                       // far past the left edge
    expect(await flexBasis()).toBeGreaterThanOrEqual(260);   // clamped to minW

    await drag(main.x + main.width + 400);           // far past the right edge
    expect(await flexBasis()).toBeLessThanOrEqual(main.width * 0.7 + 1);   // clamped to maxW
  });
});

test.describe('window file drop', () => {
  /* Native OS file drag can't be simulated, but a DataTransfer carrying a
     File makes `types` include 'Files' — enough to drive the real handlers.
     `kind` is which DragEvent to dispatch on <document>. */
  async function fireFileDrag(page: import('@playwright/test').Page, kind: string, html?: string) {
    await page.evaluate(({ kind, html }) => {
      const dt = new DataTransfer();
      if (html !== undefined) {
        dt.items.add(new File([html], 'dropped.html', { type: 'text/html' }));
      } else {
        // dragenter/leave only need the type present, not a readable file
        dt.items.add(new File([''], 'x', { type: 'text/html' }));
      }
      const ev = new DragEvent(kind, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      document.dispatchEvent(ev);
    }, { kind, html });
  }

  test('the depth counter keeps the overlay up across child enter/leave', async ({ page }) => {
    const dropHint = page.locator('#dropHint');
    await expect(dropHint).toBeHidden();

    // enter the window, then enter a child (two enters, one leave) — the
    // overlay must stay up until the counter actually reaches zero
    await fireFileDrag(page, 'dragenter');
    await expect(page.locator('body')).toHaveClass(/filedrag/);
    await fireFileDrag(page, 'dragenter');
    await fireFileDrag(page, 'dragleave');
    await expect(page.locator('body')).toHaveClass(/filedrag/);   // still up: depth 1
    await fireFileDrag(page, 'dragleave');
    await expect(page.locator('body')).not.toHaveClass(/filedrag/); // now down: depth 0
    await expect(dropHint).toBeHidden();
  });

  test('dropping a file opens it and clears the overlay', async ({ page }) => {
    await fireFileDrag(page, 'dragenter');
    await fireFileDrag(page, 'drop', '<div class="row"><div class="col-8">dropped</div></div>');
    await expect(page.locator('.g-col')).toHaveCount(1);
    await expect(page.locator('.g-col')).toContainText('dropped');
    await expect(page.locator('body')).not.toHaveClass(/filedrag/);
    await expect(page.locator('#fileName')).toContainText('dropped.html');
  });

  test('a drop is refused when the source is dirty and the user cancels', async ({ page }) => {
    page.on('dialog', d => d.dismiss());          // "discard edits?" → No
    const before = await source(page);
    await page.locator('#src').fill(before + '\n<!-- typing -->');   // make dirty

    await fireFileDrag(page, 'drop', '<div class="row"><div class="col-1">nope</div></div>');

    // the drop was refused: nothing applied, dirty typing preserved
    const src = await source(page);
    expect(src).toContain('<!-- typing -->');
    expect(src).not.toContain('nope');
    await expect(page.locator('#srcPane')).toHaveClass(/src-dirty/);
  });
});

test.describe('toast', () => {
  test('a toast auto-dismisses', async ({ page }) => {
    await page.locator('#src').fill(await source(page) + 'x');
    await page.locator('#revertBtn').click();
    await expect(page.locator('#toast')).toHaveClass(/show/);
    await expect(page.locator('#toast')).toContainText('Reverted');
    // dismiss timer is 2600ms; give it headroom
    await expect(page.locator('#toast')).not.toHaveClass(/show/, { timeout: 4000 });
  });
});

test.describe('scroll into view', () => {
  test('find scrolls a hit near the bottom into view', async ({ page }) => {
    // field040 is in the overfull row late in the sample, below the fold
    await page.locator('#findBox').fill('field040');
    await page.locator('#findBox').press('Enter');
    await expect(page.locator('.g-col.find-hit.selected')).toBeInViewport();
  });

  test('keyboard navigation scrolls the selection into view', async ({ page }) => {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ArrowDown');           // select the first row
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
    // each press restarts a smooth scroll; under parallel-engine load (esp.
    // Firefox) the final animation can outlive the default expect window
    await expect(page.locator('.g-row.selected')).toBeInViewport({ timeout: 10_000 });
  });
});

test.describe('building structure from the canvas', () => {
  test('a column can be given a nested row', async ({ page }) => {
    const col = colWithClass(page, 'col-md-4 col-lg-3');
    const nestedBefore = await col.locator('.g-row').count();
    await col.click();
    await page.locator('#inspector').getByText('Add row inside').click();
    await expect(col.locator('.g-row')).toHaveCount(nestedBefore + 1);
    expect(await source(page)).toContain('<!-- new column -->');
  });

  test('with nothing selected, Add row appends one to the document', async ({ page }) => {
    const before = await page.locator('.rows-host > .g-row').count();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');                                    // deselect
    await expect(page.locator('#inspector')).toContainText('Start here');
    await page.locator('#inspector').getByRole('button', { name: 'Add row', exact: true }).click();
    await expect(page.locator('.rows-host > .g-row')).toHaveCount(before + 1);
  });

  test('the class convention reaches the markup the canvas writes', async ({ page }) => {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');
    await page.locator('input[data-conv="row"]').fill('clearfix form-group');
    await page.locator('input[data-conv="row"]').blur();
    await expect(page.locator('#inspector')).toContainText('row clearfix form-group');

    await page.locator('#inspector').getByRole('button', { name: 'Add row', exact: true }).click();
    expect(await source(page)).toContain('<div class="row clearfix form-group">');
  });

  test('a grid class in the convention is ignored, not written', async ({ page }) => {
    await page.locator('input[data-conv="col"]').fill('col-md-6 px-2');
    await page.locator('input[data-conv="col"]').blur();
    await expect(page.locator('#inspector')).toContainText('Ignored: col-md-6');

    await colWithClass(page, 'col-md-4 col-lg-3').click();
    await page.locator('#inspector').getByText('Add column after').click();
    const src = await source(page);
    expect(src).toContain('<div class="col-md-4 col-lg-3 px-2">');
    expect(src).not.toContain('col-md-4 col-lg-3 col-md-6');
  });
});

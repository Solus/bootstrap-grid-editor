/* What the e2e suite needs from the app's default template.
 *
 * FOLLOW-UPS §4.1: most e2e cases run against the sample that boots by
 * default (`src/sample.ts`) and assert on literal class strings and content
 * inside it. The sample is a *demo* asset — it exists to show off features
 * and will be edited for that reason — so a demo edit can silently break
 * unrelated interaction tests.
 *
 * Rather than migrate 40 tests onto a separate fixture (which also entangles
 * with history state — loading a fixture via Apply in beforeEach would push
 * an undo entry and break the "undo disabled at start" test), we make the
 * coupling explicit and fail-fast: the guard test asserts the boot sample
 * still contains every marker below. If someone edits the sample out from
 * under the suite, that one guard fails with a clear message naming what's
 * missing — instead of a dozen cryptic interaction-test failures.
 *
 * Keep this list in step with what the specs actually rely on.
 */
export const SAMPLE_MARKERS: readonly string[] = [
  // mixed-tier row: label/control pairs and a modern offset
  'col-md-4 col-lg-3',        // the "code" column (resize, split, move, keyboard)
  'col-md-8 col-lg-6',        // the "name" column (reorder targets)
  'col-lg-3 offset-lg-0 d-none d-lg-block',
  'formControlName="code"',
  'formControlName="name"',
  // equal-width row: bare col + col-auto both refuse edge-drag
  'class="col"',
  'col-auto',
  // Bootstrap 3 dialect row
  'col-sm-4 col-sm-offset-4',
  // ADDRESS container: legend sections + a titled column with a comment
  'col-sm-8 col-sm-offset-0',
  'COL-CITY',
  'formControlName="city"',
  'formControlName="zip"',
  // wrapper component with sectionTitle attributes → separators
  'sectionPricing',
  'sectionTotals',
  'field020',
  // overfull row: widths + offset exceed 12 → amber "wraps" pill
  'offset-md-2',
  'field040',
  // dynamic classes: interpolated (read-only) + *ngFor
  'col-{{ itemSpan }}',
  // Angular 17 control flow: unreliable fill pill, no false warning
  '@if',
];

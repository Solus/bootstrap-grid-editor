# Sample workspace

This folder *is* the dev workspace: `Run Grid Editor Extension` (F5) opens it in
the Extension Development Host, so anything here is a file you can open and run
**Open Grid Editor** on. Not shipped — `.vscodeignore` excludes `examples/**`.

Files fall into two groups: the older ones are realistic templates that exercise
the canvas broadly (nested rows, `d-*` visibility, `@if`/`*ngIf`, interpolated
classes), and the four newer ones each pin down one **Bootstrap version**
outcome, which is otherwise hard to reach — every pre-existing sample happens to
declare its own version, so none of them leave the header chip switchable.

| File | Version in force | Header chip |
| --- | --- | --- |
| `stock-report` | your setting | **button** — shared classes only, nothing to detect |
| `notes-panel` | your setting | **button** — no grid classes at all |
| `legacy-search-form` | Bootstrap 3 | status label — `col-xs-*`, `col-md-offset-*` |
| `half-migrated-invoice` | Bootstrap 3 | status label — both styles present, older wins |
| `dashboard` | Bootstrap 4/5 | status label — bare `col-12` / `col-6` |
| `customer-form` | Bootstrap 4/5 | status label — bare `col`, `offset-md-*` |

## Checking the version work

**It says which version it's writing.** Open `stock-report`. The header chip
reads *Bootstrap 4/5* (on the shipped default) and the inspector, under the
width/offset steppers, says the file doesn't say so your setting decides. Open
`legacy-search-form`: *Bootstrap 3*, "detected from this file."

**The setting reaches the classes.** On `stock-report`, select the filter column
and raise its offset — at the default `md` breakpoint that writes `offset-md-1`.
Undo, click the chip to switch to Bootstrap 3, and raise it again:
`col-md-offset-1`. This is the bug the work started from — every class here is
valid in both versions, so before, a Bootstrap 3 project got Bootstrap 4/5
offsets written in whatever it had the setting set to.

**A file that shows its version keeps it.** With the setting on Bootstrap 3,
open `dashboard`. It stays Bootstrap 4/5, because `col-12` exists in no other
version, and its offsets come out `offset-md-*`. Same in reverse for
`legacy-search-form` with the setting on Bootstrap 4/5.

**The chip is only a button where the choice is yours.** On any status-label
file, clicking does nothing. Tab to it anyway — it keeps focus and shows its
tooltip, which is the only place that says *why* it can't be switched.

**Switching is remembered, per project.** Flip the chip on `stock-report`, then
look at `.vscode/settings.json` in this folder: `bootstrapGridEditor.dialect`,
written to the workspace so a team can commit it. (That file is untracked here —
it's a scratch file the extension writes during testing.)

**The setting is live.** Leave a canvas open on `stock-report` and edit
`bootstrapGridEditor.dialect` in `.vscode/settings.json` by hand. The chip and
the inspector follow without reopening the panel.

## Checking the inspector's wording

Select a column in `customer-form` and read the panel — it should be
explainable to someone who has never seen this code. The mixed-tier columns
show what the `+`/`−` buttons will change and that they won't add a second
class; the all-breakpoints grid explains its own `●` and grey `↑`; the notes
column warns about its `[ngClass]` and what that means for what you see;
reorder reads **Move left** / **Move right**.

On `notes-panel` the same column area instead says there are no width or offset
classes yet. For the class-convention section, set `newRowClasses` to
`clearfix` and watch the "New rows get…" preview; set it to something with a
grid class in it, like `col-md-6`, and it warns that it ignored that.

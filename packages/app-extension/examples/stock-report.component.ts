// Not a template — here to check that the Grid Editor refuses it.
//
// With this file focused, "Open Grid Editor" shouldn't be in the command
// palette at all. If it's run anyway (from a keybinding, say), it should say
// the Grid Editor works on HTML files and that this one is typescript, and
// neither open a blank canvas nor re-point one already open on an HTML file.
import { Component } from '@angular/core';

@Component({
  selector: 'app-stock-report',
  templateUrl: './stock-report.component.html',
})
export class StockReportComponent {
  results: unknown[] = [];
  totals: Record<string, number> = {};
}

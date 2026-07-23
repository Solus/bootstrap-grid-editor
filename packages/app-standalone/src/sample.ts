/* The demo template. Deliberately exercises every rendering path:
   mixed tiers, equal/auto columns, BS3 dialect, nested containers with
   legends, wrapper sectionTitles, an overfull row, dynamic classes, and
   Angular 17 control flow. */

export const SAMPLE = `<div class="container-fluid">

  <!--PAGE-HEADER-->
  <div class="row">
    <div class="col-12">
      <app-page-header [title]="'Customer'" (back)="onBack()"></app-page-header>
    </div>
  </div>

  <!-- Row with mixed tiers, a label vs control pair, and a modern offset -->
  <div class="row">
    <div class="col-md-4 col-lg-3">
      <label app-i18n="demo.editor.code"></label>
      <text-input formControlName="code"></text-input>
    </div>
    <div class="col-md-8 col-lg-6">
      <label app-i18n="demo.editor.name"></label>
      <text-input formControlName="name"></text-input>
    </div>
    <div class="col-lg-3 offset-lg-0 d-none d-lg-block">
      <status-display [statusInput]="customer.status"></status-display>
    </div>
  </div>

  <!-- Equal-width row: bare col + col-auto both refuse edge-drag -->
  <div class="row">
    <div class="col">
      <lookup-input formControlName="segment"></lookup-input>
    </div>
    <div class="col">
      <lookup-input formControlName="region"></lookup-input>
    </div>
    <div class="col-auto">
      <button class="btn btn-outline" app-i18n="demo.editor.action001"></button>
    </div>
  </div>

  <!-- Bootstrap 3 dialect: col-xs width and col-sm-offset -->
  <div class="row">
    <div class="col-xs-6 col-sm-4">
      <label app-i18n="demo.editor.field010"></label>
      <date-input formControlName="field010"></date-input>
    </div>
    <div class="col-sm-4 col-sm-offset-4">
      <label app-i18n="demo.editor.field011"></label>
      <text-input [formControl]="helper011"></text-input>
    </div>
  </div>

  <!--ADDRESS-->
  <div class="row">
    <div class="col-md-6">
      <legend class="group-title" app-i18n="demo.editor.sectionAddress"></legend>
      <div class="row">
        <!--COL-CITY-->
        <div class="col-sm-8 col-sm-offset-0">
          <label app-i18n="demo.editor.city"></label>
          <text-input formControlName="city"></text-input>
        </div>
        <div class="col-sm-4">
          <label app-i18n="demo.editor.zip"></label>
          <text-input formControlName="zip"></text-input>
        </div>
      </div>
      <legend class="group-title" app-i18n="demo.editor.sectionContact"></legend>
      @if (showContact) {
      <div class="row">
        <div class="col-12">
          <text-input formControlName="email"></text-input>
        </div>
      </div>
      }
    </div>
    <div class="col-md-6" [ngClass]="{'has-error': addressInvalid}">
      <!-- HDR:Address -->
      <label app-i18n="demo.editor.notes"></label>
      <textarea class="form-control" formControlName="notes"></textarea>
    </div>
  </div>

  <!-- Wrapper component with sectionTitle attributes → separators -->
  <div class="row">
    <div class="col-12">
      <expandable-panel [settings]="panelSettings">
        <panel-section id="p1" sectionTitle="demo.editor.sectionPricing">
          <div class="row">
            <div class="col-sm-4">
              <label app-i18n="demo.editor.field020"></label>
              <text-input formControlName="field020"></text-input>
            </div>
            <div class="col-sm-4">
              <div class="input-group">
                <text-input formControlName="field021"></text-input>
                <div class="input-group-addon">%</div>
              </div>
            </div>
          </div>
        </panel-section>
        <panel-section id="p2" sectionTitle="demo.editor.sectionTotals">
          <div class="row">
            <div class="col-sm-6">
              <label app-i18n="demo.editor.field030"></label>
              <text-input formControlName="field030"></text-input>
            </div>
          </div>
        </panel-section>
      </expandable-panel>
    </div>
  </div>

  <!-- Overfull row: widths + offset exceed 12 → amber wraps pill -->
  <div class="row">
    <div class="col-md-6">
      <label app-i18n="demo.editor.field040"></label>
      <text-input formControlName="field040"></text-input>
    </div>
    <div class="col-md-6 offset-md-2">
      <label app-i18n="demo.editor.field041"></label>
      <text-input formControlName="field041"></text-input>
    </div>
  </div>

  <!-- Dynamic class bindings: interpolated (read-only) and *ngFor / *ngIf -->
  <div class="row" *ngIf="showItems">
    <div class="col-{{ itemSpan }}" *ngFor="let item of items">
      <item-card [item]="item"></item-card>
    </div>
  </div>

  <!-- @if / @else: two-branch toggle, per-branch fill (no false warning) -->
  <div class="row">
    @if (compactMode) {
    <div class="col-sm-12">
      <summary-bar [data]="summary"></summary-bar>
    </div>
    } @else {
    <div class="col-sm-8">
      <summary-bar [data]="summary"></summary-bar>
    </div>
    <div class="col-sm-4">
      <detail-bar [data]="detail"></detail-bar>
    </div>
    }
  </div>

  <!-- Bare @if (no @else): a fixed column plus one that toggles on/off -->
  <div class="row">
    <div class="col-md-8">
      <label app-i18n="demo.editor.field050"></label>
      <text-input formControlName="field050"></text-input>
    </div>
    @if (showAdvanced) {
    <div class="col-md-4">
      <advanced-panel [config]="advanced"></advanced-panel>
    </div>
    }
  </div>

  <!-- @if / @else if / @else: three-way branch toggle -->
  <div class="row">
    @if (layout === 'compact') {
    <div class="col-sm-12">
      <summary-bar [data]="summary"></summary-bar>
    </div>
    } @else if (layout === 'split') {
    <div class="col-sm-6">
      <summary-bar [data]="summary"></summary-bar>
    </div>
    <div class="col-sm-6">
      <detail-bar [data]="detail"></detail-bar>
    </div>
    } @else {
    <div class="col-sm-4">
      <summary-bar [data]="summary"></summary-bar>
    </div>
    <div class="col-sm-8">
      <detail-bar [data]="detail"></detail-bar>
    </div>
    }
  </div>

  <!-- *ngIf on a column: modeled like a bare @if — a single-branch show/hide box -->
  <div class="row">
    <div class="col-md-6">
      <label app-i18n="demo.editor.field060"></label>
      <text-input formControlName="field060"></text-input>
    </div>
    <div class="col-md-6" *ngIf="hasWarning">
      <warning-banner [text]="warning"></warning-banner>
    </div>
  </div>

  <div class="row">
    <div class="col-md-3 offset-md-6">
      <button class="btn btn-secondary w-100" (click)="onCancel()" app-i18n="demo.editor.cancel"></button>
    </div>
    <div class="col-md-3">
      <button class="btn btn-primary w-100" [disabled]="form.invalid" (click)="onSave()" app-i18n="demo.editor.save"></button>
    </div>
  </div>

</div>
`;

import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SideBySideDiffComponent, UnifiedDiffComponent } from 'ngx-diff';
import { storeCopies } from './doc-upload';

type Side = 'left' | 'right';

/** Two texts (typed, pasted or read from files) and the line diff between them. */
@Component({
  selector: 'app-text-compare',
  standalone: true,
  imports: [FormsModule, SideBySideDiffComponent, UnifiedDiffComponent],
  template: `
    <div class="sides">
      @for (side of sides; track side.key) {
        <section class="panel side">
          <div class="side-head">
            <strong>{{ side.label }}</strong>
            <label class="secondary upload">
              Upload file
              <input
                type="file"
                accept=".txt,.md,.json,.csv,.xml,.yaml,.yml,.log,text/*"
                (change)="onFileInput($event, side.key)"
                hidden
              />
            </label>
          </div>
          <textarea
            [ngModel]="side.key === 'left' ? left() : right()"
            (ngModelChange)="(side.key === 'left' ? left : right).set($event)"
            spellcheck="false"
            [placeholder]="'Paste the ' + side.label.toLowerCase() + ' here or upload a file…'"
          ></textarea>
        </section>
      }
    </div>

    <div class="actions">
      <button type="button" class="primary" (click)="compare()">Compare</button>
      <nav class="tabs">
        <button type="button" [class.active]="viewMode() === 'side'" (click)="viewMode.set('side')">Side by side</button>
        <button type="button" [class.active]="viewMode() === 'unified'" (click)="viewMode.set('unified')">Unified</button>
      </nav>
      <button type="button" class="link" (click)="clearAll()">Clear all</button>
    </div>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }

    <section class="panel result">
      @if (compared(); as c) {
        <div class="diff ngx-diff-light-theme">
          @if (viewMode() === 'side') {
            <ngx-side-by-side-diff [before]="c.left" [after]="c.right" [lineContextSize]="4" />
          } @else {
            <ngx-unified-diff [before]="c.left" [after]="c.right" [lineContextSize]="4" />
          }
        </div>
      } @else {
        <p class="empty">Click Compare to see the differences</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .sides {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 800px) {
      .sides {
        grid-template-columns: 1fr;
      }
    }
    .side {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
    }
    .side-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .upload {
      padding: 6px 10px;
    }
    textarea {
      min-height: 280px;
      padding: 10px;
      border: 1px solid #cfd5dc;
      border-radius: 8px;
      font: 0.85rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre;
      overflow: auto;
      resize: vertical;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 14px;
    }
    .actions .primary {
      padding: 10px 28px;
    }
    .actions .tabs {
      width: 260px;
    }
    .result {
      min-height: 160px;
      padding: 0;
      overflow: hidden;
    }
    .result .empty {
      text-align: center;
      padding: 40px 12px;
    }
    .diff {
      max-height: 70vh;
      overflow: auto;
    }
    :host ::ng-deep .ngx-diff {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.85rem;
      min-width: max-content;
    }
  `,
})
export class TextCompareComponent {
  readonly sides: { key: Side; label: string }[] = [
    { key: 'left', label: 'Original text' },
    { key: 'right', label: 'Changed text' },
  ];

  readonly left = signal('');
  readonly right = signal('');
  readonly viewMode = signal<'side' | 'unified'>('side');
  /** The texts as of the last Compare click. */
  readonly compared = signal<{ left: string; right: string } | null>(null);
  readonly error = signal('');

  async onFileInput(event: Event, side: Side): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    storeCopies('text', [file]);
    try {
      (side === 'left' ? this.left : this.right).set(await file.text());
      this.error.set('');
    } catch (e) {
      console.error(e);
      this.error.set('Could not read ' + file.name + ' as text.');
    }
  }

  compare(): void {
    this.compared.set({ left: this.left(), right: this.right() });
  }

  clearAll(): void {
    this.left.set('');
    this.right.set('');
    this.compared.set(null);
    this.error.set('');
  }
}

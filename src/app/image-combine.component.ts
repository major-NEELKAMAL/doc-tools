import { Component, OnDestroy, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { PageSize, canvasesToPdf, stackImages } from './combine';
import { storeCopies } from './doc-upload';
import { baseName, canvasToBlob, loadCanvas } from './image-edit';
import { Preview, replacePreview } from './preview';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

/** 'combine' stacks the images top to bottom; 'pdf' makes one PDF page per image. */
export type CombineMode = 'combine' | 'pdf';

interface Item {
  id: number;
  file: File;
  url: string;
}

/**
 * Several images in a user-chosen order, turned into one tall image, a
 * one-page PDF of that image, or a PDF with a page per image.
 */
@Component({
  selector: 'app-image-combine',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="panel controls">
      <label
        class="drop"
        [class.small]="items().length"
        [class.over]="dragging()"
        (dragover)="onDragOver($event)"
        (dragleave)="dragging.set(false)"
        (drop)="onDrop($event)"
      >
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple (change)="onFileInput($event)" hidden />
        @if (items().length) {
          <strong>+ Add more images</strong>
        } @else {
          <strong>Click to choose images</strong>
          <span>or drag &amp; drop them here</span>
          <small>JPG, PNG or WEBP — pick as many as you need</small>
        }
      </label>

      @if (items().length) {
        <p class="step">
          {{ mode() === 'combine' ? 'Top to bottom' : 'Page order' }} — drag to reorder or use the arrows.
        </p>
        <ol class="items">
          @for (item of items(); track item.id; let i = $index, first = $first, last = $last) {
            <li
              draggable="true"
              [class.drag-over]="dragOver() === i"
              (dragstart)="dragFrom = i"
              (dragover)="onItemDragOver($event, i)"
              (dragleave)="dragOver.set(null)"
              (drop)="onItemDrop($event, i)"
              (dragend)="dragFrom = null; dragOver.set(null)"
            >
              <img [src]="item.url" alt="" />
              <span class="name" [title]="item.file.name">{{ i + 1 }}. {{ item.file.name }}</span>
              <button type="button" class="icon" title="Move up" [disabled]="first" (click)="move(i, -1)">↑</button>
              <button type="button" class="icon" title="Move down" [disabled]="last" (click)="move(i, 1)">↓</button>
              <button type="button" class="icon" title="Remove" (click)="remove(i)">✕</button>
            </li>
          }
        </ol>
        <button type="button" class="link" (click)="clear()">Remove all</button>

        @if (mode() === 'combine') {
          <div class="field">
            <span>Save as</span>
            <div class="tabs">
              <button type="button" [class.active]="output === 'image'" (click)="output = 'image'; changed()">Image</button>
              <button type="button" [class.active]="output === 'pdf'" (click)="output = 'pdf'; changed()">PDF</button>
            </div>
          </div>
          <label class="check">
            <input type="checkbox" [(ngModel)]="sameWidth" (ngModelChange)="changed()" />
            Make all images the same width
          </label>
          <label class="field">
            <span>Space between images <em>{{ gap }} px</em></span>
            <input type="range" min="0" max="80" step="2" [(ngModel)]="gap" (ngModelChange)="changed()" />
          </label>
        }

        @if (mode() === 'pdf' || output === 'pdf') {
          <div class="field">
            <span>Page size</span>
            <div class="tabs">
              <button type="button" [class.active]="pageSize === 'fit'" (click)="pageSize = 'fit'; changed()">
                Fit to image
              </button>
              <button type="button" [class.active]="pageSize === 'a4'" (click)="pageSize = 'a4'; changed()">A4</button>
            </div>
          </div>
        }
      }

      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      @if (items().length) {
        <a class="download" [class.disabled]="!result() || busy()" [attr.href]="result()?.url" [attr.download]="result()?.name">
          {{ busy() ? 'Working…' : 'Download' }}
        </a>
        @if (result(); as r) {
          <small class="hint">{{ r.name }}</small>
          <button type="button" class="secondary" [disabled]="busy()" (click)="sendToWatermark()">
            Add a watermark to this
          </button>
        }
      }
    </section>

    <section class="panel preview">
      @if (result(); as r) {
        @if (r.pdfUrl) {
          <iframe [src]="r.pdfUrl" title="PDF preview"></iframe>
        } @else {
          <img [src]="r.url" alt="Combined preview" />
        }
      } @else {
        <p class="empty">{{ busy() ? 'Working…' : 'The preview shows up here' }}</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: contents;
    }
    .drop.small {
      padding: 12px;
    }
    .items {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .items li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px;
      background: #f4f6f8;
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: grab;
    }
    .items li.drag-over {
      border-color: #2563eb;
      background: #f3f7ff;
    }
    .items img {
      width: 44px;
      height: 44px;
      object-fit: cover;
      border-radius: 4px;
      flex: none;
    }
    .items .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.85rem;
    }
    .icon {
      width: 28px;
      height: 28px;
      flex: none;
      border: 1px solid #cfd5dc;
      border-radius: 6px;
      background: #fff;
      cursor: pointer;
      font: inherit;
      line-height: 1;
    }
    .preview img {
      max-height: none;
    }
    .preview:has(img) {
      align-items: flex-start;
      max-height: 85vh;
      overflow: auto;
    }
  `,
})
export class ImageCombineComponent implements OnDestroy {
  private readonly sanitizer = inject(DomSanitizer);

  readonly mode = input.required<CombineMode>();
  /** The current result, to be opened in the watermark tool. */
  readonly watermark = output<File>();

  // Settings
  output: 'image' | 'pdf' = 'image';
  sameWidth = true;
  gap = 0;
  pageSize: PageSize = 'fit';

  // State
  readonly items = signal<Item[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly dragging = signal(false);
  readonly dragOver = signal<number | null>(null);
  readonly result = signal<Preview | null>(null);
  dragFrom: number | null = null;

  private nextId = 0;
  private debounce?: ReturnType<typeof setTimeout>;
  private run = 0;

  constructor() {
    // Switching between "Combine" and "Images to PDF" keeps the images but re-renders.
    effect(() => {
      this.mode();
      untracked(() => this.changed());
    });
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    storeCopies('combine', input.files);
    this.addFiles(input.files);
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    storeCopies('combine', event.dataTransfer?.files);
    this.addFiles(event.dataTransfer?.files);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    // Reordering a list item is not a file drop.
    if (this.dragFrom === null) this.dragging.set(true);
  }

  onItemDragOver(event: DragEvent, i: number): void {
    if (this.dragFrom === null) return;
    event.preventDefault();
    this.dragOver.set(i);
  }

  onItemDrop(event: DragEvent, to: number): void {
    if (this.dragFrom === null) return;
    event.preventDefault();
    const from = this.dragFrom;
    this.dragFrom = null;
    this.dragOver.set(null);
    if (from !== to) this.reorder(from, to);
  }

  move(i: number, by: -1 | 1): void {
    this.reorder(i, i + by);
  }

  remove(i: number): void {
    URL.revokeObjectURL(this.items()[i].url);
    this.items.update((list) => list.filter((_, j) => j !== i));
    this.changed();
  }

  clear(): void {
    this.items().forEach((it) => URL.revokeObjectURL(it.url));
    this.items.set([]);
    this.error.set('');
    this.changed();
  }

  sendToWatermark(): void {
    const r = this.result();
    if (r) this.watermark.emit(new File([r.blob], r.name, { type: r.blob.type }));
  }

  changed(): void {
    clearTimeout(this.debounce);
    this.run++; // whatever is rendering now is stale
    this.busy.set(this.items().length > 0);
    this.debounce = setTimeout(() => this.render(), 250);
  }

  ngOnDestroy(): void {
    clearTimeout(this.debounce);
    this.run++;
    this.items().forEach((it) => URL.revokeObjectURL(it.url));
    replacePreview(this.sanitizer, this.result, null, '');
  }

  private addFiles(list: FileList | null | undefined): void {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const images = files.filter((f) => ACCEPTED.includes(f.type));
    this.error.set(images.length < files.length ? 'Only JPG, PNG and WEBP images can be added — the rest were skipped.' : '');
    if (!images.length) return;
    this.items.update((items) => [
      ...items,
      ...images.map((file) => ({ id: this.nextId++, file, url: URL.createObjectURL(file) })),
    ]);
    this.changed();
  }

  private reorder(from: number, to: number): void {
    this.items.update((list) => {
      const next = [...list];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
    this.changed();
  }

  private async render(): Promise<void> {
    const files = this.items().map((it) => it.file);
    const run = this.run;
    if (!files.length) {
      replacePreview(this.sanitizer, this.result, null, '');
      this.busy.set(false);
      return;
    }
    const base = baseName(files[0]);
    try {
      let blob: Blob;
      let name: string;
      if (this.mode() === 'pdf') {
        const canvases = [];
        for (const f of files) canvases.push(await loadCanvas(f));
        blob = await canvasesToPdf(canvases, this.pageSize);
        name = base + (files.length > 1 ? '_combined' : '') + '.pdf';
      } else {
        const canvas = await stackImages(files, { sameWidth: this.sameWidth, gap: this.gap });
        if (this.output === 'pdf') {
          blob = await canvasesToPdf([canvas], this.pageSize);
          name = base + '_combined.pdf';
        } else {
          const png = files.every((f) => f.type === 'image/png');
          blob = await canvasToBlob(canvas, png ? 'image/png' : 'image/jpeg');
          name = base + '_combined' + (png ? '.png' : '.jpg');
        }
      }
      if (run !== this.run) return; // a newer render superseded this one
      this.error.set('');
      replacePreview(this.sanitizer, this.result, blob, name);
    } catch (e) {
      if (run !== this.run) return;
      console.error(e);
      replacePreview(this.sanitizer, this.result, null, '');
      this.error.set('Could not read one of the images. Try removing it, or save it again as JPG / PNG.');
    } finally {
      if (run === this.run) this.busy.set(false);
    }
  }
}

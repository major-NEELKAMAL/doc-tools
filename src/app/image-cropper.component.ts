import { Component, ElementRef, OnDestroy, effect, input, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { canvasToBlob, canvasToPng, loadCanvas } from './image-edit';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Drag/resize crop box over an image. Works in the image's
 * natural pixels; the parent calls {@link crop} to get the cropped file.
 */
@Component({
  selector: 'app-image-cropper',
  standalone: true,
  template: `
    <div
      class="stage"
      #stage
      (pointermove)="onMove($event)"
      (pointerup)="onUp($event)"
      (pointercancel)="onUp($event)"
    >
      @if (url()) {
        <img #img [src]="url()" alt="Image to crop" draggable="false" (load)="onLoad()" />
      }
      @if (rect(); as r) {
        <div
          class="box"
          [style.left.px]="r.x * scale()"
          [style.top.px]="r.y * scale()"
          [style.width.px]="r.w * scale()"
          [style.height.px]="r.h * scale()"
          (pointerdown)="onDown($event, 'move')"
        >
          @for (h of handles; track h) {
            <span class="handle {{ h }}" (pointerdown)="onDown($event, h)"></span>
          }
          <span class="size">{{ r.w | number: '1.0-0' }} × {{ r.h | number: '1.0-0' }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      justify-content: center;
      width: 100%;
    }
    .stage {
      position: relative;
      overflow: hidden;
      touch-action: none;
      user-select: none;
      line-height: 0;
    }
    img {
      display: block;
      max-width: 100%;
      max-height: 75vh;
    }
    .box {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid #fff;
      outline: 1px solid rgb(0 0 0 / 40%);
      box-shadow: 0 0 0 9999px rgb(0 0 0 / 50%);
      cursor: move;
    }
    .handle {
      position: absolute;
      width: 14px;
      height: 14px;
      margin: -8px 0 0 -8px;
      background: #fff;
      border: 1px solid #2563eb;
      border-radius: 3px;
    }
    .nw { left: 0; top: 0; cursor: nwse-resize; }
    .n { left: 50%; top: 0; cursor: ns-resize; }
    .ne { left: 100%; top: 0; cursor: nesw-resize; }
    .e { left: 100%; top: 50%; cursor: ew-resize; }
    .se { left: 100%; top: 100%; cursor: nwse-resize; }
    .s { left: 50%; top: 100%; cursor: ns-resize; }
    .sw { left: 0; top: 100%; cursor: nesw-resize; }
    .w { left: 0; top: 50%; cursor: ew-resize; }
    .size {
      position: absolute;
      left: 4px;
      top: 4px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgb(0 0 0 / 60%);
      color: #fff;
      font: 12px/1.4 system-ui, sans-serif;
      pointer-events: none;
    }
  `,
  imports: [DecimalPipe],
})
export class ImageCropperComponent implements OnDestroy {
  readonly file = input.required<File>();

  readonly url = signal<string | null>(null);
  readonly rect = signal<Rect | null>(null);
  readonly scale = signal(1);
  readonly handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  private readonly stage = viewChild.required<ElementRef<HTMLDivElement>>('stage');
  private readonly img = viewChild<ElementRef<HTMLImageElement>>('img');

  /** The EXIF-oriented image, in natural pixels. */
  private source: HTMLCanvasElement | null = null;
  private drag: { handle: Handle; startX: number; startY: number; start: Rect } | null = null;
  private resizeObserver = new ResizeObserver(() => this.updateScale());

  constructor() {
    effect(() => {
      this.load(this.file());
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver.disconnect();
    this.setUrl(null);
  }

  /** Select the whole image again. */
  reset(): void {
    if (this.source) this.rect.set({ x: 0, y: 0, w: this.source.width, h: this.source.height });
  }

  /** The selected area as a new (lossless PNG) file. */
  async crop(): Promise<File> {
    const src = this.source!;
    const r = roundRect(this.rect()!);
    const c = document.createElement('canvas');
    c.width = r.w;
    c.height = r.h;
    c.getContext('2d')!.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return canvasToPng(c, this.file().name);
  }

  onLoad(): void {
    const img = this.img()?.nativeElement;
    if (!img) return;
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(img);
    this.updateScale();
  }

  onDown(event: PointerEvent, handle: Handle): void {
    event.preventDefault();
    event.stopPropagation();
    const r = this.rect();
    if (!r) return;
    this.stage().nativeElement.setPointerCapture(event.pointerId);
    this.drag = { handle, startX: event.clientX, startY: event.clientY, start: r };
  }

  onMove(event: PointerEvent): void {
    const d = this.drag;
    const src = this.source;
    if (!d || !src) return;
    const dx = (event.clientX - d.startX) / this.scale();
    const dy = (event.clientY - d.startY) / this.scale();
    const W = src.width;
    const H = src.height;
    const min = Math.min(20, W, H);
    let { x, y, w, h } = d.start;

    if (d.handle === 'move') {
      x = clamp(x + dx, 0, W - w);
      y = clamp(y + dy, 0, H - h);
    } else {
      if (d.handle.includes('w')) {
        const nx = clamp(x + dx, 0, x + w - min);
        w = x + w - nx;
        x = nx;
      }
      if (d.handle.includes('e')) w = clamp(w + dx, min, W - x);
      if (d.handle.includes('n')) {
        const ny = clamp(y + dy, 0, y + h - min);
        h = y + h - ny;
        y = ny;
      }
      if (d.handle.includes('s')) h = clamp(h + dy, min, H - y);
    }
    this.rect.set({ x, y, w, h });
  }

  onUp(event: PointerEvent): void {
    if (!this.drag) return;
    this.drag = null;
    this.stage().nativeElement.releasePointerCapture(event.pointerId);
  }

  private async load(file: File): Promise<void> {
    const c = await loadCanvas(file);
    if (file !== this.file()) return; // a newer file arrived meanwhile
    await this.setSource(c);
  }

  private async setSource(c: HTMLCanvasElement): Promise<void> {
    this.source = c;
    this.rect.set(null);
    // PNG keeps the preview lossless; it's only shown on screen.
    this.setUrl(URL.createObjectURL(await canvasToBlob(c, 'image/png')));
    this.reset();
  }

  private setUrl(url: string | null): void {
    const old = this.url();
    if (old) URL.revokeObjectURL(old);
    this.url.set(url);
  }

  private updateScale(): void {
    const img = this.img()?.nativeElement;
    if (img && this.source && img.clientWidth) this.scale.set(img.clientWidth / this.source.width);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function roundRect(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, w: Math.max(1, Math.round(r.x + r.w) - x), h: Math.max(1, Math.round(r.y + r.h) - y) };
}

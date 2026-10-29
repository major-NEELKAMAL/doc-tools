import { Component, OnDestroy, WritableSignal, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { CombineMode, ImageCombineComponent } from './image-combine.component';
import { storeCopies } from './doc-upload';
import { ImageCropperComponent } from './image-cropper.component';
import { baseName, downloadType, exportImage, isPdf, rotateFile } from './image-edit';
import { Preview, replacePreview } from './preview';
import { ResizeResult, ResizeType, imageSize, resizeImage } from './resize';
import { LandingComponent } from './landing.component';
import { TextCompareComponent } from './text-compare.component';
import { WatermarkOptions, WatermarkService } from './watermark.service';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

type Tool = 'watermark' | CombineMode | 'text';
type Tab = 'crop' | 'rotate' | 'resize' | 'watermark';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, ImageCombineComponent, ImageCropperComponent, LandingComponent, TextCompareComponent],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnDestroy {
  private readonly watermarker = inject(WatermarkService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly cropper = viewChild(ImageCropperComponent);

  // Watermark settings
  text = 'Add watermark';
  addDate = true;
  color = '#d00000';
  opacity = 35;
  sizePercent = 7;
  angle = 30;
  tiled = true;
  imageAsPdf = false;

  // Resize settings
  resizeWidth: number | null = null;
  resizeHeight: number | null = null;
  keepAspect = true;
  maxKb: number | null = null;
  resizeType: ResizeType = 'image/jpeg';
  resizeWithWatermark = false;
  readonly kbPresets = [20, 50, 100, 200, 500];
  readonly formatBytes = formatBytes;

  // State
  readonly tool = signal<Tool>('watermark');
  readonly combineMode = signal<CombineMode>('combine');
  readonly tab = signal<Tab>('crop');
  /** The file as uploaded. */
  readonly original = signal<File | null>(null);
  /** The original with every crop/rotation applied so far. */
  readonly edited = signal<File | null>(null);
  readonly editCount = signal(0);
  readonly fileIsPdf = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly dragging = signal(false);
  readonly editedPreview = signal<Preview | null>(null);
  readonly result = signal<Preview | null>(null);
  /** Pixel size of the edited image (null for a PDF). */
  readonly editedSize = signal<{ width: number; height: number } | null>(null);
  readonly resized = signal<Preview | null>(null);
  readonly resizeInfo = signal<ResizeResult | null>(null);

  private debounce?: ReturnType<typeof setTimeout>;
  private resizeDebounce?: ReturnType<typeof setTimeout>;
  private run = 0;
  private resizeRun = 0;

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    storeCopies('crop', input.files?.[0] ? [input.files[0]] : []);
    this.setFile(input.files?.[0]);
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    storeCopies('crop', file ? [file] : []);
    this.setFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  selectTool(tool: Tool): void {
    this.tool.set(tool);
    if (tool === 'combine' || tool === 'pdf') this.combineMode.set(tool);
  }

  /** A landing card was clicked: switch to its tool and scroll to it. */
  openTool(tool: Tool): void {
    this.selectTool(tool);
    document.getElementById('tools')?.scrollIntoView({ behavior: 'smooth' });
  }

  /** Opens a combined image / PDF in the watermark tool. */
  openInWatermark(file: File): void {
    this.tool.set('watermark');
    this.setFile(file);
  }

  clear(): void {
    this.original.set(null);
    this.setEdited(null);
    this.editCount.set(0);
    this.error.set('');
    this.tab.set('crop');
  }

  selectTab(tab: Tab): void {
    if ((tab === 'crop' || tab === 'resize') && this.fileIsPdf()) return;
    this.error.set('');
    this.tab.set(tab);
    if (tab === 'watermark' && !this.result()) this.render();
    // Always re-render: the watermark settings may have changed since.
    if (tab === 'resize') this.renderResize();
  }

  async applyCrop(): Promise<void> {
    const cropper = this.cropper();
    if (cropper) await this.edit(() => cropper.crop(), 'Could not crop this image.');
  }

  rotate(deg: 90 | -90 | 180): Promise<void> {
    return this.edit(() => rotateFile(this.edited()!, deg), 'Could not rotate this file.');
  }

  undoAll(): void {
    this.setEdited(this.original());
    this.editCount.set(0);
  }

  /** Download the crop/rotate result without a watermark. */
  async downloadEdited(): Promise<void> {
    const edited = this.edited();
    const original = this.original();
    if (!edited || !original) return;
    if (this.fileIsPdf()) {
      saveBlob(edited, baseName(original) + '_edited.pdf');
      return;
    }
    const type = downloadType(original);
    saveBlob(await exportImage(edited, type), baseName(original) + '_edited' + (type === 'image/png' ? '.png' : '.jpg'));
  }

  /** Called on every watermark settings change — re-renders shortly after. */
  changed(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.render(), 250);
  }

  /** Width edited — with the aspect ratio locked, the height follows. */
  widthChanged(): void {
    const size = this.editedSize();
    if (this.keepAspect && size) {
      this.resizeHeight = this.resizeWidth ? Math.max(1, Math.round((this.resizeWidth * size.height) / size.width)) : null;
    }
    this.resizeChanged();
  }

  heightChanged(): void {
    const size = this.editedSize();
    if (this.keepAspect && size) {
      this.resizeWidth = this.resizeHeight ? Math.max(1, Math.round((this.resizeHeight * size.width) / size.height)) : null;
    }
    this.resizeChanged();
  }

  setMaxKb(kb: number | null): void {
    this.maxKb = kb;
    this.resizeChanged();
  }

  /** Called on every resize settings change — re-renders shortly after. */
  resizeChanged(): void {
    clearTimeout(this.resizeDebounce);
    this.resizeDebounce = setTimeout(() => this.renderResize(), 300);
  }

  ngOnDestroy(): void {
    clearTimeout(this.debounce);
    clearTimeout(this.resizeDebounce);
    this.setEdited(null);
  }

  private setFile(file: File | undefined): void {
    if (!file) return;
    if (!ACCEPTED.includes(file.type) && !isPdf(file)) {
      this.error.set('Please choose a JPG, PNG, WEBP image or a PDF.');
      return;
    }
    this.error.set('');
    this.original.set(file);
    this.fileIsPdf.set(isPdf(file));
    this.editCount.set(0);
    this.setEdited(file);
    this.tab.set(this.fileIsPdf() ? 'watermark' : 'crop');
    if (this.tab() === 'watermark') this.render();
  }

  private async edit(op: () => Promise<File>, failure: string): Promise<void> {
    if (!this.edited() || this.busy()) return;
    this.busy.set(true);
    try {
      this.setEdited(await op());
      this.editCount.update((n) => n + 1);
      this.error.set('');
    } catch (e) {
      console.error(e);
      this.error.set(failure);
    } finally {
      this.busy.set(false);
    }
  }

  /** Replaces the edited file; the watermark result is stale from here on. */
  private setEdited(file: File | null): void {
    this.run++;
    this.busy.set(false);
    this.edited.set(file);
    this.replacePreview(this.editedPreview, file, file?.name ?? '');
    this.replacePreview(this.result, null, '');
    this.resizeRun++;
    this.replacePreview(this.resized, null, '');
    this.resizeInfo.set(null);
    this.editedSize.set(null);
    if (file && !isPdf(file)) {
      imageSize(file).then(
        (size) => this.edited() === file && this.editedSize.set(size),
        () => undefined,
      );
    }
  }

  private async render(): Promise<void> {
    const file = this.edited();
    const original = this.original();
    if (!file || !original) return;
    const opts = this.watermarkOptions();
    if (!opts) {
      this.replacePreview(this.result, null, '');
      return;
    }
    const run = ++this.run;
    this.busy.set(true);
    try {
      const out = await this.watermarker.watermark(file, opts, {
        baseName: baseName(original),
        imageType: downloadType(original),
        imageAsPdf: this.imageAsPdf,
      });
      if (run !== this.run) return; // a newer render superseded this one
      this.error.set('');
      this.replacePreview(this.result, out.blob, out.fileName);
    } catch (e) {
      if (run !== this.run) return;
      console.error(e);
      this.replacePreview(this.result, null, '');
      this.error.set(
        this.fileIsPdf()
          ? 'Could not watermark this PDF. It may be password-protected, or the text has characters the PDF font does not support (use plain English letters).'
          : 'Could not read this image.',
      );
    } finally {
      if (run === this.run) this.busy.set(false);
    }
  }

  /** The current watermark settings, or null when there is no text to stamp. */
  private watermarkOptions(): WatermarkOptions | null {
    const lines = [this.text.trim(), this.addDate ? todayDdMmYyyy() : ''].filter(Boolean);
    if (!lines.length) return null;
    return {
      lines,
      color: this.color,
      opacity: this.opacity / 100,
      sizePercent: this.sizePercent,
      angle: this.angle,
      tiled: this.tiled,
    };
  }

  private async renderResize(): Promise<void> {
    let file: Blob | null = this.edited();
    const original = this.original();
    if (!file || !original || this.fileIsPdf()) return;
    const run = ++this.resizeRun;
    this.busy.set(true);
    try {
      const wm = this.resizeWithWatermark ? this.watermarkOptions() : null;
      if (wm) {
        file = (
          await this.watermarker.watermark(this.edited()!, wm, {
            baseName: baseName(original),
            imageType: 'image/png',
            imageAsPdf: false,
          })
        ).blob;
      }
      const out = await resizeImage(file, {
        width: this.resizeWidth,
        height: this.resizeHeight,
        maxKb: this.maxKb,
        type: this.resizeType,
      });
      if (run !== this.resizeRun) return;
      this.error.set('');
      const ext = { 'image/png': '.png', 'image/webp': '.webp' }[out.blob.type] ?? '.jpg';
      this.resizeInfo.set(out);
      this.replacePreview(this.resized, out.blob, baseName(original) + '_resized' + ext);
    } catch (e) {
      if (run !== this.resizeRun) return;
      console.error(e);
      this.resizeInfo.set(null);
      this.replacePreview(this.resized, null, '');
      this.error.set('Could not resize this image.');
    } finally {
      if (run === this.resizeRun) this.busy.set(false);
    }
  }

  private replacePreview(target: WritableSignal<Preview | null>, blob: Blob | null, name: string): void {
    replacePreview(this.sanitizer, target, blob, name);
  }
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function todayDdMmYyyy(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

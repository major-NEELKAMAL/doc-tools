import { Component, OnDestroy, WritableSignal, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ImageCropperComponent } from './image-cropper.component';
import { baseName, downloadType, exportImage, isPdf, rotateFile } from './image-edit';
import { WatermarkOptions, WatermarkService } from './watermark.service';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

type Tab = 'crop' | 'rotate' | 'watermark';

/** A blob shown in the preview: object URL plus, for PDFs, the iframe-safe URL. */
interface Preview {
  url: string;
  pdfUrl: SafeResourceUrl | null;
  name: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, ImageCropperComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnDestroy {
  private readonly watermarker = inject(WatermarkService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly cropper = viewChild(ImageCropperComponent);

  // Watermark settings
  text = 'FOR MCA REGISTRATION ONLY';
  addDate = true;
  color = '#d00000';
  opacity = 35;
  sizePercent = 7;
  angle = 30;
  tiled = true;
  imageAsPdf = false;

  // State
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

  private debounce?: ReturnType<typeof setTimeout>;
  private run = 0;

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setFile(input.files?.[0]);
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.setFile(event.dataTransfer?.files?.[0]);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  clear(): void {
    this.original.set(null);
    this.setEdited(null);
    this.editCount.set(0);
    this.error.set('');
    this.tab.set('crop');
  }

  selectTab(tab: Tab): void {
    if (tab === 'crop' && this.fileIsPdf()) return;
    this.error.set('');
    this.tab.set(tab);
    if (tab === 'watermark' && !this.result()) this.render();
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

  ngOnDestroy(): void {
    clearTimeout(this.debounce);
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
  }

  private async render(): Promise<void> {
    const file = this.edited();
    const original = this.original();
    if (!file || !original) return;
    const lines = [this.text.trim(), this.addDate ? todayDdMmYyyy() : ''].filter(Boolean);
    if (!lines.length) {
      this.replacePreview(this.result, null, '');
      return;
    }
    const opts: WatermarkOptions = {
      lines,
      color: this.color,
      opacity: this.opacity / 100,
      sizePercent: this.sizePercent,
      angle: this.angle,
      tiled: this.tiled,
    };
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

  private replacePreview(target: WritableSignal<Preview | null>, blob: Blob | null, name: string): void {
    const old = target();
    if (old) URL.revokeObjectURL(old.url);
    if (!blob) {
      target.set(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    const pdf = blob.type === 'application/pdf';
    target.set({ url, name, pdfUrl: pdf ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null });
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

function todayDdMmYyyy(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

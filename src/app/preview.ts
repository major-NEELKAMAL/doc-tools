import { WritableSignal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/** A blob shown in the preview: object URL plus, for PDFs, the iframe-safe URL. */
export interface Preview {
  url: string;
  pdfUrl: SafeResourceUrl | null;
  name: string;
  blob: Blob;
}

/** Swaps the preview in `target` for `blob`, revoking the old object URL. */
export function replacePreview(
  sanitizer: DomSanitizer,
  target: WritableSignal<Preview | null>,
  blob: Blob | null,
  name: string,
): void {
  const old = target();
  if (old) URL.revokeObjectURL(old.url);
  if (!blob) {
    target.set(null);
    return;
  }
  const url = URL.createObjectURL(blob);
  const pdf = blob.type === 'application/pdf';
  target.set({ url, name, blob, pdfUrl: pdf ? sanitizer.bypassSecurityTrustResourceUrl(url) : null });
}

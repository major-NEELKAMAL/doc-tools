import { PDFDocument, degrees } from 'pdf-lib';

/**
 * Image/PDF edit helpers. Edited images are kept as lossless PNG in between
 * steps; only the final download is converted to the original's format.
 */

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function baseName(file: File): string {
  return file.name.replace(/\.[^.]+$/, '');
}

/** The format downloads of an image should use: PNG stays PNG, else JPEG. */
export function downloadType(original: File): 'image/png' | 'image/jpeg' {
  return original.type === 'image/png' ? 'image/png' : 'image/jpeg';
}

export async function loadCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  c.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, type: string, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality),
  );
}

export async function canvasToPng(c: HTMLCanvasElement, name: string): Promise<File> {
  return new File([await canvasToBlob(c, 'image/png')], name, { type: 'image/png' });
}

/** Rotates an image, or every page of a PDF, by a multiple of 90° (clockwise). */
export async function rotateFile(file: File, deg: 90 | -90 | 180): Promise<File> {
  if (isPdf(file)) {
    const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    for (const page of pdf.getPages()) {
      page.setRotation(degrees((((page.getRotation().angle + deg) % 360) + 360) % 360));
    }
    return new File([await pdf.save()], file.name, { type: 'application/pdf' });
  }
  const src = await loadCanvas(file);
  const sideways = deg !== 180;
  const c = document.createElement('canvas');
  c.width = sideways ? src.height : src.width;
  c.height = sideways ? src.width : src.height;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return canvasToPng(c, file.name);
}

/** An edited image converted to the given download format. */
export async function exportImage(file: File, type: string): Promise<Blob> {
  if (file.type === type) return file;
  return canvasToBlob(await loadCanvas(file), type);
}

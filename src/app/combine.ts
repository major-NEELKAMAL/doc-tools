import { PDFDocument } from 'pdf-lib';
import { canvasToBlob, loadCanvas } from './image-edit';

export type PageSize = 'fit' | 'a4';

export interface StackOptions {
  sameWidth: boolean; // scale every image to the widest one
  gap: number; // px between images
}

// Largest canvas every browser can encode (iOS Safari caps the area at 16.7 MP).
const MAX_SIDE = 16384;
const MAX_AREA = 16_000_000;

const A4: [number, number] = [595.28, 841.89];
const A4_MARGIN = 24;

/** Draws the images one below the other, centred, on a white canvas. */
export async function stackImages(files: File[], opts: StackOptions): Promise<HTMLCanvasElement> {
  const sources = await Promise.all(files.map((f) => loadCanvas(f)));
  const width = Math.max(...sources.map((s) => s.width));
  const sizes = sources.map((s) =>
    opts.sameWidth ? { w: width, h: (s.height * width) / s.width } : { w: s.width, h: s.height },
  );
  const height = sizes.reduce((sum, s) => sum + s.h, 0) + opts.gap * (files.length - 1);
  const scale = Math.min(1, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_AREA / (width * height)));

  const c = document.createElement('canvas');
  c.width = Math.round(width * scale);
  c.height = Math.round(height * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  let y = 0;
  sources.forEach((src, i) => {
    const { w, h } = sizes[i];
    ctx.drawImage(src, ((width - w) / 2) * scale, y * scale, w * scale, h * scale);
    y += h + opts.gap;
  });
  return c;
}

/** A PDF with one page per canvas, each page either sized to it or an A4 sheet. */
export async function canvasesToPdf(canvases: HTMLCanvasElement[], pageSize: PageSize): Promise<Blob> {
  const pdf = await PDFDocument.create();
  for (const c of canvases) {
    const jpg = await pdf.embedJpg(new Uint8Array(await (await canvasToBlob(onWhite(c), 'image/jpeg')).arrayBuffer()));
    if (pageSize === 'fit') {
      pdf.addPage([c.width, c.height]).drawImage(jpg, { x: 0, y: 0, width: c.width, height: c.height });
      continue;
    }
    // A4 in the image's orientation, image fitted inside the margins.
    const [pw, ph] = c.width > c.height ? [A4[1], A4[0]] : A4;
    const s = Math.min((pw - A4_MARGIN * 2) / c.width, (ph - A4_MARGIN * 2) / c.height);
    const w = c.width * s;
    const h = c.height * s;
    pdf.addPage([pw, ph]).drawImage(jpg, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

/** Transparent pixels would turn black in a JPEG, so flatten onto white first. */
function onWhite(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  return c;
}

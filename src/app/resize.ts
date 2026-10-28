import { canvasToBlob, loadCanvas } from './image-edit';

export type ResizeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ResizeOptions {
  width: number | null; // px; null = from the height / original
  height: number | null;
  maxKb: number | null; // null = no file size limit
  type: ResizeType;
}

export interface ResizeResult {
  blob: Blob;
  width: number;
  height: number;
  /** False when even the smallest attempt stayed over `maxKb`. */
  reachedTarget: boolean;
}

const MIN_QUALITY = 0.4;
const MAX_QUALITY = 0.95;
const MIN_SIDE = 16;

/**
 * Resizes an image to the requested pixel size, then — when a file size limit
 * is set — lowers the JPEG/WEBP quality and, if that is not enough, the pixel
 * size until the file fits.
 */
export async function resizeImage(file: Blob, opts: ResizeOptions): Promise<ResizeResult> {
  const src = await loadCanvas(file);
  let { width, height } = targetSize(src.width, src.height, opts.width, opts.height);
  const limit = opts.maxKb ? opts.maxKb * 1024 : Infinity;

  for (let attempt = 0; ; attempt++) {
    const blob = await encode(draw(src, width, height, opts.type), opts.type, limit);
    const reachedTarget = blob.size <= limit;
    if (reachedTarget || attempt >= 15 || Math.min(width, height) <= MIN_SIDE) {
      return { blob, width, height, reachedTarget };
    }
    // File size grows roughly with the pixel count.
    const scale = Math.min(0.9, Math.max(0.5, Math.sqrt(limit / blob.size)));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
}

/** Pixel size of an image, after EXIF orientation. */
export async function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/** The output size: a missing side follows the aspect ratio; none given keeps the original. */
function targetSize(srcW: number, srcH: number, w: number | null, h: number | null) {
  if (w && h) return { width: Math.round(w), height: Math.round(h) };
  if (w) return { width: Math.round(w), height: Math.max(1, Math.round((w * srcH) / srcW)) };
  if (h) return { width: Math.max(1, Math.round((h * srcW) / srcH)), height: Math.round(h) };
  return { width: srcW, height: srcH };
}

function draw(src: HTMLCanvasElement, width: number, height: number, type: ResizeType): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  if (type === 'image/jpeg') {
    // JPEG has no transparency — give transparent areas a white background.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, width, height);
  return c;
}

/** The best quality that fits `limit`, or the lowest allowed quality when none does. */
async function encode(c: HTMLCanvasElement, type: ResizeType, limit: number): Promise<Blob> {
  if (type === 'image/png') return canvasToBlob(c, type);
  const best = await canvasToBlob(c, type, MAX_QUALITY);
  if (best.size <= limit) return best;
  let fit: Blob | null = null;
  let lo = MIN_QUALITY;
  let hi = MAX_QUALITY;
  for (let i = 0; i < 7; i++) {
    const q = (lo + hi) / 2;
    const blob = await canvasToBlob(c, type, q);
    if (blob.size <= limit) {
      fit = blob;
      lo = q;
    } else {
      hi = q;
    }
  }
  return fit ?? canvasToBlob(c, type, MIN_QUALITY);
}

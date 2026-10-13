import { Injectable } from '@angular/core';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { canvasToBlob, isPdf, loadCanvas } from './image-edit';

export interface WatermarkOptions {
  lines: string[];
  color: string; // #rrggbb
  opacity: number; // 0..1
  sizePercent: number; // font size as % of the page's shorter side
  angle: number; // degrees, counter-clockwise as seen on screen
  tiled: boolean;
}

export interface OutputOptions {
  baseName: string; // download name without extension
  imageType: string; // format for image downloads
  imageAsPdf: boolean; // wrap an image in a single-page PDF instead
}

export interface WatermarkResult {
  blob: Blob;
  fileName: string;
}

interface Offset {
  dx: number;
  dy: number;
}

/**
 * Stamps a text watermark onto images and PDFs entirely in the browser — the
 * document never leaves the user's machine.
 */
@Injectable({ providedIn: 'root' })
export class WatermarkService {
  async watermark(file: File, opts: WatermarkOptions, out: OutputOptions): Promise<WatermarkResult> {
    const base = out.baseName + '_watermarked';
    if (isPdf(file)) {
      const bytes = await this.watermarkPdf(await file.arrayBuffer(), opts);
      return { blob: new Blob([bytes], { type: 'application/pdf' }), fileName: base + '.pdf' };
    }
    const { blob, width, height } = await this.watermarkImage(file, opts, out.imageAsPdf ? 'image/jpeg' : out.imageType);
    if (!out.imageAsPdf) {
      const ext = blob.type === 'image/png' ? '.png' : '.jpg';
      return { blob, fileName: base + ext };
    }
    const pdf = await PDFDocument.create();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img = blob.type === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    pdf.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height });
    return { blob: new Blob([await pdf.save()], { type: 'application/pdf' }), fileName: base + '.pdf' };
  }

  private async watermarkImage(file: File, opts: WatermarkOptions, type: string) {
    const canvas = await loadCanvas(file);
    const { width, height } = canvas;
    const ctx = canvas.getContext('2d')!;

    const fontSize = Math.max(8, (Math.min(width, height) * opts.sizePercent) / 100);
    const lineHeight = fontSize * 1.25;
    ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.color;
    ctx.globalAlpha = opts.opacity;

    const blockW = Math.max(...opts.lines.map((l) => ctx.measureText(l).width));
    const blockH = lineHeight * opts.lines.length;
    const rad = (opts.angle * Math.PI) / 180;

    for (const { dx, dy } of placements(width, height, blockW, blockH, rad, opts.tiled)) {
      ctx.save();
      // Offsets are y-up; the canvas is y-down.
      ctx.translate(width / 2 + dx, height / 2 - dy);
      ctx.rotate(-rad);
      opts.lines.forEach((line, i) => {
        ctx.fillText(line, 0, lineHeight * (i - (opts.lines.length - 1) / 2));
      });
      ctx.restore();
    }

    return { blob: await canvasToBlob(canvas, type), width, height };
  }

  private async watermarkPdf(data: ArrayBuffer, opts: WatermarkOptions): Promise<Uint8Array> {
    const pdf = await PDFDocument.load(data, { ignoreEncryption: true });
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const [r, g, b] = hexToRgb(opts.color);

    for (const page of pdf.getPages()) {
      const box = page.getMediaBox();
      // A /Rotate'd page is displayed turned clockwise, so compensate to keep
      // the watermark at the requested on-screen angle.
      const pageRot = ((page.getRotation().angle % 360) + 360) % 360;
      const sideways = pageRot === 90 || pageRot === 270;
      const visW = sideways ? box.height : box.width;
      const visH = sideways ? box.width : box.height;

      const fontSize = Math.max(6, (Math.min(visW, visH) * opts.sizePercent) / 100);
      const lineHeight = fontSize * 1.25;
      const capHeight = font.heightAtSize(fontSize, { descender: false });
      const widths = opts.lines.map((l) => font.widthOfTextAtSize(l, fontSize));
      const blockW = Math.max(...widths);
      const blockH = lineHeight * opts.lines.length;

      const visRad = (opts.angle * Math.PI) / 180;
      const pageRad = ((opts.angle + pageRot) * Math.PI) / 180;
      const rotRad = (pageRot * Math.PI) / 180;
      const cos = Math.cos(pageRad);
      const sin = Math.sin(pageRad);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      for (const v of placements(visW, visH, blockW, blockH, visRad, opts.tiled)) {
        const off = rotate(v.dx, v.dy, rotRad);
        opts.lines.forEach((line, i) => {
          // Bottom-left corner of this line in the block's local (rotated) frame.
          const lx = -widths[i] / 2;
          const ly = lineHeight * ((opts.lines.length - 1) / 2 - i) - capHeight / 2;
          page.drawText(line, {
            x: cx + off.dx + lx * cos - ly * sin,
            y: cy + off.dy + lx * sin + ly * cos,
            size: fontSize,
            font,
            color: rgb(r, g, b),
            opacity: opts.opacity,
            rotate: degrees(opts.angle + pageRot),
          });
        });
      }
    }
    return pdf.save();
  }
}

/**
 * Centres of every watermark block, as y-up offsets from the page centre: one
 * block for a single watermark, or a staggered grid (laid out along the text
 * angle) covering the whole page for a tiled one.
 */
function placements(w: number, h: number, blockW: number, blockH: number, rad: number, tiled: boolean): Offset[] {
  if (!tiled) return [{ dx: 0, dy: 0 }];
  const stepU = blockW + blockH * 2;
  const stepV = blockH * 2.5;
  const reach = Math.hypot(w, h) / 2 + Math.max(stepU, stepV);
  const out: Offset[] = [];
  for (let row = 0, v = -reach; v <= reach; v += stepV, row++) {
    const shift = row % 2 ? stepU / 2 : 0;
    for (let u = -reach + shift; u <= reach; u += stepU) {
      const p = rotate(u, v, rad);
      if (Math.abs(p.dx) <= w / 2 + blockW && Math.abs(p.dy) <= h / 2 + blockW) out.push(p);
    }
  }
  return out;
}

function rotate(x: number, y: number, rad: number): Offset {
  return { dx: x * Math.cos(rad) - y * Math.sin(rad), dy: x * Math.sin(rad) + y * Math.cos(rad) };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

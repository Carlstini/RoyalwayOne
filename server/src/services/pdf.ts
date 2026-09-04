/**
 * DocumentProcessor — real PDF manipulation.
 * pdf-lib for structural edits, MuPDF for rendering/text/structural compression,
 * sharp for embedded image recompression.
 */
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {
  PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray, PDFNumber, degrees,
  StandardFonts, rgb, PDFPage,
} from 'pdf-lib';
import * as mupdf from 'mupdf';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export async function loadPdf(bytes: Uint8Array, opts: { password?: string } = {}) {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, ...(opts.password ? { password: opts.password } : {}) } as any);
  } catch (err) {
    logger.debug({ err }, 'pdf load failed');
    throw new AppError('We could not read this PDF. It may be damaged or password protected.', 422, 'PDF_UNREADABLE');
  }
}

export function openMuPdf(bytes: Uint8Array, password?: string) {
  let doc: any;
  try {
    doc = mupdf.Document.openDocument(Buffer.from(bytes), 'application/pdf');
  } catch {
    throw new AppError('We could not read this PDF. It may be damaged.', 422, 'PDF_UNREADABLE');
  }
  if (doc.needsPassword && doc.needsPassword()) {
    if (!password || !doc.authenticatePassword(password)) {
      throw new AppError('This PDF is password protected. Provide the password to continue.', 422, 'PDF_PASSWORD_REQUIRED');
    }
  }
  return doc;
}

export interface CompressOptions {
  preset: 'extreme' | 'recommended' | 'high-quality' | 'custom';
  dpi?: number;          // target image resolution
  jpegQuality?: number;  // 1-100
  grayscale?: boolean;
  stripMetadata?: boolean;
  downsampleImages?: boolean;
}

const PRESETS: Record<string, Required<Omit<CompressOptions, 'preset'>>> = {
  extreme: { dpi: 72, jpegQuality: 40, grayscale: false, stripMetadata: true, downsampleImages: true },
  recommended: { dpi: 144, jpegQuality: 65, grayscale: false, stripMetadata: true, downsampleImages: true },
  'high-quality': { dpi: 220, jpegQuality: 85, grayscale: false, stripMetadata: false, downsampleImages: true },
  custom: { dpi: 150, jpegQuality: 70, grayscale: false, stripMetadata: true, downsampleImages: true },
};

export interface CompressResult { bytes: Uint8Array; imagesProcessed: number }

/**
 * Compress a PDF: recompress/downsample embedded raster images, drop metadata,
 * then let MuPDF garbage-collect, deduplicate and compress remaining objects.
 * Text and vector content are untouched, so they stay selectable and sharp.
 */
export async function compressPdf(input: Uint8Array, options: CompressOptions): Promise<CompressResult> {
  const p = { ...PRESETS[options.preset] ?? PRESETS.recommended };
  if (options.preset === 'custom') {
    if (options.dpi) p.dpi = clamp(options.dpi, 36, 600);
    if (options.jpegQuality) p.jpegQuality = clamp(options.jpegQuality, 5, 100);
    if (options.grayscale !== undefined) p.grayscale = options.grayscale;
    if (options.stripMetadata !== undefined) p.stripMetadata = options.stripMetadata;
    if (options.downsampleImages !== undefined) p.downsampleImages = options.downsampleImages;
  } else if (options.grayscale) p.grayscale = true;

  const doc = await loadPdf(input);
  let imagesProcessed = 0;

  if (p.downsampleImages) {
    const maxPixels = pageMaxPixels(doc, p.dpi);
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict;
      if (dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
      try {
        const replaced = await recompressImage(doc, dict, obj, { ...p, maxPixels: maxPixels.get(ref.toString()) ?? Infinity });
        if (replaced) imagesProcessed++;
      } catch (err) {
        logger.debug({ err }, 'skipping image during compression');
      }
    }
  }

  if (p.stripMetadata) {
    doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]);
    doc.setProducer('Royalway One'); doc.setCreator('Royalway One');
    try { (doc.catalog as any).delete(PDFName.of('Metadata')); } catch { /* no XMP */ }
  }

  const intermediate = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  // Structural pass: garbage collect unused objects, deduplicate, compress streams.
  try {
    const m = mupdf.Document.openDocument(Buffer.from(intermediate), 'application/pdf') as any;
    const buf: Uint8Array = m.saveToBuffer('compress,compress-images=no,garbage=compact,sanitize').asUint8Array();
    m.destroy?.();
    if (buf.length && buf.length < intermediate.length) return { bytes: buf, imagesProcessed };
  } catch (err) {
    logger.debug({ err }, 'mupdf structural pass skipped');
  }
  return { bytes: intermediate, imagesProcessed };
}

/** Compute a per-image pixel budget from the size the image is drawn at on the page. */
function pageMaxPixels(doc: PDFDocument, dpi: number): Map<string, number> {
  const budget = new Map<string, number>();
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const res = page.node.Resources();
    const xobjs = res?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjs) continue;
    for (const [, value] of xobjs.entries()) {
      const key = value.toString();
      // Conservative: assume an image may cover the full page.
      const px = Math.ceil((width / 72) * dpi) * Math.ceil((height / 72) * dpi);
      budget.set(key, Math.max(budget.get(key) ?? 0, px));
    }
  }
  return budget;
}

async function recompressImage(
  doc: PDFDocument, dict: PDFDict, stream: PDFRawStream,
  p: { dpi: number; jpegQuality: number; grayscale: boolean; maxPixels: number },
): Promise<boolean> {
  const filter = dict.get(PDFName.of('Filter'));
  const filters = filter instanceof PDFArray ? filter.asArray().map((f) => f.toString()) : [filter?.toString() ?? ''];
  const width = (dict.get(PDFName.of('Width')) as PDFNumber)?.asNumber?.();
  const height = (dict.get(PDFName.of('Height')) as PDFNumber)?.asNumber?.();
  const bpc = (dict.get(PDFName.of('BitsPerComponent')) as PDFNumber)?.asNumber?.() ?? 8;
  if (!width || !height) return false;
  if (dict.get(PDFName.of('SMask')) || dict.get(PDFName.of('Mask')) || dict.get(PDFName.of('ImageMask'))) return false;

  const cs = dict.get(PDFName.of('ColorSpace'))?.toString() ?? '';
  let raw: Buffer;
  if (filters.includes('/DCTDecode') && filters.length === 1) {
    raw = Buffer.from(stream.getContents());
  } else if (filters.includes('/FlateDecode') && filters.length === 1 && bpc === 8 && /DeviceRGB|DeviceGray/.test(cs)) {
    const inflated = zlib.inflateSync(Buffer.from(stream.getContents()));
    const channels = cs.includes('RGB') ? 3 : 1;
    if (inflated.length < width * height * channels) return false;
    raw = await sharp(inflated, { raw: { width, height, channels: channels as 1 | 3 } }).jpeg().toBuffer();
  } else {
    return false; // JPX, CCITT, predictors, palettes: leave untouched rather than risk corruption
  }

  const scale = Math.min(1, Math.sqrt(p.maxPixels / (width * height)));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  let pipeline = sharp(raw, { failOn: 'none' });
  if (scale < 0.98) pipeline = pipeline.resize(targetW, targetH, { fit: 'fill', kernel: 'lanczos3' });
  if (p.grayscale) pipeline = pipeline.grayscale();
  const encoded = await pipeline.jpeg({ quality: p.jpegQuality, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer();
  const meta = await sharp(encoded).metadata();

  const originalSize = stream.getContents().length;
  if (encoded.length >= originalSize * 0.95 && scale >= 0.98) return false;
  const channels: number = meta.channels ?? 3;

  const newDict = doc.context.obj({
    Type: 'XObject',
    Subtype: 'Image',
    Width: meta.width ?? targetW,
    Height: meta.height ?? targetH,
    ColorSpace: channels === 1 ? 'DeviceGray' : 'DeviceRGB',
    BitsPerComponent: 8,
    Filter: 'DCTDecode',
    Length: encoded.length,
  });
  const newStream = PDFRawStream.of(newDict, encoded);
  const ref = findRef(doc, stream);
  if (!ref) return false;
  doc.context.assign(ref, newStream);
  return true;
}

function findRef(doc: PDFDocument, obj: any) {
  for (const [ref, value] of doc.context.enumerateIndirectObjects()) if (value === obj) return ref;
  return null;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  if (files.length < 2) throw new AppError('Select at least two PDFs to merge.', 400, 'BAD_REQUEST');
  const target = await PDFDocument.create();
  for (const bytes of files) {
    const src = await loadPdf(bytes);
    const pages = await target.copyPages(src, src.getPageIndices());
    pages.forEach((pg) => target.addPage(pg));
  }
  return target.save({ useObjectStreams: true });
}

/** Parse "1-3,5,8-" into zero-based page indices. */
export function parseRanges(spec: string, pageCount: number): number[] {
  const indices: number[] = [];
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part);
    if (!m) throw new AppError(`"${part}" is not a valid page range.`, 400, 'BAD_REQUEST');
    const start = m[1] ? Number(m[1]) : 1;
    const end = m[2] ? (m[3] ? Number(m[3]) : pageCount) : start;
    if (start < 1 || end > pageCount || end < start) throw new AppError(`Pages must be between 1 and ${pageCount}.`, 400, 'BAD_REQUEST');
    for (let i = start; i <= end; i++) if (!indices.includes(i - 1)) indices.push(i - 1);
  }
  if (!indices.length) throw new AppError('Select at least one page.', 400, 'BAD_REQUEST');
  return indices;
}

export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  const target = await PDFDocument.create();
  const pages = await target.copyPages(src, indices);
  pages.forEach((p) => target.addPage(p));
  return target.save({ useObjectStreams: true });
}

export async function splitPdf(bytes: Uint8Array, mode: 'each' | 'ranges', ranges: string[] = []): Promise<{ name: string; bytes: Uint8Array }[]> {
  const src = await loadPdf(bytes);
  const count = src.getPageCount();
  const outputs: { name: string; bytes: Uint8Array }[] = [];
  if (mode === 'each') {
    for (let i = 0; i < count; i++) outputs.push({ name: `page-${i + 1}.pdf`, bytes: await extractPages(bytes, [i]) });
  } else {
    for (const [i, spec] of ranges.entries()) {
      outputs.push({ name: `part-${i + 1}.pdf`, bytes: await extractPages(bytes, parseRanges(spec, count)) });
    }
  }
  return outputs;
}

export async function rotatePdf(bytes: Uint8Array, angle: number, pageIndices?: number[]): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  doc.getPages().forEach((page, i) => {
    if (pageIndices && !pageIndices.includes(i)) return;
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  });
  return doc.save({ useObjectStreams: true });
}

export async function organizePages(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  return extractPages(bytes, order);
}

export async function removePages(bytes: Uint8Array, remove: number[]): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const keep = doc.getPageIndices().filter((i) => !remove.includes(i));
  if (!keep.length) throw new AppError('You cannot remove every page.', 400, 'BAD_REQUEST');
  return extractPages(bytes, keep);
}

export async function cropPdf(bytes: Uint8Array, margins: { top: number; right: number; bottom: number; left: number }): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  for (const page of doc.getPages()) {
    const { x, y, width, height } = page.getMediaBox();
    const nw = width - margins.left - margins.right;
    const nh = height - margins.top - margins.bottom;
    if (nw <= 10 || nh <= 10) throw new AppError('Those margins would remove the whole page.', 400, 'BAD_REQUEST');
    page.setCropBox(x + margins.left, y + margins.bottom, nw, nh);
  }
  return doc.save({ useObjectStreams: true });
}

export async function addPageNumbers(bytes: Uint8Array, opts: { position?: 'bottom-center' | 'bottom-right' | 'top-right'; startAt?: number; fontSize?: number }): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = opts.fontSize ?? 11;
  doc.getPages().forEach((page, i) => {
    const label = String((opts.startAt ?? 1) + i);
    const w = font.widthOfTextAtSize(label, size);
    const { width } = page.getSize();
    const pos = opts.position ?? 'bottom-center';
    const x = pos === 'bottom-center' ? width / 2 - w / 2 : width - 40 - w;
    const y = pos === 'top-right' ? page.getSize().height - 32 : 24;
    page.drawText(label, { x, y, size, font, color: rgb(0.25, 0.25, 0.3) });
  });
  return doc.save({ useObjectStreams: true });
}

export async function watermarkPdf(bytes: Uint8Array, text: string, opts: { opacity?: number; fontSize?: number; rotation?: number } = {}): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = opts.fontSize ?? 48;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const tw = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: width / 2 - tw / 2 * Math.cos((opts.rotation ?? 45) * Math.PI / 180),
      y: height / 2 - size / 2,
      size, font, color: rgb(0.55, 0.58, 0.68),
      opacity: opts.opacity ?? 0.22,
      rotate: degrees(opts.rotation ?? 45),
    });
  }
  return doc.save({ useObjectStreams: true });
}

export async function protectPdf(bytes: Uint8Array, userPassword: string, ownerPassword?: string): Promise<Uint8Array> {
  const doc = openMuPdf(bytes);
  const opts = `compress,encrypt=aes-256,user-password=${escapeOpt(userPassword)},owner-password=${escapeOpt(ownerPassword || userPassword)}`;
  const buf = (doc as any).saveToBuffer(opts).asUint8Array();
  (doc as any).destroy?.();
  return buf;
}

export async function unlockPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = openMuPdf(bytes, password);
  const buf = (doc as any).saveToBuffer('compress,decrypt').asUint8Array();
  (doc as any).destroy?.();
  return buf;
}

function escapeOpt(v: string) {
  if (/[,=]/.test(v)) throw new AppError('Passwords cannot contain commas or equals signs.', 400, 'BAD_REQUEST');
  return v;
}

/** Repair: reparse and rewrite structure, recovering what can be recovered. */
export async function repairPdf(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const doc = openMuPdf(bytes);
    const buf = (doc as any).saveToBuffer('compress,garbage=compact,sanitize').asUint8Array();
    (doc as any).destroy?.();
    return buf;
  } catch {
    const doc = await loadPdf(bytes);
    return doc.save({ useObjectStreams: false });
  }
}

export interface RenderedPage { index: number; buffer: Buffer; width: number; height: number }

/** Render PDF pages to raster images at a given DPI using MuPDF. */
export async function renderPages(bytes: Uint8Array, opts: { dpi?: number; format?: 'png' | 'jpeg'; pages?: number[]; quality?: number } = {}): Promise<RenderedPage[]> {
  const dpi = opts.dpi ?? 150;
  const doc = openMuPdf(bytes) as any;
  const total = doc.countPages();
  const indices = opts.pages ?? Array.from({ length: total }, (_, i) => i);
  const scale = dpi / 72;
  const results: RenderedPage[] = [];
  for (const i of indices) {
    if (i < 0 || i >= total) continue;
    const page = doc.loadPage(i);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const png = Buffer.from(pixmap.asPNG());
    const buffer = opts.format === 'jpeg'
      ? await sharp(png).jpeg({ quality: opts.quality ?? 85 }).toBuffer()
      : png;
    results.push({ index: i, buffer, width: pixmap.getWidth(), height: pixmap.getHeight() });
    pixmap.destroy?.();
    page.destroy?.();
  }
  doc.destroy?.();
  return results;
}

export interface PageText { index: number; text: string }

export async function extractPdfText(bytes: Uint8Array, password?: string): Promise<PageText[]> {
  const doc = openMuPdf(bytes, password) as any;
  const pages: PageText[] = [];
  const total = doc.countPages();
  for (let i = 0; i < total; i++) {
    const page = doc.loadPage(i);
    const st = JSON.parse(page.toStructuredText('preserve-whitespace').asJSON());
    const lines: string[] = [];
    for (const block of st.blocks ?? []) {
      if (block.type !== 'text') continue;
      for (const line of block.lines ?? []) {
        const text = (line.text ?? (line.spans ?? []).map((s: any) => (s.chars ?? []).map((c: any) => c.c).join('')).join(''));
        if (text?.trim()) lines.push(text);
      }
      lines.push('');
    }
    pages.push({ index: i, text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() });
    page.destroy?.();
  }
  doc.destroy?.();
  return pages;
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await loadPdf(bytes);
  return doc.getPageCount();
}

/** Build a PDF from images, one page per image, fitted to the page. */
export async function imagesToPdf(images: { buffer: Buffer; mime: string }[], opts: { pageSize?: 'fit' | 'a4'; margin?: number } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const margin = opts.margin ?? 0;
  for (const img of images) {
    const normalized = /jpeg|jpg/.test(img.mime) ? img.buffer : await sharp(img.buffer).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
    const embedded = await doc.embedJpg(normalized);
    let page: PDFPage;
    if (opts.pageSize === 'a4') {
      page = doc.addPage([595.28, 841.89]);
      const maxW = 595.28 - margin * 2;
      const maxH = 841.89 - margin * 2;
      const scale = Math.min(maxW / embedded.width, maxH / embedded.height);
      page.drawImage(embedded, {
        x: (595.28 - embedded.width * scale) / 2,
        y: (841.89 - embedded.height * scale) / 2,
        width: embedded.width * scale,
        height: embedded.height * scale,
      });
    } else {
      page = doc.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    }
  }
  if (!doc.getPageCount()) throw new AppError('Add at least one image.', 400, 'BAD_REQUEST');
  return doc.save({ useObjectStreams: true });
}

/** Redact: permanently remove content within rectangles by rasterising affected pages. */
export async function redactPdf(bytes: Uint8Array, areas: { page: number; x: number; y: number; width: number; height: number }[], dpi = 150): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  const pageCount = src.getPageCount();
  const affected = [...new Set(areas.map((a) => a.page))].filter((p) => p >= 0 && p < pageCount);
  if (!affected.length) throw new AppError('Select at least one area to redact.', 400, 'BAD_REQUEST');

  const rendered = await renderPages(bytes, { dpi, format: 'png', pages: affected });
  const out = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    if (!affected.includes(i)) {
      const [copied] = await out.copyPages(src, [i]);
      out.addPage(copied);
      continue;
    }
    const original = src.getPage(i);
    const { width: pw, height: ph } = original.getSize();
    const render = rendered.find((r) => r.index === i)!;
    const scale = render.width / pw;
    // Paint black rectangles onto the raster: the underlying text is destroyed, not hidden.
    const overlays = areas.filter((a) => a.page === i).map((a) => ({
      input: { create: { width: Math.max(1, Math.round(a.width * scale)), height: Math.max(1, Math.round(a.height * scale)), channels: 3 as const, background: '#000000' } },
      left: Math.max(0, Math.round(a.x * scale)),
      top: Math.max(0, Math.round((ph - a.y - a.height) * scale)),
    }));
    const flat = await sharp(render.buffer).composite(overlays).jpeg({ quality: 88 }).toBuffer();
    const img = await out.embedJpg(flat);
    const page = out.addPage([pw, ph]);
    page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
  }
  return out.save({ useObjectStreams: true });
}

/** Place a signature image (or typed name) on a page. */
export async function signPdf(bytes: Uint8Array, sig: { page: number; x: number; y: number; width: number; height: number; imageBase64?: string; text?: string }): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const page = doc.getPages()[sig.page];
  if (!page) throw new AppError('That page does not exist.', 400, 'BAD_REQUEST');
  if (sig.imageBase64) {
    const raw = Buffer.from(sig.imageBase64.replace(/^data:[^,]+,/, ''), 'base64');
    const png = await sharp(raw).png().toBuffer();
    const img = await doc.embedPng(png);
    page.drawImage(img, { x: sig.x, y: sig.y, width: sig.width, height: sig.height });
  } else if (sig.text) {
    const font = await doc.embedFont(StandardFonts.HelveticaOblique);
    page.drawText(sig.text, { x: sig.x, y: sig.y, size: Math.max(12, sig.height * 0.6), font, color: rgb(0.05, 0.08, 0.2) });
  } else {
    throw new AppError('Draw or type a signature first.', 400, 'BAD_REQUEST');
  }
  return doc.save({ useObjectStreams: true });
}

export async function readFileBytes(p: string) {
  return new Uint8Array(await fs.readFile(p));
}

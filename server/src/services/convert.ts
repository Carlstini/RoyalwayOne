/**
 * Document conversion.
 * Uses LibreOffice headless when available (best fidelity, auto-detected or via
 * SOFFICE_PATH); otherwise falls back to genuine library-based conversion paths.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import * as mupdf from 'mupdf';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import pptxgen from 'pptxgenjs';
import sharp from 'sharp';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { tmpPath } from '../lib/storage.js';
import { run } from './media.js';
import { extractPdfText, renderPages } from './pdf.js';

const SOFFICE_CANDIDATES = [process.env.SOFFICE_PATH, '/usr/bin/soffice', '/usr/bin/libreoffice', '/opt/libreoffice/program/soffice'].filter(Boolean) as string[];

export function sofficePath(): string | null {
  for (const c of SOFFICE_CANDIDATES) if (existsSync(c)) return c;
  return null;
}

export async function sofficeConvert(inputPath: string, targetExt: string): Promise<Buffer> {
  const bin = sofficePath();
  if (!bin) throw new AppError('LIBREOFFICE_UNAVAILABLE', 503, 'LIBREOFFICE_UNAVAILABLE');
  const outDir = tmpPath('');
  await fs.mkdir(outDir, { recursive: true });
  await run(bin, ['--headless', '--norestore', '--convert-to', targetExt, '--outdir', outDir, inputPath], { timeoutMs: 10 * 60_000 });
  const files = await fs.readdir(outDir);
  const produced = files.find((f) => f.toLowerCase().endsWith(`.${targetExt.split(':')[0]}`));
  if (!produced) throw new AppError('LIBREOFFICE_FAILED', 500, 'LIBREOFFICE_FAILED');
  const buf = await fs.readFile(path.join(outDir, produced));
  await fs.rm(outDir, { recursive: true, force: true });
  return buf;
}

/** Render HTML to a real, text-selectable PDF using MuPDF's layout engine. */
export function htmlToPdf(html: string, opts: { width?: number; height?: number; fontSize?: number } = {}): Buffer {
  const src = mupdf.Document.openDocument(Buffer.from(wrapHtml(html)), 'text/html') as any;
  src.layout(opts.width ?? 595, opts.height ?? 842, opts.fontSize ?? 11);
  const buffer = new (mupdf as any).Buffer();
  const writer = new (mupdf as any).DocumentWriter(buffer, 'pdf', 'compress');
  const total = src.countPages();
  if (!total) throw new AppError('There was nothing to convert.', 422, 'EMPTY');
  for (let i = 0; i < total; i++) {
    const page = src.loadPage(i);
    const device = writer.beginPage(page.getBounds());
    page.run(device, (mupdf as any).Matrix.identity);
    device.close();
    writer.endPage();
    page.destroy?.();
  }
  writer.close();
  const out = Buffer.from(buffer.asUint8Array());
  src.destroy?.();
  return out;
}

function wrapHtml(inner: string) {
  if (/<html[\s>]/i.test(inner)) return inner;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{font-family:serif;line-height:1.5;margin:48px;color:#111}
  h1,h2,h3{font-family:sans-serif;color:#0b1020}
  table{border-collapse:collapse;width:100%;font-size:10px}
  td,th{border:1px solid #999;padding:4px 6px;text-align:left}
  img{max-width:100%}
  </style></head><body>${inner}</body></html>`;
}

export async function docxToPdf(buffer: Buffer): Promise<Buffer> {
  if (sofficePath()) {
    const p = tmpPath('.docx');
    await fs.writeFile(p, buffer);
    try { return await sofficeConvert(p, 'pdf'); } catch (e) { logger.warn({ e }, 'soffice docx->pdf failed, using fallback'); } finally { await fs.rm(p, { force: true }); }
  }
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return htmlToPdf(html);
}

export async function xlsxToPdf(buffer: Buffer): Promise<Buffer> {
  if (sofficePath()) {
    const p = tmpPath('.xlsx');
    await fs.writeFile(p, buffer);
    try { return await sofficeConvert(p, 'pdf'); } catch (e) { logger.warn({ e }, 'soffice xlsx->pdf failed, using fallback'); } finally { await fs.rm(p, { force: true }); }
  }
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const parts = wb.SheetNames.map((name) => `<h2>${escapeHtml(name)}</h2>${XLSX.utils.sheet_to_html(wb.Sheets[name])}`);
  return htmlToPdf(parts.join('<div style="page-break-after:always"></div>'), { width: 842, height: 595 });
}

export async function pptxToPdf(buffer: Buffer): Promise<Buffer> {
  if (sofficePath()) {
    const p = tmpPath('.pptx');
    await fs.writeFile(p, buffer);
    try { return await sofficeConvert(p, 'pdf'); } catch (e) { logger.warn({ e }, 'soffice pptx->pdf failed, using fallback'); } finally { await fs.rm(p, { force: true }); }
  }
  const slides = extractPptxText(buffer);
  if (!slides.length) throw new AppError('We could not read this presentation.', 422, 'UNREADABLE');
  const html = slides
    .map((s, i) => `<section><h2>Slide ${i + 1}</h2>${s.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}</section>`)
    .join('<div style="page-break-after:always"></div>');
  return htmlToPdf(html, { width: 842, height: 595, fontSize: 14 });
}

export function extractPptxText(buffer: Buffer): string[][] {
  const zip = new AdmZip(buffer);
  const slides = zip.getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => slideNum(a.entryName) - slideNum(b.entryName));
  return slides.map((entry) => {
    const xml = entry.getData().toString('utf8');
    const paragraphs = xml.split(/<a:p[\s>]/).slice(1);
    return paragraphs
      .map((p) => Array.from(p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((m) => decodeXml(m[1])).join(''))
      .filter((t) => t.trim());
  });
}

const slideNum = (n: string) => Number(/slide(\d+)\.xml/.exec(n)?.[1] ?? 0);
const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export async function pdfToDocx(bytes: Uint8Array, opts: { ocrText?: string } = {}): Promise<Buffer> {
  const pages = opts.ocrText ? [{ index: 0, text: opts.ocrText }] : await extractPdfText(bytes);
  const children: Paragraph[] = [];
  pages.forEach((page, i) => {
    if (i > 0) children.push(new Paragraph({ text: '', pageBreakBefore: true }));
    for (const block of page.text.split(/\n{2,}/)) {
      const lines = block.split('\n').filter((l) => l.trim());
      if (!lines.length) continue;
      const isHeading = lines.length === 1 && lines[0].length < 80 && /^[A-Z0-9]/.test(lines[0]);
      children.push(new Paragraph({
        heading: isHeading ? HeadingLevel.HEADING_2 : undefined,
        children: [new TextRun({ text: lines.join(' '), size: isHeading ? 28 : 22 })],
        spacing: { after: 160 },
      }));
    }
  });
  if (!children.length) throw new AppError('This PDF has no extractable text. Run OCR first, then convert.', 422, 'NO_TEXT');
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

export async function pdfToXlsx(bytes: Uint8Array): Promise<Buffer> {
  const pages = await extractPdfText(bytes);
  const wb = XLSX.utils.book_new();
  let any = false;
  pages.forEach((page) => {
    const rows = page.text.split('\n').filter((l) => l.trim()).map((line) => splitColumns(line));
    if (!rows.length) return;
    any = true;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `Page ${page.index + 1}`.slice(0, 31));
  });
  if (!any) throw new AppError('This PDF has no extractable text. Run OCR first, then convert.', 422, 'NO_TEXT');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Split a text line into columns on runs of 2+ spaces or tabs. */
function splitColumns(line: string): (string | number)[] {
  return line.split(/\t|\s{2,}/).map((c) => c.trim()).filter((c, i, arr) => c !== '' || i < arr.length - 1)
    .map((c) => (c !== '' && !Number.isNaN(Number(c.replace(/[,\s]/g, ''))) ? Number(c.replace(/[,\s]/g, '')) : c));
}

export async function pdfToPptx(bytes: Uint8Array, dpi = 120): Promise<Buffer> {
  const pages = await renderPages(bytes, { dpi, format: 'jpeg', quality: 82 });
  if (!pages.length) throw new AppError('This PDF has no pages.', 422, 'EMPTY');
  const pptx = new (pptxgen as any)();
  pptx.defineLayout({ name: 'RW', width: 10, height: 7.5 });
  pptx.layout = 'RW';
  for (const page of pages) {
    const slide = pptx.addSlide();
    const ratio = page.width / page.height;
    const [w, h] = ratio > 10 / 7.5 ? [10, 10 / ratio] : [7.5 * ratio, 7.5];
    slide.addImage({ data: `data:image/jpeg;base64,${page.buffer.toString('base64')}`, x: (10 - w) / 2, y: (7.5 - h) / 2, w, h });
  }
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}

export async function imageBufferConvert(buffer: Buffer, format: string, quality: number): Promise<Buffer> {
  let p = sharp(buffer, { failOn: 'none', animated: format === 'webp' || format === 'gif' });
  switch (format) {
    case 'jpeg': case 'jpg': return p.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    case 'png': return p.png({ compressionLevel: 9, palette: quality < 90 }).toBuffer();
    case 'webp': return p.webp({ quality }).toBuffer();
    case 'avif': return p.avif({ quality }).toBuffer();
    case 'tiff': return p.tiff({ quality }).toBuffer();
    case 'gif': return p.gif().toBuffer();
    default: throw new AppError(`We cannot convert to ${format}.`, 415, 'UNSUPPORTED_TYPE');
  }
}

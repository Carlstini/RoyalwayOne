/** Real OCR using Tesseract (WASM, no external service required). */
import path from 'node:path';
import fsSync from 'node:fs';
import { createRequire } from 'node:module';
import { createWorker, type Worker } from 'tesseract.js';
import { config } from '../lib/config.js';
import { PDFDocument, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { renderPages } from './pdf.js';
import { logger } from '../lib/logger.js';

let workerPromise: Promise<Worker> | null = null;
let workerLang = '';

const require_ = createRequire(import.meta.url);

/**
 * Language data directory. English is bundled with the deployment so OCR works
 * offline; other languages are fetched once and cached on disk.
 */
function langPathFor(lang: string): string | undefined {
  if (process.env.TESSERACT_LANG_PATH) return process.env.TESSERACT_LANG_PATH;
  const cacheDir = path.join(config.storageDir, 'tessdata');
  fsSync.mkdirSync(cacheDir, { recursive: true });
  if (lang === 'eng' && !fsSync.existsSync(path.join(cacheDir, 'eng.traineddata.gz'))) {
    try {
      const pkg = path.dirname(require_.resolve('@tesseract.js-data/eng/package.json'));
      const source = path.join(pkg, '4.0.0_best_int', 'eng.traineddata.gz');
      if (fsSync.existsSync(source)) fsSync.copyFileSync(source, path.join(cacheDir, 'eng.traineddata.gz'));
    } catch { /* fall back to remote language data */ }
  }
  return fsSync.existsSync(path.join(cacheDir, `${lang}.traineddata.gz`)) ? cacheDir : undefined;
}

async function getWorker(lang: string): Promise<Worker> {
  if (workerPromise && workerLang === lang) return workerPromise;
  if (workerPromise) {
    const old = await workerPromise;
    await old.terminate().catch(() => {});
  }
  workerLang = lang;
  const langPath = langPathFor(lang);
  workerPromise = createWorker(lang, 1, {
    logger: () => {},
    errorHandler: (e) => logger.warn({ e }, 'ocr'),
    cachePath: path.join(config.storageDir, 'tessdata'),
    ...(langPath ? { langPath } : {}),
  });
  return workerPromise;
}

export interface OcrWord { text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number }
export interface OcrPageResult { index: number; text: string; words: OcrWord[]; confidence: number; width: number; height: number }

export async function ocrImage(buffer: Buffer, lang = 'eng'): Promise<{ text: string; words: OcrWord[]; confidence: number }> {
  const worker = await getWorker(lang);
  const prepared = await sharp(buffer).grayscale().normalise().toBuffer();
  const { data } = await worker.recognize(prepared, {}, { text: true, blocks: true });
  const words: OcrWord[] = [];
  for (const block of (data as any).blocks ?? []) {
    for (const par of block.paragraphs ?? []) {
      for (const line of par.lines ?? []) {
        for (const w of line.words ?? []) words.push({ text: w.text, bbox: w.bbox, confidence: w.confidence });
      }
    }
  }
  return { text: data.text ?? '', words, confidence: data.confidence ?? 0 };
}

export async function ocrPdf(bytes: Uint8Array, opts: { lang?: string; dpi?: number; onPage?: (i: number, total: number) => void } = {}) {
  const dpi = opts.dpi ?? 200;
  const rendered = await renderPages(bytes, { dpi, format: 'png' });
  const pages: OcrPageResult[] = [];
  for (const page of rendered) {
    opts.onPage?.(page.index + 1, rendered.length);
    const res = await ocrImage(page.buffer, opts.lang ?? 'eng');
    pages.push({ index: page.index, ...res, width: page.width, height: page.height });
  }
  return { pages, dpi };
}

/**
 * Produce a searchable PDF: the rendered page image with an invisible text layer
 * positioned from the OCR word boxes, so text can be selected and searched.
 */
export async function makeSearchablePdf(bytes: Uint8Array, opts: { lang?: string; dpi?: number } = {}): Promise<{ pdf: Uint8Array; text: string }> {
  const dpi = opts.dpi ?? 200;
  const rendered = await renderPages(bytes, { dpi, format: 'jpeg', quality: 82 });
  const doc = await PDFDocument.create();
  const font = await doc.embedFont('Helvetica');
  const allText: string[] = [];
  for (const page of rendered) {
    const ocr = await ocrImage(page.buffer, opts.lang ?? 'eng');
    allText.push(ocr.text);
    const scale = 72 / dpi;
    const pw = page.width * scale;
    const ph = page.height * scale;
    const img = await doc.embedJpg(page.buffer);
    const pdfPage = doc.addPage([pw, ph]);
    pdfPage.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    for (const w of ocr.words) {
      const text = w.text?.trim();
      if (!text || w.confidence < 40) continue;
      const h = (w.bbox.y1 - w.bbox.y0) * scale;
      const boxWidth = (w.bbox.x1 - w.bbox.x0) * scale;
      const size = Math.max(1, h * 0.85);
      const natural = font.widthOfTextAtSize(text, size) || boxWidth;
      pdfPage.drawText(text, {
        x: w.bbox.x0 * scale,
        y: ph - w.bbox.y1 * scale + h * 0.15,
        size,
        font,
        color: rgb(0, 0, 0),
        opacity: 0,
        // squeeze glyphs to match the detected box
        ...(natural > 0 ? { horizontalScale: undefined } : {}),
      } as any);
    }
  }
  return { pdf: await doc.save({ useObjectStreams: true }), text: allText.join('\n\n') };
}

export async function shutdownOcr() {
  if (workerPromise) {
    const w = await workerPromise.catch(() => null);
    await w?.terminate().catch(() => {});
    workerPromise = null;
  }
}

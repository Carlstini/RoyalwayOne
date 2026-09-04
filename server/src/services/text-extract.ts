/** Extract readable text from any supported document, for AI features. */
import fs from 'node:fs/promises';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { AppError } from '../lib/errors.js';
import { extractPdfText } from './pdf.js';
import { extractPptxText } from './convert.js';
import { ocrImage } from './ocr.js';
import type { StoredFile } from '../lib/storage.js';

export interface ExtractedDocument {
  pages: { label: string; text: string }[];
  text: string;
  method: 'pdf-text' | 'pdf-ocr' | 'docx' | 'xlsx' | 'pptx' | 'plain' | 'image-ocr' | 'transcript';
  characters: number;
}

const TEXTUAL_MIME = /^(text\/|application\/(json|xml|x-yaml|javascript|sql|rtf))/;

export async function extractDocument(file: StoredFile, opts: { allowOcr?: boolean } = {}): Promise<ExtractedDocument> {
  const buf = await fs.readFile(file.path);
  const name = file.name.toLowerCase();

  if (file.mime === 'application/pdf' || name.endsWith('.pdf')) {
    const pages = await extractPdfText(new Uint8Array(buf));
    const total = pages.reduce((a, p) => a + p.text.length, 0);
    if (total > 120 || opts.allowOcr === false) {
      return finish(pages.map((p) => ({ label: `Page ${p.index + 1}`, text: p.text })), 'pdf-text');
    }
    const { ocrPdf } = await import('./ocr.js');
    const ocr = await ocrPdf(new Uint8Array(buf));
    return finish(ocr.pages.map((p) => ({ label: `Page ${p.index + 1}`, text: p.text })), 'pdf-ocr');
  }

  if (name.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return finish([{ label: 'Document', text: value }], 'docx');
  }

  if (/\.(xlsx|xls|csv|ods)$/.test(name)) {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const pages = wb.SheetNames.map((n) => ({ label: n, text: XLSX.utils.sheet_to_csv(wb.Sheets[n]) }));
    return finish(pages, 'xlsx');
  }

  if (name.endsWith('.pptx')) {
    const slides = extractPptxText(buf);
    return finish(slides.map((s, i) => ({ label: `Slide ${i + 1}`, text: s.join('\n') })), 'pptx');
  }

  if (TEXTUAL_MIME.test(file.mime) || /\.(txt|md|csv|json|log|srt|vtt|html?)$/.test(name)) {
    return finish([{ label: 'Document', text: buf.toString('utf8') }], 'plain');
  }

  if (file.mime.startsWith('image/')) {
    const { text } = await ocrImage(buf);
    return finish([{ label: 'Image', text }], 'image-ocr');
  }

  throw new AppError("We cannot read text from this file type. Try a PDF, Word, Excel, PowerPoint, text or image file.", 415, 'UNSUPPORTED_TYPE');
}

function finish(pages: { label: string; text: string }[], method: ExtractedDocument['method']): ExtractedDocument {
  const cleaned = pages.map((p) => ({ ...p, text: p.text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim() })).filter((p) => p.text);
  const text = cleaned.map((p) => p.text).join('\n\n');
  if (!text.trim()) throw new AppError('We could not find any readable text in this file.', 422, 'NO_TEXT');
  return { pages: cleaned, text, method, characters: text.length };
}

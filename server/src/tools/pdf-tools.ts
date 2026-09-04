import fs from 'node:fs/promises';
import * as archiverNs from 'archiver';
const archiver = (archiverNs as any).default ?? archiverNs;
import { createWriteStream } from 'node:fs';
import * as pdf from '../services/pdf.js';
import * as convert from '../services/convert.js';
import { makeSearchablePdf } from '../services/ocr.js';
import { tmpPath } from '../lib/storage.js';
import { AppError } from '../lib/errors.js';
import type { ToolDefinition, ToolRunContext } from './types.js';

const PDF_ACCEPT = ['application/pdf', '.pdf'];

const bytesOf = async (ctx: ToolRunContext, i = 0) => new Uint8Array(await fs.readFile(ctx.files[i].path));
const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

async function zipOutputs(ctx: ToolRunContext, files: { name: string; bytes: Uint8Array }[], zipName: string) {
  const dest = tmpPath('.zip');
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(dest);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    for (const f of files) archive.append(Buffer.from(f.bytes), { name: f.name });
    void archive.finalize();
  });
  const out = await ctx.emit({ name: zipName, mime: 'application/zip', path: dest });
  await fs.rm(dest, { force: true });
  return out;
}

export const pdfTools: ToolDefinition[] = [
  {
    id: 'pdf-compress',
    name: 'Compress PDF',
    category: 'pdf',
    description: 'Reduce PDF file size while keeping text sharp and selectable.',
    icon: 'compress',
    route: '/pdf/compress',
    keywords: ['compress pdf', 'reduce pdf size', 'shrink pdf', 'smaller pdf', 'optimise pdf'],
    accept: PDF_ACCEPT,
    minFiles: 1,
    maxFiles: 20,
    heavy: true,
    outputKind: 'files',
    fields: [
      {
        key: 'preset', label: 'Compression level', type: 'select', default: 'recommended',
        options: [
          { value: 'extreme', label: 'Extreme — smallest file' },
          { value: 'recommended', label: 'Recommended — balanced' },
          { value: 'high-quality', label: 'High quality — best looking' },
          { value: 'custom', label: 'Custom — advanced controls' },
        ],
      },
      { key: 'dpi', label: 'Image resolution (DPI)', type: 'range', min: 36, max: 400, step: 2, default: 150, showIf: { key: 'preset', equals: 'custom' } },
      { key: 'jpegQuality', label: 'Image quality', type: 'range', min: 20, max: 100, step: 1, default: 70, showIf: { key: 'preset', equals: 'custom' } },
      { key: 'grayscale', label: 'Convert images to greyscale', type: 'toggle', default: false },
      { key: 'stripMetadata', label: 'Remove document metadata', type: 'toggle', default: true, showIf: { key: 'preset', equals: 'custom' } },
      { key: 'downsampleImages', label: 'Downsample embedded images', type: 'toggle', default: true, showIf: { key: 'preset', equals: 'custom' } },
    ],
    async run(ctx) {
      const outputs = [];
      const perFile = [];
      for (const [i, file] of ctx.files.entries()) {
        await ctx.setStage(ctx.files.length > 1 ? `compressing ${i + 1} of ${ctx.files.length}` : 'compressing');
        const input = new Uint8Array(await fs.readFile(file.path));
        const { bytes, imagesProcessed } = await pdf.compressPdf(input, {
          preset: ctx.params.preset ?? 'recommended',
          dpi: num(ctx.params.dpi),
          jpegQuality: num(ctx.params.jpegQuality),
          grayscale: !!ctx.params.grayscale,
          stripMetadata: ctx.params.stripMetadata !== false,
          downsampleImages: ctx.params.downsampleImages !== false,
        });
        // Never hand back something larger than the original.
        const final = bytes.length < input.length ? bytes : input;
        const out = await ctx.emit({ name: `${baseName(file.name)}-compressed.pdf`, mime: 'application/pdf', buffer: Buffer.from(final) });
        outputs.push(out);
        perFile.push({
          name: file.name,
          originalSize: input.length,
          compressedSize: final.length,
          reductionPercent: Math.max(0, Math.round((1 - final.length / input.length) * 1000) / 10),
          imagesProcessed,
          alreadyOptimised: final === input,
        });
      }
      const originalTotal = perFile.reduce((a, f) => a + f.originalSize, 0);
      const newTotal = perFile.reduce((a, f) => a + f.compressedSize, 0);
      return {
        outputs,
        stats: {
          originalSize: originalTotal,
          outputSize: newTotal,
          reductionPercent: Math.max(0, Math.round((1 - newTotal / originalTotal) * 1000) / 10),
          files: perFile,
        },
      };
    },
  },
  {
    id: 'pdf-merge',
    name: 'Merge PDF',
    category: 'pdf',
    description: 'Combine several PDFs into a single document, in your chosen order.',
    icon: 'merge',
    route: '/pdf/merge',
    keywords: ['merge pdf', 'combine pdf', 'join pdf'],
    accept: PDF_ACCEPT,
    minFiles: 2,
    maxFiles: 30,
    outputKind: 'file',
    async run(ctx) {
      await ctx.setStage('merging');
      const all = await Promise.all(ctx.files.map(async (f) => new Uint8Array(await fs.readFile(f.path))));
      const bytes = await pdf.mergePdfs(all);
      const out = await ctx.emit({ name: 'merged.pdf', mime: 'application/pdf', buffer: Buffer.from(bytes) });
      return { outputs: [out], stats: { documents: all.length, outputSize: bytes.length, pages: await pdf.pdfPageCount(bytes) } };
    },
  },
  {
    id: 'pdf-split',
    name: 'Split PDF',
    category: 'pdf',
    description: 'Split a PDF into separate documents by page or by range.',
    icon: 'split',
    route: '/pdf/split',
    keywords: ['split pdf', 'separate pdf', 'divide pdf'],
    accept: PDF_ACCEPT,
    minFiles: 1,
    maxFiles: 1,
    outputKind: 'files',
    fields: [
      { key: 'mode', label: 'Split method', type: 'select', default: 'each', options: [{ value: 'each', label: 'One file per page' }, { value: 'ranges', label: 'Custom ranges' }] },
      { key: 'ranges', label: 'Ranges', type: 'text', placeholder: '1-3, 4-8, 9-', help: 'Separate each output document with a comma.', showIf: { key: 'mode', equals: 'ranges' } },
    ],
    async run(ctx) {
      await ctx.setStage('splitting');
      const bytes = await bytesOf(ctx);
      const mode = ctx.params.mode === 'ranges' ? 'ranges' : 'each';
      const ranges = String(ctx.params.ranges ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
      if (mode === 'ranges' && !ranges.length) throw new AppError('Enter at least one page range, for example 1-3.', 400, 'BAD_REQUEST');
      const parts = await pdf.splitPdf(bytes, mode, ranges);
      if (parts.length > 40) {
        const zip = await zipOutputs(ctx, parts, `${baseName(ctx.files[0].name)}-split.zip`);
        return { outputs: [zip], stats: { documents: parts.length, packaged: 'zip' } };
      }
      const outputs = [];
      for (const part of parts) {
        outputs.push(await ctx.emit({ name: `${baseName(ctx.files[0].name)}-${part.name}`, mime: 'application/pdf', buffer: Buffer.from(part.bytes) }));
      }
      return { outputs, stats: { documents: parts.length } };
    },
  },
  {
    id: 'pdf-extract-pages',
    name: 'Extract pages',
    category: 'pdf',
    description: 'Keep only the pages you need in a new PDF.',
    icon: 'pages',
    route: '/pdf/extract-pages',
    keywords: ['extract pages', 'select pages pdf', 'keep pages'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, outputKind: 'file',
    fields: [{ key: 'pages', label: 'Pages to keep', type: 'text', placeholder: '1-3, 7, 10-', default: '1' }],
    async run(ctx) {
      const bytes = await bytesOf(ctx);
      const count = await pdf.pdfPageCount(bytes);
      const indices = pdf.parseRanges(String(ctx.params.pages ?? '1'), count);
      const out = await pdf.extractPages(bytes, indices);
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}-pages.pdf`, mime: 'application/pdf', buffer: Buffer.from(out) })], stats: { pagesKept: indices.length, originalPages: count } };
    },
  },
  {
    id: 'pdf-remove-pages',
    name: 'Remove pages',
    category: 'pdf',
    description: 'Delete unwanted pages from a PDF.',
    icon: 'trash',
    route: '/pdf/remove-pages',
    keywords: ['remove pages', 'delete pages pdf'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, outputKind: 'file',
    fields: [{ key: 'pages', label: 'Pages to remove', type: 'text', placeholder: '2, 5-7', default: '' }],
    async run(ctx) {
      const bytes = await bytesOf(ctx);
      const count = await pdf.pdfPageCount(bytes);
      const indices = pdf.parseRanges(String(ctx.params.pages ?? ''), count);
      const out = await pdf.removePages(bytes, indices);
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}-edited.pdf`, mime: 'application/pdf', buffer: Buffer.from(out) })], stats: { pagesRemoved: indices.length, originalPages: count } };
    },
  },
  {
    id: 'pdf-organize',
    name: 'Organise pages',
    category: 'pdf',
    description: 'Reorder pages by dragging them into the order you want.',
    icon: 'grid',
    route: '/pdf/organize',
    keywords: ['organize pdf', 'reorder pages', 'rearrange pdf', 'sort pages'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, outputKind: 'file',
    async run(ctx) {
      const bytes = await bytesOf(ctx);
      const count = await pdf.pdfPageCount(bytes);
      const order: number[] = Array.isArray(ctx.params.order) && ctx.params.order.length
        ? ctx.params.order.map((n: any) => Number(n))
        : Array.from({ length: count }, (_, i) => i);
      if (order.some((n) => !Number.isInteger(n) || n < 0 || n >= count)) throw new AppError('The page order is not valid.', 400, 'BAD_REQUEST');
      const out = await pdf.organizePages(bytes, order);
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}-organised.pdf`, mime: 'application/pdf', buffer: Buffer.from(out) })], stats: { pages: order.length } };
    },
  },
  {
    id: 'pdf-rotate',
    name: 'Rotate PDF',
    category: 'pdf',
    description: 'Rotate every page, or just the pages you choose.',
    icon: 'rotate',
    route: '/pdf/rotate',
    keywords: ['rotate pdf', 'turn pages'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, outputKind: 'file',
    fields: [
      { key: 'angle', label: 'Rotation', type: 'select', default: '90', options: [{ value: '90', label: '90° clockwise' }, { value: '180', label: '180°' }, { value: '270', label: '90° anticlockwise' }] },
      { key: 'pages', label: 'Pages (leave blank for all)', type: 'text', placeholder: '1-3, 5' },
    ],
    async run(ctx) {
      const bytes = await bytesOf(ctx);
      const count = await pdf.pdfPageCount(bytes);
      const spec = String(ctx.params.pages ?? '').trim();
      const indices = spec ? pdf.parseRanges(spec, count) : undefined;
      const out = await pdf.rotatePdf(bytes, Number(ctx.params.angle ?? 90), indices);
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}-rotated.pdf`, mime: 'application/pdf', buffer: Buffer.from(out) })], stats: { pagesRotated: indices?.length ?? count } };
    },
  },
  {
    id: 'pdf-protect',
    name: 'Protect PDF',
    category: 'pdf',
    description: 'Add a password and AES-256 encryption to a PDF.',
    icon: 'lock',
    route: '/pdf/protect',
    keywords: ['protect pdf', 'password pdf', 'encrypt pdf'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, outputKind: 'file',
    fields: [
      { key: 'password', label: 'Password', type: 'password', placeholder: 'Choose a password' },
      { key: 'ownerPassword', label: 'Owner password (optional)', type: 'password' },
    ],
    async run(ctx) {
      const password = String(ctx.params.password ?? '');
      if (password.length < 4) throw new AppError('Choose a password of at least four characters.', 400, 'BAD_REQUEST');
      const out = await pdf.protectPdf(await bytesOf(ctx), password, ctx.params.ownerPassword ? String(ctx.params.ownerPassword) : undefined);
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}-protected.pdf`, mime: 'application/pdf', buffer: Buffer.from(out) })], stats: { encryption: 'AES-256' } };
    },
  },
  {
    id: 'pdf-unlock',
    name: 'Unlock PDF',
    category: 'pdf',
    description: 'Remove the password from a PDF you have the password for.',
    icon: 'unlock',
    route: '/pdf/unlock',
    keywords: ['unlock pdf', 'remove password pdf', 'decrypt pdf'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, outputKind: 'file',
    fields: [{ key: 'password', label: 'Current password', type: 'password', help: 'You must know the password. Royalway One does not crack protected files.' }],
    async run(ctx) {
      const out = await pdf.unlockPdf(await bytesOf(ctx), String(ctx.params.password ?? ''));
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}-unlocked.pdf`, mime: 'application/pdf', buffer: Buffer.from(out) })] };
    },
  },
  {
    id: 'pdf-page-numbers',
    name: 'Add page numbers',
    category: 'pdf',
    description: 'Stamp page numbers onto every page.',
    icon: 'hash',
    route: '/pdf/page-numbers',
    keywords: ['page numbers', 'number pages pdf'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, outputKind: 'file',
    fields: [
      { key: 'position', label: 'Position', type: 'select', default: 'bottom-center', options: [{ value: 'bottom-center', label: 'Bottom centre' }, { value: 'bottom-right', label: 'Bottom right' }, { value: 'top-right', label: 'Top right' }] },
      { key: 'startAt', label: 'Start at', type: 'number', default: 1, min: 1, max: 9999 },
      { key: 'fontSize', label: 'Size', type: 'range', min: 7, max: 24, step: 1, default: 11 },
    ],
    async run(ctx) {
      const out = await pdf.addPageNumbers(await bytesOf(ctx), {
        position: ctx.params.position, startAt: num(ctx.params.startAt) ?? 1, fontSize: num(ctx.params.fontSize),
      });
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}-numbered.pdf`, mime: 'application/pdf', buffer: Buffer.from(out) })] };
    },
  },
  {
    id: 'pdf-watermark',
    name: 'Add watermark',
    category: 'pdf',
    description: 'Overlay text such as CONFIDENTIAL or DRAFT on every page.',
    icon: 'stamp',
    route: '/pdf/watermark',
    keywords: ['watermark pdf', 'stamp pdf', 'confidential'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, outputKind: 'file',
    fields: [
      { key: 'text', label: 'Watermark text', type: 'text', default: 'CONFIDENTIAL' },
      { key: 'opacity', label: 'Opacity', type: 'range', min: 5, max: 80, step: 5, default: 22 },
      { key: 'fontSize', label: 'Size', type: 'range', min: 16, max: 120, step: 2, default: 48 },
      { key: 'rotation', label: 'Angle', type: 'range', min: 0, max: 90, step: 5, default: 45 },
    ],
    async run(ctx) {
      const text = String(ctx.params.text ?? '').trim();
      if (!text) throw new AppError('Enter the watermark text.', 400, 'BAD_REQUEST');
      const out = await pdf.watermarkPdf(await bytesOf(ctx), text, {
        opacity: (num(ctx.params.opacity) ?? 22) / 100, fontSize: num(ctx.params.fontSize), rotation: num(ctx.params.rotation),
      });
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}-watermarked.pdf`, mime: 'application/pdf', buffer: Buffer.from(out) })] };
    },
  },
  {
    id: 'pdf-crop',
    name: 'Crop PDF',
    category: 'pdf',
    description: 'Trim margins from every page.',
    icon: 'crop',
    route: '/pdf/crop',
    keywords: ['crop pdf', 'trim margins pdf'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, outputKind: 'file',
    fields: [
      { key: 'top', label: 'Top margin (pt)', type: 'number', default: 20, min: 0, max: 400 },
      { key: 'right', label: 'Right margin (pt)', type: 'number', default: 20, min: 0, max: 400 },
      { key: 'bottom', label: 'Bottom margin (pt)', type: 'number', default: 20, min: 0, max: 400 },
      { key: 'left', label: 'Left margin (pt)', type: 'number', default: 20, min: 0, max: 400 },
    ],
    async run(ctx) {
      const out = await pdf.cropPdf(await bytesOf(ctx), {
        top: num(ctx.params.top) ?? 0, right: num(ctx.params.right) ?? 0,
        bottom: num(ctx.params.bottom) ?? 0, left: num(ctx.params.left) ?? 0,
      });
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}-cropped.pdf`, mime: 'application/pdf', buffer: Buffer.from(out) })] };
    },
  },
  {
    id: 'pdf-repair',
    name: 'Repair PDF',
    category: 'pdf',
    description: 'Rebuild a damaged PDF structure and recover what can be read.',
    icon: 'wrench',
    route: '/pdf/repair',
    keywords: ['repair pdf', 'fix pdf', 'corrupt pdf'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, outputKind: 'file',
    async run(ctx) {
      const input = await bytesOf(ctx);
      const out = await pdf.repairPdf(input);
      const pages = await pdf.pdfPageCount(out);
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}-repaired.pdf`, mime: 'application/pdf', buffer: Buffer.from(out) })], stats: { pagesRecovered: pages, originalSize: input.length, outputSize: out.length } };
    },
  },
  {
    id: 'pdf-ocr',
    name: 'OCR PDF',
    category: 'pdf',
    description: 'Make a scanned PDF searchable by recognising the text on every page.',
    icon: 'scan',
    route: '/pdf/ocr',
    keywords: ['ocr pdf', 'searchable pdf', 'scanned pdf', 'recognise text'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [
      { key: 'lang', label: 'Language', type: 'select', default: 'eng', options: [
        { value: 'eng', label: 'English' }, { value: 'fra', label: 'French' }, { value: 'deu', label: 'German' },
        { value: 'spa', label: 'Spanish' }, { value: 'ita', label: 'Italian' }, { value: 'por', label: 'Portuguese' }, { value: 'nld', label: 'Dutch' },
      ] },
      { key: 'dpi', label: 'Scan resolution', type: 'select', default: '200', options: [{ value: '150', label: 'Fast (150 DPI)' }, { value: '200', label: 'Balanced (200 DPI)' }, { value: '300', label: 'Accurate (300 DPI)' }] },
    ],
    async run(ctx) {
      await ctx.setStage('recognising text');
      const bytes = await bytesOf(ctx);
      const { pdf: output, text } = await makeSearchablePdf(bytes, { lang: ctx.params.lang ?? 'eng', dpi: num(ctx.params.dpi) ?? 200 });
      const out = await ctx.emit({ name: `${baseName(ctx.files[0].name)}-searchable.pdf`, mime: 'application/pdf', buffer: Buffer.from(output) });
      return { outputs: [out], text, stats: { characters: text.length, words: text.split(/\s+/).filter(Boolean).length } };
    },
  },
  {
    id: 'pdf-sign',
    name: 'Sign PDF',
    category: 'pdf',
    description: 'Draw or type a signature and place it on the page.',
    icon: 'pen',
    route: '/pdf/sign',
    keywords: ['sign pdf', 'signature', 'e-sign'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, outputKind: 'file',
    async run(ctx) {
      const sig = ctx.params.signature;
      if (!sig) throw new AppError('Draw or type a signature, then place it on the page.', 400, 'BAD_REQUEST');
      const out = await pdf.signPdf(await bytesOf(ctx), {
        page: Number(sig.page ?? 0), x: Number(sig.x ?? 0), y: Number(sig.y ?? 0),
        width: Number(sig.width ?? 160), height: Number(sig.height ?? 60),
        imageBase64: sig.imageBase64, text: sig.text,
      });
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}-signed.pdf`, mime: 'application/pdf', buffer: Buffer.from(out) })] };
    },
  },
  {
    id: 'pdf-redact',
    name: 'Redact PDF',
    category: 'pdf',
    description: 'Permanently remove sensitive content — the text underneath is destroyed, not hidden.',
    icon: 'shield',
    route: '/pdf/redact',
    keywords: ['redact pdf', 'black out', 'remove sensitive'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    async run(ctx) {
      const areas = ctx.params.areas;
      if (!Array.isArray(areas) || !areas.length) throw new AppError('Drag over the content you want to redact first.', 400, 'BAD_REQUEST');
      await ctx.setStage('redacting');
      const out = await pdf.redactPdf(await bytesOf(ctx), areas.map((a: any) => ({
        page: Number(a.page), x: Number(a.x), y: Number(a.y), width: Number(a.width), height: Number(a.height),
      })));
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}-redacted.pdf`, mime: 'application/pdf', buffer: Buffer.from(out) })], stats: { areasRedacted: areas.length } };
    },
  },
  // ---- Conversions from PDF ----
  {
    id: 'pdf-to-word',
    name: 'PDF to Word',
    category: 'pdf',
    description: 'Convert a PDF into an editable Word document.',
    icon: 'word',
    route: '/pdf/to-word',
    keywords: ['pdf to word', 'pdf to docx', 'convert pdf word'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    async run(ctx) {
      await ctx.setStage('converting');
      const buf = await convert.pdfToDocx(await bytesOf(ctx));
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: buf })] };
    },
  },
  {
    id: 'pdf-to-excel',
    name: 'PDF to Excel',
    category: 'pdf',
    description: 'Pull tabular content out of a PDF into a spreadsheet.',
    icon: 'excel',
    route: '/pdf/to-excel',
    keywords: ['pdf to excel', 'pdf to xlsx', 'pdf table'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    async run(ctx) {
      await ctx.setStage('converting');
      const buf = await convert.pdfToXlsx(await bytesOf(ctx));
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf })] };
    },
  },
  {
    id: 'pdf-to-powerpoint',
    name: 'PDF to PowerPoint',
    category: 'pdf',
    description: 'Turn each PDF page into a presentation slide.',
    icon: 'slides',
    route: '/pdf/to-powerpoint',
    keywords: ['pdf to powerpoint', 'pdf to pptx', 'slides'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    async run(ctx) {
      await ctx.setStage('converting');
      const buf = await convert.pdfToPptx(await bytesOf(ctx));
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}.pptx`, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: buf })] };
    },
  },
  {
    id: 'pdf-to-jpg',
    name: 'PDF to JPG',
    category: 'pdf',
    description: 'Export PDF pages as JPG images.',
    icon: 'image',
    route: '/pdf/to-jpg',
    keywords: ['pdf to jpg', 'pdf to image', 'pdf to jpeg'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'files',
    fields: [
      { key: 'dpi', label: 'Resolution', type: 'select', default: '150', options: [{ value: '96', label: 'Screen (96 DPI)' }, { value: '150', label: 'Standard (150 DPI)' }, { value: '300', label: 'Print (300 DPI)' }] },
      { key: 'quality', label: 'Image quality', type: 'range', min: 40, max: 100, step: 5, default: 88 },
    ],
    async run(ctx) { return renderToImages(ctx, 'jpeg'); },
  },
  {
    id: 'pdf-to-png',
    name: 'PDF to PNG',
    category: 'pdf',
    description: 'Export PDF pages as lossless PNG images.',
    icon: 'image',
    route: '/pdf/to-png',
    keywords: ['pdf to png', 'pdf to image'],
    accept: PDF_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'files',
    fields: [{ key: 'dpi', label: 'Resolution', type: 'select', default: '150', options: [{ value: '96', label: 'Screen (96 DPI)' }, { value: '150', label: 'Standard (150 DPI)' }, { value: '300', label: 'Print (300 DPI)' }] }],
    async run(ctx) { return renderToImages(ctx, 'png'); },
  },
  // ---- Conversions to PDF ----
  {
    id: 'word-to-pdf',
    name: 'Word to PDF',
    category: 'pdf',
    description: 'Convert a Word document into a PDF.',
    icon: 'pdf',
    route: '/pdf/from-word',
    keywords: ['word to pdf', 'docx to pdf', 'doc to pdf'],
    accept: ['.docx', '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    async run(ctx) {
      await ctx.setStage('converting');
      const buf = await convert.docxToPdf(await fs.readFile(ctx.files[0].path));
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}.pdf`, mime: 'application/pdf', buffer: buf })] };
    },
  },
  {
    id: 'excel-to-pdf',
    name: 'Excel to PDF',
    category: 'pdf',
    description: 'Convert a spreadsheet into a PDF.',
    icon: 'pdf',
    route: '/pdf/from-excel',
    keywords: ['excel to pdf', 'xlsx to pdf', 'spreadsheet pdf'],
    accept: ['.xlsx', '.xls', '.csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    async run(ctx) {
      await ctx.setStage('converting');
      const buf = await convert.xlsxToPdf(await fs.readFile(ctx.files[0].path));
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}.pdf`, mime: 'application/pdf', buffer: buf })] };
    },
  },
  {
    id: 'powerpoint-to-pdf',
    name: 'PowerPoint to PDF',
    category: 'pdf',
    description: 'Convert a presentation into a PDF.',
    icon: 'pdf',
    route: '/pdf/from-powerpoint',
    keywords: ['powerpoint to pdf', 'pptx to pdf', 'slides to pdf'],
    accept: ['.pptx', '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    async run(ctx) {
      await ctx.setStage('converting');
      const buf = await convert.pptxToPdf(await fs.readFile(ctx.files[0].path));
      return { outputs: [await ctx.emit({ name: `${baseName(ctx.files[0].name)}.pdf`, mime: 'application/pdf', buffer: buf })] };
    },
  },
  {
    id: 'images-to-pdf',
    name: 'Images to PDF',
    category: 'pdf',
    description: 'Combine JPG or PNG images into a single PDF.',
    icon: 'pdf',
    route: '/pdf/from-images',
    keywords: ['jpg to pdf', 'png to pdf', 'image to pdf', 'photos to pdf'],
    accept: ['image/jpeg', 'image/png', 'image/webp', '.jpg', '.jpeg', '.png', '.webp'],
    minFiles: 1, maxFiles: 100, outputKind: 'file',
    fields: [
      { key: 'pageSize', label: 'Page size', type: 'select', default: 'fit', options: [{ value: 'fit', label: 'Fit page to image' }, { value: 'a4', label: 'A4 pages' }] },
      { key: 'margin', label: 'Margin (pt)', type: 'number', default: 24, min: 0, max: 120, showIf: { key: 'pageSize', equals: 'a4' } },
    ],
    async run(ctx) {
      await ctx.setStage('building pdf');
      const images = await Promise.all(ctx.files.map(async (f) => ({ buffer: await fs.readFile(f.path), mime: f.mime })));
      const bytes = await pdf.imagesToPdf(images, { pageSize: ctx.params.pageSize ?? 'fit', margin: num(ctx.params.margin) ?? 24 });
      return { outputs: [await ctx.emit({ name: 'images.pdf', mime: 'application/pdf', buffer: Buffer.from(bytes) })], stats: { pages: images.length } };
    },
  },
  {
    id: 'html-to-pdf',
    name: 'HTML to PDF',
    category: 'pdf',
    description: 'Turn HTML or a web page you paste in into a clean PDF.',
    icon: 'code',
    route: '/pdf/from-html',
    keywords: ['html to pdf', 'web page to pdf', 'url to pdf'],
    accept: ['.html', '.htm', 'text/html'], minFiles: 0, maxFiles: 1, outputKind: 'file',
    fields: [
      { key: 'html', label: 'HTML', type: 'textarea', placeholder: '<h1>Hello</h1>', help: 'Paste HTML, or upload an .html file.' },
      { key: 'url', label: 'Or a public page URL', type: 'text', placeholder: 'https://example.com' },
    ],
    async run(ctx) {
      let html = String(ctx.params.html ?? '').trim();
      if (!html && ctx.files[0]) html = (await fs.readFile(ctx.files[0].path)).toString('utf8');
      if (!html && ctx.params.url) {
        const url = String(ctx.params.url);
        if (!/^https?:\/\//i.test(url)) throw new AppError('Enter a valid http or https address.', 400, 'BAD_REQUEST');
        await ctx.setStage('fetching page');
        const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) }).catch(() => null);
        if (!res?.ok) throw new AppError('We could not load that page.', 422, 'URL_UNREACHABLE');
        html = await res.text();
      }
      if (!html) throw new AppError('Paste some HTML, upload a file, or enter a page address.', 400, 'BAD_REQUEST');
      await ctx.setStage('rendering');
      const buf = convert.htmlToPdf(html);
      return { outputs: [await ctx.emit({ name: 'document.pdf', mime: 'application/pdf', buffer: buf })] };
    },
  },
];

async function renderToImages(ctx: ToolRunContext, format: 'jpeg' | 'png') {
  await ctx.setStage('rendering pages');
  const bytes = new Uint8Array(await fs.readFile(ctx.files[0].path));
  const pages = await pdf.renderPages(bytes, { dpi: num(ctx.params.dpi) ?? 150, format, quality: num(ctx.params.quality) ?? 88 });
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const base = baseName(ctx.files[0].name);
  if (pages.length > 25) {
    const zip = await zipOutputs(ctx, pages.map((p) => ({ name: `${base}-${String(p.index + 1).padStart(3, '0')}.${ext}`, bytes: p.buffer })), `${base}-${ext}.zip`);
    return { outputs: [zip], stats: { pages: pages.length, packaged: 'zip' } };
  }
  const outputs = [];
  for (const page of pages) {
    outputs.push(await ctx.emit({ name: `${base}-${String(page.index + 1).padStart(3, '0')}.${ext}`, mime: `image/${format}`, buffer: page.buffer }));
  }
  return { outputs, stats: { pages: pages.length } };
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

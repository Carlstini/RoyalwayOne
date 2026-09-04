import fs from 'node:fs/promises';
import sharp from 'sharp';
import { AppError } from '../lib/errors.js';
import type { ToolDefinition, ToolOutput, ToolRunContext } from './types.js';

const IMAGE_ACCEPT = ['image/*', '.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff', '.gif', '.bmp'];
const baseName = (n: string) => n.replace(/\.[^.]+$/, '');
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

const FORMAT_OPTIONS = [
  { value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' }, { value: 'tiff', label: 'TIFF' },
];

async function encode(buffer: Buffer, format: string, quality: number, effort?: number) {
  let p = sharp(buffer, { failOn: 'none' }).rotate(); // honour EXIF orientation, then drop metadata
  switch (format) {
    case 'jpeg': return p.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    case 'png': return p.png({ compressionLevel: 9, effort: effort ?? 7, palette: quality < 90 }).toBuffer();
    case 'webp': return p.webp({ quality, effort: effort ?? 5 }).toBuffer();
    case 'avif': return p.avif({ quality, effort: effort ?? 4 }).toBuffer();
    case 'tiff': return p.tiff({ quality }).toBuffer();
    default: throw new AppError(`We cannot write ${format} images.`, 415, 'UNSUPPORTED_TYPE');
  }
}

const extFor = (f: string) => (f === 'jpeg' ? 'jpg' : f);

async function eachImage(
  ctx: ToolRunContext,
  transform: (buf: Buffer, file: { name: string; size: number }) => Promise<{ buffer: Buffer; name: string; mime: string; extra?: Record<string, unknown> }>,
  stage = 'processing',
) {
  const outputs: ToolOutput[] = [];
  const details: Record<string, unknown>[] = [];
  for (const [i, file] of ctx.files.entries()) {
    await ctx.setStage(ctx.files.length > 1 ? `${stage} ${i + 1} of ${ctx.files.length}` : stage);
    const input = await fs.readFile(file.path);
    const res = await transform(input, file);
    const out = await ctx.emit({ name: res.name, mime: res.mime, buffer: res.buffer });
    outputs.push(out);
    details.push({ name: file.name, originalSize: input.length, outputSize: res.buffer.length, reductionPercent: Math.round((1 - res.buffer.length / input.length) * 1000) / 10, ...res.extra });
  }
  const originalTotal = details.reduce((a, d: any) => a + d.originalSize, 0);
  const outputTotal = details.reduce((a, d: any) => a + d.outputSize, 0);
  return {
    outputs,
    stats: {
      originalSize: originalTotal,
      outputSize: outputTotal,
      reductionPercent: Math.round((1 - outputTotal / originalTotal) * 1000) / 10,
      files: details,
    },
  };
}

export const imageTools: ToolDefinition[] = [
  {
    id: 'image-compress',
    name: 'Compress image',
    category: 'image',
    description: 'Make images much smaller with visually comparable quality.',
    icon: 'compress',
    route: '/image/compress',
    keywords: ['compress image', 'reduce image size', 'compress photo', 'optimise image', 'batch compress'],
    accept: IMAGE_ACCEPT, minFiles: 1, maxFiles: 40, outputKind: 'files',
    fields: [
      { key: 'level', label: 'Compression level', type: 'select', default: 'recommended', options: [
        { value: 'extreme', label: 'Extreme — smallest' }, { value: 'recommended', label: 'Recommended' }, { value: 'high-quality', label: 'High quality' }, { value: 'custom', label: 'Custom' },
      ] },
      { key: 'quality', label: 'Quality', type: 'range', min: 20, max: 100, step: 1, default: 75, showIf: { key: 'level', equals: 'custom' } },
      { key: 'format', label: 'Output format', type: 'select', default: 'auto', options: [{ value: 'auto', label: 'Keep original format' }, ...FORMAT_OPTIONS] },
      { key: 'maxWidth', label: 'Limit width (px, optional)', type: 'number', min: 100, max: 12000 },
    ],
    async run(ctx) {
      const levels: Record<string, number> = { extreme: 45, recommended: 75, 'high-quality': 90, custom: num(ctx.params.quality) ?? 75 };
      const quality = levels[ctx.params.level ?? 'recommended'] ?? 75;
      const maxWidth = num(ctx.params.maxWidth);
      return eachImage(ctx, async (buf, file) => {
        const meta = await sharp(buf).metadata();
        let working = buf;
        if (maxWidth && meta.width && meta.width > maxWidth) {
          working = await sharp(buf).rotate().resize({ width: maxWidth, withoutEnlargement: true }).toBuffer();
        }
        const target = ctx.params.format && ctx.params.format !== 'auto' ? ctx.params.format : (meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : meta.format === 'avif' ? 'avif' : 'jpeg');
        const encoded = await encode(working, target, quality);
        const final = encoded.length < buf.length ? encoded : (ctx.params.format && ctx.params.format !== 'auto' ? encoded : buf);
        return { buffer: final, name: `${baseName(file.name)}-compressed.${extFor(target)}`, mime: `image/${target}`, extra: { width: meta.width, height: meta.height } };
      }, 'compressing');
    },
  },
  {
    id: 'image-convert',
    name: 'Convert image',
    category: 'image',
    description: 'Convert between JPG, PNG, WebP, AVIF and TIFF.',
    icon: 'swap',
    route: '/image/convert',
    keywords: ['convert image', 'jpg to png', 'png to jpg', 'webp', 'avif', 'heic', 'batch convert'],
    accept: IMAGE_ACCEPT, minFiles: 1, maxFiles: 40, outputKind: 'files',
    fields: [
      { key: 'format', label: 'Convert to', type: 'select', default: 'webp', options: FORMAT_OPTIONS },
      { key: 'quality', label: 'Quality', type: 'range', min: 30, max: 100, step: 1, default: 85 },
    ],
    async run(ctx) {
      const format = String(ctx.params.format ?? 'webp');
      const quality = num(ctx.params.quality) ?? 85;
      return eachImage(ctx, async (buf, file) => ({
        buffer: await encode(buf, format, quality),
        name: `${baseName(file.name)}.${extFor(format)}`,
        mime: `image/${format}`,
      }), 'converting');
    },
  },
  {
    id: 'image-resize',
    name: 'Resize image',
    category: 'image',
    description: 'Resize by pixels or percentage, with or without keeping the aspect ratio.',
    icon: 'resize',
    route: '/image/resize',
    keywords: ['resize image', 'scale image', 'image dimensions'],
    accept: IMAGE_ACCEPT, minFiles: 1, maxFiles: 40, outputKind: 'files',
    fields: [
      { key: 'mode', label: 'Resize by', type: 'select', default: 'pixels', options: [{ value: 'pixels', label: 'Pixels' }, { value: 'percent', label: 'Percentage' }] },
      { key: 'width', label: 'Width (px)', type: 'number', min: 1, max: 20000, showIf: { key: 'mode', equals: 'pixels' } },
      { key: 'height', label: 'Height (px)', type: 'number', min: 1, max: 20000, showIf: { key: 'mode', equals: 'pixels' } },
      { key: 'percent', label: 'Percentage', type: 'range', min: 5, max: 400, step: 5, default: 50, showIf: { key: 'mode', equals: 'percent' } },
      { key: 'fit', label: 'Fit', type: 'select', default: 'inside', options: [{ value: 'inside', label: 'Keep aspect ratio' }, { value: 'cover', label: 'Cover and crop' }, { value: 'fill', label: 'Stretch to fit' }] },
    ],
    async run(ctx) {
      return eachImage(ctx, async (buf, file) => {
        const meta = await sharp(buf).metadata();
        let width = num(ctx.params.width);
        let height = num(ctx.params.height);
        if (ctx.params.mode === 'percent') {
          const p = (num(ctx.params.percent) ?? 50) / 100;
          width = Math.max(1, Math.round((meta.width ?? 100) * p));
          height = Math.max(1, Math.round((meta.height ?? 100) * p));
        }
        if (!width && !height) throw new AppError('Enter a width or a height.', 400, 'BAD_REQUEST');
        const resized = await sharp(buf).rotate().resize({ width, height, fit: ctx.params.fit ?? 'inside', withoutEnlargement: false }).toBuffer();
        const outMeta = await sharp(resized).metadata();
        return { buffer: resized, name: `${baseName(file.name)}-${outMeta.width}x${outMeta.height}.${extFor(meta.format ?? 'jpeg')}`, mime: `image/${meta.format ?? 'jpeg'}`, extra: { width: outMeta.width, height: outMeta.height } };
      }, 'resizing');
    },
  },
  {
    id: 'image-crop',
    name: 'Crop image',
    category: 'image',
    description: 'Crop to an exact area or a standard aspect ratio.',
    icon: 'crop',
    route: '/image/crop',
    keywords: ['crop image', 'cut image', 'trim photo'],
    accept: IMAGE_ACCEPT, minFiles: 1, maxFiles: 1, outputKind: 'file',
    async run(ctx) {
      const c = ctx.params.crop;
      if (!c) throw new AppError('Select the area you want to keep.', 400, 'BAD_REQUEST');
      return eachImage(ctx, async (buf, file) => {
        const meta = await sharp(buf).rotate().metadata();
        const left = Math.max(0, Math.round(Number(c.x)));
        const top = Math.max(0, Math.round(Number(c.y)));
        const width = Math.min(Math.round(Number(c.width)), (meta.width ?? 0) - left);
        const height = Math.min(Math.round(Number(c.height)), (meta.height ?? 0) - top);
        if (width < 1 || height < 1) throw new AppError('That crop area is outside the image.', 400, 'BAD_REQUEST');
        const out = await sharp(buf).rotate().extract({ left, top, width, height }).toBuffer();
        return { buffer: out, name: `${baseName(file.name)}-cropped.${extFor(meta.format ?? 'jpeg')}`, mime: `image/${meta.format ?? 'jpeg'}`, extra: { width, height } };
      }, 'cropping');
    },
  },
  {
    id: 'image-rotate',
    name: 'Rotate & flip image',
    category: 'image',
    description: 'Rotate by any angle and mirror horizontally or vertically.',
    icon: 'rotate',
    route: '/image/rotate',
    keywords: ['rotate image', 'flip image', 'mirror image', 'turn photo'],
    accept: IMAGE_ACCEPT, minFiles: 1, maxFiles: 40, outputKind: 'files',
    fields: [
      { key: 'angle', label: 'Rotation', type: 'select', default: '90', options: [{ value: '0', label: 'None' }, { value: '90', label: '90° clockwise' }, { value: '180', label: '180°' }, { value: '270', label: '90° anticlockwise' }] },
      { key: 'flipH', label: 'Mirror horizontally', type: 'toggle', default: false },
      { key: 'flipV', label: 'Mirror vertically', type: 'toggle', default: false },
    ],
    async run(ctx) {
      return eachImage(ctx, async (buf, file) => {
        const meta = await sharp(buf).metadata();
        let p = sharp(buf).rotate();
        const angle = num(ctx.params.angle) ?? 0;
        if (angle) p = p.rotate(angle, { background: '#ffffff' });
        if (ctx.params.flipH) p = p.flop();
        if (ctx.params.flipV) p = p.flip();
        return { buffer: await p.toBuffer(), name: `${baseName(file.name)}-rotated.${extFor(meta.format ?? 'jpeg')}`, mime: `image/${meta.format ?? 'jpeg'}` };
      }, 'rotating');
    },
  },
  {
    id: 'image-metadata',
    name: 'Remove image metadata',
    category: 'image',
    description: 'Strip EXIF, GPS and camera data from photos before sharing them.',
    icon: 'shield',
    route: '/image/metadata',
    keywords: ['remove exif', 'strip metadata', 'remove gps from photo', 'privacy image'],
    accept: IMAGE_ACCEPT, minFiles: 1, maxFiles: 40, outputKind: 'files',
    async run(ctx) {
      return eachImage(ctx, async (buf, file) => {
        const meta = await sharp(buf).metadata();
        const hadExif = !!(meta.exif || meta.icc || (meta as any).iptc || (meta as any).xmp);
        const format = meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpeg';
        // Re-encoding without .withMetadata() drops all metadata chunks.
        const out = await encode(buf, format, 92);
        return { buffer: out, name: `${baseName(file.name)}-clean.${extFor(format)}`, mime: `image/${format}`, extra: { metadataRemoved: hadExif } };
      }, 'cleaning');
    },
  },
];

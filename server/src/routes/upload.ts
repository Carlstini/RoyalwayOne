import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../lib/config.js';
import { moveIntoStorage, signDownload, getFile, verifyDownload, fileStream, sanitizeName } from '../lib/storage.js';
import { AppError, notFound, tooLarge } from '../lib/errors.js';
import { suggestForFiles } from '../tools/registry.js';
import { recordEvent } from '../lib/jobs.js';
import { uploadLimiter } from '../lib/rate-limit.js';

const BLOCKED_EXTENSIONS = /\.(exe|dll|so|dylib|bat|cmd|com|scr|msi|apk|jar|sh|ps1|vbs|php|py|rb|pl)$/i;

const upload = multer({
  dest: path.join(config.storageDir, 'tmp'),
  limits: { fileSize: config.maxUploadBytes, files: 40 },
  fileFilter: (_req, file, cb) => {
    if (BLOCKED_EXTENSIONS.test(file.originalname)) return cb(new AppError("This file type isn't supported.", 415, 'UNSUPPORTED_TYPE'));
    cb(null, true);
  },
});

export const uploadRouter = Router();

uploadRouter.post('/upload', uploadLimiter, upload.array('files', 40), async (req, res, next) => {
  try {
    const incoming = (req.files as Express.Multer.File[]) ?? [];
    if (!incoming.length) throw new AppError('Choose at least one file to upload.', 400, 'BAD_REQUEST');
    const stored = [];
    for (const f of incoming) {
      if (f.size === 0) { await fs.rm(f.path, { force: true }); throw new AppError(`"${sanitizeName(f.originalname)}" is empty.`, 400, 'EMPTY_FILE'); }
      const detected = await detectMime(f.path, f.mimetype, f.originalname);
      const file = await moveIntoStorage({ sessionId: req.sessionId, name: f.originalname, mime: detected, sourcePath: f.path });
      stored.push({ id: file.id, name: file.name, mime: file.mime, size: file.size, url: signDownload(file.id) });
    }
    void recordEvent('files_uploaded', { count: stored.length, bytes: stored.reduce((a, f) => a + f.size, 0) });
    res.json({ ok: true, files: stored, suggestions: suggestForFiles(stored) });
  } catch (err) {
    for (const f of (req.files as Express.Multer.File[]) ?? []) await fs.rm(f.path, { force: true }).catch(() => {});
    next(err);
  }
});

/** Signed, expiring download. Files are never served from a guessable URL. */
uploadRouter.get('/files/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { exp, sig, download } = req.query as Record<string, string>;
    const file = await getFile(id);
    if (!file) throw notFound('That file is no longer available. Files are removed automatically after a short time.');
    const ownsFile = file.sessionId === req.sessionId;
    if (!ownsFile && !(exp && sig && verifyDownload(id, exp, sig))) {
      throw new AppError('This download link has expired. Please process the file again.', 403, 'LINK_EXPIRED');
    }
    res.setHeader('Content-Type', file.mime || 'application/octet-stream');
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `${download === '0' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.name)}"`);
    fileStream(file).pipe(res);
  } catch (err) { next(err); }
});

/** Sniff real content type from magic bytes; never trust the browser alone. */
async function detectMime(filePath: string, declared: string, name: string): Promise<string> {
  const fh = await fs.open(filePath, 'r');
  const buf = Buffer.alloc(64);
  await fh.read(buf, 0, 64, 0);
  await fh.close();
  const hex = buf.toString('hex');
  const ascii = buf.toString('latin1');
  if (ascii.startsWith('%PDF')) return 'application/pdf';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e47')) return 'image/png';
  if (ascii.slice(0, 4) === 'RIFF' && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.slice(0, 4) === 'RIFF' && ascii.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('494433') || hex.startsWith('fffb') || hex.startsWith('fff3')) return 'audio/mpeg';
  if (ascii.slice(4, 8) === 'ftyp') return ascii.slice(8, 12).startsWith('M4A') ? 'audio/mp4' : 'video/mp4';
  if (hex.startsWith('1a45dfa3')) return 'video/webm';
  if (hex.startsWith('4f676753')) return 'audio/ogg';
  if (hex.startsWith('664c6143')) return 'audio/flac';
  if (hex.startsWith('504b0304')) {
    if (/\.docx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (/\.xlsx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (/\.pptx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    return 'application/zip';
  }
  if (declared && declared !== 'application/octet-stream') return declared;
  return /\.(txt|md|csv|log)$/i.test(name) ? 'text/plain' : 'application/octet-stream';
}

export { tooLarge };

import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';

export interface StoredFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  sessionId: string;
  createdAt: number;
}

const metaDir = () => path.join(config.storageDir, 'meta');
const blobDir = () => path.join(config.storageDir, 'blobs');

export async function initStorage() {
  await fs.mkdir(metaDir(), { recursive: true });
  await fs.mkdir(blobDir(), { recursive: true });
  await fs.mkdir(path.join(config.storageDir, 'tmp'), { recursive: true });
}

export const newId = () => crypto.randomBytes(16).toString('hex');

export function tmpPath(ext = '') {
  return path.join(config.storageDir, 'tmp', `${newId()}${ext}`);
}

export async function saveFile(opts: {
  sessionId: string;
  name: string;
  mime: string;
  sourcePath?: string;
  buffer?: Buffer;
}): Promise<StoredFile> {
  const id = newId();
  const dest = path.join(blobDir(), id);
  if (opts.buffer) await fs.writeFile(dest, opts.buffer);
  else if (opts.sourcePath) await fs.copyFile(opts.sourcePath, dest);
  else throw new Error('saveFile requires buffer or sourcePath');
  const stat = await fs.stat(dest);
  const rec: StoredFile = {
    id,
    name: sanitizeName(opts.name),
    mime: opts.mime,
    size: stat.size,
    path: dest,
    sessionId: opts.sessionId,
    createdAt: Date.now(),
  };
  await fs.writeFile(path.join(metaDir(), `${id}.json`), JSON.stringify(rec));
  return rec;
}

export async function moveIntoStorage(opts: { sessionId: string; name: string; mime: string; sourcePath: string }) {
  const file = await saveFile(opts);
  await fs.rm(opts.sourcePath, { force: true });
  return file;
}

export async function getFile(id: string): Promise<StoredFile | null> {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  try {
    const raw = await fs.readFile(path.join(metaDir(), `${id}.json`), 'utf8');
    return JSON.parse(raw) as StoredFile;
  } catch {
    return null;
  }
}

export async function readFileBuffer(id: string): Promise<Buffer> {
  const f = await getFile(id);
  if (!f) throw new Error('file not found');
  return fs.readFile(f.path);
}

export function fileStream(f: StoredFile) {
  return createReadStream(f.path);
}

export function sanitizeName(name: string) {
  const base = path.basename(name).replace(/[^\w.\-() ]+/g, '_').slice(0, 180);
  return base || 'file';
}

/** Signed, expiring download token so blob URLs are never guessable or permanent. */
export function signDownload(fileId: string, ttlSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(`${fileId}.${exp}`).digest('base64url');
  return `/api/files/${fileId}?exp=${exp}&sig=${sig}`;
}

export function verifyDownload(fileId: string, exp: string, sig: string) {
  const expN = Number(exp);
  if (!expN || expN * 1000 < Date.now()) return false;
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(`${fileId}.${expN}`).digest('base64url');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

export async function cleanupExpired(): Promise<number> {
  const cutoff = Date.now() - config.retentionMinutes * 60_000;
  let removed = 0;
  for (const dir of [metaDir()]) {
    const entries = await fs.readdir(dir).catch(() => []);
    for (const entry of entries) {
      try {
        const rec = JSON.parse(await fs.readFile(path.join(dir, entry), 'utf8')) as StoredFile;
        if (rec.createdAt < cutoff) {
          await fs.rm(rec.path, { force: true });
          await fs.rm(path.join(dir, entry), { force: true });
          removed++;
        }
      } catch { /* ignore malformed entries */ }
    }
  }
  // stale temp files
  const tmp = path.join(config.storageDir, 'tmp');
  for (const entry of await fs.readdir(tmp).catch(() => [])) {
    const p = path.join(tmp, entry);
    const st = await fs.stat(p).catch(() => null);
    if (st && st.mtimeMs < Date.now() - 60 * 60_000) await fs.rm(p, { recursive: true, force: true });
  }
  if (removed) logger.info({ removed }, 'storage cleanup');
  return removed;
}

export async function storageStats() {
  const entries = await fs.readdir(blobDir()).catch(() => []);
  let bytes = 0;
  for (const e of entries) {
    const st = await fs.stat(path.join(blobDir(), e)).catch(() => null);
    if (st) bytes += st.size;
  }
  return { files: entries.length, bytes };
}

export { createWriteStream };

/**
 * Public media URL ingestion.
 * Two supported paths:
 *  1. Direct media URLs (a URL that serves an audio/video file) — always available.
 *  2. Platform pages via yt-dlp, only when the operator has installed it (YTDLP_PATH).
 * Anything else is refused with a clear explanation. We never fabricate a result.
 */
import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
import net from 'node:net';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { tmpPath } from '../lib/storage.js';

const execFileAsync = promisify(execFile);

let ytdlpChecked: boolean | null = null;
export async function ytdlpAvailable(): Promise<boolean> {
  if (ytdlpChecked !== null) return ytdlpChecked;
  try {
    await execFileAsync(config.urlIngest.ytdlpPath, ['--version'], { timeout: 15_000 });
    ytdlpChecked = true;
  } catch {
    ytdlpChecked = false;
  }
  return ytdlpChecked;
}

/** Block private/link-local targets to prevent SSRF. */
async function assertPublicHost(hostname: string) {
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true }).catch(() => []);
  if (!addresses.length) throw new AppError('We could not reach that address.', 400, 'URL_UNREACHABLE');
  for (const { address } of addresses) {
    if (isPrivate(address)) throw new AppError('That address cannot be processed.', 400, 'URL_BLOCKED');
  }
}

function isPrivate(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || lower.startsWith('::ffff:127');
}

export interface IngestResult { path: string; title: string; sourceType: 'direct' | 'platform'; mime: string }

export async function ingestMediaUrl(rawUrl: string, opts: { onStage?: (s: string) => void; maxBytes?: number } = {}): Promise<IngestResult> {
  if (!config.urlIngest.enabled) throw new AppError('URL processing is switched off for this deployment.', 503, 'URL_DISABLED');
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new AppError('That does not look like a valid link.', 400, 'BAD_URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError('Only http and https links can be processed.', 400, 'BAD_URL');
  await assertPublicHost(url.hostname);

  opts.onStage?.('fetching');
  const head = await fetch(url, { method: 'HEAD', redirect: 'follow' }).catch(() => null);
  const contentType = head?.headers.get('content-type') ?? '';
  const isDirectMedia = /^(audio|video)\//.test(contentType) || /\.(mp3|wav|m4a|aac|ogg|opus|flac|mp4|mov|webm|mkv|avi)(\?|$)/i.test(url.pathname);

  if (isDirectMedia) return downloadDirect(url, contentType, opts);

  if (await ytdlpAvailable()) return downloadWithYtdlp(url, opts);

  throw new AppError(
    'This link cannot be processed. Direct links to audio or video files work here — for pages on video platforms, download the media first and upload the file.',
    422, 'URL_UNSUPPORTED',
  );
}

async function downloadDirect(url: URL, contentType: string, opts: { onStage?: (s: string) => void; maxBytes?: number }): Promise<IngestResult> {
  opts.onStage?.('downloading');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new AppError('We could not download the media from that link.', 422, 'URL_UNREACHABLE');
  const max = opts.maxBytes ?? config.maxUploadBytes;
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared && declared > max) throw new AppError('That media file is too large to process.', 413, 'FILE_TOO_LARGE');

  const ext = /\.([a-z0-9]{2,4})(\?|$)/i.exec(url.pathname)?.[1] ?? (contentType.includes('audio') ? 'mp3' : 'mp4');
  const dest = tmpPath(`.${ext.toLowerCase()}`);
  let received = 0;
  const counter = new TransformStream({
    transform(chunk, controller) {
      received += chunk.length;
      if (received > max) controller.error(new AppError('That media file is too large to process.', 413, 'FILE_TOO_LARGE'));
      else controller.enqueue(chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as any), createWriteStream(dest));
  } catch (err) {
    await fs.rm(dest, { force: true });
    if (err instanceof AppError) throw err;
    throw new AppError('The download failed. Please check the link and try again.', 422, 'URL_UNREACHABLE');
  }
  const title = decodeURIComponent(url.pathname.split('/').pop() || 'media');
  return { path: dest, title, sourceType: 'direct', mime: contentType || 'application/octet-stream' };
}

async function downloadWithYtdlp(url: URL, opts: { onStage?: (s: string) => void }): Promise<IngestResult> {
  opts.onStage?.('downloading');
  const template = `${tmpPath('')}.%(ext)s`;
  try {
    const { stdout } = await execFileAsync(config.urlIngest.ytdlpPath, [
      '--no-playlist', '--no-warnings', '--restrict-filenames',
      '-f', 'bestaudio/best',
      '--max-filesize', String(config.maxUploadBytes),
      '--print', 'after_move:%(filepath)s|%(title)s',
      '-o', template, url.toString(),
    ], { timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 });
    const [filepath, title] = stdout.trim().split('\n').pop()!.split('|');
    if (!filepath) throw new Error('no output file');
    await fs.access(filepath);
    return { path: filepath, title: title || 'Media', sourceType: 'platform', mime: 'application/octet-stream' };
  } catch (err) {
    logger.warn({ err: String(err).slice(0, 400) }, 'yt-dlp ingest failed');
    throw new AppError('This link could not be processed. The source may block downloads or require sign-in.', 422, 'URL_UNSUPPORTED');
  }
}

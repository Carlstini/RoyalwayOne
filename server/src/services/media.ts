/** MediaProcessor — real FFmpeg-backed audio/video processing. */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { tmpPath } from '../lib/storage.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const FFMPEG = process.env.FFMPEG_PATH || ffmpegInstaller.path;
export const FFPROBE = process.env.FFPROBE_PATH || ffprobeInstaller.path;

export interface MediaInfo {
  durationSeconds: number;
  format: string;
  bitRate: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
}

export function run(bin: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new AppError('Processing took too long and was stopped. Try a smaller file.', 504, 'TIMEOUT'));
    }, opts.timeoutMs ?? 20 * 60_000);
    child.stdout.on('data', (d) => { out += d.toString(); if (out.length > 4e6) out = out.slice(-2e6); });
    child.stderr.on('data', (d) => { err += d.toString(); if (err.length > 4e6) err = err.slice(-2e6); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out || err);
      else {
        logger.warn({ bin, code, err: err.slice(-1500) }, 'external process failed');
        reject(new AppError('We could not process this media file. It may be corrupted or in an unsupported format.', 422, 'MEDIA_FAILED'));
      }
    });
  });
}

export async function probe(file: string): Promise<MediaInfo> {
  const json = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 120_000 });
  let data: any;
  try { data = JSON.parse(json); } catch { throw new AppError('We could not read this media file.', 422, 'MEDIA_FAILED'); }
  const streams: any[] = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = streams.find((s) => s.codec_type === 'audio');
  const fpsParts = (v?.avg_frame_rate ?? '0/1').split('/').map(Number);
  return {
    durationSeconds: Number(data.format?.duration ?? v?.duration ?? a?.duration ?? 0),
    format: data.format?.format_name ?? 'unknown',
    bitRate: Number(data.format?.bit_rate ?? 0),
    hasVideo: !!v,
    hasAudio: !!a,
    width: v?.width,
    height: v?.height,
    fps: fpsParts[1] ? fpsParts[0] / fpsParts[1] : undefined,
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
  };
}

export async function ffmpeg(args: string[], timeoutMs = 25 * 60_000) {
  return run(FFMPEG, ['-hide_banner', '-nostdin', '-y', ...args], { timeoutMs });
}

export const out = (ext: string) => tmpPath(ext.startsWith('.') ? ext : `.${ext}`);

/** Extract a normalized 16 kHz mono audio track suitable for speech-to-text. */
export async function extractSpeechAudio(input: string): Promise<string> {
  const dest = out('.wav');
  await ffmpeg(['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', dest]);
  return dest;
}

export async function concatMedia(inputs: string[], ext: string, reencodeArgs: string[]): Promise<string> {
  const listFile = tmpPath('.txt');
  await fs.writeFile(listFile, inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  const dest = out(ext);
  try {
    // Re-encode for reliability across heterogeneous inputs.
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, ...reencodeArgs, dest]);
  } finally {
    await fs.rm(listFile, { force: true });
  }
  return dest;
}

export const AUDIO_CODEC_FOR: Record<string, string[]> = {
  mp3: ['-c:a', 'libmp3lame'],
  m4a: ['-c:a', 'aac'],
  aac: ['-c:a', 'aac'],
  ogg: ['-c:a', 'libvorbis'],
  opus: ['-c:a', 'libopus'],
  flac: ['-c:a', 'flac'],
  wav: ['-c:a', 'pcm_s16le'],
};

export function audioArgsFor(format: string, bitrateKbps?: number): string[] {
  const codec = AUDIO_CODEC_FOR[format];
  if (!codec) throw new AppError(`Audio format ${format} isn't supported.`, 415, 'UNSUPPORTED_TYPE');
  const args = [...codec];
  if (bitrateKbps && format !== 'wav' && format !== 'flac') args.push('-b:a', `${bitrateKbps}k`);
  return args;
}

export function ext(name: string) {
  return path.extname(name).replace('.', '').toLowerCase();
}

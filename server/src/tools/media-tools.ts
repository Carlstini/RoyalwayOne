import fs from 'node:fs/promises';
import { ffmpeg, probe, audioArgsFor, concatMedia, out as outPath, ext } from '../services/media.js';
import { AppError } from '../lib/errors.js';
import type { ToolDefinition, ToolRunContext } from './types.js';

const AUDIO_ACCEPT = ['audio/*', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wma'];
const VIDEO_ACCEPT = ['video/*', '.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v', '.wmv', '.flv'];
const AV_ACCEPT = [...AUDIO_ACCEPT, ...VIDEO_ACCEPT];

const baseName = (n: string) => n.replace(/\.[^.]+$/, '');
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
const mimeFor = (e: string) => ({
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', avi: 'video/x-msvideo', gif: 'image/gif',
}[e] ?? 'application/octet-stream');

/** Emit an ffmpeg output file and report real before/after sizes. */
async function emitMedia(ctx: ToolRunContext, path: string, name: string, originalSize?: number) {
  const stat = await fs.stat(path);
  const output = await ctx.emit({ name, mime: mimeFor(ext(name)), path });
  await fs.rm(path, { force: true });
  return {
    outputs: [output],
    stats: {
      ...(originalSize ? { originalSize, reductionPercent: Math.round((1 - stat.size / originalSize) * 1000) / 10 } : {}),
      outputSize: stat.size,
    },
  };
}

function parseTime(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) throw new AppError('Enter times as seconds or as mm:ss.', 400, 'BAD_REQUEST');
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const VIDEO_QUALITY: Record<string, { crf: number; preset: string; audio: string }> = {
  extreme: { crf: 32, preset: 'faster', audio: '96k' },
  recommended: { crf: 26, preset: 'medium', audio: '128k' },
  'high-quality': { crf: 21, preset: 'slow', audio: '192k' },
};

export const audioTools: ToolDefinition[] = [
  {
    id: 'audio-convert',
    name: 'Convert audio',
    category: 'audio',
    description: 'Convert between MP3, WAV, M4A, OGG, Opus and FLAC.',
    icon: 'swap', route: '/audio/convert',
    keywords: ['convert audio', 'mp3 converter', 'wav to mp3', 'm4a to mp3', 'audio format'],
    accept: AV_ACCEPT, minFiles: 1, maxFiles: 10, heavy: true, outputKind: 'files',
    fields: [
      { key: 'format', label: 'Convert to', type: 'select', default: 'mp3', options: ['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac'].map((v) => ({ value: v, label: v.toUpperCase() })) },
      { key: 'bitrate', label: 'Bitrate', type: 'select', default: '192', options: [64, 96, 128, 192, 256, 320].map((v) => ({ value: String(v), label: `${v} kbps` })) },
    ],
    async run(ctx) {
      const format = String(ctx.params.format ?? 'mp3');
      const outputs = [];
      let originalSize = 0; let outputSize = 0;
      for (const [i, file] of ctx.files.entries()) {
        await ctx.setStage(ctx.files.length > 1 ? `converting ${i + 1} of ${ctx.files.length}` : 'converting');
        const dest = outPath(`.${format}`);
        await ffmpeg(['-i', file.path, '-vn', ...audioArgsFor(format, num(ctx.params.bitrate)), dest]);
        const stat = await fs.stat(dest);
        outputs.push(await ctx.emit({ name: `${baseName(file.name)}.${format}`, mime: mimeFor(format), path: dest }));
        await fs.rm(dest, { force: true });
        originalSize += file.size; outputSize += stat.size;
      }
      return { outputs, stats: { originalSize, outputSize } };
    },
  },
  {
    id: 'audio-compress',
    name: 'Compress audio',
    category: 'audio',
    description: 'Shrink audio files for email or upload.',
    icon: 'compress', route: '/audio/compress',
    keywords: ['compress audio', 'reduce audio size', 'smaller mp3'],
    accept: AUDIO_ACCEPT, minFiles: 1, maxFiles: 10, heavy: true, outputKind: 'file',
    fields: [
      { key: 'level', label: 'Compression level', type: 'select', default: 'recommended', options: [
        { value: 'extreme', label: 'Extreme — voice quality (48 kbps mono)' },
        { value: 'recommended', label: 'Recommended (96 kbps)' },
        { value: 'high-quality', label: 'High quality (160 kbps)' },
      ] },
    ],
    async run(ctx) {
      const map: Record<string, string[]> = {
        extreme: ['-ac', '1', '-ar', '22050', '-b:a', '48k'],
        recommended: ['-b:a', '96k'],
        'high-quality': ['-b:a', '160k'],
      };
      await ctx.setStage('compressing');
      const file = ctx.files[0];
      const dest = outPath('.mp3');
      await ffmpeg(['-i', file.path, '-vn', '-c:a', 'libmp3lame', ...(map[ctx.params.level ?? 'recommended'] ?? map.recommended), dest]);
      return emitMedia(ctx, dest, `${baseName(file.name)}-compressed.mp3`, file.size);
    },
  },
  {
    id: 'audio-trim',
    name: 'Trim audio',
    category: 'audio',
    description: 'Keep a section of an audio file, or cut a section out of it.',
    icon: 'scissors', route: '/audio/trim',
    keywords: ['trim audio', 'cut audio', 'crop audio', 'audio cutter'],
    accept: AUDIO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [
      { key: 'mode', label: 'Action', type: 'select', default: 'keep', options: [{ value: 'keep', label: 'Keep the selection' }, { value: 'remove', label: 'Remove the selection' }] },
      { key: 'start', label: 'Start', type: 'text', placeholder: '0:00', default: '0' },
      { key: 'end', label: 'End', type: 'text', placeholder: '1:30' },
    ],
    async run(ctx) {
      const file = ctx.files[0];
      const info = await probe(file.path);
      const start = parseTime(ctx.params.start) ?? 0;
      const end = parseTime(ctx.params.end) ?? info.durationSeconds;
      if (end <= start) throw new AppError('The end time must be after the start time.', 400, 'BAD_REQUEST');
      const format = ext(file.name) || 'mp3';
      const dest = outPath(`.${format}`);
      await ctx.setStage('trimming');
      if (ctx.params.mode === 'remove') {
        const filter = `[0:a]atrim=start=0:end=${start},asetpts=PTS-STARTPTS[a0];[0:a]atrim=start=${end},asetpts=PTS-STARTPTS[a1];[a0][a1]concat=n=2:v=0:a=1[out]`;
        await ffmpeg(['-i', file.path, '-filter_complex', filter, '-map', '[out]', ...audioArgsFor(format in { mp3: 1, wav: 1, m4a: 1, ogg: 1, opus: 1, flac: 1 } ? format : 'mp3'), dest]);
      } else {
        await ffmpeg(['-ss', String(start), '-to', String(end), '-i', file.path, '-vn', ...audioArgsFor(format in { mp3: 1, wav: 1, m4a: 1, ogg: 1, opus: 1, flac: 1 } ? format : 'mp3'), dest]);
      }
      return emitMedia(ctx, dest, `${baseName(file.name)}-trimmed.${format}`, file.size);
    },
  },
  {
    id: 'audio-merge',
    name: 'Merge audio',
    category: 'audio',
    description: 'Join several audio files into one continuous track.',
    icon: 'merge', route: '/audio/merge',
    keywords: ['merge audio', 'join audio', 'combine mp3'],
    accept: AUDIO_ACCEPT, minFiles: 2, maxFiles: 20, heavy: true, outputKind: 'file',
    async run(ctx) {
      await ctx.setStage('merging');
      const dest = await concatMedia(ctx.files.map((f) => f.path), 'mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']);
      return emitMedia(ctx, dest, 'merged.mp3');
    },
  },
  {
    id: 'audio-volume',
    name: 'Change volume',
    category: 'audio',
    description: 'Make audio louder or quieter, or normalise it to a broadcast level.',
    icon: 'volume', route: '/audio/volume',
    keywords: ['change volume', 'louder audio', 'normalize audio', 'quieter'],
    accept: AUDIO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [
      { key: 'mode', label: 'Adjustment', type: 'select', default: 'gain', options: [{ value: 'gain', label: 'Set a level' }, { value: 'normalize', label: 'Normalise loudness (EBU R128)' }] },
      { key: 'percent', label: 'Volume', type: 'range', min: 10, max: 400, step: 5, default: 150, showIf: { key: 'mode', equals: 'gain' } },
    ],
    async run(ctx) {
      const file = ctx.files[0];
      const format = 'mp3';
      const dest = outPath(`.${format}`);
      await ctx.setStage('adjusting audio');
      const filter = ctx.params.mode === 'normalize' ? 'loudnorm=I=-16:TP=-1.5:LRA=11' : `volume=${((num(ctx.params.percent) ?? 100) / 100).toFixed(3)}`;
      await ffmpeg(['-i', file.path, '-vn', '-af', filter, '-c:a', 'libmp3lame', '-b:a', '192k', dest]);
      return emitMedia(ctx, dest, `${baseName(file.name)}-volume.mp3`, file.size);
    },
  },
  {
    id: 'audio-speed',
    name: 'Change speed & pitch',
    category: 'audio',
    description: 'Speed audio up or slow it down, and shift the pitch independently.',
    icon: 'speed', route: '/audio/speed',
    keywords: ['change speed audio', 'slow down audio', 'speed up', 'pitch shift'],
    accept: AUDIO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [
      { key: 'speed', label: 'Speed', type: 'range', min: 0.25, max: 4, step: 0.05, default: 1 },
      { key: 'semitones', label: 'Pitch (semitones)', type: 'range', min: -12, max: 12, step: 1, default: 0 },
    ],
    async run(ctx) {
      const file = ctx.files[0];
      const speed = num(ctx.params.speed) ?? 1;
      const semitones = num(ctx.params.semitones) ?? 0;
      if (speed === 1 && semitones === 0) throw new AppError('Change the speed or the pitch before processing.', 400, 'BAD_REQUEST');
      const filters: string[] = [];
      if (semitones !== 0) {
        const ratio = Math.pow(2, semitones / 12);
        filters.push(`asetrate=44100*${ratio.toFixed(6)}`, 'aresample=44100', ...atempoChain(1 / ratio));
      }
      if (speed !== 1) filters.push(...atempoChain(speed));
      const dest = outPath('.mp3');
      await ctx.setStage('processing audio');
      await ffmpeg(['-i', file.path, '-vn', '-af', filters.join(','), '-c:a', 'libmp3lame', '-b:a', '192k', dest]);
      return emitMedia(ctx, dest, `${baseName(file.name)}-adjusted.mp3`, file.size);
    },
  },
  {
    id: 'audio-reverse',
    name: 'Reverse audio',
    category: 'audio',
    description: 'Play an audio file backwards.',
    icon: 'reverse', route: '/audio/reverse',
    keywords: ['reverse audio', 'backwards audio'],
    accept: AUDIO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    async run(ctx) {
      const file = ctx.files[0];
      const dest = outPath('.mp3');
      await ctx.setStage('reversing');
      await ffmpeg(['-i', file.path, '-vn', '-af', 'areverse', '-c:a', 'libmp3lame', '-b:a', '192k', dest]);
      return emitMedia(ctx, dest, `${baseName(file.name)}-reversed.mp3`, file.size);
    },
  },
  {
    id: 'audio-extract',
    name: 'Extract audio from video',
    category: 'audio',
    description: 'Pull the soundtrack out of any video file.',
    icon: 'music', route: '/audio/extract',
    keywords: ['extract audio', 'video to mp3', 'mp4 to mp3', 'get audio from video'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 5, heavy: true, outputKind: 'files',
    fields: [{ key: 'format', label: 'Audio format', type: 'select', default: 'mp3', options: ['mp3', 'wav', 'm4a', 'flac'].map((v) => ({ value: v, label: v.toUpperCase() })) }],
    async run(ctx) {
      const format = String(ctx.params.format ?? 'mp3');
      const outputs = [];
      for (const [i, file] of ctx.files.entries()) {
        await ctx.setStage(`extracting audio ${i + 1} of ${ctx.files.length}`);
        const info = await probe(file.path);
        if (!info.hasAudio) throw new AppError(`"${file.name}" does not contain an audio track.`, 422, 'NO_AUDIO');
        const dest = outPath(`.${format}`);
        await ffmpeg(['-i', file.path, '-vn', ...audioArgsFor(format, 192), dest]);
        outputs.push(await ctx.emit({ name: `${baseName(file.name)}.${format}`, mime: mimeFor(format), path: dest }));
        await fs.rm(dest, { force: true });
      }
      return { outputs };
    },
  },
  {
    id: 'audio-recorder',
    name: 'Audio recorder',
    category: 'audio',
    description: 'Record from your microphone in the browser, then save or transcribe it.',
    icon: 'mic', route: '/audio/recorder',
    keywords: ['record audio', 'voice recorder', 'microphone', 'dictate'],
    accept: AUDIO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [{ key: 'format', label: 'Save as', type: 'select', default: 'mp3', options: ['mp3', 'wav', 'm4a'].map((v) => ({ value: v, label: v.toUpperCase() })) }],
    async run(ctx) {
      const format = String(ctx.params.format ?? 'mp3');
      const file = ctx.files[0];
      const dest = outPath(`.${format}`);
      await ctx.setStage('saving recording');
      await ffmpeg(['-i', file.path, '-vn', ...audioArgsFor(format, 192), dest]);
      return emitMedia(ctx, dest, `recording.${format}`, file.size);
    },
  },
];

function atempoChain(rate: number): string[] {
  const filters: string[] = [];
  let remaining = rate;
  while (remaining > 2) { filters.push('atempo=2.0'); remaining /= 2; }
  while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5; }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters;
}

export const videoTools: ToolDefinition[] = [
  {
    id: 'video-compress',
    name: 'Compress video',
    category: 'video',
    description: 'Reduce video file size with H.264 encoding at your chosen quality.',
    icon: 'compress', route: '/video/compress',
    keywords: ['compress video', 'reduce video size', 'smaller mp4', 'shrink video'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 5, heavy: true, outputKind: 'file',
    fields: [
      { key: 'level', label: 'Compression level', type: 'select', default: 'recommended', options: [
        { value: 'extreme', label: 'Extreme — smallest file' }, { value: 'recommended', label: 'Recommended' }, { value: 'high-quality', label: 'High quality' },
      ] },
      { key: 'maxHeight', label: 'Limit resolution', type: 'select', default: '0', options: [
        { value: '0', label: 'Keep original' }, { value: '1080', label: '1080p' }, { value: '720', label: '720p' }, { value: '480', label: '480p' },
      ] },
    ],
    async run(ctx) {
      const file = ctx.files[0];
      const q = VIDEO_QUALITY[ctx.params.level ?? 'recommended'] ?? VIDEO_QUALITY.recommended;
      const maxHeight = num(ctx.params.maxHeight) ?? 0;
      const dest = outPath('.mp4');
      await ctx.setStage('compressing video');
      const args = ['-i', file.path, '-c:v', 'libx264', '-crf', String(q.crf), '-preset', q.preset, '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
      if (maxHeight) args.push('-vf', `scale=-2:'min(${maxHeight},ih)'`);
      const info = await probe(file.path);
      args.push(...(info.hasAudio ? ['-c:a', 'aac', '-b:a', q.audio] : ['-an']), dest);
      await ffmpeg(args);
      return emitMedia(ctx, dest, `${baseName(file.name)}-compressed.mp4`, file.size);
    },
  },
  {
    id: 'video-convert',
    name: 'Convert video',
    category: 'video',
    description: 'Convert between MP4, WebM, MOV, MKV and animated GIF.',
    icon: 'swap', route: '/video/convert',
    keywords: ['convert video', 'mov to mp4', 'video to gif', 'webm', 'mkv to mp4'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 5, heavy: true, outputKind: 'file',
    fields: [{ key: 'format', label: 'Convert to', type: 'select', default: 'mp4', options: ['mp4', 'webm', 'mov', 'mkv', 'gif'].map((v) => ({ value: v, label: v.toUpperCase() })) }],
    async run(ctx) {
      const file = ctx.files[0];
      const format = String(ctx.params.format ?? 'mp4');
      const dest = outPath(`.${format}`);
      await ctx.setStage('converting video');
      if (format === 'gif') {
        await ffmpeg(['-i', file.path, '-vf', 'fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', '-loop', '0', dest]);
      } else if (format === 'webm') {
        await ffmpeg(['-i', file.path, '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-c:a', 'libopus', dest]);
      } else {
        await ffmpeg(['-i', file.path, '-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', dest]);
      }
      return emitMedia(ctx, dest, `${baseName(file.name)}.${format}`, file.size);
    },
  },
  {
    id: 'video-trim',
    name: 'Trim video',
    category: 'video',
    description: 'Keep a section of a video, or remove a section from the middle.',
    icon: 'scissors', route: '/video/trim',
    keywords: ['trim video', 'cut video', 'video cutter', 'clip video'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [
      { key: 'mode', label: 'Action', type: 'select', default: 'keep', options: [{ value: 'keep', label: 'Keep the selection' }, { value: 'remove', label: 'Remove the selection' }] },
      { key: 'start', label: 'Start', type: 'text', placeholder: '0:00', default: '0' },
      { key: 'end', label: 'End', type: 'text', placeholder: '0:30' },
    ],
    async run(ctx) {
      const file = ctx.files[0];
      const info = await probe(file.path);
      const start = parseTime(ctx.params.start) ?? 0;
      const end = parseTime(ctx.params.end) ?? info.durationSeconds;
      if (end <= start) throw new AppError('The end time must be after the start time.', 400, 'BAD_REQUEST');
      const dest = outPath('.mp4');
      await ctx.setStage('trimming video');
      if (ctx.params.mode === 'remove') {
        const audio = info.hasAudio;
        const filter = [
          `[0:v]trim=start=0:end=${start},setpts=PTS-STARTPTS[v0]`,
          `[0:v]trim=start=${end},setpts=PTS-STARTPTS[v1]`,
          ...(audio ? [`[0:a]atrim=start=0:end=${start},asetpts=PTS-STARTPTS[a0]`, `[0:a]atrim=start=${end},asetpts=PTS-STARTPTS[a1]`] : []),
          audio ? '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]' : '[v0][v1]concat=n=2:v=1:a=0[v]',
        ].join(';');
        await ffmpeg(['-i', file.path, '-filter_complex', filter, '-map', '[v]', ...(info.hasAudio ? ['-map', '[a]'] : []), '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', '-pix_fmt', 'yuv420p', dest]);
      } else {
        await ffmpeg(['-ss', String(start), '-to', String(end), '-i', file.path, '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', '-pix_fmt', 'yuv420p', ...(info.hasAudio ? ['-c:a', 'aac'] : ['-an']), dest]);
      }
      return emitMedia(ctx, dest, `${baseName(file.name)}-trimmed.mp4`, file.size);
    },
  },
  {
    id: 'video-merge',
    name: 'Merge videos',
    category: 'video',
    description: 'Join several videos into one, in the order you choose.',
    icon: 'merge', route: '/video/merge',
    keywords: ['merge video', 'join videos', 'combine clips'],
    accept: VIDEO_ACCEPT, minFiles: 2, maxFiles: 12, heavy: true, outputKind: 'file',
    async run(ctx) {
      await ctx.setStage('normalising clips');
      // Normalise to a common format first so clips of different sizes concatenate cleanly.
      const normalised: string[] = [];
      for (const [i, file] of ctx.files.entries()) {
        await ctx.setStage(`preparing clip ${i + 1} of ${ctx.files.length}`);
        const dest = outPath('.mp4');
        await ffmpeg(['-i', file.path, '-vf', 'scale=1280:-2:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30', '-c:v', 'libx264', '-crf', '22', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', dest]);
        normalised.push(dest);
      }
      await ctx.setStage('merging');
      const dest = await concatMedia(normalised, 'mp4', ['-c:v', 'libx264', '-crf', '22', '-preset', 'medium', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']);
      await Promise.all(normalised.map((p) => fs.rm(p, { force: true })));
      return emitMedia(ctx, dest, 'merged.mp4');
    },
  },
  {
    id: 'video-resize',
    name: 'Resize video',
    category: 'video',
    description: 'Change the resolution of a video, including social media presets.',
    icon: 'resize', route: '/video/resize',
    keywords: ['resize video', 'change resolution', 'video dimensions', '1080p', 'vertical video'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [
      { key: 'preset', label: 'Size', type: 'select', default: '720', options: [
        { value: '2160', label: '4K (2160p)' }, { value: '1080', label: 'Full HD (1080p)' }, { value: '720', label: 'HD (720p)' },
        { value: '480', label: 'SD (480p)' }, { value: 'square', label: 'Square 1080×1080' }, { value: 'vertical', label: 'Vertical 1080×1920' }, { value: 'custom', label: 'Custom' },
      ] },
      { key: 'width', label: 'Width', type: 'number', min: 16, max: 7680, showIf: { key: 'preset', equals: 'custom' } },
      { key: 'height', label: 'Height', type: 'number', min: 16, max: 4320, showIf: { key: 'preset', equals: 'custom' } },
    ],
    async run(ctx) {
      const file = ctx.files[0];
      const preset = String(ctx.params.preset ?? '720');
      let vf: string;
      if (preset === 'square') vf = 'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2';
      else if (preset === 'vertical') vf = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2';
      else if (preset === 'custom') {
        const w = num(ctx.params.width); const h = num(ctx.params.height);
        if (!w && !h) throw new AppError('Enter a width or a height.', 400, 'BAD_REQUEST');
        vf = `scale=${w ?? -2}:${h ?? -2}`;
      } else vf = `scale=-2:${preset}`;
      const dest = outPath('.mp4');
      await ctx.setStage('resizing video');
      const info = await probe(file.path);
      await ffmpeg(['-i', file.path, '-vf', vf, '-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-pix_fmt', 'yuv420p', ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']), dest]);
      return emitMedia(ctx, dest, `${baseName(file.name)}-resized.mp4`, file.size);
    },
  },
  {
    id: 'video-crop',
    name: 'Crop video',
    category: 'video',
    description: 'Crop the frame to a region or a standard aspect ratio.',
    icon: 'crop', route: '/video/crop',
    keywords: ['crop video', 'cut frame', 'aspect ratio video'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [
      { key: 'ratio', label: 'Crop to', type: 'select', default: '1:1', options: [
        { value: '1:1', label: 'Square 1:1' }, { value: '4:5', label: 'Portrait 4:5' }, { value: '9:16', label: 'Vertical 9:16' }, { value: '16:9', label: 'Widescreen 16:9' }, { value: 'custom', label: 'Custom pixels' },
      ] },
      { key: 'x', label: 'X', type: 'number', min: 0, default: 0, showIf: { key: 'ratio', equals: 'custom' } },
      { key: 'y', label: 'Y', type: 'number', min: 0, default: 0, showIf: { key: 'ratio', equals: 'custom' } },
      { key: 'width', label: 'Width', type: 'number', min: 16, showIf: { key: 'ratio', equals: 'custom' } },
      { key: 'height', label: 'Height', type: 'number', min: 16, showIf: { key: 'ratio', equals: 'custom' } },
    ],
    async run(ctx) {
      const file = ctx.files[0];
      const info = await probe(file.path);
      if (!info.hasVideo) throw new AppError('That file does not contain video.', 422, 'NO_VIDEO');
      let crop: string;
      if (ctx.params.ratio === 'custom') {
        const w = num(ctx.params.width); const h = num(ctx.params.height);
        if (!w || !h) throw new AppError('Enter the crop width and height.', 400, 'BAD_REQUEST');
        crop = `crop=${w}:${h}:${num(ctx.params.x) ?? 0}:${num(ctx.params.y) ?? 0}`;
      } else {
        const [rw, rh] = String(ctx.params.ratio ?? '1:1').split(':').map(Number);
        crop = `crop='min(iw,ih*${rw}/${rh})':'min(ih,iw*${rh}/${rw})'`;
      }
      const dest = outPath('.mp4');
      await ctx.setStage('cropping video');
      await ffmpeg(['-i', file.path, '-vf', crop, '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', '-pix_fmt', 'yuv420p', ...(info.hasAudio ? ['-c:a', 'copy'] : ['-an']), dest]);
      return emitMedia(ctx, dest, `${baseName(file.name)}-cropped.mp4`, file.size);
    },
  },
  {
    id: 'video-rotate',
    name: 'Rotate & flip video',
    category: 'video',
    description: 'Turn a sideways video the right way up, or mirror it.',
    icon: 'rotate', route: '/video/rotate',
    keywords: ['rotate video', 'flip video', 'mirror video', 'sideways video'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [
      { key: 'angle', label: 'Rotation', type: 'select', default: '90', options: [{ value: '0', label: 'None' }, { value: '90', label: '90° clockwise' }, { value: '180', label: '180°' }, { value: '270', label: '90° anticlockwise' }] },
      { key: 'flipH', label: 'Mirror horizontally', type: 'toggle', default: false },
      { key: 'flipV', label: 'Mirror vertically', type: 'toggle', default: false },
    ],
    async run(ctx) {
      const file = ctx.files[0];
      const filters: string[] = [];
      const angle = num(ctx.params.angle) ?? 0;
      if (angle === 90) filters.push('transpose=1');
      else if (angle === 180) filters.push('transpose=1', 'transpose=1');
      else if (angle === 270) filters.push('transpose=2');
      if (ctx.params.flipH) filters.push('hflip');
      if (ctx.params.flipV) filters.push('vflip');
      if (!filters.length) throw new AppError('Choose a rotation or a mirror option.', 400, 'BAD_REQUEST');
      const info = await probe(file.path);
      const dest = outPath('.mp4');
      await ctx.setStage('rotating video');
      await ffmpeg(['-i', file.path, '-vf', filters.join(','), '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-metadata:s:v:0', 'rotate=0', ...(info.hasAudio ? ['-c:a', 'copy'] : ['-an']), dest]);
      return emitMedia(ctx, dest, `${baseName(file.name)}-rotated.mp4`, file.size);
    },
  },
  {
    id: 'video-speed',
    name: 'Change video speed',
    category: 'video',
    description: 'Create slow motion or a fast-forward version, keeping audio in sync.',
    icon: 'speed', route: '/video/speed',
    keywords: ['change speed video', 'slow motion', 'timelapse', 'speed up video'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [{ key: 'speed', label: 'Speed', type: 'range', min: 0.25, max: 4, step: 0.05, default: 1.5 }],
    async run(ctx) {
      const file = ctx.files[0];
      const speed = num(ctx.params.speed) ?? 1;
      if (speed === 1) throw new AppError('Choose a speed other than 1×.', 400, 'BAD_REQUEST');
      const info = await probe(file.path);
      const dest = outPath('.mp4');
      await ctx.setStage('changing speed');
      const filter = info.hasAudio
        ? `[0:v]setpts=${(1 / speed).toFixed(5)}*PTS[v];[0:a]${atempoChain(speed).join(',')}[a]`
        : `[0:v]setpts=${(1 / speed).toFixed(5)}*PTS[v]`;
      await ffmpeg(['-i', file.path, '-filter_complex', filter, '-map', '[v]', ...(info.hasAudio ? ['-map', '[a]', '-c:a', 'aac'] : []), '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', '-pix_fmt', 'yuv420p', dest]);
      return emitMedia(ctx, dest, `${baseName(file.name)}-${speed}x.mp4`, file.size);
    },
  },
  {
    id: 'video-volume',
    name: 'Change video volume',
    category: 'video',
    description: 'Raise, lower, normalise or fully mute a video soundtrack.',
    icon: 'volume', route: '/video/volume',
    keywords: ['video volume', 'mute video', 'louder video', 'remove audio from video'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [
      { key: 'mode', label: 'Adjustment', type: 'select', default: 'gain', options: [{ value: 'gain', label: 'Set a level' }, { value: 'normalize', label: 'Normalise loudness' }, { value: 'mute', label: 'Remove the audio' }] },
      { key: 'percent', label: 'Volume', type: 'range', min: 0, max: 400, step: 5, default: 150, showIf: { key: 'mode', equals: 'gain' } },
    ],
    async run(ctx) {
      const file = ctx.files[0];
      const dest = outPath('.mp4');
      await ctx.setStage('adjusting audio');
      if (ctx.params.mode === 'mute') {
        await ffmpeg(['-i', file.path, '-an', '-c:v', 'copy', dest]);
      } else {
        const filter = ctx.params.mode === 'normalize' ? 'loudnorm=I=-16:TP=-1.5:LRA=11' : `volume=${((num(ctx.params.percent) ?? 100) / 100).toFixed(3)}`;
        const info = await probe(file.path);
        if (!info.hasAudio) throw new AppError('That video has no audio track to adjust.', 422, 'NO_AUDIO');
        await ffmpeg(['-i', file.path, '-af', filter, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', dest]);
      }
      return emitMedia(ctx, dest, `${baseName(file.name)}-audio.mp4`, file.size);
    },
  },
  {
    id: 'video-add-audio',
    name: 'Add audio to video',
    category: 'video',
    description: 'Replace or mix a soundtrack into a video.',
    icon: 'music', route: '/video/add-audio',
    keywords: ['add audio to video', 'replace soundtrack', 'add music to video', 'dub'],
    accept: AV_ACCEPT, minFiles: 2, maxFiles: 2, heavy: true, outputKind: 'file',
    fields: [
      { key: 'mode', label: 'Existing audio', type: 'select', default: 'replace', options: [{ value: 'replace', label: 'Replace it' }, { value: 'mix', label: 'Mix the two together' }] },
      { key: 'musicVolume', label: 'New audio level', type: 'range', min: 10, max: 200, step: 5, default: 100 },
    ],
    async run(ctx) {
      const video = ctx.files.find((f) => /^video\//.test(f.mime) || /\.(mp4|mov|webm|mkv|avi)$/i.test(f.name));
      const audio = ctx.files.find((f) => f !== video);
      if (!video || !audio) throw new AppError('Upload one video file and one audio file.', 400, 'BAD_REQUEST');
      const info = await probe(video.path);
      const gain = ((num(ctx.params.musicVolume) ?? 100) / 100).toFixed(3);
      const dest = outPath('.mp4');
      await ctx.setStage('adding audio');
      if (ctx.params.mode === 'mix' && info.hasAudio) {
        await ffmpeg(['-i', video.path, '-i', audio.path, '-filter_complex', `[1:a]volume=${gain}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', dest]);
      } else {
        await ffmpeg(['-i', video.path, '-i', audio.path, '-filter_complex', `[1:a]volume=${gain}[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', dest]);
      }
      return emitMedia(ctx, dest, `${baseName(video.name)}-with-audio.mp4`, video.size);
    },
  },
  {
    id: 'video-add-text',
    name: 'Add text to video',
    category: 'video',
    description: 'Burn a caption or title onto the video.',
    icon: 'text', route: '/video/add-text',
    keywords: ['add text to video', 'caption video', 'title video', 'subtitle burn'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [
      { key: 'text', label: 'Text', type: 'text', placeholder: 'Your caption' },
      { key: 'position', label: 'Position', type: 'select', default: 'bottom', options: [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }] },
      { key: 'fontSize', label: 'Text size', type: 'range', min: 12, max: 96, step: 2, default: 36 },
    ],
    async run(ctx) {
      const file = ctx.files[0];
      const text = String(ctx.params.text ?? '').trim();
      if (!text) throw new AppError('Enter the text you want to add.', 400, 'BAD_REQUEST');
      const safe = text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019").replace(/%/g, '\\%');
      const y = ctx.params.position === 'top' ? 'h*0.08' : ctx.params.position === 'middle' ? '(h-text_h)/2' : 'h*0.85';
      const size = num(ctx.params.fontSize) ?? 36;
      const info = await probe(file.path);
      const dest = outPath('.mp4');
      await ctx.setStage('adding text');
      await ffmpeg(['-i', file.path, '-vf',
        `drawtext=text='${safe}':fontcolor=white:fontsize=${size}:box=1:boxcolor=black@0.5:boxborderw=12:x=(w-text_w)/2:y=${y}`,
        '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', '-pix_fmt', 'yuv420p', ...(info.hasAudio ? ['-c:a', 'copy'] : ['-an']), dest]);
      return emitMedia(ctx, dest, `${baseName(file.name)}-captioned.mp4`, file.size);
    },
  },
  {
    id: 'video-add-image',
    name: 'Add image or watermark',
    category: 'video',
    description: 'Overlay a logo or image on top of a video.',
    icon: 'stamp', route: '/video/add-image',
    keywords: ['watermark video', 'add logo to video', 'overlay image video'],
    accept: [...VIDEO_ACCEPT, 'image/*'], minFiles: 2, maxFiles: 2, heavy: true, outputKind: 'file',
    fields: [
      { key: 'position', label: 'Position', type: 'select', default: 'bottom-right', options: [
        { value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' }, { value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-right', label: 'Bottom right' }, { value: 'center', label: 'Centre' },
      ] },
      { key: 'scale', label: 'Size (% of width)', type: 'range', min: 5, max: 60, step: 1, default: 18 },
      { key: 'opacity', label: 'Opacity', type: 'range', min: 10, max: 100, step: 5, default: 85 },
    ],
    async run(ctx) {
      const video = ctx.files.find((f) => /^video\//.test(f.mime) || /\.(mp4|mov|webm|mkv|avi)$/i.test(f.name));
      const image = ctx.files.find((f) => f !== video);
      if (!video || !image) throw new AppError('Upload one video and one image.', 400, 'BAD_REQUEST');
      const margin = 24;
      const pos: Record<string, string> = {
        'top-left': `${margin}:${margin}`, 'top-right': `W-w-${margin}:${margin}`,
        'bottom-left': `${margin}:H-h-${margin}`, 'bottom-right': `W-w-${margin}:H-h-${margin}`,
        center: '(W-w)/2:(H-h)/2',
      };
      const scale = (num(ctx.params.scale) ?? 18) / 100;
      const alpha = (num(ctx.params.opacity) ?? 85) / 100;
      const info = await probe(video.path);
      const dest = outPath('.mp4');
      await ctx.setStage('adding overlay');
      await ffmpeg(['-i', video.path, '-i', image.path, '-filter_complex',
        `[1:v]format=rgba,colorchannelmixer=aa=${alpha.toFixed(2)}[wm];[0:v][wm]scale2ref=w=iw*${scale.toFixed(3)}:h=ow/mdar[wm2][base];[base][wm2]overlay=${pos[ctx.params.position ?? 'bottom-right']}`,
        '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', '-pix_fmt', 'yuv420p', ...(info.hasAudio ? ['-c:a', 'copy'] : ['-an']), dest]);
      return emitMedia(ctx, dest, `${baseName(video.name)}-watermarked.mp4`, video.size);
    },
  },
  {
    id: 'video-loop',
    name: 'Loop video',
    category: 'video',
    description: 'Repeat a clip a number of times back to back.',
    icon: 'reverse', route: '/video/loop',
    keywords: ['loop video', 'repeat video'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [{ key: 'times', label: 'Total plays', type: 'number', min: 2, max: 20, default: 3 }],
    async run(ctx) {
      const file = ctx.files[0];
      const times = Math.min(20, Math.max(2, num(ctx.params.times) ?? 3));
      const info = await probe(file.path);
      if (info.durationSeconds * times > 3 * 3600) throw new AppError('That many loops would make the video too long.', 400, 'BAD_REQUEST');
      const dest = outPath('.mp4');
      await ctx.setStage('looping video');
      await ffmpeg(['-stream_loop', String(times - 1), '-i', file.path, '-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-pix_fmt', 'yuv420p', ...(info.hasAudio ? ['-c:a', 'aac'] : ['-an']), dest]);
      return emitMedia(ctx, dest, `${baseName(file.name)}-looped.mp4`, file.size);
    },
  },
  {
    id: 'video-stabilize',
    name: 'Stabilise video',
    category: 'video',
    description: 'Smooth out camera shake with motion-compensated deshaking.',
    icon: 'wrench', route: '/video/stabilize',
    keywords: ['stabilize video', 'stabilise', 'remove shake', 'smooth video'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    fields: [{ key: 'strength', label: 'Strength', type: 'select', default: 'medium', options: [{ value: 'light', label: 'Light' }, { value: 'medium', label: 'Medium' }, { value: 'strong', label: 'Strong' }] }],
    async run(ctx) {
      const file = ctx.files[0];
      const rx: Record<string, number> = { light: 16, medium: 32, strong: 64 };
      const size = rx[ctx.params.strength ?? 'medium'] ?? 32;
      const info = await probe(file.path);
      const dest = outPath('.mp4');
      await ctx.setStage('stabilising video');
      await ffmpeg(['-i', file.path, '-vf', `deshake=rx=${size}:ry=${size}:edge=clamp`, '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', '-pix_fmt', 'yuv420p', ...(info.hasAudio ? ['-c:a', 'copy'] : ['-an']), dest]);
      return emitMedia(ctx, dest, `${baseName(file.name)}-stabilised.mp4`, file.size);
    },
  },
  {
    id: 'video-recorder',
    name: 'Screen & camera recorder',
    category: 'video',
    description: 'Record your screen or camera in the browser, then save it as MP4.',
    icon: 'record', route: '/video/recorder',
    keywords: ['screen recorder', 'record screen', 'webcam recorder', 'record video'],
    accept: VIDEO_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, outputKind: 'file',
    async run(ctx) {
      const file = ctx.files[0];
      const dest = outPath('.mp4');
      await ctx.setStage('finalising recording');
      const info = await probe(file.path);
      await ffmpeg(['-i', file.path, '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']), dest]);
      return emitMedia(ctx, dest, 'recording.mp4', file.size);
    },
  },
];

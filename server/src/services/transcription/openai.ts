import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { ffmpeg, probe } from '../media.js';
import { tmpPath } from '../../lib/storage.js';
import type { TranscribeOptions, TranscriptionProvider, TranscriptResult, TranscriptSegment, TranscriptWord } from './provider.js';

const CHUNK_SECONDS = 600; // keeps each upload well under the provider size limit

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  readonly id = 'openai';
  isConfigured() { return !!config.transcription.openaiKey; }

  async transcribeFile(filePath: string, options: TranscribeOptions = {}): Promise<TranscriptResult> {
    const info = await probe(filePath);
    const duration = info.durationSeconds || 0;
    const parts: string[] = [];
    const cleanup: string[] = [];

    options.onStage?.('preparing');
    if (duration > CHUNK_SECONDS) {
      const count = Math.ceil(duration / CHUNK_SECONDS);
      for (let i = 0; i < count; i++) {
        const dest = tmpPath('.mp3');
        await ffmpeg(['-ss', String(i * CHUNK_SECONDS), '-t', String(CHUNK_SECONDS), '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', dest]);
        parts.push(dest); cleanup.push(dest);
      }
    } else {
      const dest = tmpPath('.mp3');
      await ffmpeg(['-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', dest]);
      parts.push(dest); cleanup.push(dest);
    }

    options.onStage?.('transcribing');
    const words: TranscriptWord[] = [];
    const segments: TranscriptSegment[] = [];
    let language: string | undefined;
    try {
      for (const [i, part] of parts.entries()) {
        const offset = i * CHUNK_SECONDS;
        const result = await this.callApi(part, options);
        language ??= result.language;
        for (const s of result.segments ?? []) segments.push({ start: s.start + offset, end: s.end + offset, text: String(s.text).trim() });
        for (const w of result.words ?? []) words.push({ text: w.word, start: w.start + offset, end: w.end + offset });
      }
    } finally {
      await Promise.all(cleanup.map((p) => fsp.rm(p, { force: true })));
    }

    if (!segments.length) throw new AppError('We could not find any speech in this recording.', 422, 'NO_SPEECH');

    return {
      text: segments.map((s) => s.text).join('\n'),
      segments,
      words,
      language,
      durationSeconds: duration,
      provider: this.id,
      model: config.transcription.openaiModel,
    };
  }

  private async callApi(filePath: string, options: TranscribeOptions): Promise<any> {
    const form = new FormData();
    const buf = await fsp.readFile(filePath);
    form.append('file', new Blob([buf], { type: 'audio/mpeg' }), path.basename(filePath));
    form.append('model', config.transcription.openaiModel);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');
    if (options.language) form.append('language', options.language);

    const res = await fetch(`${config.transcription.openaiBaseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.transcription.openaiKey}` },
      body: form,
      signal: options.signal,
    });
    if (!res.ok) {
      logger.warn({ status: res.status, detail: (await res.text()).slice(0, 400) }, 'openai transcription error');
      throw new AppError('We could not transcribe this recording. Please try again.', 502, 'TRANSCRIPTION_FAILED');
    }
    return res.json();
  }
}

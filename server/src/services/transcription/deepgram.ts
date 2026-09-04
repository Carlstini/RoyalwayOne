import fs from 'node:fs';
import { config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { TranscribeOptions, TranscriptionProvider, TranscriptResult, TranscriptSegment, TranscriptWord } from './provider.js';

export class DeepgramProvider implements TranscriptionProvider {
  readonly id = 'deepgram';
  isConfigured() { return !!config.transcription.deepgramKey; }

  async transcribeFile(filePath: string, options: TranscribeOptions = {}): Promise<TranscriptResult> {
    const params = new URLSearchParams({
      model: config.transcription.deepgramModel,
      smart_format: 'true',
      punctuate: 'true',
      paragraphs: 'true',
      utterances: 'true',
      diarize: String(options.diarize ?? true),
    });
    if (options.language) params.set('language', options.language);
    else params.set('detect_language', 'true');

    options.onStage?.('transcribing');
    const body = fs.createReadStream(filePath);
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { authorization: `Token ${config.transcription.deepgramKey}`, 'content-type': options.mimeType ?? 'audio/wav' },
      body: body as any,
      duplex: 'half',
      signal: options.signal,
    } as any);
    if (!res.ok) {
      logger.warn({ status: res.status, detail: (await res.text()).slice(0, 400) }, 'deepgram error');
      if (res.status === 400) throw new AppError('We could not transcribe this recording. The audio may be silent or corrupted.', 422, 'TRANSCRIPTION_FAILED');
      throw new AppError('The transcription service is unavailable right now. Please try again shortly.', 502, 'TRANSCRIPTION_FAILED');
    }
    const data: any = await res.json();
    const alt = data.results?.channels?.[0]?.alternatives?.[0];
    if (!alt) throw new AppError('We could not transcribe this recording.', 422, 'TRANSCRIPTION_FAILED');

    const words: TranscriptWord[] = (alt.words ?? []).map((w: any) => ({
      text: w.punctuated_word ?? w.word,
      start: w.start,
      end: w.end,
      speaker: w.speaker !== undefined ? `Speaker ${w.speaker + 1}` : undefined,
      confidence: w.confidence,
    }));

    let segments: TranscriptSegment[] = (data.results?.utterances ?? []).map((u: any) => ({
      start: u.start, end: u.end, text: u.transcript,
      speaker: u.speaker !== undefined ? `Speaker ${u.speaker + 1}` : undefined,
    }));
    if (!segments.length) segments = segmentsFromWords(words);

    return {
      text: segments.map((s) => s.text).join('\n') || alt.transcript || '',
      segments,
      words,
      language: data.results?.channels?.[0]?.detected_language ?? options.language,
      durationSeconds: data.metadata?.duration,
      provider: this.id,
      model: config.transcription.deepgramModel,
      speakerCount: new Set(segments.map((s) => s.speaker).filter(Boolean)).size || undefined,
    };
  }
}

export function segmentsFromWords(words: TranscriptWord[], maxGap = 0.9, maxChars = 220): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let cur: TranscriptSegment | null = null;
  for (const w of words) {
    const shouldBreak = !cur || w.speaker !== cur.speaker || w.start - cur.end > maxGap || cur.text.length > maxChars;
    if (shouldBreak) {
      if (cur) segments.push(cur);
      cur = { start: w.start, end: w.end, text: w.text, speaker: w.speaker };
    } else {
      cur!.text += ` ${w.text}`;
      cur!.end = w.end;
    }
  }
  if (cur) segments.push(cur);
  return segments;
}

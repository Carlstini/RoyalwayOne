import { config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import { DeepgramProvider } from './deepgram.js';
import { OpenAITranscriptionProvider } from './openai.js';
import type { TranscriptionProvider } from './provider.js';

export * from './provider.js';

export function getTranscriptionProvider(): TranscriptionProvider {
  const candidates: TranscriptionProvider[] = [new DeepgramProvider(), new OpenAITranscriptionProvider()];
  return candidates.find((c) => c.id === config.transcription.provider && c.isConfigured())
    ?? candidates.find((c) => c.isConfigured())
    ?? candidates[0];
}

export function transcriptionAvailable() { return getTranscriptionProvider().isConfigured(); }

export function requireTranscription(): TranscriptionProvider {
  const p = getTranscriptionProvider();
  if (!p.isConfigured()) {
    throw new AppError('Transcription is not switched on for this deployment yet.', 503, 'TRANSCRIPTION_NOT_CONFIGURED');
  }
  return p;
}

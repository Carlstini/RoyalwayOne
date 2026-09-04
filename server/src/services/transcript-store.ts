/** Short-lived transcript store powering the transcript editor, exports and Q&A. */
import { config } from '../lib/config.js';
import { cacheTranscript } from './document-store.js';
import type { TranscriptSegment } from './transcription/index.js';

export interface StoredTranscript {
  id: string;
  sessionId: string;
  title: string;
  segments: TranscriptSegment[];
  text: string;
  language?: string;
  durationSeconds?: number;
  speakerCount?: number;
  provider: string;
  createdAt: number;
}

const store = new Map<string, StoredTranscript>();

export function saveTranscript(t: Omit<StoredTranscript, 'createdAt'>) {
  const record: StoredTranscript = { ...t, createdAt: Date.now() };
  store.set(t.id, record);
  cacheTranscript(t.id, t.title, t.segments, t.text);
  prune();
  return record;
}

export function getTranscript(id: string, sessionId: string) {
  const t = store.get(id);
  if (!t || t.sessionId !== sessionId) return null;
  return t;
}

export function updateTranscript(id: string, sessionId: string, segments: TranscriptSegment[]) {
  const t = getTranscript(id, sessionId);
  if (!t) return null;
  t.segments = segments;
  t.text = segments.map((s) => s.text).join('\n');
  cacheTranscript(t.id, t.title, t.segments, t.text);
  return t;
}

function prune() {
  const cutoff = Date.now() - config.retentionMinutes * 60_000;
  for (const [k, v] of store) if (v.createdAt < cutoff) store.delete(k);
  while (store.size > 300) store.delete(store.keys().next().value!);
}

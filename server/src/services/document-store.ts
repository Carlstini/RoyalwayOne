/**
 * Extracted-document cache for AI features: keeps chunked text (and embeddings)
 * for a short window so chat and analysis do not re-parse the file each time.
 */
import { config } from '../lib/config.js';
import { chunkText, embedChunks, type Chunk } from './ai/retrieval.js';
import { extractDocument, type ExtractedDocument } from './text-extract.js';
import type { StoredFile } from '../lib/storage.js';

interface Entry { doc: ExtractedDocument; chunks: Chunk[]; at: number; name: string }

const cache = new Map<string, Entry>();

export async function getDocumentContext(file: StoredFile): Promise<Entry> {
  const existing = cache.get(file.id);
  if (existing) { existing.at = Date.now(); return existing; }
  const doc = await extractDocument(file);
  const chunks = await embedChunks(chunkText(doc.pages));
  const entry: Entry = { doc, chunks, at: Date.now(), name: file.name };
  cache.set(file.id, entry);
  prune();
  return entry;
}

export function cacheTranscript(id: string, name: string, segments: { start: number; text: string; speaker?: string }[], fullText: string) {
  const pages = segments.length
    ? groupSegments(segments)
    : [{ label: 'Transcript', text: fullText }];
  const doc: ExtractedDocument = { pages, text: fullText, method: 'transcript', characters: fullText.length };
  const entry: Entry = { doc, chunks: chunkText(pages), at: Date.now(), name };
  cache.set(id, entry);
  prune();
  return entry;
}

function groupSegments(segments: { start: number; text: string; speaker?: string }[]) {
  const pages: { label: string; text: string }[] = [];
  const perGroup = 25;
  for (let i = 0; i < segments.length; i += perGroup) {
    const group = segments.slice(i, i + perGroup);
    const label = `${formatClock(group[0].start)}–${formatClock(group[group.length - 1].start)}`;
    pages.push({ label, text: group.map((s) => `${s.speaker ? `${s.speaker}: ` : ''}${s.text}`).join('\n') });
  }
  return pages;
}

const formatClock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function prune() {
  const cutoff = Date.now() - config.retentionMinutes * 60_000;
  for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
  while (cache.size > 200) cache.delete(cache.keys().next().value!);
}

export function forget(id: string) { cache.delete(id); }

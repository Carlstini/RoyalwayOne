/** Document retrieval for grounded Q&A. Embeddings when available, BM25-style lexical otherwise. */
import { getAIProvider } from './index.js';
import { logger } from '../../lib/logger.js';

export interface Chunk { id: number; label: string; text: string; embedding?: number[] }

export function chunkText(pages: { label: string; text: string }[], target = 1400, overlap = 200): Chunk[] {
  const chunks: Chunk[] = [];
  let id = 0;
  for (const page of pages) {
    const paragraphs = page.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let buffer = '';
    const flush = () => {
      if (!buffer.trim()) return;
      chunks.push({ id: id++, label: page.label, text: buffer.trim() });
      buffer = buffer.slice(Math.max(0, buffer.length - overlap));
    };
    for (const p of paragraphs) {
      if ((buffer + '\n\n' + p).length > target) flush();
      buffer = buffer ? `${buffer}\n\n${p}` : p;
      while (buffer.length > target * 1.8) {
        chunks.push({ id: id++, label: page.label, text: buffer.slice(0, target) });
        buffer = buffer.slice(target - overlap);
      }
    }
    flush();
  }
  return chunks;
}

export async function embedChunks(chunks: Chunk[]): Promise<Chunk[]> {
  const provider = getAIProvider();
  if (!provider.embed || !provider.isConfigured()) return chunks;
  try {
    const batches: Chunk[][] = [];
    for (let i = 0; i < chunks.length; i += 64) batches.push(chunks.slice(i, i + 64));
    for (const batch of batches) {
      const vectors = await provider.embed(batch.map((c) => c.text.slice(0, 6000)));
      batch.forEach((c, i) => { c.embedding = vectors[i]; });
    }
  } catch (err) {
    logger.warn({ err }, 'embedding failed; falling back to lexical retrieval');
  }
  return chunks;
}

const tokenize = (s: string) => s.toLowerCase().match(/[a-z0-9£$€%.-]{2,}/g) ?? [];

export function lexicalScore(query: string, chunks: Chunk[]): number[] {
  const qTokens = [...new Set(tokenize(query))];
  const df = new Map<string, number>();
  const docTokens = chunks.map((c) => {
    const tokens = tokenize(c.text);
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
    return tokens;
  });
  const avgLen = docTokens.reduce((a, d) => a + d.length, 0) / Math.max(1, docTokens.length);
  const k1 = 1.5;
  const b = 0.75;
  return docTokens.map((tokens) => {
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    let score = 0;
    for (const q of qTokens) {
      const f = counts.get(q) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (chunks.length - (df.get(q) ?? 0) + 0.5) / ((df.get(q) ?? 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * tokens.length) / (avgLen || 1))));
    }
    return score;
  });
}

function cosine(a: number[], b: number[]) {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function retrieve(query: string, chunks: Chunk[], topK = 8): Promise<Chunk[]> {
  if (chunks.length <= topK) return chunks;
  const lex = lexicalScore(query, chunks);
  const maxLex = Math.max(...lex, 1e-6);
  let scores = lex.map((s) => s / maxLex);

  const provider = getAIProvider();
  if (provider.embed && provider.isConfigured() && chunks[0]?.embedding) {
    try {
      const [qv] = await provider.embed([query]);
      const sims = chunks.map((c) => (c.embedding ? cosine(qv, c.embedding) : 0));
      const maxSim = Math.max(...sims, 1e-6);
      scores = scores.map((s, i) => 0.45 * s + 0.55 * (sims[i] / maxSim));
    } catch (err) {
      logger.warn({ err }, 'query embedding failed; lexical only');
    }
  }
  return chunks
    .map((c, i) => ({ c, s: scores[i] }))
    .sort((x, y) => y.s - x.s)
    .slice(0, topK)
    .sort((x, y) => x.c.id - y.c.id)
    .map((x) => x.c);
}

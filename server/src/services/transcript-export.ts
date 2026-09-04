import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { htmlToPdf } from './convert.js';
import type { TranscriptSegment } from './transcription/index.js';

export function formatTimestamp(seconds: number, withMillis = false, comma = false) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const base = `${pad(h)}:${pad(m)}:${pad(sec)}`;
  if (!withMillis) return base;
  return `${base}${comma ? ',' : '.'}${String(ms).padStart(3, '0')}`;
}
const pad = (n: number) => String(n).padStart(2, '0');

export function toSrt(segments: TranscriptSegment[]) {
  return segments.map((s, i) =>
    `${i + 1}\n${formatTimestamp(s.start, true, true)} --> ${formatTimestamp(s.end, true, true)}\n${s.speaker ? `${s.speaker}: ` : ''}${s.text.trim()}\n`,
  ).join('\n');
}

export function toVtt(segments: TranscriptSegment[]) {
  return `WEBVTT\n\n${segments.map((s) =>
    `${formatTimestamp(s.start, true)} --> ${formatTimestamp(s.end, true)}\n${s.speaker ? `<v ${s.speaker}>` : ''}${s.text.trim()}\n`,
  ).join('\n')}`;
}

export function toPlainText(segments: TranscriptSegment[], opts: { timestamps?: boolean; speakers?: boolean } = {}) {
  const lines: string[] = [];
  let lastSpeaker: string | undefined;
  for (const s of segments) {
    const prefix: string[] = [];
    if (opts.timestamps) prefix.push(`[${formatTimestamp(s.start)}]`);
    if (opts.speakers && s.speaker && s.speaker !== lastSpeaker) prefix.push(`${s.speaker}:`);
    lastSpeaker = s.speaker;
    lines.push(`${prefix.join(' ')}${prefix.length ? ' ' : ''}${s.text.trim()}`);
  }
  return lines.join('\n');
}

export async function toDocx(title: string, segments: TranscriptSegment[], opts: { timestamps?: boolean; speakers?: boolean } = {}) {
  const children = [new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 })];
  for (const s of segments) {
    const runs: TextRun[] = [];
    if (opts.timestamps) runs.push(new TextRun({ text: `[${formatTimestamp(s.start)}] `, color: '6B7280', size: 18 }));
    if (opts.speakers && s.speaker) runs.push(new TextRun({ text: `${s.speaker}: `, bold: true, size: 22 }));
    runs.push(new TextRun({ text: s.text.trim(), size: 22 }));
    children.push(new Paragraph({ children: runs, spacing: { after: 140 } }));
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

export function toPdf(title: string, segments: TranscriptSegment[], opts: { timestamps?: boolean; speakers?: boolean } = {}) {
  const rows = segments.map((s) => {
    const meta = [opts.timestamps ? `[${formatTimestamp(s.start)}]` : '', opts.speakers && s.speaker ? `<b>${escapeHtml(s.speaker)}:</b>` : '']
      .filter(Boolean).join(' ');
    return `<p>${meta ? `<span style="color:#6b7280">${meta}</span> ` : ''}${escapeHtml(s.text.trim())}</p>`;
  }).join('');
  return htmlToPdf(`<h1>${escapeHtml(title)}</h1>${rows}`);
}

export function toMarkdown(title: string, segments: TranscriptSegment[]) {
  return `# ${title}\n\n${segments.map((s) => `**${formatTimestamp(s.start)}**${s.speaker ? ` — ${s.speaker}` : ''}\n\n${s.text.trim()}\n`).join('\n')}`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

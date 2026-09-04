import { describe, it, expect } from 'vitest';
import { formatTimestamp, toSrt, toVtt, toPlainText, toMarkdown, toDocx, toPdf } from '../services/transcript-export.js';

const segments = [
  { start: 0, end: 4.2, text: 'Good morning everyone.', speaker: 'Speaker 1' },
  { start: 4.2, end: 9.5, text: 'Revenue came in at $1,400,000.', speaker: 'Speaker 2' },
  { start: 9.5, end: 14.0, text: 'Deadline is 2026-03-31.', speaker: 'Speaker 1' },
];

describe('formatTimestamp', () => {
  it('formats hours, minutes and seconds', () => {
    expect(formatTimestamp(0)).toBe('00:00:00');
    expect(formatTimestamp(65)).toBe('00:01:05');
    expect(formatTimestamp(3725)).toBe('01:02:05');
  });
  it('supports millisecond precision with a comma for SRT', () => {
    expect(formatTimestamp(4.2, true, true)).toBe('00:00:04,200');
    expect(formatTimestamp(4.2, true, false)).toBe('00:00:04.200');
  });
  it('never emits a negative or NaN timestamp', () => {
    expect(formatTimestamp(-5)).toBe('00:00:00');
    expect(formatTimestamp(Number.NaN)).toBe('00:00:00');
  });
});

describe('SRT export', () => {
  const srt = toSrt(segments);
  it('numbers cues sequentially from 1', () => {
    expect(srt.split(/\r?\n/)[0]).toBe('1');
    expect(srt).toContain('\n2\n');
    expect(srt).toContain('\n3\n');
  });
  it('uses comma-separated milliseconds and an arrow', () => {
    expect(srt).toContain('00:00:00,000 --> 00:00:04,200');
  });
  it('carries the real transcript text', () => {
    expect(srt).toContain('Revenue came in at $1,400,000.');
  });
});

describe('VTT export', () => {
  const vtt = toVtt(segments);
  it('starts with the WEBVTT header', () => expect(vtt.startsWith('WEBVTT')).toBe(true));
  it('uses dot-separated milliseconds', () => expect(vtt).toContain('00:00:00.000 --> 00:00:04.200'));
  it('tags the speaker', () => expect(vtt).toContain('<v Speaker 1>'));
});

describe('plain text export', () => {
  it('includes timestamps and speakers by default options', () => {
    const t = toPlainText(segments, { timestamps: true, speakers: true });
    expect(t).toContain('[00:00:00]');
    expect(t).toContain('Speaker 1:');
  });
  it('omits timestamps when asked', () => {
    const t = toPlainText(segments, { timestamps: false, speakers: false });
    expect(t).not.toContain('[00:00:00]');
    expect(t).toContain('Good morning everyone.');
  });
});

describe('markdown export', () => {
  it('includes the title and every segment', () => {
    const md = toMarkdown('Board meeting', segments);
    expect(md).toContain('# Board meeting');
    for (const s of segments) expect(md).toContain(s.text);
  });
});

describe('binary exports produce genuine files', () => {
  it('DOCX has the ZIP magic number and real size', async () => {
    const buf = await toDocx('Board meeting', segments);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString('hex')).toBe('504b0304');
  });
  it('PDF has the %PDF magic number and real size', () => {
    const buf = toPdf('Board meeting', segments);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('edge cases', () => {
  it('handles an empty transcript without throwing', () => {
    expect(toSrt([])).toBe('');
    expect(toVtt([]).startsWith('WEBVTT')).toBe(true);
  });
  it('handles missing speaker labels', () => {
    const s = [{ start: 0, end: 1, text: 'Hello.' }];
    expect(toPlainText(s, { speakers: true })).toContain('Hello.');
  });
});

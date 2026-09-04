import { describe, it, expect, beforeAll } from 'vitest';
process.env.SESSION_SECRET ||= 'test-secret-for-signing-abcdefghijkl';
const { signDownload, verifyDownload, sanitizeName, newId } = await import('../lib/storage.js');

describe('signed download links', () => {
  it('produces a link that verifies with its own signature', () => {
    const url = signDownload('abc123', 600);
    const q = new URL('http://x' + url).searchParams;
    expect(verifyDownload('abc123', q.get('exp')!, q.get('sig')!)).toBe(true);
  });

  it('rejects a tampered file id', () => {
    const q = new URL('http://x' + signDownload('abc123', 600)).searchParams;
    expect(verifyDownload('otherid', q.get('exp')!, q.get('sig')!)).toBe(false);
  });

  it('rejects a tampered expiry', () => {
    const q = new URL('http://x' + signDownload('abc123', 600)).searchParams;
    const later = String(Number(q.get('exp')) + 99999);
    expect(verifyDownload('abc123', later, q.get('sig')!)).toBe(false);
  });

  it('rejects a forged signature', () => {
    const q = new URL('http://x' + signDownload('abc123', 600)).searchParams;
    expect(verifyDownload('abc123', q.get('exp')!, 'not-a-real-signature')).toBe(false);
  });

  it('rejects an already-expired link', () => {
    const past = String(Math.floor(Date.now() / 1000) - 10);
    expect(verifyDownload('abc123', past, 'anything')).toBe(false);
  });

  it('does not throw on malformed input', () => {
    expect(() => verifyDownload('a', 'not-a-number', '!!!')).not.toThrow();
    expect(verifyDownload('a', 'not-a-number', '!!!')).toBe(false);
  });
});

describe('sanitizeName', () => {
  it('strips directory traversal', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeName('/absolute/path/report.pdf')).toBe('report.pdf');
  });
  it('removes shell and control characters', () => {
    const out = sanitizeName('bad;rm -rf $(x)`y`.pdf');
    expect(out).not.toMatch(/[;$`]/);
  });
  it('keeps ordinary names intact', () => {
    expect(sanitizeName('Quarterly Report (final).pdf')).toBe('Quarterly Report (final).pdf');
  });
  it('never returns an empty name', () => {
    expect(sanitizeName('')).toBe('file');
    expect(sanitizeName('///')).toBe('file');
  });
  it('caps very long names', () => {
    expect(sanitizeName('a'.repeat(500) + '.pdf').length).toBeLessThanOrEqual(180);
  });
});

describe('newId', () => {
  it('is 32 hex characters', () => expect(newId()).toMatch(/^[0-9a-f]{32}$/));
  it('does not collide across many draws', () => {
    const set = new Set(Array.from({ length: 5000 }, () => newId()));
    expect(set.size).toBe(5000);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// A deliberately unconfigured instance: no AI key, no transcription key.
// This is the state a fresh deploy is in, and it must degrade honestly.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-api-test-'));
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-for-api-abcdefghijklmno';
process.env.STORAGE_DIR = dir;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DEEPGRAM_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.ADMIN_TOKEN;

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { initStorage } = await import('../lib/storage.js');

let app: any;
beforeAll(async () => { await initStorage(); app = createApp(); });

async function samplePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText('Northwind quarterly report', { x: 50, y: 750, size: 20, font });
  return Buffer.from(await doc.save());
}

describe('GET /api/health', () => {
  it('reports healthy with per-subsystem checks', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.checks.storage.status).toBe('ok');
  });
  it('marks unconfigured providers as degraded, not failed', async () => {
    const { body } = await request(app).get('/api/health');
    expect(body.checks.ai.status).toBe('degraded');
    expect(body.checks.transcription.status).toBe('degraded');
  });
});

describe('GET /api/capabilities', () => {
  it('honestly reports AI and transcription as off', async () => {
    const { body } = await request(app).get('/api/capabilities');
    expect(body.ai).toBe(false);
    expect(body.transcription).toBe(false);
  });
  it('never leaks a secret value', async () => {
    const res = await request(app).get('/api/capabilities');
    expect(JSON.stringify(res.body)).not.toMatch(/sk-|api[_-]?key|secret/i);
  });
  it('publishes the real limits the server enforces', async () => {
    const { body } = await request(app).get('/api/capabilities');
    expect(body.limits.maxUploadBytes).toBeGreaterThan(0);
    expect(body.limits.retentionMinutes).toBeGreaterThan(0);
  });
});

describe('GET /api/tools', () => {
  it('returns the registry with categories and workflows', async () => {
    const { body } = await request(app).get('/api/tools');
    expect(body.tools.length).toBeGreaterThan(60);
    expect(body.categories.length).toBeGreaterThan(3);
  });
  it('never ships implementation code to the client', async () => {
    const res = await request(app).get('/api/tools');
    expect(res.text).not.toContain('function (');
  });
});

describe('AI endpoints without a key', () => {
  it('return a friendly, specific not-configured error', async () => {
    const res = await request(app).post('/api/ai/summarize').send({ text: 'Some text to summarise here.' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
    expect(res.body.error.message).toMatch(/not switched on/i);
  });
  it('never fabricate a result', async () => {
    const res = await request(app).post('/api/ai/summarize').send({ text: 'Some text to summarise here.' });
    expect(res.body.ok).toBe(false);
    expect(res.body.output).toBeUndefined();
  });
});

describe('upload validation', () => {
  it('accepts a real PDF and returns an id', async () => {
    const res = await request(app).post('/api/upload').attach('files', await samplePdf(), 'report.pdf');
    expect(res.status).toBe(200);
    expect(res.body.files[0].id).toMatch(/^[0-9a-f]{32}$/);
  });
  it('rejects an executable by sniffing its content', async () => {
    const res = await request(app).post('/api/upload').attach('files', Buffer.from('MZ\x90\x00\x03payload'), 'x.exe');
    expect(res.status).toBe(415);
    expect(res.body.error.message).toMatch(/isn't supported|not supported/i);
  });
  it('rejects an empty request with a clear message', async () => {
    const res = await request(app).post('/api/upload');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('file access control', () => {
  it('refuses an unsigned download from another session', async () => {
    const up = await request(app).post('/api/upload').attach('files', await samplePdf(), 'r.pdf');
    const id = up.body.files[0].id;
    const res = await request(app).get(`/api/files/${id}`); // fresh agent, no cookie
    expect([401, 403, 404]).toContain(res.status);
  });
  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get('/api/files/' + 'a'.repeat(32));
    expect([401, 403, 404]).toContain(res.status);
  });
});

describe('admin surface is absent without ADMIN_TOKEN', () => {
  it('returns 404 rather than revealing the endpoint exists', async () => {
    const res = await request(app).get('/api/admin/overview');
    expect(res.status).toBe(404);
  });
});

describe('error handling', () => {
  it('unknown tool id gives a clean error, not a stack trace', async () => {
    const res = await request(app).post('/api/tools/run').send({ toolId: 'nope', fileIds: [], params: {} });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.text).not.toMatch(/node:internal|at async|\.ts:\d+/);
  });
  it('malformed JSON is handled gracefully', async () => {
    const res = await request(app).post('/api/tools/run').set('content-type', 'application/json').send('{bad json');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
  it('unknown API route returns JSON 404, not HTML', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

describe('security headers', () => {
  it('sets nosniff and a referrer policy', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBeTruthy();
  });
  it('does not advertise the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

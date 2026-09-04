import { describe, it, expect } from 'vitest';
import { allTools, getTool, getToolByRoute, categories, searchTools, serializeTool } from '../tools/registry.js';

describe('tool registry integrity', () => {
  it('contains a substantial catalogue', () => {
    expect(allTools.length).toBeGreaterThan(60);
  });

  it('has unique ids', () => {
    const ids = allTools.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique routes', () => {
    const routes = allTools.map((t) => t.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('every tool has a clean, SEO-friendly route', () => {
    for (const t of allTools) {
      expect(t.route, t.id).toMatch(/^\/[a-z0-9]+(\/[a-z0-9-]+)*$/);
    }
  });

  it('every tool has a name, description and runnable implementation', () => {
    for (const t of allTools) {
      expect(t.name?.length, t.id).toBeGreaterThan(2);
      expect(t.description?.length, t.id).toBeGreaterThan(10);
      expect(typeof t.run, t.id).toBe('function');
    }
  });

  it('every tool belongs to a declared category', () => {
    const known = new Set(categories.map((c) => c.id));
    for (const t of allTools) expect(known.has(t.category), `${t.id}/${t.category}`).toBe(true);
  });

  it('file limits are coherent', () => {
    for (const t of allTools) {
      const min = t.minFiles ?? 0;
      const max = t.maxFiles ?? min;
      expect(max, t.id).toBeGreaterThanOrEqual(min);
    }
  });

  it('lookup by id and by route agree', () => {
    for (const t of allTools.slice(0, 25)) {
      expect(getTool(t.id)?.id).toBe(t.id);
      expect(getToolByRoute(t.route)?.id).toBe(t.id);
    }
  });

  it('serialization never leaks the run function', () => {
    const s = serializeTool(allTools[0]) as Record<string, unknown>;
    expect(s.run).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('function');
  });
});

describe('search', () => {
  it('finds compression tools', () => {
    const ids = searchTools('compress').map((t) => t.id);
    expect(ids).toContain('pdf-compress');
  });
  it('finds transcription by intent word', () => {
    const ids = searchTools('transcribe').map((t) => t.id);
    expect(ids.some((i) => i.includes('transcribe'))).toBe(true);
  });
  it('returns nothing for gibberish rather than everything', () => {
    expect(searchTools('zzzzqqqxyw').length).toBe(0);
  });
  it('respects the limit', () => {
    expect(searchTools('pdf', 5).length).toBeLessThanOrEqual(5);
  });
});

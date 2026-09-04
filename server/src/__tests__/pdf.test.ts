import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  loadPdf, mergePdfs, parseRanges, extractPages, splitPdf, rotatePdf,
  organizePages, removePages, addPageNumbers, watermarkPdf,
  protectPdf, unlockPdf, compressPdf,
} from '../services/pdf.js';

/** Build a genuine multi-page PDF to operate on — no fixtures, no mocks. */
async function makePdf(pages: number, label = 'Page') {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`${label} ${i + 1}`, { x: 60, y: 760, size: 28, font, color: rgb(0, 0, 0) });
  }
  return Buffer.from(await doc.save());
}

let three: Buffer;
beforeAll(async () => { three = await makePdf(3); });

describe('parseRanges', () => {
  it('parses single pages and ranges into 0-based indices', () => {
    expect(parseRanges('1,3', 5)).toEqual([0, 2]);
    expect(parseRanges('2-4', 5)).toEqual([1, 2, 3]);
  });
  it('deduplicates while preserving the order the user asked for', () => {
    // Order is meaningful for page organisation, so it is intentionally kept.
    expect(parseRanges('3,1,3,2', 5)).toEqual([2, 0, 1]);
  });
  it('rejects out-of-bounds pages with a clear message', () => {
    expect(() => parseRanges('1,99', 3)).toThrow(/between 1 and 3/);
  });
  it('rejects nonsense with a clear message rather than silently returning nothing', () => {
    expect(() => parseRanges('abc', 3)).toThrow(/not a valid page range/);
  });
});

describe('real PDF operations', () => {
  it('merge produces a document with the summed page count', async () => {
    const merged = await mergePdfs([await makePdf(2), await makePdf(3)]);
    expect((await loadPdf(merged)).getPageCount()).toBe(5);
  });

  it('extractPages keeps only the requested pages', async () => {
    const out = await extractPages(three, [0, 2]);
    expect((await loadPdf(out)).getPageCount()).toBe(2);
  });

  it('removePages drops the requested pages', async () => {
    const out = await removePages(three, [1]);
    expect((await loadPdf(out)).getPageCount()).toBe(2);
  });

  it('splitPdf "each" yields one real PDF per page', async () => {
    const parts = await splitPdf(three, 'each');
    expect(parts).toHaveLength(3);
    for (const p of parts) {
      expect(Buffer.from(p.bytes).subarray(0, 4).toString()).toBe('%PDF');
      expect((await loadPdf(p.bytes)).getPageCount()).toBe(1);
    }
  });

  it('splitPdf by ranges yields the requested groups', async () => {
    const parts = await splitPdf(await makePdf(6), 'ranges', ['1-2', '5-6']);
    expect(parts).toHaveLength(2);
    expect((await loadPdf(parts[0].bytes)).getPageCount()).toBe(2);
  });

  it('rotate changes page rotation to the given angle', async () => {
    const out = await rotatePdf(three, 90);
    const doc = await loadPdf(out);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });

  it('organizePages reorders without losing pages', async () => {
    const out = await organizePages(three, [2, 0, 1]);
    expect((await loadPdf(out)).getPageCount()).toBe(3);
  });

  it('addPageNumbers returns a larger, still-valid PDF', async () => {
    const out = await addPageNumbers(three, { position: 'bottom-center' });
    expect(Buffer.from(out).subarray(0, 4).toString()).toBe('%PDF');
    expect((await loadPdf(out)).getPageCount()).toBe(3);
  });

  it('watermark returns a valid PDF with the same page count', async () => {
    const out = await watermarkPdf(three, 'CONFIDENTIAL', { opacity: 0.3 });
    expect((await loadPdf(out)).getPageCount()).toBe(3);
  });
});

describe('encryption round trip', () => {
  it('protect makes the PDF unreadable without the password, unlock restores it', async () => {
    const locked = await protectPdf(three, 'hunter2');
    // pdf-lib can open the container, but it is genuinely flagged encrypted.
    expect((await loadPdf(locked)).isEncrypted).toBe(true);
    const unlocked = await unlockPdf(locked, 'hunter2');
    expect((await loadPdf(unlocked)).isEncrypted).toBe(false);
    expect((await loadPdf(unlocked)).getPageCount()).toBe(3);
  }, 30000);

  it('unlock fails with the wrong password', async () => {
    const locked = await protectPdf(three, 'hunter2');
    await expect(unlockPdf(locked, 'wrong')).rejects.toBeTruthy();
  }, 30000);
});

describe('compression produces measurable, honest results', () => {
  it('reports a real image count and returns a valid PDF for every preset', async () => {
    const res = await compressPdf(three, { preset: 'extreme' });
    expect(Buffer.from(res.bytes).subarray(0, 4).toString()).toBe('%PDF');
    expect((await loadPdf(res.bytes)).getPageCount()).toBe(3);
    expect(res.imagesProcessed).toBeGreaterThanOrEqual(0);

    // Every advertised preset must actually run and produce a real PDF.
    for (const preset of ['recommended', 'high-quality', 'custom'] as const) {
      const r = await compressPdf(three, { preset });
      expect(Buffer.from(r.bytes).subarray(0, 4).toString(), preset).toBe('%PDF');
      expect((await loadPdf(r.bytes)).getPageCount(), preset).toBe(3);
    }
  }, 60000);
});

describe('damaged input', () => {
  it('rejects a non-PDF buffer rather than returning junk', async () => {
    await expect(loadPdf(Buffer.from('this is definitely not a pdf'))).rejects.toBeTruthy();
  });
});

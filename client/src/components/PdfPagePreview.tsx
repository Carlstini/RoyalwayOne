import { useEffect, useRef, useState } from 'react';
import type { UploadedFile } from '../lib/api';

export interface PdfPage {
  index: number;
  image: string;
  pixelWidth: number;
  pixelHeight: number;
  pointWidth: number;
  pointHeight: number;
}

/** Loads rasterised page previews plus the true PDF point size for coordinate mapping. */
export function usePdfPages(file: UploadedFile | null, limit = 10) {
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) { setPages([]); setPageCount(0); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/files/${file.id}/pages?limit=${limit}`, { credentials: 'same-origin' })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error?.message ?? 'We could not open that PDF.');
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        setPages(body.pages);
        setPageCount(body.pageCount);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [file?.id, limit]);

  return { pages, pageCount, loading, error };
}

/** A page image you can draw selection rectangles on, in PDF point coordinates. */
export function PageCanvas({
  page, rects, onDraw, onSelect, mode = 'draw', activeColor = 'rgba(11,26,58,0.75)',
}: {
  page: PdfPage;
  rects: { x: number; y: number; width: number; height: number }[];
  onDraw?: (rect: { x: number; y: number; width: number; height: number }) => void;
  onSelect?: (point: { x: number; y: number }) => void;
  mode?: 'draw' | 'point';
  activeColor?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // Convert a pointer event into a 0..1 fraction of the displayed page.
  const fraction = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return {
      fx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      fy: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const finish = (d: { x0: number; y0: number; x1: number; y1: number }) => {
    const fx = Math.min(d.x0, d.x1);
    const fy = Math.min(d.y0, d.y1);
    const fw = Math.abs(d.x1 - d.x0);
    const fh = Math.abs(d.y1 - d.y0);
    if (fw < 0.01 || fh < 0.01) return;
    // PDF origin is bottom-left, the preview's is top-left.
    onDraw?.({
      x: fx * page.pointWidth,
      y: (1 - fy - fh) * page.pointHeight,
      width: fw * page.pointWidth,
      height: fh * page.pointHeight,
    });
  };

  return (
    <div
      ref={boxRef}
      className="page-canvas"
      style={{ aspectRatio: `${page.pointWidth} / ${page.pointHeight}`, cursor: mode === 'draw' ? 'crosshair' : 'copy' }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        const { fx, fy } = fraction(e);
        if (mode === 'point') {
          onSelect?.({ x: fx * page.pointWidth, y: (1 - fy) * page.pointHeight });
          return;
        }
        setDrag({ x0: fx, y0: fy, x1: fx, y1: fy });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const { fx, fy } = fraction(e);
        setDrag((d) => (d ? { ...d, x1: fx, y1: fy } : d));
      }}
      onPointerUp={() => { if (drag) { finish(drag); setDrag(null); } }}
      onPointerCancel={() => setDrag(null)}
    >
      <img src={page.image} alt={`Page ${page.index + 1}`} draggable={false} />
      {rects.map((r, i) => (
        <span
          key={i}
          className="page-canvas__rect"
          style={{
            left: `${(r.x / page.pointWidth) * 100}%`,
            top: `${(1 - (r.y + r.height) / page.pointHeight) * 100}%`,
            width: `${(r.width / page.pointWidth) * 100}%`,
            height: `${(r.height / page.pointHeight) * 100}%`,
            background: activeColor,
          }}
        />
      ))}
      {drag && (
        <span
          className="page-canvas__rect page-canvas__rect--live"
          style={{
            left: `${Math.min(drag.x0, drag.x1) * 100}%`,
            top: `${Math.min(drag.y0, drag.y1) * 100}%`,
            width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
            height: `${Math.abs(drag.y1 - drag.y0) * 100}%`,
          }}
        />
      )}
    </div>
  );
}

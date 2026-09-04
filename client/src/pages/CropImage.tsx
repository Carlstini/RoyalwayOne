import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, waitForJob, type UploadedFile, type ToolResult } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Dropzone } from '../components/Dropzone';
import { FileList } from '../components/FileList';
import { ResultPanel } from '../components/ResultPanel';
import { Icon } from '../components/Icon';
import { setMeta } from './ToolPage';

const RATIOS: { id: string; label: string; value: number | null }[] = [
  { id: 'free', label: 'Free', value: null },
  { id: '1:1', label: 'Square', value: 1 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
  { id: '3:2', label: '3:2', value: 3 / 2 },
  { id: '9:16', label: 'Story', value: 9 / 16 },
];

interface Rect { x: number; y: number; width: number; height: number }

export function CropImage() {
  const workspace = useWorkspace();
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [ratio, setRatio] = useState(RATIOS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ToolResult | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ fx: number; fy: number } | null>(null);
  const [live, setLive] = useState<Rect | null>(null);

  useEffect(() => {
    document.title = 'Crop an image — Royalway One';
    setMeta('description', 'Drag to crop an image to an exact area or a standard aspect ratio, then download the real cropped file.');
  }, []);

  const onFiles = useCallback(async (files: File[]) => {
    setError(null);
    try {
      const res = await api.upload([files[0]]);
      workspace.addFiles(res.files);
      setFile(res.files[0]);
      setRect(null);
      setResult(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not upload that image.');
    }
  }, [workspace]);

  const fraction = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return {
      fx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      fy: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  // Build a rect in pixel space, honouring a locked aspect ratio when one is chosen.
  const build = (a: { fx: number; fy: number }, b: { fx: number; fy: number }): Rect | null => {
    if (!natural) return null;
    let x0 = Math.min(a.fx, b.fx) * natural.w;
    let y0 = Math.min(a.fy, b.fy) * natural.h;
    let w = Math.abs(b.fx - a.fx) * natural.w;
    let h = Math.abs(b.fy - a.fy) * natural.h;
    if (ratio.value) {
      if (w / h > ratio.value) w = h * ratio.value; else h = w / ratio.value;
      if (x0 + w > natural.w) w = natural.w - x0;
      if (y0 + h > natural.h) h = natural.h - y0;
    }
    if (w < 8 || h < 8) return null;
    return { x: Math.round(x0), y: Math.round(y0), width: Math.round(w), height: Math.round(h) };
  };

  const apply = async () => {
    if (!file || !rect) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.runTool('image-crop', [file.id], { crop: rect });
      let out: ToolResult | undefined = res.result;
      if (res.mode === 'job' && res.job) out = (await waitForJob(res.job.id, () => {})).result;
      setResult(out ?? null);
      workspace.markToolUsed('image-crop');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not crop that image.');
    } finally {
      setBusy(false);
    }
  };

  const shown = live ?? rect;

  return (
    <div className="page">
      <h1>Crop an image</h1>
      <p className="muted">Drag over the part you want to keep, or lock it to a standard shape.</p>

      <div className="stack" style={{ marginTop: 22, gap: 18 }}>
        {!file && <Dropzone accept={['image/*']} multiple={false} onFiles={onFiles} title="Drop an image here" hint="JPG, PNG, WebP, AVIF, TIFF and more" />}
        {file && <FileList files={[file]} onRemove={() => { setFile(null); setRect(null); setResult(null); }} />}

        {file && (
          <div className="tool-layout">
            <div className="card">
              <div
                ref={boxRef}
                className="page-canvas"
                style={{ cursor: 'crosshair', touchAction: 'none' }}
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  drag.current = fraction(e);
                }}
                onPointerMove={(e) => {
                  if (!drag.current) return;
                  setLive(build(drag.current, fraction(e)));
                }}
                onPointerUp={(e) => {
                  if (drag.current) {
                    const r = build(drag.current, fraction(e));
                    if (r) setRect(r);
                  }
                  drag.current = null;
                  setLive(null);
                }}
              >
                <img
                  src={`${file.url}&download=0`}
                  alt={file.name}
                  draggable={false}
                  onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                />
                {shown && natural && (
                  <>
                    <span className="page-canvas__shade" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${(shown.x / natural.w) * 100}% ${(shown.y / natural.h) * 100}%, ${(shown.x / natural.w) * 100}% ${((shown.y + shown.height) / natural.h) * 100}%, ${((shown.x + shown.width) / natural.w) * 100}% ${((shown.y + shown.height) / natural.h) * 100}%, ${((shown.x + shown.width) / natural.w) * 100}% ${(shown.y / natural.h) * 100}%, ${(shown.x / natural.w) * 100}% ${(shown.y / natural.h) * 100}%)` }} />
                    <span
                      className="page-canvas__rect page-canvas__rect--live"
                      style={{
                        left: `${(shown.x / natural.w) * 100}%`,
                        top: `${(shown.y / natural.h) * 100}%`,
                        width: `${(shown.width / natural.w) * 100}%`,
                        height: `${(shown.height / natural.h) * 100}%`,
                      }}
                    />
                  </>
                )}
              </div>
            </div>

            <aside className="stack sticky-panel">
              <div className="card">
                <h3>Shape</h3>
                <div className="chips">
                  {RATIOS.map((r) => (
                    <button key={r.id} className={`chip${ratio.id === r.id ? ' chip--active' : ''}`} onClick={() => setRatio(r)}>{r.label}</button>
                  ))}
                </div>
              </div>

              <div className="card">
                <h3>Selection</h3>
                {natural && <div className="tiny muted">Original {natural.w} × {natural.h} px</div>}
                {rect ? (
                  <div className="small" style={{ marginTop: 8 }}>
                    <div><strong>{rect.width} × {rect.height} px</strong></div>
                    <div className="muted">from {rect.x}, {rect.y}</div>
                    <button className="btn btn--sm" style={{ marginTop: 10 }} onClick={() => setRect(null)}>Clear</button>
                  </div>
                ) : <p className="small muted" style={{ marginBottom: 0 }}>Drag over the image to select an area.</p>}
              </div>

              {error && <div className="banner banner--error" role="alert"><Icon name="info" size={18} /> {error}</div>}
              <button className="btn btn--primary" onClick={apply} disabled={!rect || busy}>{busy ? 'Cropping…' : 'Crop and download'}</button>
            </aside>
          </div>
        )}

        {result && <ResultPanel result={result} onReset={() => { setResult(null); setRect(null); }} />}
      </div>
    </div>
  );
}

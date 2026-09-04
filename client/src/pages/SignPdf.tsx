import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, waitForJob, type UploadedFile, type ToolResult } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Dropzone } from '../components/Dropzone';
import { FileList } from '../components/FileList';
import { SignaturePad } from '../components/SignaturePad';
import { usePdfPages, PageCanvas } from '../components/PdfPagePreview';
import { ResultPanel } from '../components/ResultPanel';
import { Icon } from '../components/Icon';
import { setMeta } from './ToolPage';

interface Placement { page: number; x: number; y: number; width: number; height: number }

export function SignPdf() {
  const workspace = useWorkspace();
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [width, setWidth] = useState(180);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ToolResult | null>(null);
  const { pages, pageCount, loading, error: pageError } = usePdfPages(file);

  useEffect(() => {
    document.title = 'Sign a PDF — Royalway One';
    setMeta('description', 'Draw or type your signature, place it exactly where it belongs and download a signed PDF.');
  }, []);

  const onFiles = useCallback(async (files: File[]) => {
    setError(null);
    try {
      const res = await api.upload([files[0]]);
      workspace.addFiles(res.files);
      setFile(res.files[0]);
      setResult(null);
      setPlacement(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not upload that PDF.');
    }
  }, [workspace]);

  const height = Math.round(width * 0.36);

  const apply = async () => {
    if (!file || !signature || !placement) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.runTool('pdf-sign', [file.id], {
        signature: { ...placement, imageBase64: signature },
      });
      let out: ToolResult | undefined = res.result;
      if (res.mode === 'job' && res.job) out = (await waitForJob(res.job.id, () => {})).result;
      setResult(out ?? null);
      workspace.markToolUsed('pdf-sign');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not sign that PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>Sign a PDF</h1>
      <p className="muted">Draw or type your signature, then click the page where it should go.</p>

      <div className="stack" style={{ marginTop: 22, gap: 18 }}>
        {!file && <Dropzone accept={['application/pdf', '.pdf']} multiple={false} onFiles={onFiles} title="Drop the PDF you want to sign" hint="Your file is deleted automatically afterwards" />}
        {file && <FileList files={[file]} onRemove={() => { setFile(null); setResult(null); setPlacement(null); }} />}

        {file && (
          <div className="tool-layout">
            <div className="stack">
              <div className="card">
                <h3>1. Your signature</h3>
                <SignaturePad onChange={(d) => { setSignature(d); }} />
              </div>

              <div className="card">
                <div className="row row--between">
                  <h3 style={{ margin: 0 }}>2. Place it on the page</h3>
                  {placement && <span className="pill">Page {placement.page + 1}</span>}
                </div>
                {!signature && <p className="small muted">Add a signature first, then click where it belongs.</p>}
                {pageError && <div className="banner banner--error">{pageError}</div>}
                {loading && <p className="muted small">Opening your PDF…</p>}
                <div className="stack" style={{ gap: 14, marginTop: 10 }}>
                  {pages.map((p) => (
                    <div key={p.index}>
                      <div className="tiny muted" style={{ marginBottom: 4 }}>Page {p.index + 1} of {pageCount}</div>
                      <PageCanvas
                        page={p}
                        mode="point"
                        rects={placement?.page === p.index ? [placement] : []}
                        activeColor="rgba(176,138,74,0.45)"
                        onSelect={(pt) => {
                          if (!signature) { setError('Draw or type your signature first.'); return; }
                          setError(null);
                          setPlacement({ page: p.index, x: Math.max(0, pt.x - width / 2), y: Math.max(0, pt.y - height / 2), width, height });
                        }}
                      />
                    </div>
                  ))}
                </div>
                {pageCount > pages.length && <p className="tiny muted">Showing the first {pages.length} pages.</p>}
              </div>
            </div>

            <aside className="stack sticky-panel">
              <div className="card">
                <h3>Size</h3>
                <input
                  type="range" min={80} max={320} value={width} aria-label="Signature width"
                  onChange={(e) => {
                    const w = Number(e.target.value);
                    setWidth(w);
                    setPlacement((p) => (p ? { ...p, width: w, height: Math.round(w * 0.36) } : p));
                  }}
                />
                <div className="tiny muted">{width} × {height} points</div>
              </div>
              {error && <div className="banner banner--error" role="alert"><Icon name="info" size={18} /> {error}</div>}
              <button className="btn btn--primary" onClick={apply} disabled={!signature || !placement || busy}>
                {busy ? 'Signing…' : 'Sign and download'}
              </button>
              {!placement && signature && <p className="tiny muted">Click the page to position your signature.</p>}
            </aside>
          </div>
        )}

        {result && <ResultPanel result={result} onReset={() => { setResult(null); setPlacement(null); }} />}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, waitForJob, type UploadedFile, type ToolResult } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Dropzone } from '../components/Dropzone';
import { FileList } from '../components/FileList';
import { usePdfPages, PageCanvas } from '../components/PdfPagePreview';
import { ResultPanel } from '../components/ResultPanel';
import { Icon } from '../components/Icon';
import { setMeta } from './ToolPage';

interface Area { page: number; x: number; y: number; width: number; height: number }

export function RedactPdf() {
  const workspace = useWorkspace();
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ToolResult | null>(null);
  const { pages, pageCount, loading, error: pageError } = usePdfPages(file);

  useEffect(() => {
    document.title = 'Redact a PDF — Royalway One';
    setMeta('description', 'Drag over anything sensitive and we permanently destroy the text underneath — not just cover it up.');
  }, []);

  const onFiles = useCallback(async (files: File[]) => {
    setError(null);
    try {
      const res = await api.upload([files[0]]);
      workspace.addFiles(res.files);
      setFile(res.files[0]);
      setAreas([]);
      setResult(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not upload that PDF.');
    }
  }, [workspace]);

  const apply = async () => {
    if (!file || !areas.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.runTool('pdf-redact', [file.id], { areas });
      let out: ToolResult | undefined = res.result;
      if (res.mode === 'job' && res.job) out = (await waitForJob(res.job.id, (s) => setStage(s))).result;
      setResult(out ?? null);
      workspace.markToolUsed('pdf-redact');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not redact that PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>Redact a PDF</h1>
      <p className="muted">Drag a box over anything sensitive. The text underneath is destroyed, so it cannot be copied or searched afterwards.</p>

      <div className="stack" style={{ marginTop: 22, gap: 18 }}>
        {!file && <Dropzone accept={['application/pdf', '.pdf']} multiple={false} onFiles={onFiles} title="Drop the PDF you want to redact" hint="Your file is deleted automatically afterwards" />}
        {file && <FileList files={[file]} onRemove={() => { setFile(null); setAreas([]); setResult(null); }} />}

        {file && (
          <div className="tool-layout">
            <div className="card">
              {pageError && <div className="banner banner--error">{pageError}</div>}
              {loading && <p className="muted small">Opening your PDF…</p>}
              <div className="stack" style={{ gap: 14 }}>
                {pages.map((p) => (
                  <div key={p.index}>
                    <div className="tiny muted" style={{ marginBottom: 4 }}>Page {p.index + 1} of {pageCount}</div>
                    <PageCanvas
                      page={p}
                      mode="draw"
                      rects={areas.filter((a) => a.page === p.index)}
                      activeColor="rgba(0,0,0,0.82)"
                      onDraw={(r) => setAreas((prev) => [...prev, { page: p.index, ...r }])}
                    />
                  </div>
                ))}
              </div>
              {pageCount > pages.length && <p className="tiny muted">Showing the first {pages.length} pages.</p>}
            </div>

            <aside className="stack sticky-panel">
              <div className="card">
                <div className="row row--between">
                  <h3 style={{ margin: 0 }}>Areas</h3>
                  <span className="pill">{areas.length}</span>
                </div>
                {!areas.length && <p className="small muted" style={{ marginBottom: 0 }}>Drag over the page to mark something for removal.</p>}
                {areas.map((a, i) => (
                  <div className="row row--between small" key={i} style={{ padding: '4px 0' }}>
                    <span>Page {a.page + 1} · {Math.round(a.width)}×{Math.round(a.height)}</span>
                    <button className="btn btn--sm btn--ghost" onClick={() => setAreas((prev) => prev.filter((_, ix) => ix !== i))} aria-label={`Remove area ${i + 1}`}>
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ))}
                {areas.length > 0 && <button className="btn btn--sm" style={{ marginTop: 8 }} onClick={() => setAreas([])}>Clear all</button>}
              </div>

              {busy && <div className="processing"><div className="spinner" /><div><strong>{stage || 'Redacting'}</strong><div className="tiny muted">Rebuilding each affected page.</div></div></div>}
              {error && <div className="banner banner--error" role="alert"><Icon name="info" size={18} /> {error}</div>}

              <button className="btn btn--primary" onClick={apply} disabled={!areas.length || busy}>
                {busy ? 'Redacting…' : 'Redact and download'}
              </button>
              <p className="tiny muted">Redacted pages are flattened to an image, which permanently removes the hidden text.</p>
            </aside>
          </div>
        )}

        {result && <ResultPanel result={result} onReset={() => { setResult(null); setAreas([]); }} />}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, waitForJob, type UploadedFile } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Dropzone } from '../components/Dropzone';
import { FileList } from '../components/FileList';
import { Markdown } from '../components/Markdown';
import { StatGrid } from '../components/ResultPanel';
import { Icon } from '../components/Icon';
import { setMeta } from './ToolPage';

interface Diff { added: string[]; removed: string[]; summary: Record<string, number> }

export function ComparePage() {
  const workspace = useWorkspace();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);

  useEffect(() => {
    document.title = 'Compare documents — Royalway One';
    setMeta('description', 'See exactly what changed between two versions of a document: additions, removals, changed dates, figures and clauses.');
  }, []);

  const onFiles = useCallback(async (incoming: File[]) => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.upload(incoming.slice(0, 2 - files.length));
      workspace.addFiles(res.files);
      setFiles((prev) => [...prev, ...res.files].slice(0, 2));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not upload that document.');
    } finally {
      setBusy(false);
    }
  }, [files.length, workspace]);

  const compare = async () => {
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      const res = await api.runTool('ai-compare', files.map((f) => f.id), {});
      let result = res.result;
      if (res.mode === 'job' && res.job) {
        result = (await waitForJob(res.job.id, () => {})).result;
      }
      setOutput(result?.text ?? null);
      setDiff((result?.data as any)?.diff ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not compare those documents.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>Compare documents</h1>
      <p className="muted">Upload two versions and we will show you what actually changed.</p>

      <div className="stack" style={{ marginTop: 24, gap: 18 }}>
        {files.length < 2 && (
          <Dropzone
            accept={['application/pdf', '.pdf', '.docx', '.txt', '.md']}
            multiple
            disabled={busy}
            title={files.length === 0 ? 'Drop the first document' : 'Drop the second document'}
            hint="PDF, Word or text — two documents in total"
            onFiles={onFiles}
          />
        )}
        <FileList files={files} onRemove={(id) => setFiles((p) => p.filter((f) => f.id !== id))} onReorder={setFiles} />

        {error && <div className="banner banner--error" role="alert"><Icon name="info" size={18} /> {error}</div>}

        {busy && files.length === 2 && (
          <div className="processing"><div className="spinner" /><div><strong>Comparing your documents</strong><div className="tiny muted">Reading both versions and identifying the real differences.</div></div></div>
        )}

        <div>
          <button className="btn btn--primary" onClick={compare} disabled={files.length !== 2 || busy || !workspace.capabilities.ai}>
            {busy ? 'Comparing…' : 'Compare documents'}
          </button>
        </div>

        {!workspace.capabilities.ai && (
          <div className="banner banner--warn"><Icon name="info" size={18} /> Document comparison needs AI, which is not switched on for this deployment yet.</div>
        )}

        {diff && (
          <div className="card">
            <h3>Measured differences</h3>
            <StatGrid stats={diff.summary} />
            <div className="split" style={{ marginTop: 16 }}>
              <div>
                <h4 style={{ color: 'var(--danger)' }}>Removed ({diff.removed.length})</h4>
                <ul className="small" style={{ paddingLeft: '1.1em', maxHeight: 280, overflow: 'auto' }}>
                  {diff.removed.slice(0, 60).map((l, i) => <li key={i}>{l}</li>)}
                  {!diff.removed.length && <li className="muted">Nothing removed.</li>}
                </ul>
              </div>
              <div>
                <h4 style={{ color: 'var(--success)' }}>Added ({diff.added.length})</h4>
                <ul className="small" style={{ paddingLeft: '1.1em', maxHeight: 280, overflow: 'auto' }}>
                  {diff.added.slice(0, 60).map((l, i) => <li key={i}>{l}</li>)}
                  {!diff.added.length && <li className="muted">Nothing added.</li>}
                </ul>
              </div>
            </div>
          </div>
        )}

        {output && (
          <div className="card">
            <h3>What changed</h3>
            <Markdown text={output} />
          </div>
        )}
      </div>
    </div>
  );
}

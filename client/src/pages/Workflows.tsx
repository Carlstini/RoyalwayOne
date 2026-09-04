import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, waitForJob, formatBytes, type UploadedFile, type Workflow } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Dropzone } from '../components/Dropzone';
import { FileList } from '../components/FileList';
import { Markdown } from '../components/Markdown';
import { Icon } from '../components/Icon';
import { matchesAccept } from '../components/ToolRunner';
import { setMeta } from './ToolPage';

interface StepResult {
  toolId: string; label: string; status: 'succeeded' | 'skipped' | 'failed';
  outputs?: { fileId: string; name: string; size: number; downloadUrl: string; mime: string }[];
  text?: string; error?: string;
}

export function WorkflowsPage() {
  const workspace = useWorkspace();
  const [active, setActive] = useState<Workflow | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle');
  const [stage, setStage] = useState('');
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Workflows — Royalway One';
    setMeta('description', 'Chain Royalway One tools into one click: recording to transcript to summary to minutes to follow-up email.');
  }, []);

  const onFiles = useCallback(async (incoming: File[]) => {
    if (!active) return;
    const ok = incoming.filter((f) => matchesAccept({ name: f.name, mime: f.type }, active.accept));
    if (!ok.length) { setError('That file type does not fit this workflow.'); return; }
    setError(null);
    try {
      const res = await api.upload(ok.slice(0, active.maxFiles));
      workspace.addFiles(res.files);
      setFiles(res.files);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not upload that file.');
    }
  }, [active, workspace]);

  const run = async () => {
    if (!active) return;
    setPhase('busy');
    setSteps([]);
    setError(null);
    try {
      const { job } = await api.runWorkflow(active.id, files.map((f) => f.id));
      const finished = await waitForJob(job.id, (s) => setStage(s));
      setSteps(((finished.result as any)?.steps ?? []) as StepResult[]);
      setPhase('done');
    } catch (err) {
      setPhase('idle');
      setError(err instanceof ApiError ? err.message : 'The workflow could not be completed.');
    }
  };

  if (!active) {
    return (
      <div className="page">
        <h1>Workflows</h1>
        <p className="muted">Chain several tools together and get every output in one go.</p>
        <div className="tool-grid" style={{ marginTop: 24 }}>
          {workspace.workflows.map((w) => (
            <button key={w.id} className="tool-card" onClick={() => { setActive(w); setFiles([]); setSteps([]); setPhase('idle'); api.event('workflow_opened', { workflow: w.id }); }}>
              <span className="tool-card__icon"><Icon name={w.icon} size={19} /></span>
              <span style={{ minWidth: 0 }}>
                <span className="tool-card__name" style={{ display: 'block' }}>{w.name}</span>
                <span className="tool-card__desc">{w.description}</span>
                {!w.available && <span className="tool-card__badge">Needs setup</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <button className="btn btn--sm btn--ghost" onClick={() => setActive(null)} style={{ marginBottom: 16 }}>← All workflows</button>
      <h1>{active.name}</h1>
      <p className="muted">{active.description}</p>

      <ol className="small muted" style={{ paddingLeft: '1.2em' }}>
        {active.steps.map((s) => <li key={s.toolId}>{s.label}</li>)}
      </ol>

      <div className="stack" style={{ marginTop: 22, gap: 18 }}>
        {!files.length && <Dropzone accept={active.accept} multiple={active.maxFiles > 1} onFiles={onFiles} title="Drop your file to start the workflow" hint="Every step runs automatically" />}
        <FileList files={files} onRemove={(id) => setFiles((p) => p.filter((f) => f.id !== id))} />

        {error && <div className="banner banner--error" role="alert"><Icon name="info" size={18} /> {error}</div>}

        {phase === 'busy' && (
          <div className="processing" role="status" aria-live="polite">
            <div className="spinner" />
            <div className="grow">
              <strong>{stage || 'Working through the steps'}</strong>
              <div className="progress-bar" style={{ marginTop: 6 }}><div className="progress-bar__fill" /></div>
            </div>
          </div>
        )}

        {phase !== 'done' && (
          <div>
            <button className="btn btn--primary" onClick={run} disabled={files.length < active.minFiles || phase === 'busy' || !active.available}>
              {phase === 'busy' ? 'Running…' : `Run ${active.name}`}
            </button>
          </div>
        )}

        {!active.available && <div className="banner banner--warn"><Icon name="info" size={18} /> This workflow needs a provider that is not switched on for this deployment yet.</div>}

        {steps.map((step, i) => (
          <div className="card" key={i}>
            <div className="row row--between" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>{i + 1}. {step.label}</h3>
              <span className="pill" style={step.status === 'failed' ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : step.status === 'skipped' ? undefined : { background: 'var(--success-soft)', color: 'var(--success)' }}>
                {step.status}
              </span>
            </div>
            {step.error && <p className="small muted" style={{ margin: 0 }}>{step.error}</p>}
            {step.outputs?.map((o) => (
              <div className="file-row" key={o.fileId} style={{ marginTop: 8 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="file-row__name">{o.name}</div>
                  <div className="file-row__meta">{formatBytes(o.size)}</div>
                </div>
                <a className="btn btn--sm btn--primary" href={o.downloadUrl} download={o.name}><Icon name="download" size={15} /> Download</a>
              </div>
            ))}
            {step.text && <div style={{ marginTop: 10 }}><Markdown text={step.text} /></div>}
          </div>
        ))}

        {phase === 'done' && (
          <button className="btn" onClick={() => { setFiles([]); setSteps([]); setPhase('idle'); }}><Icon name="refresh" size={15} /> Run it again</button>
        )}
      </div>
    </div>
  );
}

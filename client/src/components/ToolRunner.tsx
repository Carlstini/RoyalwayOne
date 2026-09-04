import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, waitForJob, type Tool, type ToolResult, type UploadedFile } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Dropzone } from './Dropzone';
import { FileList } from './FileList';
import { ToolFields, defaultValues } from './ToolFields';
import { ResultPanel } from './ResultPanel';
import { Icon } from './Icon';
import { useToast } from './Toast';

type Phase = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

interface Props {
  tool: Tool;
  /** Extra params merged into every run (used by canvas-based tools such as crop). */
  extraParams?: Record<string, unknown>;
  /** Custom UI rendered above the options, e.g. a page picker or recorder. */
  children?: (state: { files: UploadedFile[]; setParam: (k: string, v: any) => void; params: Record<string, any> }) => ReactNode;
  onResult?: (result: ToolResult) => void;
  nextActions?: (result: ToolResult) => { label: string; to?: string; onClick?: () => void }[];
  submitLabel?: string;
  hideFileInput?: boolean;
}

const STAGE_COPY: Record<string, string> = {
  queued: 'Waiting for a free slot',
  processing: 'Processing',
  compressing: 'Compressing',
  converting: 'Converting',
  merging: 'Merging',
  splitting: 'Splitting',
  transcribing: 'Transcribing',
  analysing: 'Analysing',
  preparing: 'Preparing',
  'preparing audio': 'Preparing audio',
  'recognising text': 'Recognising text',
  rendering: 'Rendering',
  'fetching media': 'Fetching media',
  downloading: 'Downloading',
  done: 'Finishing up',
};

export function ToolRunner({ tool, extraParams, children, onResult, nextActions, submitLabel, hideFileInput }: Props) {
  const workspace = useWorkspace();
  const toast = useToast();
  const [selected, setSelected] = useState<UploadedFile[]>([]);
  const [params, setParams] = useState<Record<string, any>>(() => defaultValues(tool.fields));
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState('');
  const [uploadFraction, setUploadFraction] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ToolResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setParams(defaultValues(tool.fields));
    setSelected([]);
    setResult(null);
    setError(null);
    setPhase('idle');
    api.event('tool_opened', { tool: tool.id, category: tool.category });
  }, [tool.id]);

  // Offer files already in the workspace that this tool can handle.
  const compatible = useMemo(
    () => workspace.files.filter((f) => matchesAccept(f, tool.accept)).filter((f) => !selected.some((s) => s.id === f.id)),
    [workspace.files, tool.accept, selected],
  );

  const setParam = useCallback((key: string, value: any) => setParams((prev) => ({ ...prev, [key]: value })), []);

  const handleFiles = useCallback(async (incoming: File[]) => {
    const rejected = incoming.filter((f) => !matchesAccept({ name: f.name, mime: f.type }, tool.accept));
    const accepted = incoming.filter((f) => matchesAccept({ name: f.name, mime: f.type }, tool.accept));
    if (rejected.length) toast(`${rejected.length === 1 ? `"${rejected[0].name}" is not` : 'Some files are not'} a supported type for this tool.`, 'error');
    if (!accepted.length) return;

    setPhase('uploading');
    setError(null);
    setUploadFraction(0);
    try {
      const { files } = await api.upload(accepted.slice(0, tool.maxFiles), setUploadFraction);
      workspace.addFiles(files);
      setSelected((prev) => [...prev, ...files].slice(0, tool.maxFiles));
      setPhase('idle');
    } catch (err) {
      setPhase('error');
      setError(err instanceof ApiError ? err.message : 'We could not upload your file. Please try again.');
    }
  }, [tool.accept, tool.maxFiles, toast, workspace]);

  const run = useCallback(async () => {
    setError(null);
    setResult(null);
    setPhase('processing');
    setStage('preparing');
    abortRef.current = new AbortController();
    try {
      const merged = { ...params, ...(extraParams ?? {}) };
      const response = await api.runTool(tool.id, selected.map((f) => f.id), merged);
      let final: ToolResult;
      if (response.mode === 'job' && response.job) {
        const job = await waitForJob(response.job.id, (s) => setStage(s), abortRef.current.signal);
        final = job.result ?? {};
      } else {
        final = response.result ?? {};
      }
      setResult(final);
      setPhase('done');
      workspace.markToolUsed(tool.id);
      onResult?.(final);
    } catch (err) {
      setPhase('error');
      setError(err instanceof ApiError ? err.message : 'Something went wrong while processing your file. Please try again.');
    }
  }, [params, extraParams, tool.id, selected, workspace, onResult]);

  const reset = () => { setResult(null); setPhase('idle'); setError(null); };

  const canRun = selected.length >= tool.minFiles && (tool.minFiles > 0 || selected.length > 0 || hasTextInput(params, tool));
  const busy = phase === 'uploading' || phase === 'processing';

  if (!tool.available) {
    return (
      <div className="banner banner--warn">
        <Icon name="info" size={18} />
        <div>
          <strong>{tool.missing.includes('transcription') ? 'Transcription' : 'AI'} is not switched on for this deployment.</strong>
          <div className="small">Add the provider key described in ENVIRONMENT.md and this tool becomes available immediately. Every other tool still works.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      {tool.maxFiles > 0 && !hideFileInput && (
        <>
          {selected.length < tool.maxFiles && (
            <Dropzone
              accept={tool.accept}
              multiple={tool.maxFiles > 1}
              compact={selected.length > 0}
              disabled={busy}
              title={selected.length ? 'Add another file' : tool.minFiles > 1 ? `Drop ${tool.minFiles} or more files here` : 'Drop your file here'}
              hint={`or click to choose · up to ${tool.maxFiles} file${tool.maxFiles === 1 ? '' : 's'}`}
              onFiles={handleFiles}
            />
          )}

          {compatible.length > 0 && selected.length < tool.maxFiles && (
            <div>
              <div className="small muted" style={{ marginBottom: 8 }}>Already in your workspace</div>
              <div className="chips">
                {compatible.slice(0, 6).map((f) => (
                  <button key={f.id} className="chip" onClick={() => setSelected((prev) => [...prev, f].slice(0, tool.maxFiles))}>
                    <Icon name="plus" size={13} /> {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <FileList
            files={selected}
            onRemove={(id) => setSelected((prev) => prev.filter((f) => f.id !== id))}
            onReorder={tool.maxFiles > 1 ? setSelected : undefined}
          />
        </>
      )}

      {children?.({ files: selected, setParam, params })}

      {tool.fields.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 14 }}>Options</h3>
          <ToolFields fields={tool.fields} values={params} onChange={setParam} />
        </div>
      )}

      {phase === 'uploading' && (
        <div className="processing">
          <div className="spinner" />
          <div className="grow">
            <div><strong>Uploading</strong> {uploadFraction > 0 && `· ${Math.round(uploadFraction * 100)}%`}</div>
            <div className="progress-bar" style={{ marginTop: 6 }}>
              <div className="progress-bar__fill" style={uploadFraction > 0 ? { width: `${uploadFraction * 100}%`, animation: 'none' } : undefined} />
            </div>
          </div>
        </div>
      )}

      {phase === 'processing' && (
        <div className="processing" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="grow">
            <div><strong>{STAGE_COPY[stage] ?? capitalise(stage) ?? 'Processing'}</strong></div>
            <div className="progress-bar" style={{ marginTop: 6 }}><div className="progress-bar__fill" /></div>
            <div className="tiny muted" style={{ marginTop: 6 }}>This happens on our servers — you can keep this tab open.</div>
          </div>
        </div>
      )}

      {error && (
        <div className="banner banner--error" role="alert">
          <Icon name="info" size={18} />
          <div className="grow">{error}</div>
          <button className="btn btn--sm" onClick={run} disabled={!canRun}>Try again</button>
        </div>
      )}

      {phase !== 'done' && (
        <div className="row">
          <button className="btn btn--primary" onClick={run} disabled={!canRun || busy}>
            {busy ? 'Working…' : submitLabel ?? tool.name}
          </button>
          {selected.length > 0 && !busy && (
            <button className="btn btn--ghost" onClick={() => setSelected([])}>Clear files</button>
          )}
        </div>
      )}

      {result && phase === 'done' && (
        <ResultPanel result={result} tool={tool} onReset={reset} nextActions={nextActions?.(result)} />
      )}
    </div>
  );
}

export function matchesAccept(file: { name: string; mime: string }, accept: string[]) {
  if (!accept.length) return true;
  const name = file.name.toLowerCase();
  return accept.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule.toLowerCase());
    if (rule.endsWith('/*')) return file.mime.startsWith(rule.slice(0, -1));
    return file.mime === rule;
  });
}

function hasTextInput(params: Record<string, any>, tool: Tool) {
  return tool.fields.some((f) => (f.type === 'textarea' || f.type === 'text') && String(params[f.key] ?? '').trim().length > 0);
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : '');

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, waitForJob, type UploadedFile } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Dropzone } from '../components/Dropzone';
import { FileList } from '../components/FileList';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { TranscriptWorkspace, type TranscriptData } from '../components/TranscriptWorkspace';
import { setMeta } from './ToolPage';

const LANGUAGES = [
  ['', 'Detect automatically'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['sv', 'Swedish'], ['pl', 'Polish'],
  ['hi', 'Hindi'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['ar', 'Arabic'],
];

export function Transcribe({ mode = 'file' }: { mode?: 'file' | 'url' }) {
  const workspace = useWorkspace();
  const toast = useToast();
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [url, setUrl] = useState('');
  const [language, setLanguage] = useState('');
  const [diarize, setDiarize] = useState(true);
  const [analyse, setAnalyse] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'working' | 'done'>('idle');
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptData | null>(null);
  const [platformSupport, setPlatformSupport] = useState<boolean | null>(null);

  useEffect(() => {
    document.title = mode === 'url' ? 'Transcribe from a link — Royalway One' : 'Transcribe audio & video — Royalway One';
    setMeta('description', 'Turn recordings into accurate, timestamped transcripts you can edit, search and export as TXT, DOCX, PDF, SRT or VTT.');
    if (mode === 'url') api.capabilities().then((c) => setPlatformSupport(c.urlPlatformSupport)).catch(() => setPlatformSupport(false));
  }, [mode]);

  const onFiles = useCallback(async (files: File[]) => {
    setPhase('uploading');
    setError(null);
    try {
      const res = await api.upload([files[0]]);
      workspace.addFiles(res.files);
      setFile(res.files[0]);
      setPhase('idle');
    } catch (err) {
      setPhase('idle');
      setError(err instanceof ApiError ? err.message : 'We could not upload that recording.');
    }
  }, [workspace]);

  const start = async () => {
    setError(null);
    setTranscript(null);
    setPhase('working');
    setStage('preparing');
    try {
      const params = mode === 'url'
        ? { url: url.trim(), language, diarize, analyse }
        : { language, diarize, analyse };
      const res = await api.runTool(mode === 'url' ? 'transcribe-url' : 'transcribe-file', file ? [file.id] : [], params);
      if (!res.job) throw new ApiError('We could not start the transcription. Please try again.');
      const job = await waitForJob(res.job.id, (s) => setStage(s));
      const data = job.result?.data as TranscriptData | undefined;
      if (!data?.segments?.length) throw new ApiError('We could not find any speech in this recording.');
      setTranscript(data);
      setPhase('done');
      workspace.markToolUsed(mode === 'url' ? 'transcribe-url' : 'transcribe-file');
      toast('Your transcript is ready.', 'success');
    } catch (err) {
      setPhase('idle');
      setError(err instanceof ApiError ? err.message : 'We could not transcribe this recording. Please try again.');
    }
  };

  const canStart = mode === 'url' ? /^https?:\/\/\S+$/i.test(url.trim()) : !!file;
  const available = workspace.capabilities.transcription;

  if (transcript) {
    return (
      <div className="page">
        <button className="btn btn--sm btn--ghost" onClick={() => { setTranscript(null); setPhase('idle'); setFile(null); }} style={{ marginBottom: 16 }}>
          <Icon name="arrow" size={15} /> Transcribe something else
        </button>
        <TranscriptWorkspace
          data={transcript}
          aiAvailable={workspace.capabilities.ai}
          mediaUrl={file && file.mime.startsWith('audio/') ? `${file.url}&download=0` : undefined}
        />
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <h1>{mode === 'url' ? 'Transcribe from a link' : 'Transcribe audio or video'}</h1>
      <p className="muted">
        {mode === 'url'
          ? 'Paste a public audio or video link and we will produce a real transcript.'
          : 'Upload a recording and get an accurate, timestamped transcript you can edit, search and export.'}
      </p>

      {!available && (
        <div className="banner banner--warn" style={{ margin: '20px 0' }}>
          <Icon name="info" size={18} />
          <div>
            <strong>Transcription is not switched on for this deployment.</strong>
            <div className="small">Add a DEEPGRAM_API_KEY or OPENAI_API_KEY as described in ENVIRONMENT.md and this page starts working immediately.</div>
          </div>
        </div>
      )}

      <div className="stack" style={{ marginTop: 24, gap: 18 }}>
        {mode === 'url' ? (
          <div className="card">
            <div className="field">
              <label className="field__label" htmlFor="media-url">Media link</label>
              <input id="media-url" type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/episode.mp3" />
              <div className="field__help">
                {platformSupport
                  ? 'Direct audio and video links work, and supported public platforms are handled where permitted.'
                  : 'Direct links to audio or video files work here. For pages on video platforms, download the media first and upload the file.'}
              </div>
            </div>
          </div>
        ) : (
          <>
            {!file && (
              <Dropzone
                accept={['audio/*', 'video/*']}
                multiple={false}
                disabled={phase === 'uploading'}
                title={phase === 'uploading' ? 'Uploading…' : 'Drop a recording here'}
                hint="MP3, WAV, M4A, MP4, MOV, WebM and more"
                onFiles={onFiles}
              />
            )}
            {file && <FileList files={[file]} onRemove={() => setFile(null)} />}
          </>
        )}

        <div className="card">
          <h3 style={{ marginBottom: 14 }}>Options</h3>
          <div className="field">
            <label className="field__label" htmlFor="tr-lang">Spoken language</label>
            <select id="tr-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="toggle"><input type="checkbox" checked={diarize} onChange={(e) => setDiarize(e.target.checked)} /> <span>Identify different speakers</span></label>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="toggle">
              <input type="checkbox" checked={analyse} onChange={(e) => setAnalyse(e.target.checked)} disabled={!workspace.capabilities.ai} />
              <span>Add an AI summary and action items{!workspace.capabilities.ai ? ' (needs AI setup)' : ''}</span>
            </label>
          </div>
        </div>

        {phase === 'working' && (
          <div className="processing" role="status" aria-live="polite">
            <div className="spinner" />
            <div className="grow">
              <strong>{stageLabel(stage)}</strong>
              <div className="progress-bar" style={{ marginTop: 6 }}><div className="progress-bar__fill" /></div>
              <div className="tiny muted" style={{ marginTop: 6 }}>Longer recordings take longer — this page updates as each step finishes.</div>
            </div>
          </div>
        )}

        {error && <div className="banner banner--error" role="alert"><Icon name="info" size={18} /> {error}</div>}

        <div>
          <button className="btn btn--primary" onClick={start} disabled={!canStart || phase === 'working' || !available}>
            {phase === 'working' ? 'Transcribing…' : 'Transcribe'}
          </button>
        </div>
      </div>
    </div>
  );
}

function stageLabel(stage: string) {
  return ({
    queued: 'Waiting for a free slot',
    preparing: 'Preparing your audio',
    'preparing audio': 'Preparing your audio',
    'fetching media': 'Fetching the media',
    downloading: 'Downloading the media',
    transcribing: 'Transcribing',
    analysing: 'Analysing with AI',
    processing: 'Processing',
    done: 'Finishing up',
  } as Record<string, string>)[stage] ?? 'Working';
}

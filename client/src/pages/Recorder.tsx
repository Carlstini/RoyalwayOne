import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, waitForJob, formatBytes, formatDuration } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { setMeta } from './ToolPage';

type Mode = 'audio' | 'screen' | 'camera';

/** Real browser capture via MediaRecorder, then a genuine server-side encode to MP3/MP4. */
export function RecorderPage({ kind }: { kind: 'audio' | 'video' }) {
  const workspace = useWorkspace();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(kind === 'audio' ? 'audio' : 'screen');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<{ name: string; size: number; downloadUrl: string; fileId: string } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    document.title = kind === 'audio' ? 'Audio recorder — Royalway One' : 'Screen & camera recorder — Royalway One';
    setMeta('description', kind === 'audio'
      ? 'Record from your microphone in the browser and save it as a real MP3, or send it straight to transcription.'
      : 'Record your screen or camera in the browser and save a real MP4.');
    return () => stopTracks();
  }, [kind]);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
  };

  const start = useCallback(async () => {
    setError(null);
    setBlob(null);
    setOutput(null);
    chunksRef.current = [];
    try {
      let stream: MediaStream;
      if (mode === 'audio') stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      else if (mode === 'camera') stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
      else {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
        // Mix in the microphone when the user has granted it, so narration is captured too.
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          mic.getAudioTracks().forEach((t) => stream.addTrack(t));
        } catch { /* screen audio only */ }
      }
      streamRef.current = stream;
      if (videoRef.current && mode !== 'audio') {
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      }
      const mimeType = pickMime(mode === 'audio');
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const complete = new Blob(chunksRef.current, { type: recorder.mimeType });
        setBlob(complete);
        setPreviewUrl(URL.createObjectURL(complete));
        stopTracks();
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
      stream.getVideoTracks()[0]?.addEventListener('ended', () => { recorder.state !== 'inactive' && recorder.stop(); setRecording(false); });
    } catch (err) {
      setError(permissionMessage(mode, err));
    }
  }, [mode]);

  const stop = () => {
    recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) window.clearInterval(timerRef.current);
  };

  const save = async () => {
    if (!blob) return;
    setBusy(true);
    setError(null);
    try {
      const ext = blob.type.includes('webm') ? 'webm' : blob.type.includes('mp4') ? 'mp4' : 'bin';
      const file = new File([blob], `recording.${ext}`, { type: blob.type });
      const upload = await api.upload([file]);
      workspace.addFiles(upload.files);
      const res = await api.runTool(kind === 'audio' ? 'audio-recorder' : 'video-recorder', [upload.files[0].id], kind === 'audio' ? { format: 'mp3' } : {});
      let result = res.result;
      if (res.mode === 'job' && res.job) result = (await waitForJob(res.job.id, () => {})).result;
      const out = result?.outputs?.[0];
      if (out) {
        setOutput(out);
        toast('Your recording has been saved.', 'success');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save that recording.');
    } finally {
      setBusy(false);
    }
  };

  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined';

  return (
    <div className="page page--narrow">
      <h1>{kind === 'audio' ? 'Audio recorder' : 'Screen & camera recorder'}</h1>
      <p className="muted">
        {kind === 'audio'
          ? 'Record straight from your microphone, then save it as an MP3 or send it to transcription.'
          : 'Record your screen or your camera, then save it as a real MP4.'}
      </p>

      {!supported && <div className="banner banner--warn"><Icon name="info" size={18} /> Your browser does not support recording. Try the latest Chrome, Edge, Firefox or Safari.</div>}

      <div className="stack" style={{ marginTop: 22, gap: 18 }}>
        {kind === 'video' && !recording && (
          <div className="chips">
            <button className={`chip${mode === 'screen' ? ' chip--active' : ''}`} onClick={() => setMode('screen')}>Screen</button>
            <button className={`chip${mode === 'camera' ? ' chip--active' : ''}`} onClick={() => setMode('camera')}>Camera</button>
          </div>
        )}

        {kind === 'video' && (
          <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 'var(--radius)', background: '#000', display: recording ? 'block' : 'none' }} />
        )}

        <div className="card center">
          {recording ? (
            <>
              <div style={{ fontSize: '2rem', fontFamily: 'var(--mono)' }}>{formatDuration(seconds)}</div>
              <p className="muted small">Recording…</p>
              <button className="btn btn--primary" onClick={stop}>Stop recording</button>
            </>
          ) : (
            <>
              <span className="tool-card__icon" style={{ width: 52, height: 52, margin: '0 auto 12px' }}><Icon name={kind === 'audio' ? 'mic' : 'record'} size={24} /></span>
              <button className="btn btn--primary" onClick={start} disabled={!supported}>
                {blob ? 'Record again' : 'Start recording'}
              </button>
              <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>Your browser will ask for permission first. Nothing is sent anywhere until you choose to save.</p>
            </>
          )}
        </div>

        {error && <div className="banner banner--error" role="alert"><Icon name="info" size={18} /> {error}</div>}

        {blob && !recording && (
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Your recording · {formatBytes(blob.size)}</h3>
            {kind === 'audio'
              ? <audio controls src={previewUrl ?? undefined} style={{ width: '100%' }} />
              : <video controls src={previewUrl ?? undefined} style={{ width: '100%', borderRadius: 'var(--radius)' }} />}
            <div className="row">
              <button className="btn btn--primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : `Save as ${kind === 'audio' ? 'MP3' : 'MP4'}`}</button>
              {kind === 'audio' && <Link className="btn" to="/transcribe">Transcribe it instead</Link>}
            </div>
          </div>
        )}

        {output && (
          <div className="result-panel">
            <div className="result-panel__head"><Icon name="check" size={20} /> <strong>Saved</strong></div>
            <div className="result-panel__body">
              <div className="file-row">
                <div className="grow"><div className="file-row__name">{output.name}</div><div className="file-row__meta">{formatBytes(output.size)}</div></div>
                <a className="btn btn--sm btn--primary" href={output.downloadUrl} download={output.name}><Icon name="download" size={15} /> Download</a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function pickMime(audioOnly: boolean) {
  const candidates = audioOnly
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
}

function permissionMessage(mode: Mode, err: unknown) {
  const name = (err as any)?.name;
  if (name === 'NotAllowedError') return mode === 'screen' ? 'Screen recording permission was declined.' : 'Microphone or camera permission was declined. Allow access in your browser and try again.';
  if (name === 'NotFoundError') return 'We could not find a microphone or camera to record from.';
  return 'We could not start recording. Check your browser permissions and try again.';
}

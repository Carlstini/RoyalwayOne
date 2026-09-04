import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, formatDuration } from '../lib/api';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { useToast } from './Toast';
import { DocumentChat } from './DocumentChat';

export interface TranscriptSegment { start: number; end: number; text: string; speaker?: string }

export interface TranscriptData {
  transcriptId: string;
  title: string;
  text: string;
  segments: TranscriptSegment[];
  language?: string;
  durationSeconds?: number;
  speakerCount?: number;
  analysis?: Record<string, string>;
}

const AI_ACTIONS: { id: string; label: string }[] = [
  { id: 'executive-summary', label: 'Executive summary' },
  { id: 'summary', label: 'Summary' },
  { id: 'key-points', label: 'Key points' },
  { id: 'action-items', label: 'Action items' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'topics', label: 'Topics' },
  { id: 'questions', label: 'Open questions' },
  { id: 'important-moments', label: 'Important moments' },
  { id: 'meeting-minutes', label: 'Meeting minutes' },
  { id: 'follow-up-email', label: 'Follow-up email' },
];

const EXPORTS = [
  { format: 'txt', label: 'Text (.txt)' },
  { format: 'docx', label: 'Word (.docx)' },
  { format: 'pdf', label: 'PDF (.pdf)' },
  { format: 'srt', label: 'Subtitles (.srt)' },
  { format: 'vtt', label: 'Subtitles (.vtt)' },
  { format: 'md', label: 'Markdown (.md)' },
];

export function TranscriptWorkspace({ data, aiAvailable, mediaUrl }: { data: TranscriptData; aiAvailable: boolean; mediaUrl?: string }) {
  const toast = useToast();
  const [segments, setSegments] = useState<TranscriptSegment[]>(data.segments);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'transcript' | 'analysis' | 'chat'>('transcript');
  const [analysis, setAnalysis] = useState<Record<string, string>>(data.analysis ?? {});
  const [running, setRunning] = useState<string | null>(null);
  const [showTimestamps, setShowTimestamps] = useState(true);

  useEffect(() => { setSegments(data.segments); setAnalysis(data.analysis ?? {}); }, [data.transcriptId]);

  const filtered = useMemo(() => {
    if (!query.trim()) return segments.map((s, i) => ({ s, i }));
    const q = query.toLowerCase();
    return segments.map((s, i) => ({ s, i })).filter(({ s }) => s.text.toLowerCase().includes(q) || s.speaker?.toLowerCase().includes(q));
  }, [segments, query]);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveTranscript(data.transcriptId, segments);
      setDirty(false);
      toast('Your edits have been saved.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'We could not save your edits.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const runAi = async (task: string) => {
    setRunning(task);
    setTab('analysis');
    try {
      const res = await api.aiTask(task, { text: segments.map((s) => `${s.speaker ? `${s.speaker}: ` : ''}${s.text}`).join('\n') });
      setAnalysis((prev) => ({ ...prev, [task]: res.output }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'The AI request failed. Please try again.', 'error');
    } finally {
      setRunning(null);
    }
  };

  const words = segments.reduce((a, s) => a + s.text.split(/\s+/).filter(Boolean).length, 0);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card">
        <div className="row row--between">
          <div>
            <h2 style={{ margin: 0 }}>{data.title}</h2>
            <div className="small muted">
              {data.durationSeconds ? `${formatDuration(data.durationSeconds)} · ` : ''}
              {words.toLocaleString()} words
              {data.language ? ` · ${data.language}` : ''}
              {data.speakerCount ? ` · ${data.speakerCount} speakers` : ''}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {dirty && <button className="btn btn--sm btn--primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save edits'}</button>}
            <div className="row" style={{ gap: 6 }}>
              <label className="sr-only" htmlFor="export-format">Export format</label>
              <select
                id="export-format"
                style={{ minWidth: 170 }}
                defaultValue=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  window.location.href = `/api/transcription/${data.transcriptId}/export/${e.target.value}?timestamps=${showTimestamps ? 1 : 0}`;
                  e.target.value = '';
                }}
              >
                <option value="">Export transcript…</option>
                {EXPORTS.map((x) => <option key={x.format} value={x.format}>{x.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {mediaUrl && (
        <audio controls src={mediaUrl} style={{ width: '100%' }}>Your browser cannot play this audio.</audio>
      )}

      <div className="chips">
        <button className={`chip${tab === 'transcript' ? ' chip--active' : ''}`} onClick={() => setTab('transcript')}>Transcript</button>
        <button className={`chip${tab === 'analysis' ? ' chip--active' : ''}`} onClick={() => setTab('analysis')}>AI analysis</button>
        <button className={`chip${tab === 'chat' ? ' chip--active' : ''}`} onClick={() => setTab('chat')}>Ask the transcript</button>
      </div>

      {tab === 'transcript' && (
        <div className="card">
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="search-input grow" style={{ maxWidth: 320 }}>
              <span className="search-input__icon"><Icon name="search" size={16} /></span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this transcript" aria-label="Search transcript" />
            </div>
            <label className="toggle">
              <input type="checkbox" checked={showTimestamps} onChange={(e) => setShowTimestamps(e.target.checked)} />
              <span className="small">Timestamps</span>
            </label>
            <span className="grow" />
            <button className="btn btn--sm" onClick={() => { void navigator.clipboard.writeText(segments.map((s) => s.text).join('\n')); toast('Transcript copied.', 'success'); }}>
              <Icon name="copy" size={15} /> Copy all
            </button>
          </div>

          {filtered.length === 0 && <p className="muted">No lines match “{query}”.</p>}

          <div>
            {filtered.map(({ s, i }) => (
              <div className="segment" key={i}>
                {showTimestamps
                  ? <span className="segment__time">{formatDuration(s.start)}</span>
                  : <span />}
                <div>
                  {s.speaker && <div className="segment__speaker">{s.speaker}</div>}
                  <div
                    className="segment__text"
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    aria-label={`Transcript line at ${formatDuration(s.start)}`}
                    onBlur={(e) => {
                      const text = e.currentTarget.textContent ?? '';
                      if (text !== s.text) {
                        setSegments((prev) => prev.map((seg, si) => (si === i ? { ...seg, text } : seg)));
                        setDirty(true);
                      }
                    }}
                  >{s.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'analysis' && (
        <div className="stack">
          {!aiAvailable && (
            <div className="banner banner--warn"><Icon name="info" size={18} /> AI analysis is not switched on for this deployment. Your transcript, editing and exports all still work.</div>
          )}
          {aiAvailable && (
            <div className="chips">
              {AI_ACTIONS.map((a) => (
                <button key={a.id} className="chip" onClick={() => runAi(a.id)} disabled={running !== null}>
                  {running === a.id ? 'Working…' : analysis[a.id] ? `↻ ${a.label}` : a.label}
                </button>
              ))}
            </div>
          )}
          {running && (
            <div className="processing"><div className="spinner" /><div><strong>Analysing your transcript</strong><div className="tiny muted">Grounded in what was actually said.</div></div></div>
          )}
          {Object.entries(analysis).map(([task, output]) => (
            <div className="card" key={task}>
              <div className="row row--between" style={{ marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>{AI_ACTIONS.find((a) => a.id === task)?.label ?? task}</h3>
                <button className="btn btn--sm btn--ghost" onClick={() => { void navigator.clipboard.writeText(output); toast('Copied.', 'success'); }}>
                  <Icon name="copy" size={15} /> Copy
                </button>
              </div>
              <Markdown text={output} />
            </div>
          ))}
          {!running && !Object.keys(analysis).length && aiAvailable && (
            <p className="muted">Choose an action above to analyse this transcript.</p>
          )}
        </div>
      )}

      {tab === 'chat' && (
        <DocumentChat transcriptId={data.transcriptId} documentName={data.title} available={aiAvailable} />
      )}
    </div>
  );
}

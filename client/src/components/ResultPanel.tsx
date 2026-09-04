import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { formatBytes, formatDuration, type Tool, type ToolResult } from '../lib/api';
import { useToast } from './Toast';

interface Props {
  result: ToolResult;
  tool?: Tool;
  nextActions?: { label: string; to?: string; onClick?: () => void }[];
  onReset?: () => void;
}

export function ResultPanel({ result, tool, nextActions, onReset }: Props) {
  const toast = useToast();
  const outputs = result.outputs ?? [];
  const stats = result.stats ?? {};

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to your clipboard.', 'success');
    } catch {
      toast('Your browser blocked copying. Select the text and copy it manually.', 'error');
    }
  };

  return (
    <div className="result-panel">
      <div className="result-panel__head">
        <Icon name="check" size={20} />
        <strong>Done</strong>
        <span className="muted small">{result.message ?? (outputs.length ? `${outputs.length} file${outputs.length === 1 ? '' : 's'} ready` : 'Your result is ready')}</span>
      </div>
      <div className="result-panel__body stack">
        <StatGrid stats={stats} />

        {outputs.length > 0 && (
          <div className="file-list">
            {outputs.map((o) => (
              <div className="file-row" key={o.fileId}>
                {o.mime.startsWith('image/')
                  ? <img className="file-thumb" src={`${o.downloadUrl}&download=0`} alt="" loading="lazy" />
                  : <span className="file-thumb" style={{ display: 'grid', placeItems: 'center' }}><Icon name="document" size={18} /></span>}
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="file-row__name">{o.name}</div>
                  <div className="file-row__meta">{formatBytes(o.size)}</div>
                </div>
                {/^(application\/pdf|image|audio|video)/.test(o.mime) && (
                  <a className="btn btn--sm" href={`${o.downloadUrl}&download=0`} target="_blank" rel="noopener noreferrer">Preview</a>
                )}
                <a className="btn btn--sm btn--primary" href={o.downloadUrl} download={o.name}>
                  <Icon name="download" size={15} /> Download
                </a>
              </div>
            ))}
          </div>
        )}

        {result.text && (
          <div className="card" style={{ background: 'var(--surface-alt)' }}>
            <Markdown text={result.text} />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn--sm" onClick={() => copy(result.text!)}><Icon name="copy" size={15} /> Copy</button>
              <button
                className="btn btn--sm"
                onClick={() => downloadText(result.text!, `${tool?.id ?? 'royalway'}-result.md`)}
              >
                <Icon name="download" size={15} /> Save as Markdown
              </button>
            </div>
          </div>
        )}

        {result.data && !result.text && <DataView data={result.data} />}

        {(nextActions?.length || onReset) && (
          <div className="row">
            {nextActions?.map((a) => (
              a.to
                ? <Link key={a.label} className="btn btn--sm" to={a.to}>{a.label}</Link>
                : <button key={a.label} className="btn btn--sm" onClick={a.onClick}>{a.label}</button>
            ))}
            {onReset && <button className="btn btn--sm btn--ghost" onClick={onReset}><Icon name="refresh" size={15} /> Start again</button>}
          </div>
        )}
      </div>
    </div>
  );
}

export function StatGrid({ stats }: { stats: Record<string, any> }) {
  const entries: { label: string; value: string; good?: boolean }[] = [];
  if (typeof stats.originalSize === 'number') entries.push({ label: 'Original', value: formatBytes(stats.originalSize) });
  if (typeof stats.outputSize === 'number') entries.push({ label: 'Result', value: formatBytes(stats.outputSize) });
  if (typeof stats.reductionPercent === 'number' && stats.reductionPercent > 0) entries.push({ label: 'Reduction', value: `${stats.reductionPercent}% smaller`, good: true });
  if (typeof stats.pages === 'number') entries.push({ label: 'Pages', value: String(stats.pages) });
  if (typeof stats.documents === 'number') entries.push({ label: 'Documents', value: String(stats.documents) });
  if (typeof stats.durationSeconds === 'number') entries.push({ label: 'Length', value: formatDuration(stats.durationSeconds) });
  if (typeof stats.words === 'number') entries.push({ label: 'Words', value: stats.words.toLocaleString() });
  if (stats.language) entries.push({ label: 'Language', value: String(stats.language) });
  if (stats.speakers) entries.push({ label: 'Speakers', value: String(stats.speakers) });
  if (typeof stats.characters === 'number') entries.push({ label: 'Characters', value: stats.characters.toLocaleString() });
  if (typeof stats.pagesKept === 'number') entries.push({ label: 'Pages kept', value: String(stats.pagesKept) });
  if (typeof stats.pagesRemoved === 'number') entries.push({ label: 'Pages removed', value: String(stats.pagesRemoved) });
  if (typeof stats.similarity === 'number') entries.push({ label: 'Similarity', value: `${stats.similarity}%` });
  if (typeof stats.linesAdded === 'number') entries.push({ label: 'Lines added', value: String(stats.linesAdded) });
  if (typeof stats.linesRemoved === 'number') entries.push({ label: 'Lines removed', value: String(stats.linesRemoved) });
  if (!entries.length) return null;

  return (
    <div className="stat-grid">
      {entries.map((e) => (
        <div className="stat" key={e.label}>
          <div className="stat__label">{e.label}</div>
          <div className={`stat__value${e.good ? ' stat__value--good' : ''}`}>{e.value}</div>
        </div>
      ))}
    </div>
  );
}

function DataView({ data }: { data: any }) {
  if (Array.isArray(data)) return <ul>{data.map((d, i) => <li key={i}>{typeof d === 'string' ? d : JSON.stringify(d)}</li>)}</ul>;
  if (typeof data !== 'object' || data === null) return <p>{String(data)}</p>;

  return (
    <div className="stack">
      {Object.entries(data).map(([key, value]) => {
        if (!value || (Array.isArray(value) && !value.length)) return null;
        return (
          <div className="card" key={key} style={{ background: 'var(--surface-alt)' }}>
            <h3 style={{ textTransform: 'capitalize' }}>{key.replace(/([A-Z])/g, ' $1')}</h3>
            {Array.isArray(value) ? (
              <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                {value.map((item, i) => (
                  <li key={i}>
                    {typeof item === 'string' ? item : Object.entries(item as Record<string, any>).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                  </li>
                ))}
              </ul>
            ) : <p style={{ margin: 0 }}>{String(value)}</p>}
          </div>
        );
      })}
    </div>
  );
}

export function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

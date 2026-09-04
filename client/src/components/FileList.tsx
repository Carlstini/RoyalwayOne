import { Icon } from './Icon';
import { formatBytes, type UploadedFile } from '../lib/api';

interface Props {
  files: UploadedFile[];
  onRemove?: (id: string) => void;
  onReorder?: (files: UploadedFile[]) => void;
}

export function FileList({ files, onRemove, onReorder }: Props) {
  if (!files.length) return null;

  const move = (index: number, delta: number) => {
    if (!onReorder) return;
    const next = [...files];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
  };

  return (
    <ul className="file-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {files.map((f, i) => (
        <li key={f.id} className="file-row">
          {f.mime.startsWith('image/')
            ? <img className="file-thumb" src={`${f.url}&download=0`} alt="" loading="lazy" />
            : <span className="file-thumb" style={{ display: 'grid', placeItems: 'center' }}><Icon name={iconFor(f.mime, f.name)} size={18} /></span>}
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="file-row__name">{f.name}</div>
            <div className="file-row__meta">{formatBytes(f.size)}</div>
          </div>
          {onReorder && files.length > 1 && (
            <>
              <button className="btn btn--ghost btn--sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${f.name} up`}>↑</button>
              <button className="btn btn--ghost btn--sm" onClick={() => move(i, 1)} disabled={i === files.length - 1} aria-label={`Move ${f.name} down`}>↓</button>
            </>
          )}
          {onRemove && (
            <button className="btn btn--ghost btn--sm" onClick={() => onRemove(f.id)} aria-label={`Remove ${f.name}`}>
              <Icon name="close" size={16} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function iconFor(mime: string, name: string) {
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'music';
  if (mime.startsWith('video/')) return 'video';
  if (/\.(xlsx?|csv)$/i.test(name)) return 'excel';
  if (/\.(pptx?)$/i.test(name)) return 'slides';
  if (/\.(docx?)$/i.test(name)) return 'word';
  return 'document';
}

import { useCallback, useRef, useState, type DragEvent } from 'react';
import { Icon } from './Icon';

interface Props {
  accept?: string[];
  multiple?: boolean;
  compact?: boolean;
  title?: string;
  hint?: string;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

export function Dropzone({ accept, multiple = true, compact, title, hint, disabled, onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);

  const handle = useCallback((list: FileList | null) => {
    if (!list?.length) return;
    onFiles(Array.from(list));
  }, [onFiles]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setActive(false);
    if (!disabled) handle(e.dataTransfer.files);
  };

  const acceptAttr = accept?.length ? accept.join(',') : undefined;

  return (
    <>
      <button
        type="button"
        className={`dropzone${active ? ' dropzone--active' : ''}${compact ? ' dropzone--compact' : ''}`}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setActive(true); }}
        onDragLeave={() => setActive(false)}
        onDrop={onDrop}
        disabled={disabled}
      >
        <Icon name="upload" size={compact ? 22 : 28} />
        <div className="dropzone__title" style={{ marginTop: 10 }}>{title ?? 'Drop files here'}</div>
        <div className="dropzone__hint">{hint ?? 'or click to choose from your device'}</div>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        multiple={multiple}
        accept={acceptAttr}
        onChange={(e) => { handle(e.target.files); e.target.value = ''; }}
        tabIndex={-1}
        aria-hidden="true"
      />
    </>
  );
}

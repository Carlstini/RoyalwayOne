import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

const FONTS = [
  { id: 'cursive', label: 'Flowing', css: '"Segoe Script", "Brush Script MT", cursive' },
  { id: 'serif', label: 'Classic', css: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Plain', css: 'ui-monospace, "Courier New", monospace' },
];

/** Draw with a pointer or type a name — either way we produce a transparent PNG. */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const [tab, setTab] = useState<'draw' | 'type'>('draw');
  const [typed, setTyped] = useState('');
  const [font, setFont] = useState(FONTS[0]);
  const [hasInk, setHasInk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Crisp lines on high-DPI screens.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = 600 * ratio;
    c.height = 200 * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b1a3a';
  }, [tab]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 600, y: ((e.clientY - r.top) / r.height) * 200 };
  };

  const emitDrawn = () => {
    const c = canvasRef.current!;
    onChange(c.toDataURL('image/png'));
  };

  const clear = () => {
    const c = canvasRef.current;
    if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    onChange(null);
  };

  // Render typed text to a transparent PNG of the same shape as a drawn signature.
  useEffect(() => {
    if (tab !== 'type') return;
    if (!typed.trim()) { onChange(null); return; }
    const c = document.createElement('canvas');
    const ratio = 2;
    c.width = 600 * ratio;
    c.height = 200 * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#0b1a3a';
    ctx.textBaseline = 'middle';
    let size = 76;
    do {
      ctx.font = `${size}px ${font.css}`;
      size -= 2;
    } while (ctx.measureText(typed).width > 560 && size > 18);
    ctx.fillText(typed, 20, 105);
    onChange(c.toDataURL('image/png'));
  }, [typed, font, tab, onChange]);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="chips">
        <button className={`chip${tab === 'draw' ? ' chip--active' : ''}`} onClick={() => { setTab('draw'); onChange(null); }}>Draw it</button>
        <button className={`chip${tab === 'type' ? ' chip--active' : ''}`} onClick={() => { setTab('type'); clear(); }}>Type it</button>
      </div>

      {tab === 'draw' ? (
        <>
          <canvas
            ref={canvasRef}
            className="signature-pad"
            style={{ touchAction: 'none' }}
            aria-label="Signature drawing area"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drawing.current = true;
              last.current = pos(e);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const ctx = canvasRef.current!.getContext('2d')!;
              const p = pos(e);
              ctx.beginPath();
              ctx.moveTo(last.current!.x, last.current!.y);
              ctx.lineTo(p.x, p.y);
              ctx.stroke();
              last.current = p;
              setHasInk(true);
            }}
            onPointerUp={() => { drawing.current = false; if (hasInk) emitDrawn(); }}
            onPointerLeave={() => { if (drawing.current) { drawing.current = false; if (hasInk) emitDrawn(); } }}
          />
          <div className="row">
            <button className="btn btn--sm" onClick={clear}><Icon name="trash" size={15} /> Clear</button>
            <span className="tiny muted">Sign with a mouse, trackpad or finger.</span>
          </div>
        </>
      ) : (
        <>
          <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your name" aria-label="Typed signature" />
          <div className="chips">
            {FONTS.map((f) => (
              <button key={f.id} className={`chip${font.id === f.id ? ' chip--active' : ''}`} style={{ fontFamily: f.css }} onClick={() => setFont(f)}>{f.label}</button>
            ))}
          </div>
          {typed && <div className="signature-preview" style={{ fontFamily: font.css }}>{typed}</div>}
        </>
      )}
    </div>
  );
}

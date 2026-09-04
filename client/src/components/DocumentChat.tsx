import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Markdown } from './Markdown';
import { Icon } from './Icon';

interface Message { role: 'user' | 'assistant'; content: string; sources?: { label: string; excerpt: string }[] }

const SUGGESTED = [
  'What is this about?',
  'What are the deadlines?',
  'Who is responsible for what?',
  'What are the financial figures?',
  'What risks are mentioned?',
];

export function DocumentChat({ fileId, transcriptId, documentName, available }: { fileId?: string; transcriptId?: string; documentName?: string; available: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);
  useEffect(() => { setMessages([]); }, [fileId, transcriptId]);

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setBusy(true);
    try {
      const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const res = await api.aiChat({ fileId, transcriptId, question: trimmed, history });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.answer, sources: res.sources }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not answer that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!available) {
    return <div className="banner banner--warn"><Icon name="info" size={18} /> AI chat is not switched on for this deployment yet.</div>;
  }

  return (
    <div className="card">
      {documentName && <div className="small muted" style={{ marginBottom: 12 }}>Answers are grounded in <strong>{documentName}</strong>. If it is not in the document, we will say so.</div>}

      <div className="chat" style={{ minHeight: 160, marginBottom: 16 }}>
        {messages.length === 0 && !busy && (
          <div className="stack" style={{ gap: 10 }}>
            <p className="muted small" style={{ margin: 0 }}>Try asking:</p>
            <div className="chips">
              {SUGGESTED.map((q) => <button key={q} className="chip" onClick={() => ask(q)}>{q}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg--${m.role === 'user' ? 'user' : 'ai'}`}>
            {m.role === 'user' ? m.content : <Markdown text={m.content} />}
            {m.sources && m.sources.length > 0 && (
              <details className="msg__sources">
                <summary>Sources ({m.sources.length})</summary>
                <ul style={{ paddingLeft: '1.1em', marginTop: 6 }}>
                  {m.sources.map((s, si) => <li key={si}><strong>{s.label}</strong> — {s.excerpt}…</li>)}
                </ul>
              </details>
            )}
          </div>
        ))}
        {busy && <div className="msg msg--ai"><span className="row" style={{ gap: 8 }}><span className="spinner" style={{ width: 15, height: 15 }} /> Reading your document…</span></div>}
        <div ref={endRef} />
      </div>

      {error && <div className="banner banner--error" style={{ marginBottom: 12 }} role="alert">{error}</div>}

      <form className="row" style={{ gap: 8, flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
        <input
          className="grow" type="text" value={input} placeholder="Ask a question about this content…"
          onChange={(e) => setInput(e.target.value)} disabled={busy} aria-label="Your question"
        />
        <button className="btn btn--primary" type="submit" disabled={busy || !input.trim()} style={{ width: 'auto' }}>
          <Icon name="send" size={16} /> Ask
        </button>
      </form>
    </div>
  );
}

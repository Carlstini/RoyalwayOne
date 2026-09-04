import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../lib/workspace';
import { ToolRunner } from '../components/ToolRunner';
import { ToolCard } from '../components/ToolCard';
import { Icon } from '../components/Icon';
import type { ToolResult } from '../lib/api';

export function ToolPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toolByRoute, tools, loading } = useWorkspace();
  const tool = toolByRoute(location.pathname);

  useEffect(() => {
    if (!tool) return;
    document.title = `${tool.name} — Royalway One`;
    setMeta('description', `${tool.description} Free and instant in Royalway One, with no sign-in required.`);
    return () => { document.title = 'Royalway One — Everything you need. One workspace.'; };
  }, [tool]);

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;

  if (!tool) {
    return (
      <div className="page page--narrow">
        <h1>Tool not found</h1>
        <p className="muted">That tool does not exist, or it has moved.</p>
        <Link className="btn btn--primary" to="/tools">Browse all tools</Link>
      </div>
    );
  }

  const related = tools.filter((t) => t.category === tool.category && t.id !== tool.id).slice(0, 4);

  const nextActions = (result: ToolResult) => {
    const actions: { label: string; to?: string; onClick?: () => void }[] = [];
    const first = result.outputs?.[0];
    if (!first) return actions;
    if (first.mime === 'application/pdf' && tool.id !== 'pdf-compress') actions.push({ label: 'Compress this PDF', to: '/pdf/compress' });
    if (first.mime.startsWith('audio/')) actions.push({ label: 'Transcribe this audio', to: '/transcribe' });
    if (first.mime === 'application/pdf') actions.push({ label: 'Summarise it with AI', to: '/ai/summarize' });
    return actions;
  };

  return (
    <div className="page">
      <Link className="small muted" to={`/category/${tool.category}`}>← {categoryLabel(tool.category)}</Link>
      <div className="row" style={{ gap: 12, margin: '12px 0 6px' }}>
        <span className="tool-card__icon" style={{ width: 42, height: 42 }}><Icon name={tool.icon} size={21} /></span>
        <div>
          <h1 style={{ margin: 0 }}>{tool.name}</h1>
          <p className="muted" style={{ margin: 0 }}>{tool.description}</p>
        </div>
      </div>

      <div className="tool-layout" style={{ marginTop: 28 }}>
        <div>
          <ToolRunner tool={tool} nextActions={nextActions} />
        </div>
        <aside className="stack sticky-panel">
          <div className="card">
            <h3>How this works</h3>
            <ol className="small muted" style={{ paddingLeft: '1.1em', margin: 0 }}>
              <li>Add your file{tool.maxFiles > 1 ? 's' : ''}.</li>
              <li>Choose your options.</li>
              <li>We process it on our servers.</li>
              <li>Download the real result.</li>
            </ol>
            <p className="tiny muted" style={{ marginTop: 12, marginBottom: 0 }}>
              Files are deleted automatically a short time after processing. Nothing is kept and no account is created.
            </p>
          </div>
          {related.length > 0 && (
            <div className="card">
              <h3>Related tools</h3>
              <div className="stack" style={{ gap: 6 }}>
                {related.map((r) => (
                  <button key={r.id} className="chip" style={{ textAlign: 'left' }} onClick={() => navigate(r.route)}>{r.name}</button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {related.length > 0 && (
        <section className="section">
          <div className="section__head"><h2 className="section__title">More {categoryLabel(tool.category).toLowerCase()}</h2></div>
          <div className="tool-grid">{related.map((r) => <ToolCard key={r.id} tool={r} />)}</div>
        </section>
      )}
    </div>
  );
}

function categoryLabel(id: string) {
  return ({
    pdf: 'PDF & Documents', image: 'Images', audio: 'Audio', video: 'Video',
    transcribe: 'Transcription', ai: 'AI Workspace', business: 'Business Tools',
  } as Record<string, string>)[id] ?? 'Tools';
}

export function setMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

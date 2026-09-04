import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type Tool, type UploadedFile } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Dropzone } from '../components/Dropzone';
import { FileList } from '../components/FileList';
import { ToolCard } from '../components/ToolCard';
import { QuickSearch } from '../components/Layout';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

const QUICK_IDEAS = [
  { label: 'Compress a PDF', to: '/pdf/compress' },
  { label: 'Merge PDFs', to: '/pdf/merge' },
  { label: 'PDF to Word', to: '/pdf/to-word' },
  { label: 'Transcribe audio', to: '/transcribe' },
  { label: 'Summarise a document', to: '/ai/summarize' },
  { label: 'Compress a video', to: '/video/compress' },
  { label: 'Convert an image', to: '/image/convert' },
  { label: 'Ask a document a question', to: '/ai/document-chat' },
];

export function Home() {
  const workspace = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<Tool[]>([]);
  const [uploading, setUploading] = useState(false);
  const [recent, setRecent] = useState<UploadedFile[]>([]);

  const onFiles = useCallback(async (files: File[]) => {
    setUploading(true);
    try {
      const res = await api.upload(files);
      workspace.addFiles(res.files);
      setRecent(res.files);
      setSuggestions(res.suggestions);
      toast(`${res.files.length} file${res.files.length === 1 ? '' : 's'} ready. Choose what to do next.`, 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'We could not upload your file. Please try again.', 'error');
    } finally {
      setUploading(false);
    }
  }, [toast, workspace]);

  const recentTools = workspace.recentTools.map((id) => workspace.toolById(id)).filter(Boolean) as Tool[];
  const popular = ['pdf-compress', 'pdf-merge', 'transcribe-file', 'ai-summarize', 'image-compress', 'video-compress', 'pdf-to-word', 'ai-document-chat']
    .map((id) => workspace.toolById(id)).filter(Boolean) as Tool[];

  return (
    <div className="page">
      <section className="hero">
        <h1 className="hero__title">Royalway One</h1>
        <p className="hero__tagline">Everything you need. One workspace.</p>
        <div className="rule" />
        <p className="hero__support">Work with PDFs, documents, images, audio, video and AI — all in one place. No account, no sign-in, no payment.</p>
        <div style={{ maxWidth: 620, margin: '0 auto' }}><QuickSearch big /></div>
      </section>

      <section aria-labelledby="upload-heading">
        <h2 id="upload-heading" className="sr-only">Upload files</h2>
        <Dropzone
          onFiles={onFiles}
          disabled={uploading}
          title={uploading ? 'Uploading…' : 'Drop any file to begin'}
          hint="PDFs, documents, images, audio and video — we will suggest what you can do with them"
        />
        {recent.length > 0 && (
          <div className="stack" style={{ marginTop: 16 }}>
            <FileList files={recent} onRemove={(id) => { workspace.removeFile(id); setRecent((p) => p.filter((f) => f.id !== id)); }} />
            {suggestions.length > 0 && (
              <div>
                <div className="section__title" style={{ marginBottom: 10 }}>What would you like to do?</div>
                <div className="tool-grid">
                  {suggestions.slice(0, 6).map((t) => <ToolCard key={t.id} tool={t} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">What do you want to do?</h2>
        </div>
        <div className="chips">
          {QUICK_IDEAS.map((idea) => (
            <button key={idea.to} className="chip" onClick={() => navigate(idea.to)}>{idea.label}</button>
          ))}
        </div>
      </section>

      {recentTools.length > 0 && (
        <section className="section">
          <div className="section__head"><h2 className="section__title">Your recent tools</h2></div>
          <div className="tool-grid">{recentTools.slice(0, 4).map((t) => <ToolCard key={t.id} tool={t} />)}</div>
        </section>
      )}

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Popular tools</h2>
          <Link to="/tools">Browse everything <Icon name="arrow" size={14} /></Link>
        </div>
        <div className="tool-grid">{popular.map((t) => <ToolCard key={t.id} tool={t} />)}</div>
      </section>

      <section className="section">
        <div className="section__head"><h2 className="section__title">Browse by category</h2></div>
        <div className="category-grid">
          {workspace.categories.map((c) => {
            const count = c.id === 'workflow' ? workspace.workflows.length : workspace.tools.filter((t) => t.category === c.id).length;
            return (
              <Link className="category-card" key={c.id} to={c.id === 'workflow' ? '/workflows' : `/category/${c.id}`}>
                <div className="row" style={{ gap: 10, marginBottom: 6 }}>
                  <span className="tool-card__icon" style={{ width: 32, height: 32 }}><Icon name={c.icon} size={17} /></span>
                  <strong>{c.name}</strong>
                </div>
                <div className="tool-card__desc">{c.description}</div>
                <div className="category-card__count" style={{ marginTop: 8 }}>{count} tool{count === 1 ? '' : 's'}</div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="card card--pad-lg" style={{ background: 'var(--surface-alt)' }}>
          <div className="split">
            <div>
              <h3>Private by default</h3>
              <p className="muted small" style={{ margin: 0 }}>Files are stored temporarily behind signed, expiring links and deleted automatically after processing. No account is created and no personal details are collected.</p>
            </div>
            <div>
              <h3>Real processing, every time</h3>
              <p className="muted small" style={{ margin: 0 }}>Every result comes from genuine processing: real PDF engines, real media encoding, real speech-to-text and real AI. The statistics you see are measured from your actual files.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { api, type Tool } from '../lib/api';

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="header">
        <div className="header__inner">
          <Link className="brand" to="/" aria-label="Royalway One home">
            <span className="brand__mark">Royalway</span>
            <span className="brand__one">One</span>
          </Link>
          <div className="header__search"><QuickSearch /></div>
          <nav className="nav" aria-label="Main">
            <NavLink to="/tools">All tools</NavLink>
            <NavLink to="/transcribe">Transcribe</NavLink>
            <NavLink to="/ai/document-chat">Ask a document</NavLink>
            <NavLink to="/workflows">Workflows</NavLink>
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="footer">
        <div className="footer__inner">
          <div>
            <div className="brand" style={{ marginBottom: 6 }}>
              <span className="brand__mark">Royalway</span><span className="brand__one">One</span>
            </div>
            <div>Everything you need. One workspace.</div>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <Link to="/tools">All tools</Link>
            <Link to="/workflows">Workflows</Link>
            <Link to="/privacy">Privacy &amp; files</Link>
          </div>
          <div style={{ maxWidth: 300 }}>
            No account needed. Your files are processed securely and deleted automatically a short time after processing.
          </div>
        </div>
      </footer>
    </>
  );
}

export function QuickSearch({ big }: { big?: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Tool[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(() => {
      api.search(query).then((r) => { setResults(r.results); setOpen(true); }).catch(() => setResults([]));
    }, 160);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = (tool: Tool) => {
    api.event('search_performed', { query: query.slice(0, 40), picked: tool.id });
    setOpen(false);
    setQuery('');
    navigate(tool.route);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div className="search-input">
        <span className="search-input__icon"><Icon name="search" size={17} /></span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) go(results[0]); if (e.key === 'Escape') setOpen(false); }}
          placeholder={big ? 'What do you want to do? e.g. compress a PDF, transcribe audio' : 'Search tools'}
          aria-label="Search tools"
          style={big ? { minHeight: 54, fontSize: '1.02rem', paddingLeft: 44 } : undefined}
          role="combobox"
          aria-expanded={open}
          aria-controls="tool-search-results"
        />
      </div>
      {open && results.length > 0 && (
        <div
          id="tool-search-results"
          className="card"
          style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 80, padding: 6, boxShadow: 'var(--shadow-lg)', maxHeight: 380, overflow: 'auto' }}
          role="listbox"
        >
          {results.map((tool) => (
            <button key={tool.id} className="tool-card" style={{ border: 0, padding: '10px 12px' }} onClick={() => go(tool)} role="option" aria-selected={false}>
              <span className="tool-card__icon" style={{ width: 30, height: 30 }}><Icon name={tool.icon} size={16} /></span>
              <span style={{ minWidth: 0 }}>
                <span className="tool-card__name" style={{ display: 'block' }}>{tool.name}</span>
                <span className="tool-card__desc">{tool.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

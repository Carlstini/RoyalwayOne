import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useWorkspace } from '../lib/workspace';
import { ToolCard } from '../components/ToolCard';
import { QuickSearch } from '../components/Layout';
import { Icon } from '../components/Icon';

export function AllTools() {
  const { tools, categories, loading } = useWorkspace();
  const [filter, setFilter] = useState('all');

  const grouped = useMemo(() => categories
    .filter((c) => c.id !== 'workflow')
    .map((c) => ({ category: c, tools: tools.filter((t) => t.category === c.id) }))
    .filter((g) => g.tools.length), [categories, tools]);

  const shown = filter === 'all' ? grouped : grouped.filter((g) => g.category.id === filter);

  return (
    <div className="page">
      <h1>All tools</h1>
      <p className="muted">{tools.length} tools, all free and open. No sign-in required.</p>
      <div style={{ maxWidth: 520, margin: '20px 0' }}><QuickSearch /></div>

      <div className="chips" style={{ marginBottom: 24 }}>
        <button className={`chip${filter === 'all' ? ' chip--active' : ''}`} onClick={() => setFilter('all')}>All</button>
        {grouped.map((g) => (
          <button key={g.category.id} className={`chip${filter === g.category.id ? ' chip--active' : ''}`} onClick={() => setFilter(g.category.id)}>
            {g.category.name}
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading tools…</p>}

      {shown.map((g) => (
        <section className="section" key={g.category.id} style={{ marginTop: 32 }}>
          <div className="section__head">
            <h2 className="section__title">{g.category.name}</h2>
            <span className="muted small">{g.category.description}</span>
          </div>
          <div className="tool-grid">{g.tools.map((t) => <ToolCard key={t.id} tool={t} />)}</div>
        </section>
      ))}
    </div>
  );
}

export function CategoryPage() {
  const { id } = useParams();
  const { tools, categories } = useWorkspace();
  const category = categories.find((c) => c.id === id);
  const list = tools.filter((t) => t.category === id);

  if (!category) {
    return (
      <div className="page page--narrow">
        <h1>Category not found</h1>
        <p className="muted">That category does not exist.</p>
        <Link className="btn" to="/tools">Browse all tools</Link>
      </div>
    );
  }

  return (
    <div className="page">
      <Link className="small muted" to="/tools">← All tools</Link>
      <div className="row" style={{ gap: 12, marginTop: 12 }}>
        <span className="tool-card__icon" style={{ width: 40, height: 40 }}><Icon name={category.icon} size={20} /></span>
        <div>
          <h1 style={{ margin: 0 }}>{category.name}</h1>
          <p className="muted" style={{ margin: 0 }}>{category.description}</p>
        </div>
      </div>
      <div className="tool-grid" style={{ marginTop: 28 }}>{list.map((t) => <ToolCard key={t.id} tool={t} />)}</div>
    </div>
  );
}

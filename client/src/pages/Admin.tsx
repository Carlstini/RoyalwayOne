import { useCallback, useEffect, useState } from 'react';
import { formatBytes, formatDuration } from '../lib/api';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

interface Overview {
  system: { uptimeSeconds: number; memoryMb: number; loadAverage: number[]; database: string; env: string };
  providers: { ai: { configured: boolean; provider: string; model: string }; transcription: { configured: boolean; provider: string }; media: { ffmpeg: boolean }; office: boolean };
  jobs: {
    total: number; byStatus: Record<string, number>; byTool: Record<string, number>; averageMs: number;
    recent: { id: string; tool: string; status: string; stage?: string; error?: string; createdAt: number; durationMs: number }[];
    failures: { id: string; tool: string; error?: string; at: number }[];
  };
  storage: { files: number; bytes: number; tmpFiles?: number };
  usage: Record<string, number>;
}

export function Admin() {
  const toast = useToast();
  const [token, setToken] = useState(() => sessionStorage.getItem('rw:admin-token') ?? '');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { document.title = 'Admin — Royalway One'; }, []);

  const load = useCallback(async (t: string) => {
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/overview', { headers: { 'x-admin-token': t } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? (res.status === 404 ? 'The admin dashboard is not enabled on this deployment.' : 'Not authorised.'));
      sessionStorage.setItem('rw:admin-token', t);
      setData(body as Overview);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Could not load the dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (token) void load(token); }, []);
  useEffect(() => {
    if (!data) return;
    const id = window.setInterval(() => void load(token), 15000);
    return () => window.clearInterval(id);
  }, [data, token, load]);

  const cleanup = async () => {
    const res = await fetch('/api/admin/cleanup', { method: 'POST', headers: { 'x-admin-token': token } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { toast(`Removed ${body.filesRemoved} expired files.`, 'success'); void load(token); }
    else toast('Cleanup failed.', 'error');
  };

  if (!data) {
    return (
      <div className="page page--narrow">
        <h1>Admin</h1>
        <p className="muted">Enter the admin token for this deployment.</p>
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void load(token); }}>
          <div className="field">
            <label className="field__label" htmlFor="admin-token">Admin token</label>
            <input id="admin-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          </div>
          {error && <div className="banner banner--error" role="alert">{error}</div>}
          <div><button className="btn btn--primary" type="submit" disabled={!token || loading}>{loading ? 'Checking…' : 'Open dashboard'}</button></div>
        </form>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="row row--between">
        <h1 style={{ margin: 0 }}>Admin dashboard</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--sm" onClick={() => void load(token)}><Icon name="refresh" size={15} /> Refresh</button>
          <button className="btn btn--sm" onClick={cleanup}><Icon name="trash" size={15} /> Run cleanup</button>
          <button className="btn btn--sm btn--ghost" onClick={() => { sessionStorage.removeItem('rw:admin-token'); setData(null); setToken(''); }}>Sign out</button>
        </div>
      </div>

      <div className="stat-grid" style={{ marginTop: 20 }}>
        <Stat label="Uptime" value={formatDuration(data.system.uptimeSeconds)} />
        <Stat label="Memory" value={`${data.system.memoryMb} MB`} />
        <Stat label="Load (1m)" value={String(data.system.loadAverage[0])} />
        <Stat label="Store" value={data.system.database} />
        <Stat label="Jobs tracked" value={String(data.jobs.total)} />
        <Stat label="Average job" value={data.jobs.averageMs ? `${(data.jobs.averageMs / 1000).toFixed(1)}s` : '—'} />
        <Stat label="Stored files" value={`${data.storage.files} · ${formatBytes(data.storage.bytes)}`} />
        <Stat label="Environment" value={data.system.env} />
      </div>

      <div className="split" style={{ marginTop: 26 }}>
        <div className="card">
          <h3>Providers</h3>
          <ul className="small" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <ProviderRow ok={data.providers.ai.configured} label={`AI — ${data.providers.ai.provider}${data.providers.ai.model ? ` (${data.providers.ai.model})` : ''}`} />
            <ProviderRow ok={data.providers.transcription.configured} label={`Transcription — ${data.providers.transcription.provider}`} />
            <ProviderRow ok={data.providers.media.ffmpeg} label="FFmpeg media processing" />
            <ProviderRow ok={data.providers.office} label="LibreOffice Office conversion (optional)" />
          </ul>
        </div>
        <div className="card">
          <h3>Job status</h3>
          <ul className="small" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {Object.entries(data.jobs.byStatus).map(([k, v]) => (
              <li key={k} className="row row--between" style={{ padding: '5px 0' }}><span>{k}</span><strong>{v}</strong></li>
            ))}
            {!Object.keys(data.jobs.byStatus).length && <li className="muted">No jobs yet.</li>}
          </ul>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3>Most used tools</h3>
        <div className="chips">
          {Object.entries(data.jobs.byTool).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([tool, count]) => (
            <span className="chip" key={tool}>{tool} · {count}</span>
          ))}
          {!Object.keys(data.jobs.byTool).length && <span className="muted small">No tool runs recorded yet.</span>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20, overflowX: 'auto' }}>
        <h3>Recent jobs</h3>
        <table className="table">
          <thead><tr><th>Tool</th><th>Status</th><th>Duration</th><th>When</th><th>Error</th></tr></thead>
          <tbody>
            {data.jobs.recent.map((j) => (
              <tr key={j.id}>
                <td>{j.tool}</td>
                <td><span className="pill">{j.status}</span></td>
                <td>{(j.durationMs / 1000).toFixed(1)}s</td>
                <td>{new Date(j.createdAt).toLocaleTimeString()}</td>
                <td className="muted">{j.error ?? '—'}</td>
              </tr>
            ))}
            {!data.jobs.recent.length && <tr><td colSpan={5} className="muted">Nothing yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3>Anonymous usage counts</h3>
        <div className="chips">
          {Object.entries(data.usage).map(([k, v]) => <span className="chip" key={k}>{k} · {v}</span>)}
          {!Object.keys(data.usage).length && <span className="muted small">No events recorded yet.</span>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat"><div className="stat__label">{label}</div><div className="stat__value">{value}</div></div>;
}

function ProviderRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="row" style={{ gap: 8, padding: '5px 0' }}>
      <span style={{ color: ok ? 'var(--success)' : 'var(--muted)' }}><Icon name={ok ? 'check' : 'info'} size={16} /></span>
      <span>{label}</span>
      <span className="grow" />
      <span className="tiny muted">{ok ? 'configured' : 'not configured'}</span>
    </li>
  );
}

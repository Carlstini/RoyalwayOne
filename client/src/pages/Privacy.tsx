import { useEffect, useState } from 'react';
import { api, formatBytes } from '../lib/api';
import { setMeta } from './ToolPage';

export function Privacy() {
  const [limits, setLimits] = useState<{ maxUploadBytes: number; maxMediaSeconds: number; retentionMinutes: number } | null>(null);

  useEffect(() => {
    document.title = 'Privacy & your files — Royalway One';
    setMeta('description', 'How Royalway One handles your files: temporary storage, signed links, automatic deletion and no accounts.');
    api.capabilities().then((c) => setLimits(c.limits)).catch(() => {});
  }, []);

  return (
    <div className="page page--narrow">
      <h1>Privacy &amp; your files</h1>
      <p className="muted">Royalway One is open by default. There is no account, no sign-in and no payment.</p>

      <h2>What happens to a file you upload</h2>
      <ol>
        <li>It is uploaded over an encrypted connection and stored in private temporary storage.</li>
        <li>It is validated — we check the real file type, not just the name.</li>
        <li>It is processed by the tool you chose.</li>
        <li>You download the result through a signed link that expires.</li>
        <li>Both the original and the result are deleted automatically.</li>
      </ol>

      {limits && (
        <div className="stat-grid" style={{ margin: '20px 0' }}>
          <div className="stat"><div className="stat__label">Maximum upload</div><div className="stat__value">{formatBytes(limits.maxUploadBytes)}</div></div>
          <div className="stat"><div className="stat__label">Maximum media length</div><div className="stat__value">{Math.round(limits.maxMediaSeconds / 60)} min</div></div>
          <div className="stat"><div className="stat__label">Automatic deletion</div><div className="stat__value">{limits.retentionMinutes} min</div></div>
        </div>
      )}

      <h2>What we do not do</h2>
      <ul>
        <li>We do not require an account or collect personal details.</li>
        <li>We do not keep your files after the retention window.</li>
        <li>We do not publish predictable file links — every download link is signed and expires.</li>
        <li>We do not sell data or run advertising trackers.</li>
      </ul>

      <h2>Analytics</h2>
      <p>We record anonymous counts, such as which tool categories are used and whether a job succeeded or failed. No file names, file contents, IP addresses or identifiers are stored with those counts.</p>

      <h2>AI and transcription</h2>
      <p>When you use an AI or transcription tool, the relevant text or audio is sent to the configured provider to produce your result. Provider credentials live only on the server, never in your browser. If those providers are not configured for this deployment, the affected tools clearly say so rather than pretending to work.</p>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { QuickSearch } from '../components/Layout';

export function NotFound() {
  return (
    <div className="page page--narrow center" style={{ paddingTop: 80 }}>
      <h1>That page does not exist</h1>
      <p className="muted">The link may be old, or the tool may have moved. Search for what you need:</p>
      <div style={{ maxWidth: 460, margin: '20px auto' }}><QuickSearch /></div>
      <Link className="btn btn--primary" to="/tools">Browse all tools</Link>
    </div>
  );
}

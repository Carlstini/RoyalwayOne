import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import type { Tool } from '../lib/api';

export function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Link className="tool-card" to={tool.route}>
      <span className="tool-card__icon"><Icon name={tool.icon} size={19} /></span>
      <span style={{ minWidth: 0 }}>
        <span className="tool-card__name" style={{ display: 'block' }}>{tool.name}</span>
        <span className="tool-card__desc">{tool.description}</span>
        {!tool.available && <span className="tool-card__badge">Needs setup</span>}
      </span>
    </Link>
  );
}

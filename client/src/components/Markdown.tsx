import { useMemo } from 'react';

/** Minimal, safe Markdown renderer — no HTML passthrough, no dependencies. */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parse(text), [text]);
  return <div className="prose">{blocks}</div>;
}

function inline(text: string, keyPrefix: string) {
  const nodes: (string | JSX.Element)[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith('**')) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('[')) {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(token)!;
      nodes.push(/^https?:\/\//i.test(href) ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{label}</a> : <span key={key}>{label}</span>);
    } else nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function parse(source: string): JSX.Element[] {
  const lines = source.replace(/\r/g, '').split('\n');
  const out: JSX.Element[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = (['h2', 'h3', 'h4', 'h5'][level - 1] ?? 'h4') as keyof JSX.IntrinsicElements;
      out.push(<Tag key={key++}>{inline(heading[2], `h${key}`)}</Tag>);
      i++; continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[-:\s|]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const rows: string[][] = [];
      const header = splitRow(line);
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      out.push(
        <table key={key++}>
          <thead><tr>{header.map((h, hi) => <th key={hi}>{inline(h, `th${hi}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, `td${ri}${ci}`)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*•]\s+/, '')); i++; }
      out.push(<ul key={key++}>{items.map((it, ii) => <li key={ii}>{inline(it, `li${ii}`)}</li>)}</ul>);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
      out.push(<ol key={key++}>{items.map((it, ii) => <li key={ii}>{inline(it, `oli${ii}`)}</li>)}</ol>);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(<blockquote key={key++}>{inline(quote.join(' '), `bq${key}`)}</blockquote>);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*•]\s|\s*\d+[.)]\s|>|\|)/.test(lines[i])) { para.push(lines[i]); i++; }
    out.push(<p key={key++}>{inline(para.join(' '), `p${key}`)}</p>);
  }

  return out;
}

const splitRow = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

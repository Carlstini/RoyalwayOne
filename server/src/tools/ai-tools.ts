import { getDocumentContext } from '../services/document-store.js';
import { AI_TASKS, compareDocuments, extractEntities, rewrite, runTask, translate, type AiTaskId } from '../services/ai/tasks.js';
import { AppError } from '../lib/errors.js';
import type { ToolDefinition, ToolRunContext } from './types.js';

const DOC_ACCEPT = ['application/pdf', '.pdf', '.docx', '.doc', '.txt', '.md', '.rtf', '.xlsx', '.csv', '.pptx', 'image/*', 'text/*'];

async function sourceText(ctx: ToolRunContext): Promise<{ text: string; label: string }> {
  const pasted = String(ctx.params.text ?? '').trim();
  if (pasted) return { text: pasted, label: 'Pasted text' };
  if (!ctx.files.length) throw new AppError('Upload a document or paste some text first.', 400, 'BAD_REQUEST');
  await ctx.setStage('reading document');
  const { doc } = await getDocumentContext(ctx.files[0]);
  return { text: doc.text, label: ctx.files[0].name };
}

function aiTool(opts: {
  id: string; task: AiTaskId; name: string; description: string; icon: string; route: string;
  keywords: string[]; category?: 'ai' | 'business';
}): ToolDefinition {
  return {
    id: opts.id,
    name: opts.name,
    category: opts.category ?? 'ai',
    description: opts.description,
    icon: opts.icon,
    route: opts.route,
    keywords: opts.keywords,
    accept: DOC_ACCEPT,
    minFiles: 0,
    maxFiles: 1,
    heavy: true,
    requires: ['ai'],
    outputKind: 'text',
    fields: [
      { key: 'text', label: 'Or paste text instead', type: 'textarea', placeholder: 'Paste your content here…' },
      { key: 'instruction', label: 'Extra instruction (optional)', type: 'text', placeholder: 'e.g. focus on the financial risks' },
    ],
    async run(ctx) {
      const src = await sourceText(ctx);
      await ctx.setStage('analysing');
      const { output, truncated } = await runTask(opts.task, src.text, ctx.params.instruction ? String(ctx.params.instruction) : undefined);
      return { text: output, stats: { source: src.label, characters: src.text.length, truncated, task: AI_TASKS[opts.task].label } };
    },
  };
}

export const aiTools: ToolDefinition[] = [
  aiTool({ id: 'ai-summarize', task: 'summary', name: 'Summarise', description: 'Get an accurate summary of any document, transcript or pasted text.', icon: 'sparkle', route: '/ai/summarize', keywords: ['summarise', 'summarize', 'summary', 'tldr', 'shorten document'] }),
  aiTool({ id: 'ai-executive-summary', task: 'executive-summary', name: 'Executive summary', description: 'A concise, leadership-ready overview of the material.', icon: 'briefcase', route: '/ai/executive-summary', keywords: ['executive summary', 'brief', 'leadership summary'], category: 'business' }),
  aiTool({ id: 'ai-key-points', task: 'key-points', name: 'Key points', description: 'Pull out the points that actually matter.', icon: 'list', route: '/ai/key-points', keywords: ['key points', 'bullet points', 'highlights'] }),
  aiTool({ id: 'ai-action-items', task: 'action-items', name: 'Action items', description: 'Find the tasks, owners and deadlines hidden in your content.', icon: 'check', route: '/ai/action-items', keywords: ['action items', 'todos', 'tasks', 'follow ups'], category: 'business' }),
  aiTool({ id: 'ai-decisions', task: 'decisions', name: 'Decisions', description: 'Identify every decision that was recorded.', icon: 'gavel', route: '/ai/decisions', keywords: ['decisions', 'decision log', 'agreed'], category: 'business' }),
  aiTool({ id: 'ai-explain', task: 'explain', name: 'Explain simply', description: 'Turn dense or technical content into plain language.', icon: 'lightbulb', route: '/ai/explain', keywords: ['explain', 'simplify', 'plain english', 'eli5'] }),
  aiTool({ id: 'ai-meeting-minutes', task: 'meeting-minutes', name: 'Meeting minutes', description: 'Formal minutes with attendees, decisions and actions.', icon: 'notes', route: '/ai/meeting-minutes', keywords: ['meeting minutes', 'minutes', 'meeting notes'], category: 'business' }),
  aiTool({ id: 'ai-follow-up-email', task: 'follow-up-email', name: 'Follow-up email', description: 'A professional recap email drafted from your meeting or document.', icon: 'mail', route: '/ai/follow-up-email', keywords: ['follow up email', 'recap email', 'email after meeting'], category: 'business' }),
  aiTool({ id: 'ai-swot', task: 'swot', name: 'SWOT analysis', description: 'Strengths, weaknesses, opportunities and threats, grounded in your document.', icon: 'grid', route: '/ai/swot', keywords: ['swot', 'analysis', 'strategy'], category: 'business' }),
  aiTool({ id: 'ai-presentation-outline', task: 'presentation-outline', name: 'Presentation outline', description: 'A slide-by-slide outline built from your source material.', icon: 'slides', route: '/ai/presentation-outline', keywords: ['presentation outline', 'slide deck', 'pitch outline'], category: 'business' }),
  aiTool({ id: 'ai-project-brief', task: 'project-brief', name: 'Project brief', description: 'A structured brief with objectives, scope, risks and timeline.', icon: 'clipboard', route: '/ai/project-brief', keywords: ['project brief', 'scope document'], category: 'business' }),
  aiTool({ id: 'ai-decision-log', task: 'decision-log', name: 'Decision log', description: 'A tabular decision log with rationale, owners and status.', icon: 'table', route: '/ai/decision-log', keywords: ['decision log', 'record of decisions'], category: 'business' }),
  aiTool({ id: 'ai-proposal-analyzer', task: 'proposal-analysis', name: 'Proposal analyser', description: 'Understand what a proposal really commits you to.', icon: 'search', route: '/ai/proposal-analyzer', keywords: ['proposal analysis', 'review proposal', 'tender', 'bid'], category: 'business' }),
  aiTool({ id: 'ai-policy-summarizer', task: 'policy-summary', name: 'Policy summariser', description: 'Condense a policy into rules, responsibilities and exceptions.', icon: 'shield', route: '/ai/policy-summarizer', keywords: ['policy summary', 'summarise policy', 'compliance'], category: 'business' }),
  aiTool({ id: 'ai-document-review', task: 'document-review', name: 'Document review assistant', description: 'A professional review with gaps, inconsistencies and improvements.', icon: 'eye', route: '/ai/document-review', keywords: ['review document', 'proofread', 'critique'], category: 'business' }),
  aiTool({ id: 'ai-job-description', task: 'job-description', name: 'Job description generator', description: 'Build a structured job description from notes or a brief.', icon: 'user', route: '/ai/job-description', keywords: ['job description', 'hiring', 'role profile'], category: 'business' }),
  aiTool({ id: 'ai-report-summarizer', task: 'report-summary', name: 'Report summariser', description: 'Findings, figures and recommendations from any report.', icon: 'chart', route: '/ai/report-summarizer', keywords: ['summarise report', 'report summary', 'findings'], category: 'business' }),
  {
    id: 'ai-extract',
    name: 'Extract information',
    category: 'ai',
    description: 'Pull out names, dates, amounts, deadlines, organisations and responsibilities.',
    icon: 'target',
    route: '/ai/extract',
    keywords: ['extract information', 'entities', 'find dates', 'find amounts', 'data extraction'],
    accept: DOC_ACCEPT, minFiles: 0, maxFiles: 1, heavy: true, requires: ['ai'], outputKind: 'data',
    fields: [{ key: 'text', label: 'Or paste text instead', type: 'textarea', placeholder: 'Paste your content here…' }],
    async run(ctx) {
      const src = await sourceText(ctx);
      await ctx.setStage('extracting');
      const { data, truncated } = await extractEntities(src.text);
      return { data, stats: { source: src.label, truncated } };
    },
  },
  {
    id: 'ai-rewrite',
    name: 'Rewrite',
    category: 'ai',
    description: 'Rewrite text as professional, simpler, shorter, more detailed or executive-friendly.',
    icon: 'pen',
    route: '/ai/rewrite',
    keywords: ['rewrite', 'rephrase', 'improve writing', 'tone', 'email rewriter'],
    accept: DOC_ACCEPT, minFiles: 0, maxFiles: 1, heavy: true, requires: ['ai'], outputKind: 'text',
    fields: [
      { key: 'text', label: 'Text to rewrite', type: 'textarea', placeholder: 'Paste your text here…' },
      { key: 'style', label: 'Style', type: 'select', default: 'professional', options: [
        { value: 'professional', label: 'Professional' }, { value: 'simpler', label: 'Simpler' }, { value: 'shorter', label: 'Shorter' },
        { value: 'detailed', label: 'More detailed' }, { value: 'executive', label: 'Executive-friendly' }, { value: 'friendly', label: 'Friendly' },
      ] },
      { key: 'instruction', label: 'Extra instruction (optional)', type: 'text' },
    ],
    async run(ctx) {
      const src = await sourceText(ctx);
      await ctx.setStage('rewriting');
      const { output, truncated } = await rewrite(src.text, String(ctx.params.style ?? 'professional'), ctx.params.instruction ? String(ctx.params.instruction) : undefined);
      return { text: output, stats: { source: src.label, style: ctx.params.style ?? 'professional', truncated } };
    },
  },
  {
    id: 'ai-translate',
    name: 'Translate',
    category: 'ai',
    description: 'Translate a document or pasted text while preserving its structure.',
    icon: 'globe',
    route: '/ai/translate',
    keywords: ['translate', 'translation', 'language', 'translate document'],
    accept: DOC_ACCEPT, minFiles: 0, maxFiles: 1, heavy: true, requires: ['ai'], outputKind: 'text',
    fields: [
      { key: 'text', label: 'Or paste text instead', type: 'textarea', placeholder: 'Paste your text here…' },
      { key: 'target', label: 'Translate into', type: 'select', default: 'Spanish', options: ['Arabic', 'Chinese (Simplified)', 'Dutch', 'English', 'French', 'German', 'Hindi', 'Italian', 'Japanese', 'Polish', 'Portuguese', 'Spanish', 'Swedish', 'Turkish'].map((v) => ({ value: v, label: v })) },
    ],
    async run(ctx) {
      const src = await sourceText(ctx);
      await ctx.setStage('translating');
      const { output, truncated } = await translate(src.text, String(ctx.params.target ?? 'Spanish'));
      return { text: output, stats: { source: src.label, target: ctx.params.target, truncated } };
    },
  },
  {
    id: 'ai-compare',
    name: 'Compare documents',
    category: 'ai',
    description: 'See exactly what changed between two versions of a document.',
    icon: 'compare',
    route: '/ai/compare',
    keywords: ['compare documents', 'diff', 'what changed', 'contract comparison', 'version compare'],
    accept: DOC_ACCEPT, minFiles: 2, maxFiles: 2, heavy: true, requires: ['ai'], outputKind: 'text',
    async run(ctx) {
      if (ctx.files.length !== 2) throw new AppError('Upload exactly two documents to compare.', 400, 'BAD_REQUEST');
      await ctx.setStage('reading documents');
      const [a, b] = await Promise.all(ctx.files.map((f) => getDocumentContext(f)));
      await ctx.setStage('comparing');
      const { output, truncated } = await compareDocuments(
        { name: ctx.files[0].name, text: a.doc.text },
        { name: ctx.files[1].name, text: b.doc.text },
      );
      const diff = textDiff(a.doc.text, b.doc.text);
      return { text: output, data: { diff }, stats: { documentA: ctx.files[0].name, documentB: ctx.files[1].name, truncated, ...diff.summary } };
    },
  },
  {
    id: 'ai-document-chat',
    name: 'Ask your document',
    category: 'ai',
    description: 'Chat with a document and get answers grounded in what it actually says.',
    icon: 'chat',
    route: '/ai/document-chat',
    keywords: ['ask document', 'chat with pdf', 'document q&a', 'question document', 'ask a question'],
    accept: DOC_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, requires: ['ai'], outputKind: 'text',
    async run(ctx) {
      await ctx.setStage('reading document');
      const { doc } = await getDocumentContext(ctx.files[0]);
      return {
        data: { documentId: ctx.files[0].id, name: ctx.files[0].name, pages: doc.pages.length, characters: doc.characters, method: doc.method },
        message: 'Document ready. Ask anything about it.',
      };
    },
  },
  {
    id: 'ai-email',
    name: 'Professional email',
    category: 'business',
    description: 'Draft a clear, professional email from a short brief or a document.',
    icon: 'mail',
    route: '/ai/email',
    keywords: ['write email', 'professional email', 'email generator', 'draft email'],
    accept: DOC_ACCEPT, minFiles: 0, maxFiles: 1, heavy: true, requires: ['ai'], outputKind: 'text',
    fields: [
      { key: 'purpose', label: 'What is the email for?', type: 'text', placeholder: 'e.g. chase an overdue invoice politely' },
      { key: 'text', label: 'Background or content (optional)', type: 'textarea' },
      { key: 'tone', label: 'Tone', type: 'select', default: 'professional', options: ['professional', 'friendly', 'formal', 'direct', 'apologetic', 'persuasive'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
    ],
    async run(ctx) {
      const purpose = String(ctx.params.purpose ?? '').trim();
      if (!purpose) throw new AppError('Tell us what the email needs to achieve.', 400, 'BAD_REQUEST');
      let context = String(ctx.params.text ?? '').trim();
      if (!context && ctx.files.length) context = (await getDocumentContext(ctx.files[0])).doc.text;
      await ctx.setStage('writing');
      const { generateEmail } = await import('../services/ai/tasks.js');
      const output = await generateEmail(purpose, context || purpose, String(ctx.params.tone ?? 'professional'));
      return { text: output, stats: { tone: ctx.params.tone ?? 'professional' } };
    },
  },
  {
    id: 'ai-spreadsheet-insights',
    name: 'Spreadsheet insights',
    category: 'business',
    description: 'Understand what a spreadsheet is telling you: trends, outliers and totals.',
    icon: 'chart',
    route: '/ai/spreadsheet-insights',
    keywords: ['spreadsheet insights', 'analyse excel', 'csv analysis', 'data insights'],
    accept: ['.xlsx', '.xls', '.csv', 'text/csv'], minFiles: 1, maxFiles: 1, heavy: true, requires: ['ai'], outputKind: 'text',
    async run(ctx) {
      await ctx.setStage('reading spreadsheet');
      const { doc } = await getDocumentContext(ctx.files[0]);
      await ctx.setStage('analysing');
      const { output, truncated } = await runTask('report-summary', `Spreadsheet data (CSV per sheet):\n${doc.text}`, 'Describe the structure, then give totals, notable trends, outliers and data-quality issues. Only use the supplied values.');
      return { text: output, stats: { sheets: doc.pages.length, truncated } };
    },
  },
];

/** Lightweight line-level diff so the UI can highlight changes without AI. */
export function textDiff(a: string, b: string) {
  const A = a.split('\n').map((l) => l.trim()).filter(Boolean);
  const B = b.split('\n').map((l) => l.trim()).filter(Boolean);
  const setA = new Set(A);
  const setB = new Set(B);
  const removed = A.filter((l) => !setB.has(l));
  const added = B.filter((l) => !setA.has(l));
  const unchanged = A.filter((l) => setB.has(l));
  return {
    added: added.slice(0, 400),
    removed: removed.slice(0, 400),
    summary: {
      linesAdded: added.length,
      linesRemoved: removed.length,
      linesUnchanged: unchanged.length,
      similarity: Math.round((unchanged.length / Math.max(1, Math.max(A.length, B.length))) * 100),
    },
  };
}

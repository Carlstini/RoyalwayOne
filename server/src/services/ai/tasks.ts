/** Grounded AI tasks. Every output is derived from the user's actual content. */
import { config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import { requireAI, type ChatMessage } from './index.js';

const BASE_SYSTEM = `You are Royalway One's document intelligence engine.
Rules you must always follow:
- Base every statement strictly on the supplied source material.
- Never invent names, dates, figures, decisions or commitments.
- If the source does not contain the answer, say so plainly.
- Write in clear, professional British English unless asked otherwise.
- Return clean Markdown without preamble such as "Here is".`;

export function clip(text: string, max = config.ai.maxInputChars) {
  const t = text.trim();
  if (!t) throw new AppError('There is no readable text in this content to work with.', 422, 'NO_TEXT');
  if (t.length <= max) return { text: t, truncated: false };
  return { text: `${t.slice(0, max)}\n\n[Content truncated for length]`, truncated: true };
}

async function ask(system: string, user: string, opts: { json?: boolean; maxTokens?: number; temperature?: number } = {}) {
  const provider = requireAI();
  const messages: ChatMessage[] = [
    { role: 'system', content: `${BASE_SYSTEM}\n\n${system}` },
    { role: 'user', content: user },
  ];
  return provider.complete(messages, opts);
}

const source = (text: string) => `SOURCE MATERIAL:\n"""\n${text}\n"""`;

export const AI_TASKS = {
  summary: {
    label: 'Summary',
    system: 'Summarise the source material accurately in flowing prose. Cover the purpose, main content and outcome.',
  },
  'executive-summary': {
    label: 'Executive summary',
    system: 'Write an executive summary for a senior leader: 4-8 sentences, focused on purpose, findings, risks, financials and required decisions. Only include what the source supports.',
  },
  'key-points': {
    label: 'Key points',
    system: 'Extract the key points as a Markdown bullet list. Each bullet must be self-contained and factual.',
  },
  'action-items': {
    label: 'Action items',
    system: 'Extract action items as a Markdown table with the columns Action | Owner | Due date | Source detail. Use "Not stated" when the source does not specify an owner or date. If there are no action items, say so.',
  },
  decisions: {
    label: 'Decisions',
    system: 'List the decisions recorded in the source as bullets, each with what was decided and by whom if stated. If none, say that no decisions were recorded.',
  },
  topics: {
    label: 'Topics',
    system: 'List the distinct topics discussed, each with a one-line description of what was said about it.',
  },
  questions: {
    label: 'Open questions',
    system: 'List unresolved questions or items awaiting an answer that appear in the source. If none, say so.',
  },
  'important-moments': {
    label: 'Important moments',
    system: 'Identify the most important moments. If timestamps appear in the source, include them exactly as written.',
  },
  'meeting-minutes': {
    label: 'Meeting minutes',
    system: 'Produce formal meeting minutes with these sections: Meeting overview, Attendees (only if stated), Agenda/topics discussed, Decisions, Action items table, Next steps. Mark unknown details as "Not stated".',
    maxTokens: 3000,
  },
  'follow-up-email': {
    label: 'Follow-up email',
    system: 'Write a professional follow-up email. Include a Subject line, a short greeting, a concise recap, decisions, an action list with owners, and a polite close. Use only facts from the source.',
  },
  explain: {
    label: 'Explain simply',
    system: 'Explain the source material in plain language for a non-expert. Define jargon. Keep the meaning exact.',
  },
  'swot': {
    label: 'SWOT analysis',
    system: 'Produce a SWOT analysis with four Markdown sections: Strengths, Weaknesses, Opportunities, Threats. Ground every entry in the source.',
  },
  'presentation-outline': {
    label: 'Presentation outline',
    system: 'Produce a slide-by-slide presentation outline. For each slide give a title and 3-5 concise bullets drawn from the source.',
  },
  'project-brief': {
    label: 'Project brief',
    system: 'Produce a project brief with Background, Objectives, Scope, Deliverables, Stakeholders, Timeline, Risks. Mark anything absent as "Not stated".',
  },
  'decision-log': {
    label: 'Decision log',
    system: 'Produce a decision log as a Markdown table: Decision | Rationale | Owner | Date | Status.',
  },
  'proposal-analysis': {
    label: 'Proposal analysis',
    system: 'Analyse this proposal: what is offered, pricing and commercial terms, obligations, timelines, risks, gaps and questions to raise. Only use what the source states.',
  },
  'policy-summary': {
    label: 'Policy summary',
    system: 'Summarise this policy: scope, who it applies to, key rules, responsibilities, exceptions and consequences.',
  },
  'document-review': {
    label: 'Document review',
    system: 'Review the document as a professional reviewer: purpose, structure, clarity issues, inconsistencies, missing information and specific improvement suggestions.',
  },
  'job-description': {
    label: 'Job description',
    system: 'Produce a structured job description with Role summary, Responsibilities, Required skills, Desirable skills, and Success measures, based on the source.',
  },
  'report-summary': {
    label: 'Report summary',
    system: 'Summarise this report with Purpose, Method (if stated), Findings, Figures, Conclusions and Recommendations.',
  },
} as const;

export type AiTaskId = keyof typeof AI_TASKS;

export async function runTask(taskId: AiTaskId, text: string, extraInstruction?: string) {
  const task = AI_TASKS[taskId];
  if (!task) throw new AppError('That AI action is not available.', 400, 'BAD_REQUEST');
  const { text: clipped, truncated } = clip(text);
  const user = `${source(clipped)}${extraInstruction ? `\n\nADDITIONAL INSTRUCTION: ${extraInstruction}` : ''}`;
  const output = await ask(task.system, user, { maxTokens: (task as any).maxTokens ?? 2200 });
  return { output, truncated, task: task.label };
}

export async function rewrite(text: string, style: string, instruction?: string) {
  const { text: clipped, truncated } = clip(text);
  const styles: Record<string, string> = {
    professional: 'Rewrite in a polished professional tone.',
    simpler: 'Rewrite in simpler, plainer language.',
    shorter: 'Rewrite significantly shorter while keeping all essential meaning.',
    detailed: 'Rewrite with more structure and detail, without inventing new facts.',
    executive: 'Rewrite for a busy executive: direct, outcome-first, minimal detail.',
    friendly: 'Rewrite in a warm, approachable tone while staying professional.',
  };
  const directive = styles[style] ?? styles.professional;
  const output = await ask(
    `${directive} Preserve all facts exactly. Return only the rewritten text.`,
    `${source(clipped)}${instruction ? `\n\nADDITIONAL INSTRUCTION: ${instruction}` : ''}`,
    { maxTokens: 3000, temperature: 0.3 },
  );
  return { output, truncated };
}

export async function translate(text: string, targetLanguage: string) {
  const { text: clipped, truncated } = clip(text);
  const output = await ask(
    `Translate the source material into ${targetLanguage}. Preserve formatting, structure, names, numbers and dates. Return only the translation.`,
    source(clipped),
    { maxTokens: 3500, temperature: 0.1 },
  );
  return { output, truncated };
}

export interface ExtractionResult {
  people: { name: string; role?: string; context?: string }[];
  organisations: string[];
  dates: { value: string; meaning?: string }[];
  amounts: { value: string; meaning?: string }[];
  deadlines: { value: string; item?: string; owner?: string }[];
  locations: string[];
  figures: { value: string; meaning?: string }[];
  responsibilities: { owner: string; responsibility: string }[];
}

export async function extractEntities(text: string): Promise<{ data: ExtractionResult; truncated: boolean }> {
  const { text: clipped, truncated } = clip(text);
  const raw = await ask(
    `Extract structured information. Respond with JSON only, matching exactly this shape:
{"people":[{"name":"","role":"","context":""}],"organisations":[""],"dates":[{"value":"","meaning":""}],"amounts":[{"value":"","meaning":""}],"deadlines":[{"value":"","item":"","owner":""}],"locations":[""],"figures":[{"value":"","meaning":""}],"responsibilities":[{"owner":"","responsibility":""}]}
Use empty arrays where nothing is present. Never invent entries.`,
    source(clipped),
    { json: true, maxTokens: 2500, temperature: 0 },
  );
  return { data: parseJson<ExtractionResult>(raw), truncated };
}

export function parseJson<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/[{[][\s\S]*[}\]]/);
    if (match) {
      try { return JSON.parse(match[0]) as T; } catch { /* fall through */ }
    }
    throw new AppError('The AI response could not be read. Please try again.', 502, 'AI_FAILED');
  }
}

export async function compareDocuments(a: { name: string; text: string }, b: { name: string; text: string }) {
  const half = Math.floor(config.ai.maxInputChars / 2);
  const at = clip(a.text, half);
  const bt = clip(b.text, half);
  const output = await ask(
    `Compare two versions of a document. Produce Markdown with these sections:
## Executive summary of changes
## Added
## Removed
## Changed wording
## Changed dates and figures
## Changed clauses or obligations
## What stayed the same
## Changes that matter most
Quote short excerpts to evidence each point. Never invent changes.`,
    `DOCUMENT A (${a.name}):\n"""\n${at.text}\n"""\n\nDOCUMENT B (${b.name}):\n"""\n${bt.text}\n"""`,
    { maxTokens: 3000 },
  );
  return { output, truncated: at.truncated || bt.truncated };
}

export async function answerFromContext(question: string, contexts: { label: string; text: string }[], history: ChatMessage[] = []) {
  const provider = requireAI();
  const contextBlock = contexts.map((c) => `[${c.label}]\n${c.text}`).join('\n\n---\n\n');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${BASE_SYSTEM}

You answer questions about the user's uploaded material using ONLY the supplied excerpts.
- Cite the excerpt labels you used, like [Page 3].
- If the excerpts do not contain the answer, reply exactly: "I could not find that in this document." and suggest what to look for instead.
- Be concise and specific; quote figures and dates verbatim.

EXCERPTS FROM THE USER'S DOCUMENT:
"""
${contextBlock}
"""`,
    },
    ...history.slice(-8),
    { role: 'user', content: question },
  ];
  return provider.complete(messages, { maxTokens: 1500, temperature: 0.1 });
}

export async function generateEmail(purpose: string, context: string, tone = 'professional') {
  const { text: clipped } = clip(context || purpose);
  return ask(
    `Write a complete email in a ${tone} tone for this purpose: ${purpose}. Include a Subject line. Only use facts present in the source material.`,
    source(clipped),
    { maxTokens: 1200, temperature: 0.4 },
  );
}

export async function freeformChat(messages: ChatMessage[]) {
  const provider = requireAI();
  return provider.complete([{ role: 'system', content: `${BASE_SYSTEM}\nYou are a helpful business and document assistant.` }, ...messages.slice(-16)], { maxTokens: 1800, temperature: 0.4 });
}

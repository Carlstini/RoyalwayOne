import { pdfTools } from './pdf-tools.js';
import { imageTools } from './image-tools.js';
import { audioTools, videoTools } from './media-tools.js';
import { transcribeTools } from './transcribe-tools.js';
import { aiTools } from './ai-tools.js';
import { aiAvailable } from '../services/ai/index.js';
import { transcriptionAvailable } from '../services/transcription/index.js';
import type { ToolCategory, ToolDefinition } from './types.js';

export const allTools: ToolDefinition[] = [
  ...pdfTools, ...imageTools, ...audioTools, ...videoTools, ...transcribeTools, ...aiTools,
];

const byId = new Map(allTools.map((t) => [t.id, t]));
export const getTool = (id: string) => byId.get(id);
export const getToolByRoute = (route: string) => allTools.find((t) => t.route === route);

export interface CategoryMeta { id: ToolCategory; name: string; description: string; icon: string }

export const categories: CategoryMeta[] = [
  { id: 'pdf', name: 'PDF & Documents', description: 'Compress, convert, merge, split, protect and OCR.', icon: 'document' },
  { id: 'image', name: 'Images', description: 'Compress, convert, resize, crop and clean up photos.', icon: 'image' },
  { id: 'audio', name: 'Audio', description: 'Convert, trim, merge and enhance audio.', icon: 'music' },
  { id: 'video', name: 'Video', description: 'Compress, convert, trim, resize and edit video.', icon: 'video' },
  { id: 'transcribe', name: 'Transcription', description: 'Turn speech into accurate, timestamped text.', icon: 'waveform' },
  { id: 'ai', name: 'AI Workspace', description: 'Summarise, extract, compare, translate and ask questions.', icon: 'sparkle' },
  { id: 'business', name: 'Business Tools', description: 'Minutes, briefs, emails and analysis that save real time.', icon: 'briefcase' },
  { id: 'workflow', name: 'Workflows', description: 'Chain tools together into one click.', icon: 'workflow' },
];

/** A tool is unavailable only when its required provider is not configured. */
export function toolAvailability(tool: ToolDefinition) {
  const missing: string[] = [];
  if (tool.requires?.includes('ai') && !aiAvailable()) missing.push('ai');
  if (tool.requires?.includes('transcription') && !transcriptionAvailable()) missing.push('transcription');
  return { available: missing.length === 0, missing };
}

export function serializeTool(tool: ToolDefinition) {
  const { available, missing } = toolAvailability(tool);
  return {
    id: tool.id,
    name: tool.name,
    category: tool.category,
    description: tool.description,
    icon: tool.icon,
    route: tool.route,
    keywords: tool.keywords,
    accept: tool.accept,
    minFiles: tool.minFiles,
    maxFiles: tool.maxFiles,
    heavy: !!tool.heavy,
    fields: tool.fields ?? [],
    outputKind: tool.outputKind,
    available,
    missing,
  };
}

/** Ranked tool search over names, descriptions and intent keywords. */
export function searchTools(query: string, limit = 12) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = allTools.map((tool) => {
    const haystacks = [tool.name.toLowerCase(), tool.keywords.join(' ').toLowerCase(), tool.description.toLowerCase(), tool.category];
    let score = 0;
    if (haystacks[0] === q) score += 100;
    if (haystacks[0].includes(q)) score += 40;
    if (haystacks[1].includes(q)) score += 35;
    for (const term of terms) {
      if (haystacks[0].includes(term)) score += 12;
      if (haystacks[1].includes(term)) score += 9;
      if (haystacks[2].includes(term)) score += 4;
      if (haystacks[3].includes(term)) score += 3;
    }
    return { tool, score };
  }).filter((s) => s.score > 0);
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => serializeTool(s.tool));
}

/** Suggest tools that make sense for the files a user has just dropped in. */
export function suggestForFiles(files: { name: string; mime: string }[]) {
  const kinds = new Set(files.map((f) => kindOf(f)));
  const suggestions: string[] = [];
  if (kinds.has('pdf')) suggestions.push('pdf-compress', 'pdf-merge', 'pdf-split', 'pdf-to-word', 'ai-summarize', 'pdf-ocr');
  if (kinds.has('image')) suggestions.push('image-compress', 'image-convert', 'image-resize', 'images-to-pdf');
  if (kinds.has('audio')) suggestions.push('transcribe-file', 'audio-convert', 'audio-compress', 'audio-trim');
  if (kinds.has('video')) suggestions.push('video-compress', 'audio-extract', 'transcribe-file', 'video-trim');
  if (kinds.has('doc')) suggestions.push('word-to-pdf', 'ai-summarize', 'ai-key-points', 'ai-compare');
  if (kinds.has('sheet')) suggestions.push('excel-to-pdf', 'ai-spreadsheet-insights');
  if (kinds.has('slides')) suggestions.push('powerpoint-to-pdf', 'ai-summarize');
  const unique = [...new Set(suggestions)];
  return unique.map((id) => byId.get(id)).filter(Boolean).map((t) => serializeTool(t!));
}

export function kindOf(file: { name: string; mime: string }) {
  const n = file.name.toLowerCase();
  if (file.mime === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (file.mime.startsWith('image/')) return 'image';
  if (file.mime.startsWith('audio/')) return 'audio';
  if (file.mime.startsWith('video/')) return 'video';
  if (/\.(docx?|rtf|odt|txt|md)$/.test(n)) return 'doc';
  if (/\.(xlsx?|csv|ods)$/.test(n)) return 'sheet';
  if (/\.(pptx?|odp)$/.test(n)) return 'slides';
  return 'other';
}

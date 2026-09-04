import { z } from 'zod';
import type { StoredFile } from '../lib/storage.js';

export type ToolCategory = 'pdf' | 'image' | 'audio' | 'video' | 'transcribe' | 'ai' | 'business' | 'workflow';

export interface ToolOutput {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  downloadUrl: string;
  previewUrl?: string;
}

export interface ToolRunContext {
  sessionId: string;
  files: StoredFile[];
  params: Record<string, any>;
  setStage(stage: string): Promise<void>;
  /** Persist a result file and return a signed download descriptor. */
  emit(opts: { name: string; mime: string; buffer?: Buffer | Uint8Array; path?: string }): Promise<ToolOutput>;
}

export interface ToolResult {
  outputs?: ToolOutput[];
  stats?: Record<string, unknown>;
  text?: string;
  data?: unknown;
  message?: string;
}

export interface ToolOptionField {
  key: string;
  label: string;
  type: 'select' | 'number' | 'text' | 'toggle' | 'range' | 'textarea' | 'password';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  placeholder?: string;
  help?: string;
  showIf?: { key: string; equals: unknown };
}

export interface ToolDefinition {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  icon: string;
  route: string;
  keywords: string[];
  accept: string[];
  minFiles: number;
  maxFiles: number;
  /** Long-running tools show an indeterminate processing state with stages. */
  heavy?: boolean;
  requires?: ('ai' | 'transcription')[];
  fields?: ToolOptionField[];
  schema?: z.ZodTypeAny;
  outputKind: 'file' | 'files' | 'text' | 'data' | 'transcript';
  run(ctx: ToolRunContext): Promise<ToolResult>;
}

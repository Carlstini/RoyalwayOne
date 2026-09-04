import fs from 'node:fs/promises';
import { getFile, saveFile, signDownload, type StoredFile } from '../lib/storage.js';
import { AppError, notFound } from '../lib/errors.js';
import { registerJobHandler, type JobContext } from '../lib/jobs.js';
import { getTool, toolAvailability } from './registry.js';
import type { ToolDefinition, ToolOutput, ToolResult, ToolRunContext } from './types.js';

export async function resolveFiles(sessionId: string, fileIds: string[]): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  for (const id of fileIds) {
    const file = await getFile(id);
    if (!file) throw notFound('One of your files is no longer available. Please upload it again.');
    if (file.sessionId !== sessionId) throw new AppError('That file does not belong to this session.', 403, 'FORBIDDEN');
    files.push(file);
  }
  return files;
}

export function validateSelection(tool: ToolDefinition, files: StoredFile[]) {
  const { available, missing } = toolAvailability(tool);
  if (!available) {
    throw new AppError(
      missing.includes('transcription')
        ? 'Transcription is not switched on for this deployment yet.'
        : 'AI features are not switched on for this deployment yet.',
      503, 'NOT_CONFIGURED',
    );
  }
  if (files.length < tool.minFiles) {
    throw new AppError(tool.minFiles === 1 ? 'Please add a file first.' : `Please add at least ${tool.minFiles} files.`, 400, 'BAD_REQUEST');
  }
  if (files.length > tool.maxFiles) {
    throw new AppError(`This tool accepts up to ${tool.maxFiles} file${tool.maxFiles === 1 ? '' : 's'} at a time.`, 400, 'BAD_REQUEST');
  }
}

export function makeContext(opts: {
  sessionId: string;
  files: StoredFile[];
  params: Record<string, any>;
  setStage?: (stage: string) => Promise<void>;
}): ToolRunContext {
  return {
    sessionId: opts.sessionId,
    files: opts.files,
    params: opts.params,
    setStage: opts.setStage ?? (async () => {}),
    async emit({ name, mime, buffer, path }) {
      const stored = await saveFile({
        sessionId: opts.sessionId,
        name,
        mime,
        buffer: buffer ? Buffer.from(buffer) : undefined,
        sourcePath: path,
      });
      const output: ToolOutput = {
        fileId: stored.id,
        name: stored.name,
        mime: stored.mime,
        size: stored.size,
        downloadUrl: signDownload(stored.id),
      };
      if (/^(image|application\/pdf|audio|video)/.test(mime)) output.previewUrl = output.downloadUrl;
      return output;
    },
  };
}

export async function runToolNow(opts: {
  toolId: string;
  sessionId: string;
  fileIds: string[];
  params: Record<string, any>;
  setStage?: (stage: string) => Promise<void>;
}): Promise<ToolResult & { tool: string }> {
  const tool = getTool(opts.toolId);
  if (!tool) throw notFound('That tool is not available.');
  const files = await resolveFiles(opts.sessionId, opts.fileIds);
  validateSelection(tool, files);
  const ctx = makeContext({ sessionId: opts.sessionId, files, params: opts.params ?? {}, setStage: opts.setStage });
  const result = await tool.run(ctx);
  return { ...result, tool: tool.id };
}

/** Every tool is also runnable as a background job. */
registerJobHandler('tool', async (ctx: JobContext) => {
  const { toolId, params } = ctx.job.params as { toolId: string; params: Record<string, any> };
  return runToolNow({
    toolId,
    sessionId: ctx.job.session_id,
    fileIds: ctx.job.input_file_ids,
    params: params ?? {},
    setStage: (stage) => ctx.setStage(stage),
  });
});

export async function fileToBuffer(file: StoredFile) {
  return fs.readFile(file.path);
}

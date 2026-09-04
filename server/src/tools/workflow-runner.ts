import { registerJobHandler, type JobContext } from '../lib/jobs.js';
import { getWorkflow } from './workflows.js';
import { getTool } from './registry.js';
import { runToolNow } from './runner.js';
import { AppError, notFound } from '../lib/errors.js';
import type { ToolOutput } from './types.js';

export interface WorkflowStepResult {
  toolId: string;
  label: string;
  status: 'succeeded' | 'skipped' | 'failed';
  outputs?: ToolOutput[];
  text?: string;
  data?: unknown;
  stats?: Record<string, unknown>;
  error?: string;
}

registerJobHandler('workflow', async (ctx: JobContext) => {
  const { workflowId, params } = ctx.job.params as { workflowId: string; params?: Record<string, any> };
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw notFound('That workflow is not available.');

  const original = ctx.job.input_file_ids;
  let previousFileIds = original;
  let carriedText = '';
  const results: WorkflowStepResult[] = [];

  for (const [index, step] of workflow.steps.entries()) {
    const tool = getTool(step.toolId);
    if (!tool) { results.push({ toolId: step.toolId, label: step.label, status: 'skipped', error: 'Tool unavailable' }); continue; }
    await ctx.setStage(`${index + 1} of ${workflow.steps.length}: ${step.label}`);

    const stepParams: Record<string, any> = { ...(step.params ?? {}), ...(params?.[step.toolId] ?? {}) };
    let fileIds: string[] = [];
    if (step.input === 'original') fileIds = original;
    else if (step.input === 'previous') fileIds = previousFileIds;
    else if (step.input === 'text') {
      if (!carriedText) { results.push({ toolId: step.toolId, label: step.label, status: 'skipped', error: 'No text was produced by the earlier steps.' }); continue; }
      stepParams.text = carriedText;
    }

    try {
      const result = await runToolNow({
        toolId: step.toolId,
        sessionId: ctx.job.session_id,
        fileIds,
        params: stepParams,
        setStage: (s) => ctx.setStage(`${step.label}: ${s}`),
      });
      if (result.outputs?.length) previousFileIds = result.outputs.map((o) => o.fileId);
      const producedText = result.text ?? (result.data as any)?.text;
      if (producedText && step.toolId.startsWith('transcribe')) carriedText = producedText;
      else if (producedText && !carriedText) carriedText = producedText;
      results.push({ toolId: step.toolId, label: step.label, status: 'succeeded', outputs: result.outputs, text: result.text, data: result.data, stats: result.stats as any });
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'This step could not be completed.';
      results.push({ toolId: step.toolId, label: step.label, status: 'failed', error: message });
      if (!step.optional && index === 0) throw err; // the first step is essential
    }
  }

  const succeeded = results.filter((r) => r.status === 'succeeded').length;
  return {
    workflowId,
    name: workflow.name,
    steps: results,
    outputs: results.flatMap((r) => r.outputs ?? []),
    stats: { stepsCompleted: succeeded, stepsTotal: workflow.steps.length },
  };
});

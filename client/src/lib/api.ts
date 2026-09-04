export interface ToolField {
  key: string;
  label: string;
  type: 'select' | 'number' | 'text' | 'toggle' | 'range' | 'textarea' | 'password';
  options?: { value: string; label: string }[];
  min?: number; max?: number; step?: number;
  default?: unknown;
  placeholder?: string;
  help?: string;
  showIf?: { key: string; equals: unknown };
}

export interface Tool {
  id: string; name: string; category: string; description: string; icon: string; route: string;
  keywords: string[]; accept: string[]; minFiles: number; maxFiles: number; heavy: boolean;
  fields: ToolField[]; outputKind: 'file' | 'files' | 'text' | 'data' | 'transcript';
  available: boolean; missing: string[];
}

export interface Category { id: string; name: string; description: string; icon: string }

export interface Workflow {
  id: string; name: string; description: string; icon: string;
  accept: string[]; minFiles: number; maxFiles: number; available: boolean;
  steps: { toolId: string; label: string }[];
}

export interface UploadedFile { id: string; name: string; mime: string; size: number; url: string }

export interface ToolOutput { fileId: string; name: string; mime: string; size: number; downloadUrl: string; previewUrl?: string }

export interface ToolResult {
  tool?: string;
  outputs?: ToolOutput[];
  stats?: Record<string, any>;
  text?: string;
  data?: any;
  message?: string;
}

export interface Job {
  id: string; tool: string; status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage: string; result?: ToolResult; error?: string; createdAt: number; updatedAt: number;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = 'ERROR', status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: init.body instanceof FormData ? init.headers : { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError('We could not reach Royalway One. Please check your connection and try again.', 'NETWORK', 0);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
  if (!res.ok || data?.ok === false) {
    throw new ApiError(
      data?.error?.message ?? 'Something went wrong. Please try again.',
      data?.error?.code ?? 'ERROR',
      res.status,
    );
  }
  return data as T;
}

export const api = {
  capabilities: () => request<{ ai: boolean; transcription: boolean; urlPlatformSupport: boolean; officeConversion: boolean; limits: { maxUploadBytes: number; maxMediaSeconds: number; retentionMinutes: number } }>('/api/capabilities'),

  tools: () => request<{ categories: Category[]; tools: Tool[]; workflows: Workflow[]; capabilities: { ai: boolean; transcription: boolean } }>('/api/tools'),

  search: (q: string) => request<{ results: Tool[] }>(`/api/tools/search?q=${encodeURIComponent(q)}`),

  upload: (files: File[], onProgress?: (fraction: number) => void) =>
    new Promise<{ files: UploadedFile[]; suggestions: Tool[] }>((resolve, reject) => {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.withCredentials = true;
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      });
      xhr.onload = () => {
        let data: any = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300 && data?.ok) resolve(data);
        else reject(new ApiError(data?.error?.message ?? 'We could not upload your file. Please try again.', data?.error?.code ?? 'UPLOAD_FAILED', xhr.status));
      };
      xhr.onerror = () => reject(new ApiError('The upload failed. Please check your connection and try again.', 'NETWORK', 0));
      xhr.ontimeout = () => reject(new ApiError('The upload timed out. Please try a smaller file.', 'TIMEOUT', 0));
      xhr.send(form);
    }),

  runTool: (toolId: string, fileIds: string[], params: Record<string, unknown> = {}) =>
    request<{ mode: 'sync' | 'job'; result?: ToolResult; job?: Job }>('/api/tools/run', {
      method: 'POST',
      body: JSON.stringify({ toolId, fileIds, params }),
    }),

  runWorkflow: (workflowId: string, fileIds: string[], params: Record<string, unknown> = {}) =>
    request<{ job: Job }>('/api/workflows/run', { method: 'POST', body: JSON.stringify({ workflowId, fileIds, params }) }),

  job: (id: string) => request<{ job: Job }>(`/api/jobs/${id}`),

  transcript: (id: string) => request<{ transcript: any }>(`/api/transcription/${id}`),
  saveTranscript: (id: string, segments: any[]) => request<{ transcript: any }>(`/api/transcription/${id}`, { method: 'PUT', body: JSON.stringify({ segments }) }),

  aiTask: (task: string, payload: { fileId?: string; text?: string; instruction?: string }) =>
    request<{ output: string; truncated: boolean; source: string }>(`/api/ai/${task}`, { method: 'POST', body: JSON.stringify(payload) }),

  aiChat: (payload: { fileId?: string; transcriptId?: string; question: string; history?: { role: 'user' | 'assistant'; content: string }[] }) =>
    request<{ answer: string; grounded: boolean; document?: string; sources: { label: string; excerpt: string }[] }>('/api/ai/chat', { method: 'POST', body: JSON.stringify(payload) }),

  event: (name: string, props: Record<string, unknown> = {}) => {
    void fetch('/api/analytics/event', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, props }),
      keepalive: true,
    }).catch(() => {});
  },
};

/** Poll a background job until it finishes, surfacing each real stage. */
export async function waitForJob(id: string, onStage: (stage: string, status: Job['status']) => void, signal?: AbortSignal): Promise<Job> {
  let delay = 700;
  for (;;) {
    if (signal?.aborted) throw new ApiError('Cancelled.', 'CANCELLED', 0);
    const { job } = await api.job(id);
    onStage(job.stage, job.status);
    if (job.status === 'succeeded') return job;
    if (job.status === 'failed') throw new ApiError(job.error ?? 'Something went wrong while processing your file. Please try again.', 'JOB_FAILED', 500);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.15, 2500);
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

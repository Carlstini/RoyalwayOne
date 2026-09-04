/**
 * Workflow definitions: ordered chains of real tools. Each step consumes either
 * the original upload or the previous step's output, so the whole chain produces
 * genuine artefacts.
 */
export interface WorkflowStep {
  toolId: string;
  label: string;
  /** 'original' = the uploaded files, 'previous' = the previous step's outputs, 'text' = previous text output */
  input: 'original' | 'previous' | 'text';
  params?: Record<string, unknown>;
  optional?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  accept: string[];
  minFiles: number;
  maxFiles: number;
  requires?: ('ai' | 'transcription')[];
  steps: WorkflowStep[];
}

export const workflows: WorkflowDefinition[] = [
  {
    id: 'meeting-workflow',
    name: 'Meeting workflow',
    description: 'Recording → transcript → executive summary → action items → minutes → follow-up email.',
    icon: 'waveform',
    accept: ['audio/*', 'video/*'],
    minFiles: 1, maxFiles: 1,
    requires: ['transcription', 'ai'],
    steps: [
      { toolId: 'transcribe-file', label: 'Transcribe the recording', input: 'original', params: { analyse: false, diarize: true } },
      { toolId: 'ai-executive-summary', label: 'Executive summary', input: 'text' },
      { toolId: 'ai-action-items', label: 'Action items', input: 'text' },
      { toolId: 'ai-meeting-minutes', label: 'Meeting minutes', input: 'text' },
      { toolId: 'ai-follow-up-email', label: 'Follow-up email', input: 'text' },
    ],
  },
  {
    id: 'document-workflow',
    name: 'Document workflow',
    description: 'PDF → OCR → compression → AI summary → executive brief.',
    icon: 'document',
    accept: ['application/pdf', '.pdf'],
    minFiles: 1, maxFiles: 1,
    requires: ['ai'],
    steps: [
      { toolId: 'pdf-ocr', label: 'Recognise text', input: 'original', optional: true },
      { toolId: 'pdf-compress', label: 'Compress the PDF', input: 'previous', params: { preset: 'recommended' } },
      { toolId: 'ai-summarize', label: 'Summarise', input: 'text' },
      { toolId: 'ai-executive-summary', label: 'Executive brief', input: 'text' },
    ],
  },
  {
    id: 'content-workflow',
    name: 'Content workflow',
    description: 'Video → extract audio → transcript → summary → presentation outline.',
    icon: 'video',
    accept: ['video/*'],
    minFiles: 1, maxFiles: 1,
    requires: ['transcription', 'ai'],
    steps: [
      { toolId: 'audio-extract', label: 'Extract the audio', input: 'original', params: { format: 'mp3' } },
      { toolId: 'transcribe-file', label: 'Transcribe', input: 'previous', params: { analyse: false } },
      { toolId: 'ai-summarize', label: 'Summarise', input: 'text' },
      { toolId: 'ai-presentation-outline', label: 'Presentation outline', input: 'text' },
    ],
  },
  {
    id: 'contract-review-workflow',
    name: 'Contract review',
    description: 'Contract → key points → extracted dates and amounts → risk review.',
    icon: 'shield',
    accept: ['application/pdf', '.pdf', '.docx', '.txt'],
    minFiles: 1, maxFiles: 1,
    requires: ['ai'],
    steps: [
      { toolId: 'ai-key-points', label: 'Key points', input: 'original' },
      { toolId: 'ai-extract', label: 'Dates, amounts and obligations', input: 'original' },
      { toolId: 'ai-document-review', label: 'Review and risks', input: 'original' },
    ],
  },
  {
    id: 'share-ready-workflow',
    name: 'Share-ready PDF',
    description: 'PDF → remove metadata and compress → watermark → ready to send.',
    icon: 'send',
    accept: ['application/pdf', '.pdf'],
    minFiles: 1, maxFiles: 1,
    steps: [
      { toolId: 'pdf-compress', label: 'Compress and clean metadata', input: 'original', params: { preset: 'recommended', stripMetadata: true } },
      { toolId: 'pdf-watermark', label: 'Add a watermark', input: 'previous', params: { text: 'CONFIDENTIAL', opacity: 18 } },
    ],
  },
];

export const getWorkflow = (id: string) => workflows.find((w) => w.id === id);

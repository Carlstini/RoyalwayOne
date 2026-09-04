/** TranscriptionProvider abstraction. */
export interface TranscriptWord { text: string; start: number; end: number; speaker?: string; confidence?: number }
export interface TranscriptSegment { start: number; end: number; text: string; speaker?: string }
export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
  language?: string;
  durationSeconds?: number;
  provider: string;
  model?: string;
  speakerCount?: number;
}
export interface TranscribeOptions {
  language?: string;
  diarize?: boolean;
  mimeType?: string;
  signal?: AbortSignal;
  onStage?: (stage: string) => void;
}
export interface TranscriptionProvider {
  readonly id: string;
  isConfigured(): boolean;
  transcribeFile(filePath: string, options?: TranscribeOptions): Promise<TranscriptResult>;
}

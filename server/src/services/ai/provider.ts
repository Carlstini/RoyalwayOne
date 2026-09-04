/** AIProvider abstraction — swap providers without touching feature code. */
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
}

export interface AIProvider {
  readonly id: string;
  readonly model: string;
  isConfigured(): boolean;
  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string>;
  embed?(texts: string[]): Promise<number[][]>;
}

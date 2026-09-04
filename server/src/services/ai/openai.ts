import { config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { AIProvider, ChatMessage, CompletionOptions } from './provider.js';

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  readonly model = config.ai.openaiModel;

  isConfigured() { return !!config.ai.openaiKey; }

  async complete(messages: ChatMessage[], options: CompletionOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 2000,
    };
    if (options.json) body.response_format = { type: 'json_object' };
    const data = await request(`${config.ai.openaiBaseUrl}/chat/completions`, config.ai.openaiKey, body, options.signal);
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new AppError('The AI service returned an unexpected response. Please try again.', 502, 'AI_FAILED');
    return text;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const data = await request(`${config.ai.openaiBaseUrl}/embeddings`, config.ai.openaiKey, {
      model: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
      input: texts,
    });
    return (data.data ?? []).map((d: any) => d.embedding as number[]);
  }
}

async function request(url: string, key: string, body: unknown, signal?: AbortSignal, attempt = 0): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  signal?.addEventListener('abort', () => controller.abort());
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        return request(url, key, body, signal, attempt + 1);
      }
      throw new AppError('The AI service is busy right now. Please try again in a moment.', 503, 'AI_BUSY');
    }
    if (!res.ok) {
      logger.warn({ status: res.status, detail: (await res.text()).slice(0, 400) }, 'openai error');
      throw new AppError('We could not complete this AI request. Please try again.', 502, 'AI_FAILED');
    }
    return res.json();
  } catch (err) {
    if (err instanceof AppError) throw err;
    if ((err as Error).name === 'AbortError') throw new AppError('The AI request took too long. Please try again with a shorter document.', 504, 'AI_TIMEOUT');
    logger.warn({ err }, 'openai request failed');
    throw new AppError('We could not reach the AI service. Please try again.', 502, 'AI_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

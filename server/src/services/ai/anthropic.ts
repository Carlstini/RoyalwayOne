import { config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { AIProvider, ChatMessage, CompletionOptions } from './provider.js';

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  readonly model = config.ai.anthropicModel;

  isConfigured() { return !!config.ai.anthropicKey; }

  async complete(messages: ChatMessage[], options: CompletionOptions = {}): Promise<string> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.ai.anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          system: system || undefined,
          messages: rest.length ? rest : [{ role: 'user', content: 'Hello' }],
          max_tokens: options.maxTokens ?? 2000,
          temperature: options.temperature ?? 0.2,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn({ status: res.status, detail: (await res.text()).slice(0, 400) }, 'anthropic error');
        throw new AppError('We could not complete this AI request. Please try again.', 502, 'AI_FAILED');
      }
      const data = await res.json() as any;
      const text = (data.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
      if (!text) throw new AppError('The AI service returned an empty response. Please try again.', 502, 'AI_FAILED');
      return text;
    } catch (err) {
      if (err instanceof AppError) throw err;
      if ((err as Error).name === 'AbortError') throw new AppError('The AI request took too long. Please try again with a shorter document.', 504, 'AI_TIMEOUT');
      throw new AppError('We could not reach the AI service. Please try again.', 502, 'AI_FAILED');
    } finally {
      clearTimeout(timer);
    }
  }
}

import { config } from '../../lib/config.js';
import { AppError } from '../../lib/errors.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import type { AIProvider } from './provider.js';

export * from './provider.js';

let cached: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (cached) return cached;
  const candidates: AIProvider[] = [new OpenAIProvider(), new AnthropicProvider()];
  const preferred = candidates.find((c) => c.id === config.ai.provider && c.isConfigured());
  cached = preferred ?? candidates.find((c) => c.isConfigured()) ?? candidates[0];
  return cached;
}

export function aiAvailable() {
  return getAIProvider().isConfigured();
}

export function requireAI(): AIProvider {
  const p = getAIProvider();
  if (!p.isConfigured()) {
    throw new AppError('AI features are not switched on for this deployment yet. Everything else still works.', 503, 'AI_NOT_CONFIGURED');
  }
  return p;
}

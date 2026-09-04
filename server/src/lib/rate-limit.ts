import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { config } from './config.js';

const keyGenerator = (req: Request) => req.sessionId || req.ip || 'anonymous';

const base: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  skip: () => config.env === 'test',
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'You have made a lot of requests in a short time. Please wait a moment and try again.' } },
};

export const apiLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 240 });
export const uploadLimiter = rateLimit({ ...base, windowMs: 10 * 60_000, limit: 120, message: { ok: false, error: { code: 'RATE_LIMITED', message: 'You have uploaded a lot of files recently. Please wait a few minutes before uploading more.' } } });
export const processLimiter = rateLimit({ ...base, windowMs: 10 * 60_000, limit: 120, message: { ok: false, error: { code: 'RATE_LIMITED', message: 'You have run a lot of jobs recently. Please wait a few minutes and try again.' } } });
export const aiLimiter = rateLimit({ ...base, windowMs: 10 * 60_000, limit: 60, message: { ok: false, error: { code: 'RATE_LIMITED', message: 'You have used the AI tools a lot in the last few minutes. Please wait a moment and try again.' } } });

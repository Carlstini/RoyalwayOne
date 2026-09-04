import type { Request } from 'express';
import { z, ZodSchema } from 'zod';
import { badRequest } from './errors.js';

export function parseBody<T>(schema: ZodSchema<T>, req: Request): T {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(`Invalid request: ${issue.path.join('.') || 'body'} ${issue.message.toLowerCase()}.`);
  }
  return result.data;
}

export const fileIdSchema = z.string().regex(/^[a-f0-9]{32}$/, 'is not a valid file reference');
export { z };

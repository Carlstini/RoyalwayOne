import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

const COOKIE = 'rw_sid';

function sign(id: string) {
  return `${id}.${crypto.createHmac('sha256', config.sessionSecret).update(id).digest('base64url')}`;
}
function verify(value: string): string | null {
  const [id, sig] = value.split('.');
  if (!id || !sig) return null;
  return sign(id) === value ? id : null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { sessionId: string }
  }
}

/** Anonymous, cookie-backed session. No personal data, no sign-in. */
export function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const raw = req.cookies?.[COOKIE];
  let id = raw ? verify(raw) : null;
  if (!id) {
    id = crypto.randomBytes(16).toString('hex');
    res.cookie(COOKIE, sign(id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.env === 'production',
      maxAge: 30 * 24 * 3600 * 1000,
      path: '/',
    });
  }
  req.sessionId = id;
  next();
}

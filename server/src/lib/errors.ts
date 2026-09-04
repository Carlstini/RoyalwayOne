/** User-safe application error. Message is shown to the end user verbatim. */
export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'REQUEST_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (m: string) => new AppError(m, 400, 'BAD_REQUEST');
export const tooLarge = (m = 'This file is too large.') => new AppError(m, 413, 'FILE_TOO_LARGE');
export const unsupported = (m = "This file type isn't supported.") => new AppError(m, 415, 'UNSUPPORTED_TYPE');
export const notFound = (m = 'We could not find what you were looking for.') => new AppError(m, 404, 'NOT_FOUND');
export const rateLimited = (m: string) => new AppError(m, 429, 'RATE_LIMITED');
export const notConfigured = (m: string) => new AppError(m, 503, 'NOT_CONFIGURED');

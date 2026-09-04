import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { sessionMiddleware } from './lib/session.js';
import { AppError } from './lib/errors.js';
import { apiLimiter } from './lib/rate-limit.js';
import { uploadRouter } from './routes/upload.js';
import { toolsRouter } from './routes/tools.js';
import { aiRouter } from './routes/ai.js';
import { transcriptionRouter } from './routes/transcription.js';
import { systemRouter } from './routes/system.js';
import { allTools } from './tools/registry.js';
import './tools/runner.js';
import './tools/workflow-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(pinoHttp({
    logger,
    autoLogging: { ignore: (req: any) => req.url === '/api/health' },
    serializers: {
      req: (req: any) => ({ method: req.method, url: req.url }),
      res: (res: any) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req: any, res: any, err: any) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug'),
  }));

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:', 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        // Allow embedding only where the operator opts in (e.g. preview environments).
        frameAncestors: config.frameAncestors,
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: config.frameAncestors.length === 1 && config.frameAncestors[0] === "'self'" ? { action: 'sameorigin' } : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
  }));

  app.use(cookieParser());
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(sessionMiddleware);

  app.use('/api', apiLimiter);
  app.use('/api', systemRouter);
  app.use('/api', uploadRouter);
  app.use('/api', toolsRouter);
  app.use('/api', aiRouter);
  app.use('/api', transcriptionRouter);

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${config.publicUrl || ''}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', (_req, res) => {
    const base = config.publicUrl.replace(/\/$/, '');
    const urls = ['/', '/tools', '/workflows', ...allTools.map((t) => t.route)];
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((u) => `  <url><loc>${base}${u}</loc><changefreq>weekly</changefreq><priority>${u === '/' ? '1.0' : '0.7'}</priority></url>`)
        .join('\n')}\n</urlset>`,
    );
  });

  // Serve the built frontend (single-service deployment on Render).
  const clientDir = [
    path.resolve(__dirname, '../../client/dist'),
    path.resolve(__dirname, '../../../client/dist'),
  ].find((dir) => existsSync(path.join(dir, 'index.html'))) ?? '';
  if (clientDir) {
    app.use(express.static(clientDir, {
      maxAge: '1y',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'That endpoint does not exist.' } });
  });

  // Central error handler: users only ever see safe, human messages.
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `This file is too large. The limit is ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB.`
        : err.code === 'LIMIT_FILE_COUNT' ? 'You have selected too many files at once.'
        : 'We could not read that upload. Please try again.';
      return res.status(413).json({ ok: false, error: { code: err.code, message } });
    }
    if (err instanceof AppError) {
      if (err.status >= 500) req.log?.error({ err }, 'application error');
      return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'That request was too large.' } });
    }
    // A body the client sent wrong is a 400, not a server fault.
    if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in (err as any))) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'We could not read that request. Please try again.' } });
    }
    req.log?.error({ err }, 'unhandled error');
    res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
  });

  return app;
}

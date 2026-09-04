import { createApp } from './app.js';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { initStorage, cleanupExpired } from './lib/storage.js';
import { initDb, store } from './lib/db.js';
import { startWorker, stopWorker } from './lib/jobs.js';
import { shutdownOcr } from './services/ocr.js';

async function main() {
  await initStorage();
  await initDb();

  const runInlineWorker = process.env.RUN_WORKER !== 'false';
  if (runInlineWorker) startWorker();

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info({ port: config.port, env: config.env, worker: runInlineWorker }, 'Royalway One is running');
  });
  server.requestTimeout = 30 * 60_000;
  server.headersTimeout = 31 * 60_000;

  const cleanupTimer = setInterval(() => {
    void cleanupExpired().catch((err) => logger.error({ err }, 'cleanup failed'));
    void store.purgeBefore(Date.now() - config.retentionMinutes * 60_000 * 12).catch(() => {});
  }, 10 * 60_000);
  cleanupTimer.unref();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopWorker();
    clearInterval(cleanupTimer);
    await shutdownOcr();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 15_000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => logger.error({ err }, 'uncaught exception'));
}

void main();

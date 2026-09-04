/** Optional dedicated Render worker service: processes queued jobs only. */
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { initStorage, cleanupExpired } from '../lib/storage.js';
import { initDb, store } from '../lib/db.js';
import { startWorker, stopWorker } from '../lib/jobs.js';
import { shutdownOcr } from '../services/ocr.js';
import '../tools/runner.js';
import '../tools/workflow-runner.js';

async function main() {
  await initStorage();
  await initDb();
  if (store.kind !== 'postgres') {
    logger.warn('A dedicated worker needs DATABASE_URL so it can share the job queue with the web service.');
  }
  startWorker();
  logger.info({ concurrency: config.workerConcurrency }, 'Royalway One worker running');

  const timer = setInterval(() => void cleanupExpired().catch(() => {}), 10 * 60_000);
  const shutdown = async () => { stopWorker(); clearInterval(timer); await shutdownOcr(); process.exit(0); };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void main();

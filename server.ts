import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createBackupSnapshot, getDb, getMetaValue, initializeDatabase, recordServerEvent } from './src/server/db.ts';
import { createApiRouter } from './src/server/routes.ts';

const AUTO_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 jam

function startAutoBackupScheduler() {
  const runIfDue = () => {
    try {
      const db = getDb();
      const lastBackup = getMetaValue(db, 'LAST_SUCCESSFUL_BACKUP', '');
      const elapsed = lastBackup ? Date.now() - new Date(lastBackup).getTime() : Infinity;
      if (!lastBackup || Number.isNaN(elapsed) || elapsed >= AUTO_BACKUP_INTERVAL_MS) {
        createBackupSnapshot(db, 'system_scheduler', { backupType: 'AUTO_SCHEDULED' });
      }
    } catch (err) {
      try {
        recordServerEvent(getDb(), {
          level: 'ERROR',
          source: 'AutoBackupScheduler',
          event_type: 'AUTO_BACKUP_FAILED',
          message: err instanceof Error ? err.message : 'Backup otomatis terjadwal gagal.',
        });
      } catch {
        // Ignore if DB unavailable
      }
    }
  };

  setTimeout(runIfDue, 15000);
  const timer = setInterval(runIfDue, 60 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
}

async function startServer() {
  initializeDatabase();
  startAutoBackupScheduler();

  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '15mb' }));
  app.use('/api', createApiRouter());

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CBT KIR IPA SMAN 1 Sukabumi listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});


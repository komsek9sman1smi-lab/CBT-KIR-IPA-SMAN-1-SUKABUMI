import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ConflictError,
  DatabasePersistenceError,
  FACTORY_RESET_CONFIRMATION_PHRASE,
  createBackupSnapshot,
  executeFactoryReset,
  getConfigVersion,
  getConfigVersionHistory,
  getMetaValue,
  getSettingsMap,
  getSyncVersions,
  listBackupsWithVerification,
  openAndInitializeDatabase,
  restoreBackupSnapshot,
  rollbackConfigVersion,
  saveUploadedLogoFile,
  updateSettingsWithVersioning,
  type DbPathsConfig,
} from './db.ts';

function createTempPaths(): { root: string; paths: DbPathsConfig } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cbt_persist_test_'));
  return {
    root,
    paths: {
      dataDir: root,
      dbPath: path.join(root, 'test_cbt.sqlite'),
      backupDir: path.join(root, 'backups'),
      uploadsDir: path.join(root, 'uploads'),
    },
  };
}

test('1. First init sets DATABASE_INITIALIZED=true & subsequent restarts never overwrite custom settings/INSTALLATION_ID', (t) => {
  const { root, paths } = createTempPaths();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const db1 = openAndInitializeDatabase(paths);
  assert.equal(getMetaValue(db1, 'DATABASE_INITIALIZED'), 'true');
  const installationId1 = getMetaValue(db1, 'INSTALLATION_ID');
  assert.ok(installationId1.startsWith('inst_'));

  const updated = updateSettingsWithVersioning(
    db1,
    {
      app_name: 'CBT KIR IPA CUSTOM PERSISTENT',
      school_name: 'SMAN 1 Sukabumi Unggulan',
      announcement: 'Pengumuman khusus yang harus bertahan selamanya',
    },
    'usr_admin_01',
    { expectedVersion: 1 },
  );
  assert.equal(updated.config_version, 2);
  assert.equal(updated.verified, true);
  db1.close();

  // Simulate server restart / redeploy opening the same DB
  const db2 = openAndInitializeDatabase(paths);
  const installationId2 = getMetaValue(db2, 'INSTALLATION_ID');
  assert.equal(installationId2, installationId1);

  const settingsAfterRestart = getSettingsMap(db2, { strict: true });
  assert.equal(settingsAfterRestart.app_name, 'CBT KIR IPA CUSTOM PERSISTENT');
  assert.equal(settingsAfterRestart.school_name, 'SMAN 1 Sukabumi Unggulan');
  assert.equal(
    settingsAfterRestart.announcement,
    'Pengumuman khusus yang harus bertahan selamanya',
  );
  assert.equal(getConfigVersion(db2), 2);
  db2.close();
});

test('2. Upgrading pre-hardening DB preserves existing settings/users and creates AUTO_PRE_MIGRATION backup', (t) => {
  const { root, paths } = createTempPaths();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Create legacy pre-hardening database without SYSTEM_METADATA or SCHEMA_MIGRATIONS
  const legacyDb = new DatabaseSync(paths.dbPath);
  legacyDb.exec(`
    CREATE TABLE USERS (
      user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      nama TEXT NOT NULL,
      kelas TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );
    CREATE TABLE EXAMS (
      exam_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      total_questions INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      settings_json TEXT NOT NULL
    );
    CREATE TABLE QUESTIONS (
      question_id TEXT PRIMARY KEY,
      question_type TEXT NOT NULL,
      question_text TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}',
      correct_answer TEXT NOT NULL DEFAULT '',
      explanation TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Umum',
      difficulty TEXT NOT NULL DEFAULT 'SEDANG',
      score REAL NOT NULL DEFAULT 10,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE EXAM_QUESTIONS (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, question_id TEXT NOT NULL, question_order INTEGER NOT NULL, score REAL NOT NULL DEFAULT 10);
    CREATE TABLE EXAM_PARTICIPANTS (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL, started_at TEXT, submitted_at TEXT, remaining_seconds INTEGER, attempt_number INTEGER, status TEXT, score REAL);
    CREATE TABLE ANSWERS (answer_id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL, question_id TEXT NOT NULL, answer_json TEXT, is_doubtful INTEGER, is_correct INTEGER, earned_score REAL, updated_at TEXT);
    CREATE TABLE VIOLATION_LOGS (violation_id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL, event_type TEXT NOT NULL, event_time TEXT NOT NULL, description TEXT);
    CREATE TABLE RESULTS (result_id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL, total_score REAL, correct_count INTEGER, incorrect_count INTEGER, unanswered_count INTEGER, ranking INTEGER, graded_at TEXT, published INTEGER);
    CREATE TABLE SETTINGS (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
    CREATE TABLE AUDIT_LOGS (log_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, activity TEXT NOT NULL, timestamp TEXT NOT NULL, details TEXT);
    CREATE TABLE EXAM_LOGS (log_id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL, event_type TEXT NOT NULL, timestamp TEXT NOT NULL, details TEXT);
    CREATE TABLE ESSAY_GRADES (essay_grade_id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL, question_id TEXT NOT NULL, score REAL, feedback TEXT, graded_by TEXT, graded_at TEXT);
    CREATE TABLE EXAM_CATEGORIES (category_id TEXT PRIMARY KEY, category_name TEXT UNIQUE NOT NULL, description TEXT, created_at TEXT NOT NULL);
    CREATE TABLE LOGIN_ATTEMPTS (attempt_id TEXT PRIMARY KEY, username TEXT NOT NULL, ip_address TEXT, attempt_time TEXT NOT NULL, success INTEGER NOT NULL);
    CREATE TABLE ACTIVE_SESSIONS (session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, login_time TEXT NOT NULL, last_active TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE BACKUP_LOGS (backup_id TEXT PRIMARY KEY, file_id TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE NOTIFICATIONS (notification_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, is_read INTEGER NOT NULL);
    CREATE TABLE REPORT_TEMPLATES (template_id TEXT PRIMARY KEY, name TEXT NOT NULL, doc_category TEXT NOT NULL, exam_id TEXT NOT NULL DEFAULT '', content_json TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE OFFICIAL_DOCUMENTS (doc_id TEXT PRIMARY KEY, doc_category TEXT NOT NULL, exam_id TEXT NOT NULL, title TEXT NOT NULL, doc_number TEXT NOT NULL DEFAULT '', content_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  legacyDb.prepare("INSERT INTO USERS VALUES ('usr_custom', 'admin.lama', 'h', 's', 'Admin Lama', 'Pembina', 'SUPER_ADMIN', 'ACTIVE', '2026-01-01T00:00:00.000Z')").run();
  legacyDb.prepare("INSERT INTO SETTINGS VALUES ('app_name', 'CBT LEGACY PRODUCTION')").run();
  legacyDb.close();

  const upgradedDb = openAndInitializeDatabase(paths);
  assert.equal(getMetaValue(upgradedDb, 'DATABASE_INITIALIZED'), 'true');
  const settings = getSettingsMap(upgradedDb, { strict: true });
  assert.equal(settings.app_name, 'CBT LEGACY PRODUCTION');

  const usersCount = (upgradedDb.prepare('SELECT COUNT(*) as c FROM USERS').get() as { c: number }).c;
  assert.equal(usersCount, 1);

  const backups = listBackupsWithVerification(upgradedDb, paths.backupDir);
  assert.ok(backups.some((b) => b.backup_type === 'AUTO_PRE_MIGRATION' && b.file_exists));
  upgradedDb.close();
});

test('3. Empty USERS/SETTINGS after DATABASE_INITIALIZED=true throws loud error and blocks silent factory reset', (t) => {
  const { root, paths } = createTempPaths();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const db1 = openAndInitializeDatabase(paths);
  // Corrupt / clear SETTINGS while keeping DATABASE_INITIALIZED='true'
  db1.prepare('DELETE FROM SETTINGS').run();

  assert.throws(
    () => getSettingsMap(db1, { strict: true }),
    (err: unknown) => err instanceof DatabasePersistenceError && err.code === 'SETTINGS_EMPTY_AFTER_INIT',
  );
  db1.close();

  // Re-opening database MUST fail loudly rather than reseeding defaults!
  assert.throws(
    () => openAndInitializeDatabase(paths),
    (err: unknown) => err instanceof DatabasePersistenceError && err.code === 'DB_EMPTY_AFTER_INIT',
  );
});

test('4. Versioning, 409 conflict protection, logo file persistence, and rollback preserve non-config data', (t) => {
  const { root, paths } = createTempPaths();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const db = openAndInitializeDatabase(paths);
  const initialUsers = (db.prepare('SELECT COUNT(*) as c FROM USERS').get() as { c: number }).c;
  const initialQuestions = (db.prepare('SELECT COUNT(*) as c FROM QUESTIONS').get() as { c: number }).c;

  // Upload a binary logo and verify disk persistence
  const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const logoInfo = saveUploadedLogoFile(db, {
    buffer: fakePng,
    originalName: 'logo-sekolah.png',
    mimeType: 'image/png',
    ext: 'png',
    uploadedBy: 'usr_admin_01',
    uploadsDir: paths.uploadsDir,
  });
  assert.ok(logoInfo.logo_url.startsWith('/api/assets/'));
  assert.ok(fs.existsSync(path.join(paths.uploadsDir, logoInfo.filename)));

  // Apply setting change (v1 -> v2)
  const v2 = updateSettingsWithVersioning(
    db,
    { app_name: 'NAMA BARU A', logo_url: logoInfo.logo_url },
    'usr_admin_01',
    { expectedVersion: 1 },
  );
  assert.equal(v2.config_version, 2);

  // Stale expectedVersion=1 from another tab/device must throw ConflictError (409)
  assert.throws(
    () =>
      updateSettingsWithVersioning(
        db,
        { app_name: 'NAMA STALE' },
        'usr_admin_01',
        { expectedVersion: 1 },
      ),
    (err: unknown) => err instanceof ConflictError && err.status === 409 && err.currentVersion === 2,
  );

  // Rollback app_name change back to v1 value
  const history = getConfigVersionHistory(db, 10);
  const appNameChange = history.find((h) => h.setting_key === 'app_name');
  assert.ok(appNameChange);

  const rolled = rollbackConfigVersion(db, appNameChange!.version_id, 'usr_admin_01');
  assert.equal(rolled.settings.app_name, 'CBT KIR IPA SMAN 1 SUKABUMI');
  // Logo remains untouched when rolling back only app_name!
  assert.equal(rolled.settings.logo_url, logoInfo.logo_url);

  // Non-config tables untouched
  assert.equal((db.prepare('SELECT COUNT(*) as c FROM USERS').get() as { c: number }).c, initialUsers);
  assert.equal((db.prepare('SELECT COUNT(*) as c FROM QUESTIONS').get() as { c: number }).c, initialQuestions);
  assert.ok(getSyncVersions(db).config >= 3);
  db.close();
});

test('5. Backup snapshot verification and faithful restore with automatic pre-restore backup', (t) => {
  const { root, paths } = createTempPaths();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const db = openAndInitializeDatabase(paths);
  updateSettingsWithVersioning(db, { app_name: 'SEBELUM BENCANA' }, 'usr_admin_01', { expectedVersion: 1 });
  const backup = createBackupSnapshot(db, 'usr_admin_01', {
    backupDir: paths.backupDir,
    backupType: 'MANUAL',
  });
  assert.ok(backup.size_bytes > 100);
  assert.ok(backup.checksum_sha256.length === 64);

  // Mutate state after backup
  updateSettingsWithVersioning(db, { app_name: 'SETELAH PERUBAHAN' }, 'usr_admin_01', { expectedVersion: 2 });
  assert.equal(getSettingsMap(db, { strict: true }).app_name, 'SETELAH PERUBAHAN');

  // Restore snapshot
  const fullPath = path.join(paths.backupDir, backup.file_id);
  const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as {
    snapshot: Record<string, Record<string, unknown>[]>;
  };
  restoreBackupSnapshot(db, parsed.snapshot, 'usr_admin_01', { backupDir: paths.backupDir });

  assert.equal(getSettingsMap(db, { strict: true }).app_name, 'SEBELUM BENCANA');
  const allBackups = listBackupsWithVerification(db, paths.backupDir);
  assert.ok(allBackups.some((b) => b.backup_type === 'AUTO_PRE_RESTORE' && b.file_exists));
  db.close();
});

test('6. Guarded Factory Reset rejects wrong phrase and creates AUTO_PRE_RESET backup when valid', (t) => {
  const { root, paths } = createTempPaths();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const db = openAndInitializeDatabase(paths);
  updateSettingsWithVersioning(db, { app_name: 'CUSTOM SEBELUM RESET' }, 'usr_admin_01', { expectedVersion: 1 });

  assert.throws(
    () =>
      executeFactoryReset(db, {
        actorUserId: 'usr_admin_01',
        confirmationPhrase: 'SALAH',
        backupDir: paths.backupDir,
      }),
  );
  // Still custom!
  assert.equal(getSettingsMap(db, { strict: true }).app_name, 'CUSTOM SEBELUM RESET');

  const res = executeFactoryReset(db, {
    actorUserId: 'usr_admin_01',
    confirmationPhrase: FACTORY_RESET_CONFIRMATION_PHRASE,
    backupDir: paths.backupDir,
  });
  assert.ok(res.pre_reset_backup_file.includes('auto_pre_reset'));
  assert.equal(getSettingsMap(db, { strict: true }).app_name, 'CBT KIR IPA SMAN 1 SUKABUMI');
  assert.equal(getMetaValue(db, 'DATABASE_INITIALIZED'), 'true');

  const backups = listBackupsWithVerification(db, paths.backupDir);
  assert.ok(backups.some((b) => b.backup_type === 'AUTO_PRE_RESET' && b.file_exists));
  db.close();
});

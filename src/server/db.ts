import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.ts';
import { createDefaultTemplatePayload } from '../shared/documentTemplates.ts';
import type {
  AppSettingsMap,
  BackupLogRecord,
  BaseConfigSource,
  ConfigVersionRecord,
  DocumentCategory,
  ExamSettings,
  ServerEventRecord,
  SyncDomain,
  SyncVersionsMap,
  SystemMonitoringStatus,
  SystemSyncState,
} from '../shared/types.ts';

export const APP_VERSION = '2.3.0';
export const DB_SCHEMA_VERSION = '3.0.0';
export const FACTORY_RESET_CONFIRMATION_PHRASE = 'RESET PABRIK CBT KIR IPA';

export interface DbPathsConfig {
  dataDir: string;
  dbPath: string;
  backupDir: string;
  uploadsDir: string;
}

export function getDefaultDbPaths(): DbPathsConfig {
  const explicitDb = process.env.CBT_DB_PATH ? path.resolve(process.env.CBT_DB_PATH) : '';
  const dataDir = process.env.CBT_DATA_DIR
    ? path.resolve(process.env.CBT_DATA_DIR)
    : explicitDb
      ? path.dirname(explicitDb)
      : path.resolve(process.cwd(), 'data');
  return {
    dataDir,
    dbPath: explicitDb || path.join(dataDir, 'cbt_kir_ipa.sqlite'),
    backupDir: path.join(dataDir, 'backups'),
    uploadsDir: path.join(dataDir, 'uploads'),
  };
}

let dbInstance: DatabaseSync | null = null;
let lastDbErrorMessage: string | null = null;

export class ConflictError extends Error {
  status = 409;
  code = 'VERSION_CONFLICT';
  currentVersion: number;
  constructor(message: string, currentVersion: number) {
    super(message);
    this.currentVersion = currentVersion;
  }
}

export class DatabasePersistenceError extends Error {
  status = 500;
  code: string;
  constructor(message: string, code = 'DB_PERSISTENCE_ERROR') {
    super(message);
    this.code = code;
  }
}

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getLastDbError(): string | null {
  return lastDbErrorMessage;
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    initializeDatabase();
  }
  return dbInstance!;
}

export function setDbInstanceForTesting(db: DatabaseSync | null) {
  dbInstance = db;
}

function ensureDirectories(paths: DbPathsConfig) {
  for (const dir of [paths.dataDir, paths.backupDir, paths.uploadsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function hasColumn(db: DatabaseSync, tableName: string, columnName: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === columnName);
}

function addColumnIfMissing(db: DatabaseSync, tableName: string, columnName: string, definition: string) {
  if (!hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
  }
}

export function getMetaValue(db: DatabaseSync, key: string, fallback = ''): string {
  const row = db
    .prepare('SELECT meta_value FROM SYSTEM_METADATA WHERE meta_key = ?')
    .get(key) as { meta_value: string } | undefined;
  return row ? row.meta_value : fallback;
}

export function setMetaValue(db: DatabaseSync, key: string, value: string) {
  db.prepare(
    `INSERT INTO SYSTEM_METADATA (meta_key, meta_value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(meta_key) DO UPDATE SET
       meta_value = excluded.meta_value,
       updated_at = excluded.updated_at`,
  ).run(key, value, nowIso());
}

export function recordServerEvent(
  db: DatabaseSync,
  payload: {
    level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
    source: string;
    event_type: string;
    message: string;
    details?: Record<string, unknown> | string;
  },
) {
  try {
    const detailsStr =
      typeof payload.details === 'string'
        ? payload.details
        : payload.details
          ? JSON.stringify(payload.details)
          : '';
    db.prepare(
      'INSERT INTO SERVER_EVENTS (event_id, level, source, event_type, message, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(uid('evt'), payload.level, payload.source, payload.event_type, payload.message, detailsStr, nowIso());
  } catch {
    // Do not mask original DB error if event table itself cannot be written
  }
}

function createCoreSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS SYSTEM_METADATA (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS SCHEMA_MIGRATIONS (
      migration_id TEXT PRIMARY KEY,
      version TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      backup_file TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS CONFIG_VERSIONS (
      version_id TEXT PRIMARY KEY,
      version_number INTEGER NOT NULL,
      setting_key TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'APP',
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT '',
      changed_by TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'APPLIED',
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS SERVER_EVENTS (
      event_id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS BASE_CONFIGURATION (
      config_key TEXT PRIMARY KEY,
      config_value TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'INITIAL_DEFAULT' CHECK (source IN ('INITIAL_DEFAULT', 'MIGRATED_SETTINGS', 'SUPER_ADMIN', 'ROLLBACK', 'RESTORE')),
      config_version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT NOT NULL DEFAULT 'system_init',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS APP_ASSETS (
      asset_id TEXT PRIMARY KEY,
      asset_type TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content_base64 TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS USERS (
      user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      nama TEXT NOT NULL,
      kelas TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'PROFESSOR', 'SISWA')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'LOCKED')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS EXAMS (
      exam_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'ARCHIVED')),
      total_questions INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      settings_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS QUESTIONS (
      question_id TEXT PRIMARY KEY,
      question_type TEXT NOT NULL CHECK (question_type IN ('PG', 'PGK', 'BENAR_SALAH', 'ESAI', 'ISIAN_SINGKAT', 'MENJODOHKAN', 'MENGURUTKAN')),
      question_text TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}',
      correct_answer TEXT NOT NULL DEFAULT '',
      explanation TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Umum',
      materi TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT 'SEDANG',
      score REAL NOT NULL DEFAULT 10,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS EXAM_QUESTIONS (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      question_order INTEGER NOT NULL,
      score REAL NOT NULL DEFAULT 10,
      UNIQUE(exam_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS EXAM_PARTICIPANTS (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'BELUM_MULAI',
      started_at TEXT NOT NULL DEFAULT '',
      submitted_at TEXT NOT NULL DEFAULT '',
      score REAL NOT NULL DEFAULT 0,
      session_id TEXT NOT NULL DEFAULT '',
      UNIQUE(exam_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS ANSWERS (
      answer_id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      answer_json TEXT NOT NULL DEFAULT 'null',
      is_doubtful INTEGER NOT NULL DEFAULT 0,
      saved_at TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      UNIQUE(exam_id, user_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS VIOLATION_LOGS (
      log_id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_time TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS RESULTS (
      result_id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      correct_count INTEGER NOT NULL DEFAULT 0,
      incorrect_count INTEGER NOT NULL DEFAULT 0,
      unanswered_count INTEGER NOT NULL DEFAULT 0,
      total_score REAL NOT NULL DEFAULT 0,
      published INTEGER NOT NULL DEFAULT 0,
      graded_at TEXT NOT NULL,
      UNIQUE(exam_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS SETTINGS (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS SESSIONS (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      exam_id TEXT NOT NULL DEFAULT '',
      token_hash TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS AUDIT_LOGS (
      log_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      activity TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS EXAM_LOGS (
      log_id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ESSAY_GRADES (
      grade_id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      feedback TEXT NOT NULL DEFAULT '',
      graded_by TEXT NOT NULL,
      graded_at TEXT NOT NULL,
      UNIQUE(exam_id, question_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS BACKUP_LOGS (
      backup_id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      status TEXT NOT NULL,
      backup_type TEXT NOT NULL DEFAULT 'MANUAL',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      checksum_sha256 TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS EXAM_CATEGORIES (
      category_id TEXT PRIMARY KEY,
      category_name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS NOTIFICATIONS (
      notification_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS LOGIN_ATTEMPTS (
      attempt_key TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT NOT NULL DEFAULT '',
      last_attempt_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS REPORT_TEMPLATES (
      template_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      doc_category TEXT NOT NULL CHECK (doc_category IN ('LAPORAN_HASIL', 'BERITA_ACARA', 'PENGUMUMAN_PEMENANG')),
      exam_id TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      content_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS OFFICIAL_DOCUMENTS (
      doc_id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL DEFAULT '',
      template_id TEXT NOT NULL DEFAULT '',
      doc_category TEXT NOT NULL CHECK (doc_category IN ('LAPORAN_HASIL', 'BERITA_ACARA', 'PENGUMUMAN_PEMENANG')),
      title TEXT NOT NULL,
      doc_number TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
      content_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Safe additive column guards for pre-hardening databases before pre-migration backup logging
  addColumnIfMissing(db, 'BACKUP_LOGS', 'backup_type', "TEXT NOT NULL DEFAULT 'MANUAL'");
  addColumnIfMissing(db, 'BACKUP_LOGS', 'size_bytes', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'BACKUP_LOGS', 'checksum_sha256', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'QUESTIONS', 'materi', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'APP_ASSETS', 'content_base64', "TEXT NOT NULL DEFAULT ''");
}

interface MigrationStep {
  version: string;
  description: string;
  apply: (db: DatabaseSync) => void;
}

const MIGRATIONS: MigrationStep[] = [
  {
    version: '001_initial_schema',
    description: 'Skema dasar 18 tabel CBT KIR IPA',
    apply: (db) => {
      addColumnIfMissing(db, 'QUESTIONS', 'materi', "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    version: '002_persistence_hardening',
    description: 'Penambahan metadata anti-reset, riwayat versi konfigurasi, aset permanen, dan metadata backup',
    apply: (db) => {
      addColumnIfMissing(db, 'BACKUP_LOGS', 'backup_type', "TEXT NOT NULL DEFAULT 'MANUAL'");
      addColumnIfMissing(db, 'BACKUP_LOGS', 'size_bytes', 'INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing(db, 'BACKUP_LOGS', 'checksum_sha256', "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, 'QUESTIONS', 'materi', "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    version: '003_permanent_base_configuration',
    description: 'Migrasi SETTINGS ke tabel BASE_CONFIGURATION permanen dan cadangan biner APP_ASSETS',
    apply: (db) => {
      addColumnIfMissing(db, 'APP_ASSETS', 'content_base64', "TEXT NOT NULL DEFAULT ''");
      const existingSettings = db
        .prepare('SELECT setting_key, setting_value FROM SETTINGS')
        .all() as Array<{ setting_key: string; setting_value: string }>;
      const cfgVer = Math.max(1, Number(getMetaValue(db, 'CONFIG_VERSION', '1')) || 1);
      const hasEdits =
        cfgVer > 1 ||
        ((db.prepare('SELECT COUNT(*) as c FROM CONFIG_VERSIONS').get() as { c: number }).c > 0);
      const source: BaseConfigSource = hasEdits ? 'SUPER_ADMIN' : 'MIGRATED_SETTINGS';
      const ts = nowIso();
      const upsertBase = db.prepare(
        `INSERT OR IGNORE INTO BASE_CONFIGURATION (config_key, config_value, source, config_version, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const s of existingSettings) {
        upsertBase.run(s.setting_key, s.setting_value, source, cfgVer, hasEdits ? 'super_admin' : 'system_migration', ts);
      }
      // Backfill APP_ASSETS content_base64 if files currently exist on disk
      const assets = db
        .prepare('SELECT asset_id, file_path, content_base64 FROM APP_ASSETS')
        .all() as Array<{ asset_id: string; file_path: string; content_base64: string }>;
      for (const a of assets) {
        if (!a.content_base64 && a.file_path && fs.existsSync(a.file_path)) {
          try {
            const b64 = fs.readFileSync(a.file_path).toString('base64');
            db.prepare('UPDATE APP_ASSETS SET content_base64 = ? WHERE asset_id = ?').run(b64, a.asset_id);
          } catch {
            // Keep migration non-fatal if an old asset file was external
          }
        }
      }
    },
  },
];

function runSafeMigrations(db: DatabaseSync, backupDir: string, existingHasData: boolean) {
  const appliedRows = db
    .prepare('SELECT version FROM SCHEMA_MIGRATIONS')
    .all() as Array<{ version: string }>;
  const appliedSet = new Set(appliedRows.map((r) => r.version));
  const pending = MIGRATIONS.filter((m) => !appliedSet.has(m.version));
  if (pending.length === 0) return;

  let preMigrationBackupFile = '';
  if (existingHasData) {
    const bkp = createBackupSnapshot(db, 'system_migration', {
      backupDir,
      backupType: 'AUTO_PRE_MIGRATION',
    });
    preMigrationBackupFile = bkp.file_id;
  }

  for (const step of pending) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      step.apply(db);
      db.prepare(
        'INSERT INTO SCHEMA_MIGRATIONS (migration_id, version, description, applied_at, backup_file) VALUES (?, ?, ?, ?, ?)',
      ).run(uid('mig'), step.version, step.description, nowIso(), preMigrationBackupFile);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      recordServerEvent(db, {
        level: 'CRITICAL',
        source: 'db.ts',
        event_type: 'MIGRATION_FAILED',
        message: `Migrasi ${step.version} gagal dan dibatalkan.`,
        details: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }

  const latest = pending[pending.length - 1];
  setMetaValue(db, 'LAST_MIGRATION_VERSION', latest.version);
  setMetaValue(db, 'DATABASE_VERSION', DB_SCHEMA_VERSION);
}

function ensureSystemMetadataDefaults(db: DatabaseSync) {
  const ts = nowIso();
  const baseCount = (db.prepare('SELECT COUNT(*) as c FROM BASE_CONFIGURATION').get() as { c: number }).c;
  const superAdminEdited =
    baseCount > 0 &&
    ((
      db
        .prepare("SELECT COUNT(*) as c FROM BASE_CONFIGURATION WHERE source != 'INITIAL_DEFAULT'")
        .get() as { c: number }
    ).c > 0);
  const defaults: Record<string, string> = {
    DATABASE_INITIALIZED: 'true',
    DATABASE_VERSION: DB_SCHEMA_VERSION,
    APP_VERSION: APP_VERSION,
    INSTALLATION_ID: uid('inst'),
    LAST_MIGRATION_VERSION: MIGRATIONS[MIGRATIONS.length - 1].version,
    LAST_SUCCESSFUL_BACKUP: '',
    LAST_SAVE_AT: ts,
    LAST_SYNC_CHECK_AT: ts,
    CONFIG_VERSION: '1',
    BASE_CONFIG_SOURCE: superAdminEdited ? 'SUPER_ADMIN' : 'INITIAL_DEFAULT',
    BASE_CONFIG_UPDATED_AT: ts,
    BASE_CONFIG_UPDATED_BY: superAdminEdited ? 'super_admin' : 'system_init',
    SYNC_VERSION_CONFIG: '1',
    SYNC_VERSION_USERS: '1',
    SYNC_VERSION_QUESTIONS: '1',
    SYNC_VERSION_EXAMS: '1',
    SYNC_VERSION_RESULTS: '1',
    SYNC_VERSION_DOCUMENTS: '1',
    SYNC_VERSION_BACKUPS: '1',
  };

  const stmt = db.prepare(
    'INSERT OR IGNORE INTO SYSTEM_METADATA (meta_key, meta_value, updated_at) VALUES (?, ?, ?)',
  );
  for (const [k, v] of Object.entries(defaults)) {
    stmt.run(k, v, ts);
  }
  // Always keep current running app/db version synced without touching INSTALLATION_ID or CONFIG_VERSION
  setMetaValue(db, 'APP_VERSION', APP_VERSION);
  setMetaValue(db, 'DATABASE_VERSION', DB_SCHEMA_VERSION);
}

export function openAndInitializeDatabase(paths: DbPathsConfig = getDefaultDbPaths()): DatabaseSync {
  ensureDirectories(paths);

  const fileExistedBefore = fs.existsSync(paths.dbPath);
  const fileSizeBefore = fileExistedBefore ? fs.statSync(paths.dbPath).size : 0;

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(paths.dbPath);
    const check = db.prepare('PRAGMA quick_check;').get() as { quick_check?: string } | undefined;
    if (!check || check.quick_check !== 'ok') {
      throw new DatabasePersistenceError(
        `Pemeriksaan integritas database gagal (${check?.quick_check || 'unknown'}).`,
        'DB_INTEGRITY_FAILED',
      );
    }
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA synchronous = NORMAL;');
  } catch (err) {
    lastDbErrorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  }

  // Ensure schema tables exist (never drops or clears existing tables)
  createCoreSchema(db);

  // Inspect existing initialization markers and actual table counts BEFORE running any seed
  const initializedMeta = getMetaValue(db, 'DATABASE_INITIALIZED', '');
  const existingUsers = (db.prepare('SELECT COUNT(*) as c FROM USERS').get() as { c: number }).c;
  const existingSettings = (db.prepare('SELECT COUNT(*) as c FROM SETTINGS').get() as { c: number }).c;
  const existingBaseCfg = (db.prepare('SELECT COUNT(*) as c FROM BASE_CONFIGURATION').get() as { c: number }).c;
  const existingExams = (db.prepare('SELECT COUNT(*) as c FROM EXAMS').get() as { c: number }).c;
  const existingHasData = existingUsers > 0 || existingSettings > 0 || existingBaseCfg > 0 || existingExams > 0;

  // Anti-reset check: if DB was previously marked initialized, NEVER auto-reseed if core tables are unexpectedly empty
  if (initializedMeta === 'true' && (existingUsers === 0 || (existingSettings === 0 && existingBaseCfg === 0))) {
    const msg =
      'Pencegahan Reset Aktif: Database sudah pernah diinisialisasi namun tabel USERS/BASE_CONFIGURATION kosong. Sistem menolak reset otomatis ke pengaturan awal.';
    recordServerEvent(db, {
      level: 'CRITICAL',
      source: 'initializeDatabase',
      event_type: 'BLOCKED_SILENT_RESEED',
      message: msg,
      details: { existingUsers, existingSettings, existingBaseCfg, fileExistedBefore, fileSizeBefore },
    });
    lastDbErrorMessage = msg;
    throw new DatabasePersistenceError(msg, 'DB_EMPTY_AFTER_INIT');
  }

  // Run safe forward-only schema migrations (creates pre-migration backup automatically if data exists)
  runSafeMigrations(db, paths.backupDir, existingHasData);

  if (initializedMeta === 'true' || existingHasData) {
    // Existing database (either already hardened or upgrading from pre-hardening DB):
    // NEVER wipe, overwrite, or reset BASE_CONFIGURATION, SETTINGS, or USERS!
    // Only fill genuinely missing new schema keys if absent from both tables.
    const ts = nowIso();
    const insertMissingBase = db.prepare(
      "INSERT OR IGNORE INTO BASE_CONFIGURATION (config_key, config_value, source, config_version, updated_by, updated_at) VALUES (?, ?, ?, 1, 'system_upgrade', ?)",
    );
    const insertMissingSetting = db.prepare(
      'INSERT OR IGNORE INTO SETTINGS (setting_key, setting_value) VALUES (?, ?)',
    );
    const existingSettingsMap = new Map<string, string>();
    for (const r of db.prepare('SELECT setting_key, setting_value FROM SETTINGS').all() as Array<{ setting_key: string; setting_value: string }>) {
      existingSettingsMap.set(r.setting_key, r.setting_value);
    }
    const existingBaseMap = new Map<string, string>();
    for (const r of db.prepare('SELECT config_key, config_value FROM BASE_CONFIGURATION').all() as Array<{ config_key: string; config_value: string }>) {
      existingBaseMap.set(r.config_key, r.config_value);
    }

    for (const [k, v] of Object.entries(DEFAULT_APP_SETTINGS)) {
      const val = existingBaseMap.get(k) ?? existingSettingsMap.get(k) ?? v;
      const src: BaseConfigSource = existingSettingsMap.has(k) ? 'MIGRATED_SETTINGS' : 'INITIAL_DEFAULT';
      insertMissingBase.run(k, val, src, ts);
      insertMissingSetting.run(k, val);
    }
    ensureDefaultReportTemplates(db, false);
    ensureSystemMetadataDefaults(db);
    lastDbErrorMessage = null;
    return db;
  }

  // Brand-new empty installation: seed initial data once, then lock DATABASE_INITIALIZED = 'true'
  seedInitialData(db);
  ensureDefaultReportTemplates(db, false);
  ensureSystemMetadataDefaults(db);
  lastDbErrorMessage = null;
  return db;
}

export function initializeDatabase(): DatabaseSync {
  const db = openAndInitializeDatabase(getDefaultDbPaths());
  dbInstance = db;
  return db;
}

export const DEFAULT_APP_SETTINGS: AppSettingsMap = {
  app_name: 'CBT KIR IPA SMAN 1 SUKABUMI',
  org_name: 'Kelompok Ilmiah Remaja (KIR) IPA',
  school_name: 'SMA Negeri 1 Sukabumi',
  academic_year: '2026 / 2027',
  management_period: 'Periode 2026–2027',
  logo_url: '/src/assets/images/kir_ipa_logo_1795216569338.jpg',
  primary_color: '#0F294A',
  accent_color: '#D97706',
  contact_info: 'Jl. RH. Didi Sukardi No. 124, Sukabumi · kiripa@sman1sukabumi.sch.id',
  announcement:
    'Selamat datang di Portal Ujian Digital Resmi KIR IPA SMAN 1 Sukabumi. Pastikan koneksi stabil dan gunakan mode layar penuh saat ujian seleksi OSN berlangsung.',
  report_footer: 'Dokumen Resmi Panitia Evaluasi Akademik KIR IPA SMA Negeri 1 Sukabumi',
  max_login_attempts: '5',
  lockout_minutes: '5',
  session_hours: '8',
  professor_global_access: 'false',
};

export const ALLOWED_SETTING_KEYS: Array<keyof AppSettingsMap> = [
  'app_name',
  'org_name',
  'school_name',
  'academic_year',
  'management_period',
  'logo_url',
  'primary_color',
  'accent_color',
  'contact_info',
  'announcement',
  'report_footer',
  'max_login_attempts',
  'lockout_minutes',
  'session_hours',
  'professor_global_access',
];

const SECURITY_SETTING_KEYS = new Set<string>([
  'max_login_attempts',
  'lockout_minutes',
  'session_hours',
  'professor_global_access',
]);

export function getBaseConfigurationMap(
  db: DatabaseSync,
  options: { strict?: boolean } = {},
): AppSettingsMap {
  let baseRows: Array<{ config_key: string; config_value: string }>;
  try {
    baseRows = db.prepare('SELECT config_key, config_value FROM BASE_CONFIGURATION').all() as Array<{
      config_key: string;
      config_value: string;
    }>;
  } catch (err) {
    const msg = 'Gagal membaca BASE_CONFIGURATION dari database server.';
    recordServerEvent(db, {
      level: 'CRITICAL',
      source: 'getBaseConfigurationMap',
      event_type: 'BASE_CONFIG_READ_ERROR',
      message: msg,
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    throw new DatabasePersistenceError(msg, 'BASE_CONFIG_READ_ERROR');
  }

  let settingRows: Array<{ setting_key: string; setting_value: string }> = [];
  if (baseRows.length === 0) {
    try {
      settingRows = db.prepare('SELECT setting_key, setting_value FROM SETTINGS').all() as Array<{
        setting_key: string;
        setting_value: string;
      }>;
    } catch {
      settingRows = [];
    }
  }

  const initialized = getMetaValue(db, 'DATABASE_INITIALIZED', '') === 'true';
  if ((initialized || options.strict) && baseRows.length === 0 && settingRows.length === 0) {
    const msg =
      'BASE_CONFIGURATION kosong padahal database sudah aktif. Sistem memblokir fallback ke pengaturan awal.';
    recordServerEvent(db, {
      level: 'CRITICAL',
      source: 'getBaseConfigurationMap',
      event_type: 'SETTINGS_EMPTY_AFTER_INIT',
      message: msg,
    });
    throw new DatabasePersistenceError(msg, 'SETTINGS_EMPTY_AFTER_INIT');
  }

  const map: Record<string, string> = {};
  if (baseRows.length > 0) {
    for (const r of baseRows) {
      map[r.config_key] = r.config_value;
    }
  } else {
    for (const r of settingRows) {
      map[r.setting_key] = r.setting_value;
    }
  }

  // Only populate keys genuinely absent from both tables (never overwrite any stored value)
  for (const [k, v] of Object.entries(DEFAULT_APP_SETTINGS)) {
    if (map[k] === undefined) {
      map[k] = v;
    }
  }
  return map as unknown as AppSettingsMap;
}

export function getSettingsMap(db: DatabaseSync, options: { strict?: boolean } = {}): AppSettingsMap {
  return getBaseConfigurationMap(db, options);
}

export function getConfigVersion(db: DatabaseSync): number {
  return Math.max(1, Number(getMetaValue(db, 'CONFIG_VERSION', '1')) || 1);
}

const SYNC_META_KEY_MAP: Record<SyncDomain, string> = {
  config: 'SYNC_VERSION_CONFIG',
  users: 'SYNC_VERSION_USERS',
  questions: 'SYNC_VERSION_QUESTIONS',
  exams: 'SYNC_VERSION_EXAMS',
  results: 'SYNC_VERSION_RESULTS',
  documents: 'SYNC_VERSION_DOCUMENTS',
  backups: 'SYNC_VERSION_BACKUPS',
};

export function getSyncVersions(db: DatabaseSync): SyncVersionsMap {
  const out = {} as SyncVersionsMap;
  for (const [domain, metaKey] of Object.entries(SYNC_META_KEY_MAP) as Array<[SyncDomain, string]>) {
    out[domain] = Math.max(1, Number(getMetaValue(db, metaKey, '1')) || 1);
  }
  return out;
}

export function bumpSyncVersion(db: DatabaseSync, domain: SyncDomain): number {
  const metaKey = SYNC_META_KEY_MAP[domain];
  const next = Math.max(1, Number(getMetaValue(db, metaKey, '1')) || 1) + 1;
  setMetaValue(db, metaKey, String(next));
  setMetaValue(db, 'LAST_SAVE_AT', nowIso());
  return next;
}

export function getSyncState(db: DatabaseSync): SystemSyncState {
  // Verify DB is genuinely readable
  db.prepare('SELECT 1 as ok').get();
  const ts = nowIso();
  setMetaValue(db, 'LAST_SYNC_CHECK_AT', ts);
  return {
    server_time: ts,
    db_ok: true,
    installation_id: getMetaValue(db, 'INSTALLATION_ID', 'unknown'),
    app_version: getMetaValue(db, 'APP_VERSION', APP_VERSION),
    db_version: getMetaValue(db, 'DATABASE_VERSION', DB_SCHEMA_VERSION),
    config_version: getConfigVersion(db),
    base_config_source: (getMetaValue(db, 'BASE_CONFIG_SOURCE', 'INITIAL_DEFAULT') as BaseConfigSource),
    base_config_updated_at: getMetaValue(db, 'BASE_CONFIG_UPDATED_AT', ''),
    last_save_at: getMetaValue(db, 'LAST_SAVE_AT', ''),
    last_backup_at: getMetaValue(db, 'LAST_SUCCESSFUL_BACKUP', ''),
    sync_versions: getSyncVersions(db),
  };
}

function validateSettingUpdateEntry(key: keyof AppSettingsMap, rawVal: string): string {
  const val = rawVal.trim();
  if (key === 'app_name' || key === 'school_name' || key === 'org_name') {
    if (!val) {
      throw new Error(`Pengaturan "${key}" tidak boleh kosong.`);
    }
    return val.slice(0, 160);
  }
  if (key === 'primary_color' || key === 'accent_color') {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(val)) {
      throw new Error(`Kode warna "${key}" harus menggunakan format hex yang valid (mis. #0F294A).`);
    }
    return val;
  }
  if (key === 'max_login_attempts') {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 3 || n > 15) {
      throw new Error('Maksimal percobaan login harus bernilai antara 3 hingga 15.');
    }
    return String(Math.round(n));
  }
  if (key === 'lockout_minutes') {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 1 || n > 60) {
      throw new Error('Durasi blokir login harus antara 1 hingga 60 menit.');
    }
    return String(Math.round(n));
  }
  if (key === 'session_hours') {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 1 || n > 24) {
      throw new Error('Masa aktif sesi harus antara 1 hingga 24 jam.');
    }
    return String(Math.round(n));
  }
  if (key === 'professor_global_access') {
    return val === 'true' ? 'true' : 'false';
  }
  return rawVal;
}

export function updateSettingsWithVersioning(
  db: DatabaseSync,
  updates: Partial<Record<keyof AppSettingsMap, unknown>>,
  actorUserId: string,
  options: {
    expectedVersion?: number;
    note?: string;
    status?: 'APPLIED' | 'ROLLED_BACK';
    source?: BaseConfigSource;
  } = {},
): {
  settings: AppSettingsMap;
  config_version: number;
  base_config_source: BaseConfigSource;
  changed_keys: string[];
  verified: boolean;
} {
  const currentVersion = getConfigVersion(db);
  if (
    options.expectedVersion !== undefined &&
    Number(options.expectedVersion) !== currentVersion
  ) {
    throw new ConflictError(
      `Konflik versi konfigurasi: versi server saat ini adalah #${currentVersion}, sedangkan halaman Anda masih memuat versi #${options.expectedVersion}. Muat ulang konfigurasi terbaru sebelum menyimpan.`,
      currentVersion,
    );
  }

  const existing = getBaseConfigurationMap(db, { strict: true });
  const changedEntries: Array<{
    key: keyof AppSettingsMap;
    oldValue: string;
    newValue: string;
    category: 'APP' | 'SECURITY';
  }> = [];

  for (const key of ALLOWED_SETTING_KEYS) {
    if (updates[key] === undefined) continue;
    const nextVal = validateSettingUpdateEntry(key, String(updates[key]));
    const prevVal = String(existing[key] ?? '');
    if (nextVal !== prevVal) {
      changedEntries.push({
        key,
        oldValue: prevVal,
        newValue: nextVal,
        category: SECURITY_SETTING_KEYS.has(key) ? 'SECURITY' : 'APP',
      });
    }
  }

  if (changedEntries.length === 0) {
    return {
      settings: existing,
      config_version: currentVersion,
      base_config_source: getMetaValue(db, 'BASE_CONFIG_SOURCE', 'INITIAL_DEFAULT') as BaseConfigSource,
      changed_keys: [],
      verified: true,
    };
  }

  const nextVersion = currentVersion + 1;
  const ts = nowIso();
  const nextSource: BaseConfigSource =
    options.source || (options.status === 'ROLLED_BACK' ? 'ROLLBACK' : 'SUPER_ADMIN');

  db.exec('BEGIN IMMEDIATE;');
  try {
    const upsertBase = db.prepare(
      `INSERT INTO BASE_CONFIGURATION (config_key, config_value, source, config_version, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(config_key) DO UPDATE SET
         config_value = excluded.config_value,
         source = excluded.source,
         config_version = excluded.config_version,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    );
    const upsertSetting = db.prepare(
      `INSERT INTO SETTINGS (setting_key, setting_value) VALUES (?, ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    );
    const insertVersion = db.prepare(
      `INSERT INTO CONFIG_VERSIONS (version_id, version_number, setting_key, category, old_value, new_value, changed_by, changed_at, status, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const entry of changedEntries) {
      upsertBase.run(entry.key, entry.newValue, nextSource, nextVersion, actorUserId, ts);
      upsertSetting.run(entry.key, entry.newValue);
      insertVersion.run(
        uid('cfgv'),
        nextVersion,
        entry.key,
        entry.category,
        entry.oldValue,
        entry.newValue,
        actorUserId,
        ts,
        options.status || 'APPLIED',
        options.note || '',
      );
    }

    setMetaValue(db, 'CONFIG_VERSION', String(nextVersion));
    setMetaValue(db, 'BASE_CONFIG_SOURCE', nextSource);
    setMetaValue(db, 'BASE_CONFIG_UPDATED_AT', ts);
    setMetaValue(db, 'BASE_CONFIG_UPDATED_BY', actorUserId);
    bumpSyncVersion(db, 'config');

    // Read-back verification inside transaction against BOTH BASE_CONFIGURATION & SETTINGS before commit
    const verifyBaseStmt = db.prepare(
      'SELECT config_value, config_version FROM BASE_CONFIGURATION WHERE config_key = ?',
    );
    const verifySettingStmt = db.prepare(
      'SELECT setting_value FROM SETTINGS WHERE setting_key = ?',
    );
    for (const entry of changedEntries) {
      const baseRow = verifyBaseStmt.get(entry.key) as
        | { config_value: string; config_version: number }
        | undefined;
      const settingRow = verifySettingStmt.get(entry.key) as { setting_value: string } | undefined;
      if (
        !baseRow ||
        baseRow.config_value !== entry.newValue ||
        baseRow.config_version !== nextVersion ||
        !settingRow ||
        settingRow.setting_value !== entry.newValue
      ) {
        throw new DatabasePersistenceError(
          `Verifikasi write-through Base Configuration gagal untuk "${entry.key}".`,
          'WRITE_VERIFICATION_FAILED',
        );
      }
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    recordServerEvent(db, {
      level: 'ERROR',
      source: 'updateSettingsWithVersioning',
      event_type: 'SETTINGS_SAVE_FAILED',
      message: err instanceof Error ? err.message : 'Gagal menyimpan pengaturan ke Base Configuration.',
      details: { keys: changedEntries.map((c) => c.key), actorUserId },
    });
    throw err;
  }

  logAudit(db, actorUserId, 'BASE_CONFIG_WRITE_THROUGH', {
    version: nextVersion,
    source: nextSource,
    keys: changedEntries.map((c) => c.key),
  });

  return {
    settings: getBaseConfigurationMap(db, { strict: true }),
    config_version: nextVersion,
    base_config_source: nextSource,
    changed_keys: changedEntries.map((c) => c.key),
    verified: true,
  };
}

export function rollbackConfigVersion(
  db: DatabaseSync,
  versionId: string,
  actorUserId: string,
) {
  const target = db
    .prepare('SELECT * FROM CONFIG_VERSIONS WHERE version_id = ?')
    .get(versionId) as ConfigVersionRecord | undefined;
  if (!target) {
    throw new Error('Riwayat versi konfigurasi tidak ditemukan.');
  }
  const key = target.setting_key as keyof AppSettingsMap;
  if (!ALLOWED_SETTING_KEYS.includes(key)) {
    throw new Error('Kunci konfigurasi pada riwayat ini tidak valid.');
  }

  // Restore ONLY the selected configuration key to target's old_value
  const result = updateSettingsWithVersioning(
    db,
    { [key]: target.old_value },
    actorUserId,
    {
      status: 'ROLLED_BACK',
      source: 'ROLLBACK',
      note: `Rollback perubahan #${target.version_number} (${target.setting_key})`,
    },
  );

  logAudit(db, actorUserId, 'CONFIG_ROLLBACK', {
    rolled_back_version_id: versionId,
    setting_key: key,
    new_config_version: result.config_version,
  });

  return result;
}

export function getConfigVersionHistory(db: DatabaseSync, limit = 50): ConfigVersionRecord[] {
  return db
    .prepare(
      `SELECT cv.*, COALESCE(u.nama, cv.changed_by) as changed_by_name
       FROM CONFIG_VERSIONS cv
       LEFT JOIN USERS u ON u.user_id = cv.changed_by
       ORDER BY cv.version_number DESC, cv.changed_at DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as ConfigVersionRecord[];
}

export function getServerEvents(db: DatabaseSync, limit = 50): ServerEventRecord[] {
  return db
    .prepare('SELECT * FROM SERVER_EVENTS ORDER BY created_at DESC LIMIT ?')
    .all(limit) as unknown as ServerEventRecord[];
}

export function saveUploadedLogoFile(
  db: DatabaseSync,
  params: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    ext: string;
    uploadedBy: string;
    uploadsDir?: string;
  },
): {
  asset_id: string;
  filename: string;
  logo_url: string;
  size_bytes: number;
  sha256: string;
} {
  const uploadsDir = params.uploadsDir || getDefaultDbPaths().uploadsDir;
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const assetId = uid('ast');
  const safeExt = params.ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
  const filename = `logo_${assetId}_${Date.now()}.${safeExt}`;
  const fullPath = path.resolve(uploadsDir, filename);
  if (!fullPath.startsWith(path.resolve(uploadsDir) + path.sep)) {
    throw new Error('Lokasi file upload tidak valid.');
  }

  fs.writeFileSync(fullPath, params.buffer);
  const stat = fs.statSync(fullPath);
  const writtenBytes = fs.readFileSync(fullPath);
  const sha256 = crypto.createHash('sha256').update(writtenBytes).digest('hex');

  if (stat.size !== params.buffer.length || stat.size === 0) {
    throw new DatabasePersistenceError('Verifikasi ukuran file logo pada disk gagal.', 'UPLOAD_VERIFY_FAILED');
  }

  const contentBase64 = writtenBytes.toString('base64');
  db.prepare(
    `INSERT INTO APP_ASSETS (asset_id, asset_type, filename, mime_type, size_bytes, sha256, file_path, content_base64, created_by, created_at)
     VALUES (?, 'LOGO', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    assetId,
    filename,
    params.mimeType,
    stat.size,
    sha256,
    fullPath,
    contentBase64,
    params.uploadedBy,
    nowIso(),
  );

  logAudit(db, params.uploadedBy, 'LOGO_FILE_UPLOAD', {
    asset_id: assetId,
    filename,
    size_bytes: stat.size,
  });

  return {
    asset_id: assetId,
    filename,
    logo_url: `/api/assets/${encodeURIComponent(filename)}`,
    size_bytes: stat.size,
    sha256,
  };
}

export function resolveUploadedAssetFile(
  db: DatabaseSync,
  safeName: string,
  uploadsDir: string = getDefaultDbPaths().uploadsDir,
): { buffer: Buffer; mimeType: string } | null {
  const cleanName = path.basename(safeName);
  if (!cleanName) return null;
  const fullPath = path.resolve(uploadsDir, cleanName);
  if (!fullPath.startsWith(path.resolve(uploadsDir) + path.sep)) {
    return null;
  }

  const ext = path.extname(cleanName).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  const fallbackMime = mimeMap[ext] || 'application/octet-stream';

  if (fs.existsSync(fullPath)) {
    return { buffer: fs.readFileSync(fullPath), mimeType: fallbackMime };
  }

  // Self-heal from embedded APP_ASSETS.content_base64 in SQLite database if disk uploads directory was replaced
  const row = db
    .prepare('SELECT mime_type, sha256, content_base64 FROM APP_ASSETS WHERE filename = ?')
    .get(cleanName) as { mime_type: string; sha256: string; content_base64: string } | undefined;
  if (!row || !row.content_base64) {
    return null;
  }

  const buf = Buffer.from(row.content_base64, 'base64');
  if (buf.length === 0) return null;
  if (row.sha256) {
    const actualSha = crypto.createHash('sha256').update(buf).digest('hex');
    if (actualSha !== row.sha256) return null;
  }

  try {
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(fullPath, buf);
  } catch {
    // Still serve in-memory buffer even if upload dir is temporarily unwritable
  }

  return { buffer: buf, mimeType: row.mime_type || fallbackMime };
}

export function logAudit(db: DatabaseSync, userId: string, activity: string, details: Record<string, unknown> | string) {
  const detailsStr = typeof details === 'string' ? details : JSON.stringify(details);
  db.prepare(
    'INSERT INTO AUDIT_LOGS (log_id, user_id, activity, timestamp, details) VALUES (?, ?, ?, ?, ?)',
  ).run(uid('aud'), userId, activity, nowIso(), detailsStr);
}

export function logExamEvent(
  db: DatabaseSync,
  examId: string,
  userId: string,
  eventType: string,
  details: string,
) {
  db.prepare(
    'INSERT INTO EXAM_LOGS (log_id, exam_id, user_id, event_type, timestamp, details) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(uid('exl'), examId, userId, eventType, nowIso(), details);
}

export function createNotification(db: DatabaseSync, userId: string, title: string, message: string) {
  db.prepare(
    'INSERT INTO NOTIFICATIONS (notification_id, user_id, title, message, created_at, is_read) VALUES (?, ?, ?, ?, ?, 0)',
  ).run(uid('ntf'), userId, title, message, nowIso());
}

function seedInitialData(db: DatabaseSync) {
  const ts = nowIso();
  const baseCount = (db.prepare('SELECT COUNT(*) as c FROM BASE_CONFIGURATION').get() as { c: number }).c;
  if (baseCount === 0) {
    const insertBase = db.prepare(
      "INSERT OR IGNORE INTO BASE_CONFIGURATION (config_key, config_value, source, config_version, updated_by, updated_at) VALUES (?, ?, 'INITIAL_DEFAULT', 1, 'system_init', ?)",
    );
    for (const [k, v] of Object.entries(DEFAULT_APP_SETTINGS)) {
      insertBase.run(k, v, ts);
    }
  }

  const settingsCount = (db.prepare('SELECT COUNT(*) as c FROM SETTINGS').get() as { c: number }).c;
  if (settingsCount === 0) {
    const insertSetting = db.prepare(
      'INSERT OR IGNORE INTO SETTINGS (setting_key, setting_value) VALUES (?, ?)',
    );
    for (const [k, v] of Object.entries(DEFAULT_APP_SETTINGS)) {
      insertSetting.run(k, v);
    }
  }

  const userCount = (db.prepare('SELECT COUNT(*) as c FROM USERS').get() as { c: number }).c;
  if (userCount > 0) {
    return;
  }

  const createdAt = nowIso();
  const insertUser = db.prepare(
    'INSERT INTO USERS (user_id, username, password_hash, password_salt, nama, kelas, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );

  const adminPass = process.env.SUPER_ADMIN_INITIAL_PASSWORD || 'guakeren';
  const profPass = 'ProfKir2026!';
  const siswaPass = 'SiswaKir2026!';

  const seedUsers = [
    { id: 'usr_admin_01', username: 'aetherium22', pass: adminPass, nama: 'Drs. Hendra Wijaya, M.Pd.', kelas: 'Pembina Utama', role: 'SUPER_ADMIN' },
    { id: 'usr_prof_01', username: 'prof.fisika', pass: profPass, nama: 'Siti Nurhaliza, S.Si., M.Sc.', kelas: 'Divisi Fisika & Astronomi', role: 'PROFESSOR' },
    { id: 'usr_prof_02', username: 'prof.biokimia', pass: profPass, nama: 'Dr. Bagus Prasetyo, M.Si.', kelas: 'Divisi Biologi & Kimia', role: 'PROFESSOR' },
    { id: 'usr_siswa_01', username: 'siswa01', pass: siswaPass, nama: 'Nadia Putri Ramadhani', kelas: 'XI-IPA-1', role: 'SISWA' },
    { id: 'usr_siswa_02', username: 'siswa02', pass: siswaPass, nama: 'Rafi Ahmad Fauzan', kelas: 'XI-IPA-1', role: 'SISWA' },
    { id: 'usr_siswa_03', username: 'siswa03', pass: siswaPass, nama: 'Aulia Zahra Maharani', kelas: 'XI-IPA-2', role: 'SISWA' },
    { id: 'usr_siswa_04', username: 'siswa04', pass: siswaPass, nama: 'Dimas Pratama Putra', kelas: 'X-MIPA-1', role: 'SISWA' },
    { id: 'usr_siswa_05', username: 'siswa05', pass: siswaPass, nama: 'Keisha Permata Sari', kelas: 'XII-IPA-1', role: 'SISWA' },
    { id: 'usr_siswa_06', username: 'siswa06', pass: siswaPass, nama: 'Fajar Maulana Hakim', kelas: 'XI-IPA-2', role: 'SISWA' },
    { id: 'usr_siswa_07', username: 'siswa07', pass: siswaPass, nama: 'Salsabila Khoirunnisa', kelas: 'X-MIPA-2', role: 'SISWA' },
  ];

  for (const u of seedUsers) {
    const { hash, salt } = hashPassword(u.pass);
    insertUser.run(u.id, u.username, hash, salt, u.nama, u.kelas, u.role, 'ACTIVE', createdAt);
  }

  // Categories
  const insertCat = db.prepare(
    'INSERT INTO EXAM_CATEGORIES (category_id, category_name, description, created_at) VALUES (?, ?, ?, ?)',
  );
  insertCat.run('cat_fisika', 'Fisika', 'Mekanika, Termodinamika, Elektromagnetik, Optik & Fisika Modern', createdAt);
  insertCat.run('cat_kimia', 'Kimia', 'Stoikiometri, Termokimia, Kesetimbangan, Kimia Organik & Larutan', createdAt);
  insertCat.run('cat_biologi', 'Biologi', 'Biologi Sel, Genetika Molekuler, Fisiologi & Ekologi', createdAt);
  insertCat.run('cat_metode', 'Metode Ilmiah & Matematika', 'Rancangan Eksperimen, Statistika Riset & Penalaran Kuantitatif', createdAt);

  // Questions covering all 7 types with KaTeX math & chemistry
  const insertQ = db.prepare(
    `INSERT INTO QUESTIONS (question_id, question_type, question_text, options_json, correct_answer, explanation, image_url, category, materi, difficulty, score, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const seedQuestions = [
    {
      id: 'q_pg_fisika_01',
      type: 'PG',
      text: '<p>Sebuah benda bermassa $m = 2\\text{ kg}$ bergerak harmonik sederhana dengan persamaan simpangan $y(t) = 0{,}1 \\sin(10t)$ dalam satuan SI. Berapakah energi mekanik total benda tersebut?</p>',
      options: JSON.stringify({
        choices: [
          { id: 'A', label: 'A', text: '$0{,}5\\text{ J}$' },
          { id: 'B', label: 'B', text: '$1{,}0\\text{ J}$' },
          { id: 'C', label: 'C', text: '$2{,}0\\text{ J}$' },
          { id: 'D', label: 'D', text: '$5{,}0\\text{ J}$' },
          { id: 'E', label: 'E', text: '$10{,}0\\text{ J}$' },
        ],
      }),
      answer: 'B',
      explanation: 'Energi mekanik gerak harmonik sederhana: $E_m = \\frac{1}{2} m \\omega^2 A^2 = \\frac{1}{2}(2)(10)^2(0{,}1)^2 = 1{,}0\\text{ J}$.',
      category: 'Fisika',
      materi: 'Getaran Harmonik Sederhana',
      difficulty: 'SEDANG',
      score: 10,
      created_by: 'usr_prof_01',
    },
    {
      id: 'q_pgk_kimia_01',
      type: 'PGK',
      text: '<p>Perhatikan reaksi pembakaran sempurna gas metana berikut:</p><p>$$\\text{CH}_4(g) + 2\\text{O}_2(g) \\rightarrow \\text{CO}_2(g) + 2\\text{H}_2\\text{O}(g) \\quad \\Delta H = -890\\text{ kJ/mol}$$</p><p>Pernyataan berikut yang <strong>BENAR</strong> mengenai reaksi tersebut adalah (pilih lebih dari satu):</p>',
      options: JSON.stringify({
        choices: [
          { id: 'A', label: 'A', text: 'Reaksi bersifat eksoterm karena $\\Delta H < 0$.' },
          { id: 'B', label: 'B', text: 'Pembakaran $0{,}5\\text{ mol}$ $\\text{CH}_4$ melepaskan kalor $445\\text{ kJ}$.' },
          { id: 'C', label: 'C', text: 'Total koefisien reaktan lebih besar daripada produk.' },
          { id: 'D', label: 'D', text: 'Pembentukan $2\\text{ mol}$ $\\text{CO}_2$ membutuhkan $4\\text{ mol}$ $\\text{O}_2$.' },
          { id: 'E', label: 'E', text: 'Entalpi sistem meningkat setelah reaksi berlangsung.' },
        ],
        pgk_scoring: 'PARTIAL',
        pgk_penalty: 2,
      }),
      answer: JSON.stringify(['A', 'B', 'D']),
      explanation: 'Reaksi eksoterm melepaskan kalor ($\\Delta H < 0$). $0{,}5\\text{ mol}$ melepaskan $445\\text{ kJ}$, dan perbandingan stoikiometri $\\text{O}_2 : \\text{CO}_2 = 2 : 1$.',
      category: 'Kimia',
      materi: 'Termokimia & Stoikiometri',
      difficulty: 'SULIT',
      score: 15,
      created_by: 'usr_prof_02',
    },
    {
      id: 'q_bs_biologi_01',
      type: 'BENAR_SALAH',
      text: '<p><strong>Pernyataan:</strong> Pada fase terang fotosintesis tumbuhan C3, fotolisis molekul air ($\\text{H}_2\\text{O}$) terjadi di stroma kloroplas dan menghasilkan gas $\\text{CO}_2$ sebagai produk sampingan.</p>',
      options: JSON.stringify({}),
      answer: 'SALAH',
      explanation: 'Fotolisis air terjadi di <strong>lumen tilakoid</strong> (bukan stroma) pada Fotosistem II dan menghasilkan gas oksigen ($\\text{O}_2$), proton ($\\text{H}^+$), serta elektron.',
      category: 'Biologi',
      materi: 'Metabolisme & Fotosintesis',
      difficulty: 'MUDAH',
      score: 10,
      created_by: 'usr_prof_02',
    },
    {
      id: 'q_isian_kimia_01',
      type: 'ISIAN_SINGKAT',
      text: '<p>Hitunglah $\\text{pH}$ larutan asam kuat $\\text{HCl}$ dengan konsentrasi $0{,}01\\text{ M}$ pada suhu $25^\\circ\\text{C}$. (Tuliskan angka saja)</p>',
      options: JSON.stringify({
        accepted_answers: ['2', '2.0', '2,0'],
        case_sensitive: false,
      }),
      answer: '2',
      explanation: 'Karena $\\text{HCl}$ terionisasi sempurna: $[\\text{H}^+] = 10^{-2}\\text{ M}$, maka $\\text{pH} = -\\log(10^{-2}) = 2$.',
      category: 'Kimia',
      materi: 'Kesetimbangan Asam Basa',
      difficulty: 'MUDAH',
      score: 10,
      created_by: 'usr_prof_02',
    },
    {
      id: 'q_jodoh_fisika_01',
      type: 'MENJODOHKAN',
      text: '<p>Pasangkan besaran fisika di kolom kiri dengan satuan SI atau rumus dimensi yang tepat di kolom kanan:</p>',
      options: JSON.stringify({
        matching_pairs: [
          { id: 'p1', left: 'Gaya ($F$)', right: 'Newton ($\\text{kg}\\cdot\\text{m}/\\text{s}^2$)' },
          { id: 'p2', left: 'Usaha & Energi ($W$)', right: 'Joule ($\\text{kg}\\cdot\\text{m}^2/\\text{s}^2$)' },
          { id: 'p3', left: 'Daya ($P$)', right: 'Watt ($\\text{J/s}$)' },
          { id: 'p4', left: 'Tekanan ($p$)', right: 'Pascal ($\\text{N/m}^2$)' },
        ],
      }),
      answer: JSON.stringify({
        p1: 'Newton ($\\text{kg}\\cdot\\text{m}/\\text{s}^2$)',
        p2: 'Joule ($\\text{kg}\\cdot\\text{m}^2/\\text{s}^2$)',
        p3: 'Watt ($\\text{J/s}$)',
        p4: 'Pascal ($\\text{N/m}^2$)',
      }),
      explanation: 'Gaya = Newton, Usaha = Joule, Daya = Watt, dan Tekanan = Pascal.',
      category: 'Fisika',
      materi: 'Besaran & Satuan SI',
      difficulty: 'MUDAH',
      score: 20,
      created_by: 'usr_prof_01',
    },
    {
      id: 'q_urut_biologi_01',
      type: 'MENGURUTKAN',
      text: '<p>Urutkan tahapan proses mitosis sel eukariotik dari tahap paling awal hingga tahap akhir:</p>',
      options: JSON.stringify({
        ordering_items: [
          { id: 'ord_1', text: 'Profase (kondensasi kromatin menjadi kromosom)' },
          { id: 'ord_2', text: 'Metafase (kromosom berjajar di bidang ekuator)' },
          { id: 'ord_3', text: 'Anafase (kromatid saudara ditarik ke kutub berlawanan)' },
          { id: 'ord_4', text: 'Telofase (pembentukan kembali membran inti)' },
        ],
      }),
      answer: JSON.stringify(['ord_1', 'ord_2', 'ord_3', 'ord_4']),
      explanation: 'Urutan baku fase mitosis adalah Profase → Metafase → Anafase → Telofase (PMAT).',
      category: 'Biologi',
      materi: 'Pembelahan Sel',
      difficulty: 'MUDAH',
      score: 15,
      created_by: 'usr_prof_02',
    },
    {
      id: 'q_esai_metode_01',
      type: 'ESAI',
      text: '<p>Seorang anggota KIR IPA ingin meneliti pengaruh konsentrasi pupuk cair organik terhadap laju pertumbuhan tinggi tanaman cabai rawit (<em>Capsicum frutescens</em>) selama 21 hari.</p><p>Rumuskanlah <strong>hipotesis penelitian</strong>, tentukan <strong>variabel bebas, variabel terikat, dan minimal 2 variabel kontrol</strong> untuk rancangan eksperimen tersebut!</p>',
      options: JSON.stringify({
        essay_max_chars: 1500,
        essay_rubric: [
          { criterion: 'Ketepatan Hipotesis Ilmiah', max_points: 8, description: 'Menyatakan hubungan kausal terukur antara konsentrasi pupuk dan laju pertumbuhan.' },
          { criterion: 'Identifikasi Variabel Bebas & Terikat', max_points: 6, description: 'Variabel bebas = konsentrasi pupuk; variabel terikat = laju/pertambahan tinggi tanaman.' },
          { criterion: 'Kelengkapan Variabel Kontrol', max_points: 6, description: 'Minimal 2 kontrol valid (intensitas cahaya, volume penyiraman, jenis media tanam, usia bibit).' },
        ],
      }),
      answer: 'Rubrik penilaian esai metode ilmiah (skor maks 20).',
      explanation: 'Eksperimen terkontrol harus mengisolasi satu variabel bebas dan menjaga faktor lingkungan tetap seragam.',
      category: 'Metode Ilmiah & Matematika',
      materi: 'Desain Penelitian Ilmiah',
      difficulty: 'SEDANG',
      score: 20,
      created_by: 'usr_prof_01',
    },
    {
      id: 'q_pg_fisika_02',
      type: 'PG',
      text: '<p>Dalam percobaan efek fotolistrik, frekuensi ambang logam natrium adalah $f_0 = 5{,}5 \\times 10^{14}\\text{ Hz}$. Jika logam disinari cahaya dengan frekuensi $f = 7{,}5 \\times 10^{14}\\text{ Hz}$ ($h = 6{,}63 \\times 10^{-34}\\text{ J}\\cdot\\text{s}$), energi kinetik maksimum fotoelektron yang terpancar adalah:</p>',
      options: JSON.stringify({
        choices: [
          { id: 'A', label: 'A', text: '$1{,}326 \\times 10^{-19}\\text{ J}$' },
          { id: 'B', label: 'B', text: '$2{,}652 \\times 10^{-19}\\text{ J}$' },
          { id: 'C', label: 'C', text: '$3{,}646 \\times 10^{-19}\\text{ J}$' },
          { id: 'D', label: 'D', text: '$4{,}972 \\times 10^{-19}\\text{ J}$' },
          { id: 'E', label: 'E', text: '$6{,}630 \\times 10^{-19}\\text{ J}$' },
        ],
      }),
      answer: 'A',
      explanation: '$E_{k,\\max} = h(f - f_0) = 6{,}63 \\times 10^{-34}(7{,}5 - 5{,}5) \\times 10^{14} = 1{,}326 \\times 10^{-19}\\text{ J}$.',
      category: 'Fisika',
      materi: 'Fisika Kuantum',
      difficulty: 'OLIMPIADE',
      score: 10,
      created_by: 'usr_prof_01',
    },
  ];

  for (const q of seedQuestions) {
    insertQ.run(
      q.id,
      q.type,
      q.text,
      q.options,
      q.answer,
      q.explanation,
      '',
      q.category,
      q.materi,
      q.difficulty,
      q.score,
      q.created_by,
      createdAt,
    );
  }

  // Exams
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const lastWeekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const lastWeekEnd = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();

  const defaultExamSettings: ExamSettings = {
    exam_type: 'SIMULASI_OSN',
    total_score_target: 100,
    passing_grade: 70,
    target_classes: ['ALL'],
    shuffle_questions: false,
    shuffle_options: false,
    allow_free_navigation: true,
    max_attempts: 1,
    show_result_after_publish: true,
    show_explanation_after_publish: true,
    show_leaderboard: true,
    leaderboard_anonymous: false,
    anti_cheat_tab_switch: true,
    anti_cheat_fullscreen: true,
    anti_cheat_block_copy: true,
    anti_cheat_block_context_menu: true,
    anti_cheat_single_session: true,
  };

  const insertExam = db.prepare(
    `INSERT INTO EXAMS (exam_id, title, description, subject, start_time, end_time, duration, status, total_questions, created_by, settings_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  insertExam.run(
    'exm_osn_2026',
    'Seleksi Internal OSN & Riset KIR IPA 2026',
    'Ujian seleksi dan pemetaan kompetensi anggota KIR IPA SMAN 1 Sukabumi mencakup Fisika, Kimia, Biologi, dan Metode Ilmiah.',
    'Sains Terpadu (IPA)',
    oneHourAgo,
    nextWeek,
    60,
    'ACTIVE',
    7,
    'usr_prof_01',
    JSON.stringify(defaultExamSettings),
  );

  insertExam.run(
    'exm_tryout_01',
    'Tryout Dasar Olimpiade Sains Tahap 1',
    'Evaluasi pemahaman konsep dasar mekanika, termokimia, dan biologi sel anggota baru KIR IPA.',
    'IPA Terpadu',
    lastWeekStart,
    lastWeekEnd,
    45,
    'COMPLETED',
    5,
    'usr_prof_01',
    JSON.stringify({ ...defaultExamSettings, exam_type: 'EVALUASI', passing_grade: 75 }),
  );

  const insertEQ = db.prepare(
    'INSERT INTO EXAM_QUESTIONS (id, exam_id, question_id, question_order, score) VALUES (?, ?, ?, ?, ?)',
  );

  const exam1Questions = [
    ['q_pg_fisika_01', 1, 10],
    ['q_pgk_kimia_01', 2, 15],
    ['q_bs_biologi_01', 3, 10],
    ['q_isian_kimia_01', 4, 10],
    ['q_jodoh_fisika_01', 5, 20],
    ['q_urut_biologi_01', 6, 15],
    ['q_esai_metode_01', 7, 20],
  ] as const;

  for (const [qId, ord, sc] of exam1Questions) {
    insertEQ.run(uid('eq'), 'exm_osn_2026', qId, ord, sc);
  }

  const exam2Questions = [
    ['q_pg_fisika_01', 1, 20],
    ['q_pg_fisika_02', 2, 20],
    ['q_bs_biologi_01', 3, 20],
    ['q_isian_kimia_01', 4, 20],
    ['q_esai_metode_01', 5, 20],
  ] as const;

  for (const [qId, ord, sc] of exam2Questions) {
    insertEQ.run(uid('eq'), 'exm_tryout_01', qId, ord, sc);
  }

  const insertPart = db.prepare(
    'INSERT INTO EXAM_PARTICIPANTS (id, exam_id, user_id, status, started_at, submitted_at, score, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertAns = db.prepare(
    'INSERT INTO ANSWERS (answer_id, exam_id, user_id, question_id, answer_json, is_doubtful, saved_at, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertRes = db.prepare(
    'INSERT INTO RESULTS (result_id, exam_id, user_id, correct_count, incorrect_count, unanswered_count, total_score, published, graded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertEssayGrade = db.prepare(
    'INSERT INTO ESSAY_GRADES (grade_id, exam_id, question_id, user_id, score, feedback, graded_by, graded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );

  const studentIds = [
    'usr_siswa_01',
    'usr_siswa_02',
    'usr_siswa_03',
    'usr_siswa_04',
    'usr_siswa_05',
    'usr_siswa_06',
    'usr_siswa_07',
  ];

  for (const sid of studentIds) {
    insertPart.run(uid('prt'), 'exm_osn_2026', sid, 'BELUM_MULAI', '', '', 0, '');
  }

  const tryoutPerformance = [
    { sid: 'usr_siswa_01', q1: 'B', q2: 'A', q3: 'SALAH', q4: '2', essay: 19, mins: 28, graded: true },
    { sid: 'usr_siswa_02', q1: 'B', q2: 'A', q3: 'SALAH', q4: '2', essay: 17, mins: 31, graded: true },
    { sid: 'usr_siswa_03', q1: 'B', q2: 'B', q3: 'SALAH', q4: '2', essay: 18, mins: 34, graded: true },
    { sid: 'usr_siswa_04', q1: 'C', q2: 'A', q3: 'BENAR', q4: '2', essay: 15, mins: 39, graded: true },
    { sid: 'usr_siswa_05', q1: 'B', q2: 'C', q3: 'BENAR', q4: '3', essay: 14, mins: 41, graded: true },
    { sid: 'usr_siswa_06', q1: 'A', q2: 'D', q3: 'BENAR', q4: '1', essay: 0, mins: 43, graded: false },
  ];

  const baseStart = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  for (const p of tryoutPerformance) {
    const startIso = baseStart.toISOString();
    const subIso = new Date(baseStart.getTime() + p.mins * 60 * 1000).toISOString();
    const s1 = p.q1 === 'B' ? 20 : 0;
    const s2 = p.q2 === 'A' ? 20 : 0;
    const s3 = p.q3 === 'SALAH' ? 20 : 0;
    const s4 = p.q4 === '2' ? 20 : 0;
    const total = s1 + s2 + s3 + s4 + (p.graded ? p.essay : 0);
    const correctCount =
      (s1 > 0 ? 1 : 0) + (s2 > 0 ? 1 : 0) + (s3 > 0 ? 1 : 0) + (s4 > 0 ? 1 : 0) + (p.graded && p.essay >= 12 ? 1 : 0);
    const incorrectCount = 5 - correctCount;

    insertPart.run(uid('prt'), 'exm_tryout_01', p.sid, 'TERKUMPUL', startIso, subIso, total, '');
    insertAns.run(uid('ans'), 'exm_tryout_01', p.sid, 'q_pg_fisika_01', JSON.stringify(p.q1), 0, subIso, s1);
    insertAns.run(uid('ans'), 'exm_tryout_01', p.sid, 'q_pg_fisika_02', JSON.stringify(p.q2), 0, subIso, s2);
    insertAns.run(uid('ans'), 'exm_tryout_01', p.sid, 'q_bs_biologi_01', JSON.stringify(p.q3), 0, subIso, s3);
    insertAns.run(uid('ans'), 'exm_tryout_01', p.sid, 'q_isian_kimia_01', JSON.stringify(p.q4), 0, subIso, s4);
    insertAns.run(
      uid('ans'),
      'exm_tryout_01',
      p.sid,
      'q_esai_metode_01',
      JSON.stringify('Hipotesis: Pemberian pupuk organik cair berpengaruh signifikan terhadap tinggi tanaman cabai. Variabel bebas: konsentrasi pupuk; variabel terikat: tinggi tanaman; variabel kontrol: intensitas cahaya dan volume penyiraman.'),
      0,
      subIso,
      p.graded ? p.essay : 0,
    );

    if (p.graded) {
      insertEssayGrade.run(
        uid('eg'),
        'exm_tryout_01',
        'q_esai_metode_01',
        p.sid,
        p.essay,
        'Rumusan hipotesis dan identifikasi variabel eksperimen sudah sistematis.',
        'usr_prof_01',
        subIso,
      );
    }

    insertRes.run(
      uid('res'),
      'exm_tryout_01',
      p.sid,
      correctCount,
      incorrectCount,
      0,
      total,
      1,
      subIso,
    );
  }

  db.prepare(
    'INSERT INTO VIOLATION_LOGS (log_id, exam_id, user_id, event_type, event_time, description) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    uid('vio'),
    'exm_tryout_01',
    'usr_siswa_05',
    'TAB_SWITCH',
    new Date(baseStart.getTime() + 18 * 60 * 1000).toISOString(),
    'Peserta berpindah tab/jendela selama 4 detik (tercatat otomatis).',
  );

  logAudit(db, 'usr_admin_01', 'SYSTEM_INITIALIZE', {
    message: 'Inisialisasi awal database CBT KIR IPA SMAN 1 Sukabumi',
  });
  logAudit(db, 'usr_prof_01', 'EXAM_ACTIVATE', {
    exam_id: 'exm_osn_2026',
    title: 'Seleksi Internal OSN & Riset KIR IPA 2026',
  });

  createNotification(
    db,
    'usr_siswa_01',
    'Ujian Seleksi OSN Dibuka',
    'Ujian "Seleksi Internal OSN & Riset KIR IPA 2026" telah aktif. Silakan mulai sesuai jadwal.',
  );
  createNotification(
    db,
    'usr_prof_01',
    '1 Jawaban Esai Menunggu Penilaian',
    'Terdapat jawaban esai pada Tryout Dasar Olimpiade Sains Tahap 1 yang belum dinilai.',
  );
}

export function ensureDefaultReportTemplates(
  db: DatabaseSync,
  forceRestore = false,
  actorUserId = 'usr_admin_01',
) {
  const existingCount = (db.prepare('SELECT COUNT(*) as c FROM REPORT_TEMPLATES').get() as { c: number }).c;
  if (existingCount > 0 && !forceRestore) return;

  const settings = getSettingsMap(db);
  const ts = nowIso();
  const defaults: Array<{
    template_id: string;
    name: string;
    doc_category: DocumentCategory;
  }> = [
    {
      template_id: 'tpl_default_laporan',
      name: 'Template Standar Laporan Hasil Ujian',
      doc_category: 'LAPORAN_HASIL',
    },
    {
      template_id: 'tpl_default_berita_acara',
      name: 'Template Resmi Berita Acara Pelaksanaan Ujian/Lomba',
      doc_category: 'BERITA_ACARA',
    },
    {
      template_id: 'tpl_default_pengumuman',
      name: 'Template Surat Keputusan & Pengumuman Pemenang',
      doc_category: 'PENGUMUMAN_PEMENANG',
    },
  ];

  const upsert = db.prepare(
    `INSERT INTO REPORT_TEMPLATES (template_id, name, doc_category, exam_id, is_default, content_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, '', 1, ?, ?, ?, ?)
     ON CONFLICT(template_id) DO UPDATE SET
       name = excluded.name,
       content_json = excluded.content_json,
       updated_at = excluded.updated_at`,
  );

  for (const d of defaults) {
    const payload = createDefaultTemplatePayload(d.doc_category, settings);
    upsert.run(
      d.template_id,
      d.name,
      d.doc_category,
      JSON.stringify(payload),
      actorUserId,
      ts,
      ts,
    );
  }
}

export const BACKUP_TABLES = [
  'USERS',
  'EXAMS',
  'QUESTIONS',
  'EXAM_QUESTIONS',
  'EXAM_PARTICIPANTS',
  'ANSWERS',
  'VIOLATION_LOGS',
  'RESULTS',
  'BASE_CONFIGURATION',
  'SETTINGS',
  'AUDIT_LOGS',
  'EXAM_LOGS',
  'ESSAY_GRADES',
  'EXAM_CATEGORIES',
  'NOTIFICATIONS',
  'REPORT_TEMPLATES',
  'OFFICIAL_DOCUMENTS',
  'CONFIG_VERSIONS',
  'APP_ASSETS',
  'SYSTEM_METADATA',
] as const;

export function createBackupSnapshot(
  db: DatabaseSync,
  createdBy: string,
  options: {
    backupDir?: string;
    backupType?: 'MANUAL' | 'AUTO_SCHEDULED' | 'AUTO_PRE_MIGRATION' | 'AUTO_PRE_RESTORE' | 'AUTO_PRE_RESET';
  } = {},
) {
  const backupDir = options.backupDir || getDefaultDbPaths().backupDir;
  const backupType = options.backupType || 'MANUAL';
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const snapshot: Record<string, unknown[]> = {};
  const recordCounts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${t}`).all();
    snapshot[t] = rows;
    recordCounts[t] = rows.length;
  }

  const backupId = uid('bkp');
  const createdAt = nowIso();
  const fileName = `backup_${backupType.toLowerCase()}_${backupId}_${Date.now()}.json`;
  const filePath = path.join(backupDir, fileName);

  const payload = {
    backup_id: backupId,
    backup_type: backupType,
    app_version: APP_VERSION,
    db_version: DB_SCHEMA_VERSION,
    created_at: createdAt,
    created_by: createdBy,
    record_counts: recordCounts,
    snapshot,
  };

  const jsonText = JSON.stringify(payload, null, 2);
  const checksum = crypto.createHash('sha256').update(jsonText).digest('hex');
  fs.writeFileSync(filePath, jsonText, 'utf8');

  // Verify written backup file exists & parses cleanly
  const verifiedRaw = fs.readFileSync(filePath, 'utf8');
  const verifiedParsed = JSON.parse(verifiedRaw) as { backup_id?: string; snapshot?: Record<string, unknown[]> };
  if (verifiedParsed.backup_id !== backupId || !verifiedParsed.snapshot?.USERS || !verifiedParsed.snapshot?.SETTINGS) {
    throw new DatabasePersistenceError('Verifikasi file backup gagal setelah penulisan disk.', 'BACKUP_VERIFY_FAILED');
  }
  const sizeBytes = fs.statSync(filePath).size;

  db.prepare(
    'INSERT INTO BACKUP_LOGS (backup_id, file_id, created_at, created_by, status, backup_type, size_bytes, checksum_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(backupId, fileName, createdAt, createdBy, 'SUCCESS', backupType, sizeBytes, checksum);

  setMetaValue(db, 'LAST_SUCCESSFUL_BACKUP', createdAt);
  bumpSyncVersion(db, 'backups');

  // Prune old AUTO_SCHEDULED backups beyond retention of 20 (never deletes manual or pre-action backups)
  if (backupType === 'AUTO_SCHEDULED') {
    const autoBackups = db
      .prepare(
        "SELECT backup_id, file_id FROM BACKUP_LOGS WHERE backup_type = 'AUTO_SCHEDULED' ORDER BY created_at DESC",
      )
      .all() as Array<{ backup_id: string; file_id: string }>;
    for (const old of autoBackups.slice(20)) {
      const p = path.resolve(backupDir, path.basename(old.file_id));
      if (p.startsWith(path.resolve(backupDir) + path.sep) && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          // Ignore file unlink failure
        }
      }
      db.prepare('DELETE FROM BACKUP_LOGS WHERE backup_id = ?').run(old.backup_id);
    }
  }

  logAudit(db, createdBy, 'DATABASE_BACKUP', {
    backup_id: backupId,
    backup_type: backupType,
    file: fileName,
    size_bytes: sizeBytes,
  });

  return {
    backup_id: backupId,
    file_id: fileName,
    backup_type: backupType,
    size_bytes: sizeBytes,
    checksum_sha256: checksum,
    record_counts: recordCounts,
    snapshot,
  };
}

export function listBackupsWithVerification(
  db: DatabaseSync,
  backupDir: string = getDefaultDbPaths().backupDir,
): BackupLogRecord[] {
  const rows = db
    .prepare(
      `SELECT b.*, COALESCE(u.nama, b.created_by) as creator_name
       FROM BACKUP_LOGS b
       LEFT JOIN USERS u ON u.user_id = b.created_by
       ORDER BY b.created_at DESC`,
    )
    .all() as unknown as BackupLogRecord[];

  return rows.map((row) => {
    const safeName = path.basename(String(row.file_id || ''));
    const fullPath = path.resolve(backupDir, safeName);
    const exists =
      Boolean(safeName) &&
      fullPath.startsWith(path.resolve(backupDir) + path.sep) &&
      fs.existsSync(fullPath);
    const actualSize = exists ? fs.statSync(fullPath).size : 0;
    return {
      ...row,
      file_exists: exists,
      size_bytes: row.size_bytes || actualSize,
    };
  });
}

export function restoreBackupSnapshot(
  db: DatabaseSync,
  snapshot: Record<string, Record<string, unknown>[]>,
  restoredBy: string,
  options: { backupDir?: string; skipPreBackup?: boolean } = {},
) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Format snapshot backup tidak valid.');
  }
  if (!Array.isArray(snapshot.USERS) || snapshot.USERS.length === 0) {
    throw new Error('Snapshot backup ditolak karena tidak memiliki data USERS yang valid.');
  }
  if (!Array.isArray(snapshot.SETTINGS) || snapshot.SETTINGS.length === 0) {
    throw new Error('Snapshot backup ditolak karena tidak memiliki data SETTINGS yang valid.');
  }

  if (!options.skipPreBackup) {
    createBackupSnapshot(db, restoredBy, {
      backupDir: options.backupDir,
      backupType: 'AUTO_PRE_RESTORE',
    });
  }

  const allowedTables = BACKUP_TABLES.filter((t) => t !== 'SYSTEM_METADATA');
  const existingBackupLogs = db.prepare('SELECT * FROM BACKUP_LOGS').all();

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const table of allowedTables) {
      const rows = snapshot[table];
      if (!Array.isArray(rows)) continue;
      db.prepare(`DELETE FROM ${table}`).run();
      if (rows.length === 0) continue;

      const validTableCols = new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
      );
      const cols = Object.keys(rows[0]).filter((c) => validTableCols.has(c));
      if (cols.length === 0) continue;

      const placeholders = cols.map(() => '?').join(', ');
      const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
      for (const row of rows) {
        stmt.run(...cols.map((c) => (row[c] ?? null) as string | number | null));
      }
    }

    // Ensure BASE_CONFIGURATION exists even if restoring a pre-v3 snapshot that only has SETTINGS
    const baseCfgCount = (db.prepare('SELECT COUNT(*) as c FROM BASE_CONFIGURATION').get() as { c: number }).c;
    if (baseCfgCount === 0) {
      const sRows = db
        .prepare('SELECT setting_key, setting_value FROM SETTINGS')
        .all() as Array<{ setting_key: string; setting_value: string }>;
      const insBase = db.prepare(
        "INSERT OR IGNORE INTO BASE_CONFIGURATION (config_key, config_value, source, config_version, updated_by, updated_at) VALUES (?, ?, 'RESTORE', ?, ?, ?)",
      );
      const rTs = nowIso();
      for (const s of sRows) {
        insBase.run(s.setting_key, s.setting_value, 1, restoredBy, rTs);
      }
    }

    // Ensure metadata markers stay valid and never reset INSTALLATION_ID unintentionally
    setMetaValue(db, 'DATABASE_INITIALIZED', 'true');
    setMetaValue(db, 'BASE_CONFIG_SOURCE', 'RESTORE');
    setMetaValue(db, 'BASE_CONFIG_UPDATED_AT', nowIso());
    setMetaValue(db, 'BASE_CONFIG_UPDATED_BY', restoredBy);
    if (Array.isArray(snapshot.SYSTEM_METADATA)) {
      const metaCfg = snapshot.SYSTEM_METADATA.find((r) => r.meta_key === 'CONFIG_VERSION');
      if (metaCfg?.meta_value) {
        setMetaValue(db, 'CONFIG_VERSION', String(metaCfg.meta_value));
      }
    }

    // Re-ensure backup logs remain consistent if missing
    if (existingBackupLogs.length > 0) {
      const existingCount = (db.prepare('SELECT COUNT(*) as c FROM BACKUP_LOGS').get() as { c: number }).c;
      if (existingCount === 0) {
        const stmt = db.prepare(
          'INSERT OR IGNORE INTO BACKUP_LOGS (backup_id, file_id, created_at, created_by, status, backup_type, size_bytes, checksum_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        );
        for (const b of existingBackupLogs as Array<Record<string, unknown>>) {
          stmt.run(
            String(b.backup_id),
            String(b.file_id),
            String(b.created_at),
            String(b.created_by),
            String(b.status || 'SUCCESS'),
            String(b.backup_type || 'MANUAL'),
            Number(b.size_bytes || 0),
            String(b.checksum_sha256 || ''),
          );
        }
      }
    }

    for (const domain of Object.keys(SYNC_META_KEY_MAP) as SyncDomain[]) {
      bumpSyncVersion(db, domain);
    }

    // Verify restored data before commit
    const restoredUsersCount = (db.prepare('SELECT COUNT(*) as c FROM USERS').get() as { c: number }).c;
    const restoredBaseCount = (db.prepare('SELECT COUNT(*) as c FROM BASE_CONFIGURATION').get() as { c: number }).c;
    const restoredSettingsCount = (db.prepare('SELECT COUNT(*) as c FROM SETTINGS').get() as { c: number }).c;
    if (restoredUsersCount === 0 || restoredBaseCount === 0 || restoredSettingsCount === 0) {
      throw new DatabasePersistenceError('Verifikasi pemulihan gagal: USERS/BASE_CONFIGURATION kosong.', 'RESTORE_VERIFY_FAILED');
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    recordServerEvent(db, {
      level: 'ERROR',
      source: 'restoreBackupSnapshot',
      event_type: 'RESTORE_FAILED',
      message: err instanceof Error ? err.message : 'Pemulihan database gagal.',
    });
    throw err;
  }

  logAudit(db, restoredBy, 'DATABASE_RESTORE', {
    restored_tables: Object.keys(snapshot).filter((k) => allowedTables.includes(k as (typeof allowedTables)[number])),
  });
}

export function executeFactoryReset(
  db: DatabaseSync,
  params: {
    actorUserId: string;
    confirmationPhrase: string;
    backupDir?: string;
  },
) {
  if (params.confirmationPhrase !== FACTORY_RESET_CONFIRMATION_PHRASE) {
    throw new Error(`Frasa konfirmasi harus persis: "${FACTORY_RESET_CONFIRMATION_PHRASE}"`);
  }

  // Mandatory verified backup before factory reset
  const preResetBackup = createBackupSnapshot(db, params.actorUserId, {
    backupDir: params.backupDir,
    backupType: 'AUTO_PRE_RESET',
  });

  const tablesToReset = [
    'ANSWERS',
    'ESSAY_GRADES',
    'RESULTS',
    'VIOLATION_LOGS',
    'EXAM_LOGS',
    'EXAM_PARTICIPANTS',
    'EXAM_QUESTIONS',
    'EXAMS',
    'QUESTIONS',
    'EXAM_CATEGORIES',
    'NOTIFICATIONS',
    'OFFICIAL_DOCUMENTS',
    'REPORT_TEMPLATES',
    'CONFIG_VERSIONS',
    'BASE_CONFIGURATION',
    'SETTINGS',
    'SESSIONS',
    'LOGIN_ATTEMPTS',
    'USERS',
  ];

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const table of tablesToReset) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    seedInitialData(db);
    ensureDefaultReportTemplates(db, true, params.actorUserId);
    setMetaValue(db, 'DATABASE_INITIALIZED', 'true');
    setMetaValue(db, 'CONFIG_VERSION', '1');
    setMetaValue(db, 'BASE_CONFIG_SOURCE', 'INITIAL_DEFAULT');
    setMetaValue(db, 'BASE_CONFIG_UPDATED_AT', nowIso());
    setMetaValue(db, 'BASE_CONFIG_UPDATED_BY', params.actorUserId);
    for (const domain of Object.keys(SYNC_META_KEY_MAP) as SyncDomain[]) {
      bumpSyncVersion(db, domain);
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    recordServerEvent(db, {
      level: 'CRITICAL',
      source: 'executeFactoryReset',
      event_type: 'FACTORY_RESET_FAILED',
      message: err instanceof Error ? err.message : 'Factory reset gagal.',
    });
    throw err;
  }

  logAudit(db, params.actorUserId, 'EXPLICIT_FACTORY_RESET', {
    pre_reset_backup_id: preResetBackup.backup_id,
    pre_reset_backup_file: preResetBackup.file_id,
  });

  recordServerEvent(db, {
    level: 'WARN',
    source: 'executeFactoryReset',
    event_type: 'EXPLICIT_FACTORY_RESET',
    message: 'Super Admin menjalankan reset pabrik eksplisit setelah backup otomatis.',
    details: { actorUserId: params.actorUserId, preResetBackupFile: preResetBackup.file_id },
  });

  return {
    ok: true,
    pre_reset_backup_id: preResetBackup.backup_id,
    pre_reset_backup_file: preResetBackup.file_id,
  };
}

export function getSystemMonitoringStatus(
  db: DatabaseSync,
  options: {
    dbPath?: string;
    backupDir?: string;
    autoBackupIntervalMinutes?: number;
    gasFilesCount?: number;
  } = {},
): SystemMonitoringStatus {
  const dbPath = options.dbPath || getDefaultDbPaths().dbPath;
  const backupDir = options.backupDir || getDefaultDbPaths().backupDir;

  let dbStatus: 'CONNECTED' | 'ERROR' = 'CONNECTED';
  let dbError: string | undefined = lastDbErrorMessage || undefined;
  try {
    db.prepare('SELECT 1').get();
  } catch (err) {
    dbStatus = 'ERROR';
    dbError = err instanceof Error ? err.message : String(err);
  }

  const countTable = (table: string) =>
    (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;

  const tableCounts: Record<string, number> = {
    USERS: countTable('USERS'),
    QUESTIONS: countTable('QUESTIONS'),
    EXAMS: countTable('EXAMS'),
    EXAM_PARTICIPANTS: countTable('EXAM_PARTICIPANTS'),
    RESULTS: countTable('RESULTS'),
    REPORT_TEMPLATES: countTable('REPORT_TEMPLATES'),
    OFFICIAL_DOCUMENTS: countTable('OFFICIAL_DOCUMENTS'),
    BASE_CONFIGURATION: countTable('BASE_CONFIGURATION'),
    CONFIG_VERSIONS: countTable('CONFIG_VERSIONS'),
    APP_ASSETS: countTable('APP_ASSETS'),
    BACKUP_LOGS: countTable('BACKUP_LOGS'),
  };

  const backups = listBackupsWithVerification(db, backupDir);
  const recentEvents = getServerEvents(db, 40);
  const configVersions = getConfigVersionHistory(db, 40);

  return {
    server_status: 'ONLINE',
    db_status: dbStatus,
    db_error: dbError,
    db_path: dbPath,
    installation_id: getMetaValue(db, 'INSTALLATION_ID', ''),
    app_version: getMetaValue(db, 'APP_VERSION', APP_VERSION),
    db_version: getMetaValue(db, 'DATABASE_VERSION', DB_SCHEMA_VERSION),
    last_migration_version: getMetaValue(db, 'LAST_MIGRATION_VERSION', ''),
    database_initialized: getMetaValue(db, 'DATABASE_INITIALIZED', '') === 'true',
    config_version: getConfigVersion(db),
    base_config_source: (getMetaValue(db, 'BASE_CONFIG_SOURCE', 'INITIAL_DEFAULT') as BaseConfigSource),
    base_config_updated_at: getMetaValue(db, 'BASE_CONFIG_UPDATED_AT', ''),
    base_config_updated_by: getMetaValue(db, 'BASE_CONFIG_UPDATED_BY', ''),
    last_save_at: getMetaValue(db, 'LAST_SAVE_AT', ''),
    last_backup_at: getMetaValue(db, 'LAST_SUCCESSFUL_BACKUP', ''),
    last_sync_check_at: getMetaValue(db, 'LAST_SYNC_CHECK_AT', ''),
    auto_backup_interval_minutes: options.autoBackupIntervalMinutes ?? 360,
    sync_versions: getSyncVersions(db),
    gas_bundle_status: {
      ready: true,
      version: APP_VERSION,
      files_count: options.gasFilesCount ?? 19,
    },
    table_counts: tableCounts,
    backups_count: backups.filter((b) => b.file_exists).length,
    recent_errors: recentEvents,
    config_versions: configVersions,
  };
}

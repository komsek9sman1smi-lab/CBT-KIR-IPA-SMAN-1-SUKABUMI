import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from './auth.ts';
import {
  ConflictError,
  DatabasePersistenceError,
  FACTORY_RESET_CONFIRMATION_PHRASE,
  bumpSyncVersion,
  createBackupSnapshot,
  createNotification,
  ensureDefaultReportTemplates,
  executeFactoryReset,
  getConfigVersion,
  getDb,
  getDefaultDbPaths,
  getMetaValue,
  getSettingsMap,
  getSyncState,
  getSystemMonitoringStatus,
  listBackupsWithVerification,
  logAudit,
  logExamEvent,
  nowIso,
  recordServerEvent,
  restoreBackupSnapshot,
  rollbackConfigVersion,
  saveUploadedLogoFile,
  uid,
  updateSettingsWithVersioning,
} from './db.ts';
import { GAS_PROJECT_FILES } from '../gas/gasBundle.ts';
import {
  computeExamGradeSummary,
  computeItemAnalysis,
  computeLeaderboardRanks,
  gradeSingleQuestion,
  safeJsonParse,
  sanitizeRichHtml,
} from '../shared/grading.ts';
import {
  buildQuestionDedupeKey,
  normalizeQuestionTypeAlias,
  isValidImageReference,
} from '../shared/spreadsheet.ts';
import {
  buildDefaultWinnerRows,
  computeDocumentVariables,
  sanitizeLogoUrl,
} from '../shared/documentTemplates.ts';
import type {
  DocumentCategory,
  DocumentContentPayload,
  ExamRecord,
  ExamSettings,
  ImportErrorDetail,
  QuestionOptionsPayload,
  QuestionRecord,
  UserRecord,
  UserRole,
} from '../shared/types.ts';

interface AuthenticatedRequest extends Request {
  authUser?: UserRecord;
  authSessionId?: string;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function getAuthTokenFromRequest(req: Request): { token: string | null; viaCookie: boolean } {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return { token: t, viaCookie: false };
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.cbt_session) {
    return { token: cookies.cbt_session, viaCookie: true };
  }
  return { token: null, viaCookie: false };
}

function resolveSessionFromRequest(req: Request): {
  user: UserRecord;
  session_id: string;
} | null {
  const { token: rawToken } = getAuthTokenFromRequest(req);
  if (!rawToken) return null;

  const db = getDb();
  const tokenHash = hashSessionToken(rawToken);
  const session = db
    .prepare(
      `SELECT s.session_id, s.user_id, s.expires_at, s.status as session_status,
              u.user_id, u.username, u.nama, u.kelas, u.role, u.status, u.created_at
       FROM SESSIONS s
       JOIN USERS u ON u.user_id = s.user_id
       WHERE s.token_hash = ? AND s.status = 'ACTIVE'`,
    )
    .get(tokenHash) as (UserRecord & { session_id: string; expires_at: string }) | undefined;

  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.prepare("UPDATE SESSIONS SET status = 'EXPIRED' WHERE session_id = ?").run(session.session_id);
    return null;
  }
  if (session.status !== 'ACTIVE') return null;

  return {
    session_id: session.session_id,
    user: {
      user_id: session.user_id,
      username: session.username,
      nama: session.nama,
      kelas: session.kelas,
      role: session.role,
      status: session.status,
      created_at: session.created_at,
    },
  };
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const { token: rawToken, viaCookie } = getAuthTokenFromRequest(req);
  if (!rawToken) {
    res.status(401).json({ error: 'Sesi autentikasi tidak ditemukan. Silakan login kembali.' });
    return;
  }
  if (viaCookie && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      res.status(403).json({ error: 'Permintaan tidak valid (header verifikasi hilang).' });
      return;
    }
  }
  const db = getDb();
  const tokenHash = hashSessionToken(rawToken);
  const session = db
    .prepare(
      `SELECT s.session_id, s.user_id, s.expires_at, s.status as session_status,
              u.user_id, u.username, u.nama, u.kelas, u.role, u.status, u.created_at
       FROM SESSIONS s
       JOIN USERS u ON u.user_id = s.user_id
       WHERE s.token_hash = ? AND s.status = 'ACTIVE'`,
    )
    .get(tokenHash) as (UserRecord & { session_id: string; expires_at: string }) | undefined;

  if (!session) {
    res.status(401).json({ error: 'Token sesi tidak valid atau sudah berakhir.' });
    return;
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.prepare("UPDATE SESSIONS SET status = 'EXPIRED' WHERE session_id = ?").run(session.session_id);
    res.status(401).json({ error: 'Sesi Anda telah kedaluwarsa. Silakan login ulang.' });
    return;
  }
  if (session.status !== 'ACTIVE') {
    res.status(403).json({ error: 'Akun Anda sedang dinonaktifkan atau terkunci sementara.' });
    return;
  }

  req.authUser = {
    user_id: session.user_id,
    username: session.username,
    nama: session.nama,
    kelas: session.kelas,
    role: session.role,
    status: session.status,
    created_at: session.created_at,
  };
  req.authSessionId = session.session_id;
  next();
}

function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser || !roles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'Anda tidak memiliki hak akses untuk operasi ini.' });
      return;
    }
    next();
  };
}

function canProfessorAccessAll(db: DatabaseSync): boolean {
  const settings = getSettingsMap(db);
  return settings.professor_global_access === 'true';
}

function finalizeParticipantSubmission(
  db: DatabaseSync,
  exam: ExamRecord,
  userId: string,
  reason: 'MANUAL_SUBMIT' | 'AUTO_TIME_UP' | 'ADMIN_FORCE_STOP',
) {
  const participant = db
    .prepare('SELECT * FROM EXAM_PARTICIPANTS WHERE exam_id = ? AND user_id = ?')
    .get(exam.exam_id, userId) as
    | { id: string; status: string; started_at: string; submitted_at: string }
    | undefined;

  if (!participant) {
    throw new Error('Peserta tidak terdaftar pada ujian ini.');
  }

  if (participant.status === 'TERKUMPUL' || participant.status === 'DIHENTIKAN') {
    return db
      .prepare('SELECT * FROM RESULTS WHERE exam_id = ? AND user_id = ?')
      .get(exam.exam_id, userId);
  }

  const questions = db
    .prepare(
      `SELECT q.*, eq.score as exam_score
       FROM EXAM_QUESTIONS eq
       JOIN QUESTIONS q ON q.question_id = eq.question_id
       WHERE eq.exam_id = ?
       ORDER BY eq.question_order ASC`,
    )
    .all(exam.exam_id) as unknown as Array<QuestionRecord & { exam_score: number }>;

  const answerRows = db
    .prepare('SELECT * FROM ANSWERS WHERE exam_id = ? AND user_id = ?')
    .all(exam.exam_id, userId) as Array<{
    answer_id: string;
    question_id: string;
    answer_json: string;
  }>;

  const essayRows = db
    .prepare('SELECT * FROM ESSAY_GRADES WHERE exam_id = ? AND user_id = ?')
    .all(exam.exam_id, userId) as Array<{ question_id: string; score: number }>;

  const answersByQ: Record<string, { answer_json: string }> = {};
  for (const r of answerRows) answersByQ[r.question_id] = { answer_json: r.answer_json };

  const essayByQ: Record<string, { score: number }> = {};
  for (const e of essayRows) essayByQ[e.question_id] = { score: e.score };

  const settings = safeJsonParse<ExamSettings>(exam.settings_json, {
    passing_grade: 75,
  } as ExamSettings);

  const summary = computeExamGradeSummary(questions, answersByQ, essayByQ, settings.passing_grade ?? 75);
  const submittedAt = nowIso();
  const nextStatus = reason === 'ADMIN_FORCE_STOP' ? 'DIHENTIKAN' : 'TERKUMPUL';

  db.exec('BEGIN TRANSACTION;');
  try {
    const updAns = db.prepare(
      'UPDATE ANSWERS SET score = ? WHERE exam_id = ? AND user_id = ? AND question_id = ?',
    );
    for (const q of questions) {
      const outcome = summary.question_scores[q.question_id];
      if (outcome) {
        updAns.run(outcome.score, exam.exam_id, userId, q.question_id);
      }
    }

    db.prepare(
      'UPDATE EXAM_PARTICIPANTS SET status = ?, submitted_at = ?, score = ? WHERE exam_id = ? AND user_id = ?',
    ).run(nextStatus, submittedAt, summary.total_score, exam.exam_id, userId);

    const existingRes = db
      .prepare('SELECT result_id, published FROM RESULTS WHERE exam_id = ? AND user_id = ?')
      .get(exam.exam_id, userId) as { result_id: string; published: number } | undefined;

    if (existingRes) {
      db.prepare(
        `UPDATE RESULTS
         SET correct_count = ?, incorrect_count = ?, unanswered_count = ?, total_score = ?, graded_at = ?
         WHERE result_id = ?`,
      ).run(
        summary.correct_count,
        summary.incorrect_count,
        summary.unanswered_count,
        summary.total_score,
        submittedAt,
        existingRes.result_id,
      );
    } else {
      db.prepare(
        `INSERT INTO RESULTS (result_id, exam_id, user_id, correct_count, incorrect_count, unanswered_count, total_score, published, graded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(
        uid('res'),
        exam.exam_id,
        userId,
        summary.correct_count,
        summary.incorrect_count,
        summary.unanswered_count,
        summary.total_score,
        submittedAt,
      );
    }

    logExamEvent(db, exam.exam_id, userId, reason, `Total skor objektif: ${summary.total_score}`);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return db
    .prepare('SELECT * FROM RESULTS WHERE exam_id = ? AND user_id = ?')
    .get(exam.exam_id, userId);
}

function recalculateExamResultForStudent(db: DatabaseSync, examId: string, userId: string) {
  const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(examId) as ExamRecord | undefined;
  if (!exam) return;

  const questions = db
    .prepare(
      `SELECT q.*, eq.score as exam_score
       FROM EXAM_QUESTIONS eq
       JOIN QUESTIONS q ON q.question_id = eq.question_id
       WHERE eq.exam_id = ?`,
    )
    .all(examId) as unknown as Array<QuestionRecord & { exam_score: number }>;

  const answerRows = db
    .prepare('SELECT question_id, answer_json FROM ANSWERS WHERE exam_id = ? AND user_id = ?')
    .all(examId, userId) as Array<{ question_id: string; answer_json: string }>;

  const essayRows = db
    .prepare('SELECT question_id, score FROM ESSAY_GRADES WHERE exam_id = ? AND user_id = ?')
    .all(examId, userId) as Array<{ question_id: string; score: number }>;

  const answersByQ: Record<string, { answer_json: string }> = {};
  for (const r of answerRows) answersByQ[r.question_id] = { answer_json: r.answer_json };
  const essayByQ: Record<string, { score: number }> = {};
  for (const e of essayRows) essayByQ[e.question_id] = { score: e.score };

  const settings = safeJsonParse<ExamSettings>(exam.settings_json, { passing_grade: 75 } as ExamSettings);
  const summary = computeExamGradeSummary(questions, answersByQ, essayByQ, settings.passing_grade ?? 75);

  db.prepare(
    'UPDATE EXAM_PARTICIPANTS SET score = ? WHERE exam_id = ? AND user_id = ?',
  ).run(summary.total_score, examId, userId);

  db.prepare(
    `UPDATE RESULTS
     SET correct_count = ?, incorrect_count = ?, unanswered_count = ?, total_score = ?, graded_at = ?
     WHERE exam_id = ? AND user_id = ?`,
  ).run(
    summary.correct_count,
    summary.incorrect_count,
    summary.unanswered_count,
    summary.total_score,
    nowIso(),
    examId,
    userId,
  );
}

export function createApiRouter() {
  const router = express.Router();

  // 1. Public App Config (Identity & Announcement) + Persistent Assets + Sync State
  router.get('/assets/:fileName', (req, res) => {
    const safeName = path.basename(String(req.params.fileName || ''));
    if (!safeName) {
      res.status(404).end();
      return;
    }
    const uploadsDir = getDefaultDbPaths().uploadsDir;
    const fullPath = path.resolve(uploadsDir, safeName);
    if (!fullPath.startsWith(path.resolve(uploadsDir) + path.sep) || !fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Berkas aset tidak ditemukan di server.' });
      return;
    }
    const ext = path.extname(safeName).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(fullPath);
  });

  router.get('/sync/version', (req, res) => {
    const db = getDb();
    const state = getSyncState(db);
    const resolved = resolveSessionFromRequest(req);
    if (!resolved) {
      res.json({
        server_time: state.server_time,
        db_ok: state.db_ok,
        installation_id: state.installation_id,
        app_version: state.app_version,
        db_version: state.db_version,
        config_version: state.config_version,
        last_save_at: state.last_save_at,
        sync_versions: {
          config: state.sync_versions.config,
        },
      });
      return;
    }
    res.json(state);
  });

  router.get('/public/config', (_req, res) => {
    const db = getDb();
    const settings = getSettingsMap(db, { strict: true });
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      app_name: settings.app_name,
      org_name: settings.org_name,
      school_name: settings.school_name,
      academic_year: settings.academic_year,
      management_period: settings.management_period,
      logo_url: settings.logo_url,
      primary_color: settings.primary_color,
      accent_color: settings.accent_color,
      contact_info: settings.contact_info,
      announcement: settings.announcement,
      report_footer: settings.report_footer,
      config_version: getConfigVersion(db),
      installation_id: getMetaValue(db, 'INSTALLATION_ID', ''),
      last_save_at: getMetaValue(db, 'LAST_SAVE_AT', ''),
    });
  });

  // 2. Authentication + Rate Limiting / Temporary Lockout
  router.post('/auth/login', (req, res) => {
    const db = getDb();
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!username || !password) {
      res.status(400).json({ error: 'Username dan password wajib diisi.' });
      return;
    }

    const settings = getSettingsMap(db);
    const maxAttempts = Math.max(3, Number(settings.max_login_attempts || 5));
    const lockoutMinutes = Math.max(1, Number(settings.lockout_minutes || 5));
    const attemptKey = `user:${username}`;

    const attempt = db
      .prepare('SELECT * FROM LOGIN_ATTEMPTS WHERE attempt_key = ?')
      .get(attemptKey) as
      | { attempt_key: string; failed_count: number; locked_until: string }
      | undefined;

    if (attempt && attempt.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
      const minsLeft = Math.ceil((new Date(attempt.locked_until).getTime() - Date.now()) / 60000);
      res.status(429).json({
        error: `Terlalu banyak percobaan login gagal. Akun diblokir sementara selama ${minsLeft} menit.`,
      });
      return;
    }

    const user = db
      .prepare('SELECT * FROM USERS WHERE lower(username) = ?')
      .get(username) as
      | (UserRecord & { password_hash: string; password_salt: string })
      | undefined;

    if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
      const nextCount = (attempt?.failed_count ?? 0) + 1;
      const lockedUntil =
        nextCount >= maxAttempts
          ? new Date(Date.now() + lockoutMinutes * 60 * 1000).toISOString()
          : '';
      db.prepare(
        `INSERT INTO LOGIN_ATTEMPTS (attempt_key, failed_count, locked_until, last_attempt_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(attempt_key) DO UPDATE SET
           failed_count = excluded.failed_count,
           locked_until = excluded.locked_until,
           last_attempt_at = excluded.last_attempt_at`,
      ).run(attemptKey, nextCount, lockedUntil, nowIso());

      if (lockedUntil) {
        res.status(429).json({
          error: `Login gagal ${maxAttempts} kali. Akun dikunci sementara selama ${lockoutMinutes} menit.`,
        });
      } else {
        res.status(401).json({
          error: `Username atau password tidak sesuai. Sisa percobaan: ${maxAttempts - nextCount}.`,
        });
      }
      return;
    }

    if (user.status !== 'ACTIVE') {
      res.status(403).json({ error: 'Akun Anda berstatus nonaktif. Hubungi Super Admin.' });
      return;
    }

    // Clear failed attempts
    db.prepare('DELETE FROM LOGIN_ATTEMPTS WHERE attempt_key = ?').run(attemptKey);

    const { rawToken, tokenHash } = generateSessionToken();
    const sessionHours = Math.max(1, Number(settings.session_hours || 8));
    const sessionId = uid('ses');
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000).toISOString();

    db.prepare(
      'INSERT INTO SESSIONS (session_id, user_id, exam_id, token_hash, created_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(sessionId, user.user_id, '', tokenHash, createdAt, expiresAt, 'ACTIVE');

    logAudit(db, user.user_id, 'LOGIN', { username: user.username, role: user.role });

    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const cookieAttrs = isHttps
      ? `Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${sessionHours * 3600}`
      : `Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionHours * 3600}`;
    res.setHeader('Set-Cookie', `cbt_session=${encodeURIComponent(rawToken)}; ${cookieAttrs}`);

    res.json({
      token: rawToken,
      session_id: sessionId,
      expires_at: expiresAt,
      user: {
        user_id: user.user_id,
        username: user.username,
        nama: user.nama,
        kelas: user.kelas,
        role: user.role,
        status: user.status,
        created_at: user.created_at,
      },
    });
  });

  router.post('/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    db.prepare("UPDATE SESSIONS SET status = 'REVOKED' WHERE session_id = ?").run(req.authSessionId!);
    logAudit(db, req.authUser!.user_id, 'LOGOUT', { session_id: req.authSessionId });
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const clearAttrs = isHttps
      ? 'Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0'
      : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
    res.setHeader('Set-Cookie', `cbt_session=; ${clearAttrs}`);
    res.json({ ok: true });
  });

  router.get('/auth/session', (req, res) => {
    const resolved = resolveSessionFromRequest(req);
    if (!resolved) {
      res.json({ authenticated: false, user: null });
      return;
    }
    res.json({ authenticated: true, user: resolved.user, session_id: resolved.session_id });
  });

  router.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.authUser, session_id: req.authSessionId });
  });

  router.post('/auth/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const currentPassword = String(req.body?.current_password ?? '');
    const newPassword = String(req.body?.new_password ?? '');
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
      return;
    }

    const user = db
      .prepare('SELECT * FROM USERS WHERE user_id = ?')
      .get(req.authUser!.user_id) as { password_hash: string; password_salt: string } | undefined;

    if (!user || !verifyPassword(currentPassword, user.password_hash, user.password_salt)) {
      res.status(400).json({ error: 'Password saat ini tidak valid.' });
      return;
    }

    const { hash, salt } = hashPassword(newPassword);
    db.prepare('UPDATE USERS SET password_hash = ?, password_salt = ? WHERE user_id = ?').run(
      hash,
      salt,
      req.authUser!.user_id,
    );
    logAudit(db, req.authUser!.user_id, 'CHANGE_PASSWORD', { self: true });
    res.json({ ok: true });
  });

  // 3. Notifications
  router.get('/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const items = db
      .prepare(
        'SELECT * FROM NOTIFICATIONS WHERE user_id = ? OR user_id = ? ORDER BY created_at DESC LIMIT 25',
      )
      .all(req.authUser!.user_id, 'ALL');
    res.json({ notifications: items });
  });

  router.post('/notifications/read', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    db.prepare('UPDATE NOTIFICATIONS SET is_read = 1 WHERE user_id = ?').run(req.authUser!.user_id);
    res.json({ ok: true });
  });

  // 4. Dashboard Overview Statistics
  router.get('/dashboard/stats', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const user = req.authUser!;

    if (user.role === 'SUPER_ADMIN') {
      const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM USERS').get() as { c: number }).c;
      const totalStudents = (db.prepare("SELECT COUNT(*) as c FROM USERS WHERE role = 'SISWA'").get() as { c: number }).c;
      const totalProfessors = (db.prepare("SELECT COUNT(*) as c FROM USERS WHERE role = 'PROFESSOR'").get() as { c: number }).c;
      const totalExams = (db.prepare('SELECT COUNT(*) as c FROM EXAMS').get() as { c: number }).c;
      const activeExams = (db.prepare("SELECT COUNT(*) as c FROM EXAMS WHERE status = 'ACTIVE'").get() as { c: number }).c;
      const completedExams = (db.prepare("SELECT COUNT(*) as c FROM EXAMS WHERE status = 'COMPLETED'").get() as { c: number }).c;
      const totalQuestions = (db.prepare('SELECT COUNT(*) as c FROM QUESTIONS').get() as { c: number }).c;
      const totalAttempts = (db.prepare("SELECT COUNT(*) as c FROM EXAM_PARTICIPANTS WHERE status IN ('MENGERJAKAN', 'TERKUMPUL', 'DIHENTIKAN')").get() as { c: number }).c;
      const recentAudit = db
        .prepare(
          `SELECT a.*, u.nama, u.role FROM AUDIT_LOGS a
           LEFT JOIN USERS u ON u.user_id = a.user_id
           ORDER BY a.timestamp DESC LIMIT 8`,
        )
        .all();

      res.json({
        role: 'SUPER_ADMIN',
        stats: {
          total_users: totalUsers,
          total_students: totalStudents,
          total_professors: totalProfessors,
          total_exams: totalExams,
          total_questions: totalQuestions,
          active_exams: activeExams,
          completed_exams: completedExams,
          total_attempts: totalAttempts,
        },
        recent_audit: recentAudit,
      });
      return;
    }

    if (user.role === 'PROFESSOR') {
      const globalAccess = canProfessorAccessAll(db);
      const qFilter = globalAccess ? '' : 'WHERE created_by = ?';
      const qParams = globalAccess ? [] : [user.user_id];

      const totalQuestions = (
        db.prepare(`SELECT COUNT(*) as c FROM QUESTIONS ${qFilter}`).get(...qParams) as { c: number }
      ).c;
      const totalExams = (
        db.prepare(`SELECT COUNT(*) as c FROM EXAMS ${qFilter}`).get(...qParams) as { c: number }
      ).c;
      const activeExams = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM EXAMS ${globalAccess ? "WHERE status = 'ACTIVE'" : "WHERE created_by = ? AND status = 'ACTIVE'"}`,
          )
          .get(...qParams) as { c: number }
      ).c;
      const scheduledExams = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM EXAMS ${globalAccess ? "WHERE status = 'SCHEDULED'" : "WHERE created_by = ? AND status = 'SCHEDULED'"}`,
          )
          .get(...qParams) as { c: number }
      ).c;
      const completedExams = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM EXAMS ${globalAccess ? "WHERE status = 'COMPLETED'" : "WHERE created_by = ? AND status = 'COMPLETED'"}`,
          )
          .get(...qParams) as { c: number }
      ).c;

      const totalParticipants = (
        db.prepare('SELECT COUNT(*) as c FROM EXAM_PARTICIPANTS').get() as { c: number }
      ).c;
      const doneParticipants = (
        db
          .prepare("SELECT COUNT(*) as c FROM EXAM_PARTICIPANTS WHERE status IN ('TERKUMPUL', 'DIHENTIKAN')")
          .get() as { c: number }
      ).c;
      const pendingParticipants = (
        db
          .prepare("SELECT COUNT(*) as c FROM EXAM_PARTICIPANTS WHERE status IN ('BELUM_MULAI', 'MENGERJAKAN', 'GANGGUAN')")
          .get() as { c: number }
      ).c;

      const pendingEssays = (
        db
          .prepare(
            `SELECT COUNT(*) as c
             FROM ANSWERS a
             JOIN QUESTIONS q ON q.question_id = a.question_id
             JOIN EXAM_PARTICIPANTS ep ON ep.exam_id = a.exam_id AND ep.user_id = a.user_id
             LEFT JOIN ESSAY_GRADES eg ON eg.exam_id = a.exam_id AND eg.question_id = a.question_id AND eg.user_id = a.user_id
             WHERE q.question_type = 'ESAI' AND ep.status IN ('TERKUMPUL', 'DIHENTIKAN') AND eg.grade_id IS NULL`,
          )
          .get() as { c: number }
      ).c;

      res.json({
        role: 'PROFESSOR',
        stats: {
          total_questions: totalQuestions,
          total_exams: totalExams,
          active_exams: activeExams,
          scheduled_exams: scheduledExams,
          completed_exams: completedExams,
          total_participants: totalParticipants,
          done_participants: doneParticipants,
          pending_participants: pendingParticipants,
          pending_essays: pendingEssays,
        },
      });
      return;
    }

    // SISWA Dashboard
    const exams = db
      .prepare(
        `SELECT e.*, ep.status as participant_status, ep.started_at, ep.submitted_at, ep.score as participant_score,
                r.total_score as published_score, r.published, r.correct_count, r.incorrect_count, r.unanswered_count
         FROM EXAMS e
         JOIN EXAM_PARTICIPANTS ep ON ep.exam_id = e.exam_id AND ep.user_id = ?
         LEFT JOIN RESULTS r ON r.exam_id = e.exam_id AND r.user_id = ?
         WHERE e.status IN ('SCHEDULED', 'ACTIVE', 'COMPLETED')
         ORDER BY e.start_time DESC`,
      )
      .all(user.user_id, user.user_id) as Array<Record<string, unknown>>;

    const sanitized = exams.map((row) => {
      const published = Number(row.published ?? 0) === 1;
      return {
        ...row,
        published_score: published ? row.published_score : null,
        correct_count: published ? row.correct_count : null,
        incorrect_count: published ? row.incorrect_count : null,
        unanswered_count: published ? row.unanswered_count : null,
      };
    });

    res.json({ role: 'SISWA', exams: sanitized });
  });

  // 5. User Management (Super Admin & limited Professor)
  router.get('/users', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const roleFilter = String(req.query.role ?? '');
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const statusFilter = String(req.query.status ?? '');

    let sql =
      'SELECT user_id, username, nama, kelas, role, status, created_at FROM USERS WHERE 1=1';
    const params: string[] = [];

    if (req.authUser!.role === 'PROFESSOR') {
      sql += " AND role = 'SISWA'";
    } else if (roleFilter && ['SUPER_ADMIN', 'PROFESSOR', 'SISWA'].includes(roleFilter)) {
      sql += ' AND role = ?';
      params.push(roleFilter);
    }

    if (statusFilter && ['ACTIVE', 'INACTIVE', 'LOCKED'].includes(statusFilter)) {
      sql += ' AND status = ?';
      params.push(statusFilter);
    }

    if (search) {
      sql += ' AND (lower(username) LIKE ? OR lower(nama) LIKE ? OR lower(kelas) LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY created_at DESC';
    const users = db.prepare(sql).all(...params);
    res.json({ users });
  });

  router.post('/users', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const nama = String(req.body?.nama ?? '').trim();
    const kelas = String(req.body?.kelas ?? '').trim();
    const password = String(req.body?.password ?? '');
    const requestedRole = String(req.body?.role ?? 'SISWA') as UserRole;

    if (!username || !nama || password.length < 6) {
      res.status(400).json({ error: 'Username, nama lengkap, dan password (min. 6 karakter) wajib diisi.' });
      return;
    }

    if (req.authUser!.role === 'PROFESSOR' && requestedRole !== 'SISWA') {
      res.status(403).json({ error: 'Professor hanya dapat membuat akun Siswa.' });
      return;
    }

    const exists = db.prepare('SELECT user_id FROM USERS WHERE lower(username) = ?').get(username);
    if (exists) {
      res.status(409).json({ error: 'Username sudah terdaftar.' });
      return;
    }

    const { hash, salt } = hashPassword(password);
    const userId = uid('usr');
    db.prepare(
      'INSERT INTO USERS (user_id, username, password_hash, password_salt, nama, kelas, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(userId, username, hash, salt, nama, kelas, requestedRole, 'ACTIVE', nowIso());

    bumpSyncVersion(db, 'users');
    logAudit(db, req.authUser!.user_id, 'USER_CREATE', { target_user_id: userId, username, role: requestedRole });
    res.status(201).json({
      user: { user_id: userId, username, nama, kelas, role: requestedRole, status: 'ACTIVE' },
    });
  });

  router.put('/users/:userId', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const target = db
      .prepare('SELECT * FROM USERS WHERE user_id = ?')
      .get(req.params.userId) as UserRecord | undefined;

    if (!target) {
      res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      return;
    }

    if (req.authUser!.role === 'PROFESSOR' && target.role !== 'SISWA') {
      res.status(403).json({ error: 'Professor tidak diizinkan mengubah akun Super Admin atau Professor lain.' });
      return;
    }

    const nextUsername =
      req.authUser!.role === 'SUPER_ADMIN' && req.body?.username !== undefined
        ? String(req.body.username).trim().toLowerCase()
        : target.username;

    if (!nextUsername) {
      res.status(400).json({ error: 'Username tidak boleh kosong.' });
      return;
    }

    if (nextUsername !== target.username) {
      const dup = db
        .prepare('SELECT user_id FROM USERS WHERE lower(username) = ? AND user_id != ?')
        .get(nextUsername, target.user_id);
      if (dup) {
        res.status(409).json({ error: 'Username sudah digunakan akun lain.' });
        return;
      }
    }

    const nama = String(req.body?.nama ?? target.nama).trim();
    const kelas = String(req.body?.kelas ?? target.kelas).trim();
    const status = String(req.body?.status ?? target.status);
    const role =
      req.authUser!.role === 'SUPER_ADMIN' ? String(req.body?.role ?? target.role) : target.role;

    if (target.user_id === req.authUser!.user_id && status !== 'ACTIVE') {
      res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun sendiri.' });
      return;
    }

    const optionalNewPassword = String(req.body?.new_password ?? '');
    if (optionalNewPassword) {
      if (optionalNewPassword.length < 6) {
        res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
        return;
      }
      if (req.authUser!.role !== 'SUPER_ADMIN') {
        res.status(403).json({ error: 'Hanya Super Admin yang dapat mengganti password pengguna lain.' });
        return;
      }
      const { hash, salt } = hashPassword(optionalNewPassword);
      db.prepare(
        'UPDATE USERS SET username = ?, nama = ?, kelas = ?, role = ?, status = ?, password_hash = ?, password_salt = ? WHERE user_id = ?',
      ).run(nextUsername, nama, kelas, role, status, hash, salt, target.user_id);
    } else {
      db.prepare('UPDATE USERS SET username = ?, nama = ?, kelas = ?, role = ?, status = ? WHERE user_id = ?').run(
        nextUsername,
        nama,
        kelas,
        role,
        status,
        target.user_id,
      );
    }

    bumpSyncVersion(db, 'users');
    logAudit(db, req.authUser!.user_id, 'USER_UPDATE', {
      target_user_id: target.user_id,
      username: nextUsername,
      role,
      status,
    });
    res.json({ ok: true });
  });

  router.post('/users/:userId/reset-password', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const newPassword = String(req.body?.new_password ?? '');
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Password reset minimal 6 karakter.' });
      return;
    }
    const target = db.prepare('SELECT user_id, username FROM USERS WHERE user_id = ?').get(req.params.userId);
    if (!target) {
      res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      return;
    }
    const { hash, salt } = hashPassword(newPassword);
    db.prepare('UPDATE USERS SET password_hash = ?, password_salt = ? WHERE user_id = ?').run(
      hash,
      salt,
      req.params.userId,
    );
    logAudit(db, req.authUser!.user_id, 'PASSWORD_RESET', { target_user_id: req.params.userId });
    res.json({ ok: true });
  });

  router.delete('/users/:userId', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const target = db
      .prepare('SELECT * FROM USERS WHERE user_id = ?')
      .get(req.params.userId) as UserRecord | undefined;
    if (!target) {
      res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      return;
    }
    if (target.user_id === req.authUser!.user_id) {
      res.status(400).json({ error: 'Tidak dapat menghapus akun Super Admin yang sedang aktif.' });
      return;
    }
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('DELETE FROM SESSIONS WHERE user_id = ?').run(target.user_id);
      db.prepare('DELETE FROM EXAM_PARTICIPANTS WHERE user_id = ?').run(target.user_id);
      db.prepare('DELETE FROM ANSWERS WHERE user_id = ?').run(target.user_id);
      db.prepare('DELETE FROM VIOLATION_LOGS WHERE user_id = ?').run(target.user_id);
      db.prepare('DELETE FROM RESULTS WHERE user_id = ?').run(target.user_id);
      db.prepare('DELETE FROM ESSAY_GRADES WHERE user_id = ?').run(target.user_id);
      db.prepare('DELETE FROM NOTIFICATIONS WHERE user_id = ?').run(target.user_id);
      db.prepare('DELETE FROM USERS WHERE user_id = ?').run(target.user_id);
      bumpSyncVersion(db, 'users');
      logAudit(db, req.authUser!.user_id, 'USER_DELETE', { target_user_id: target.user_id, username: target.username });
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
    res.json({ ok: true });
  });

  router.post('/users/import', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const rows = Array.isArray(req.body?.users) ? req.body.users : [];
    let imported = 0;
    let skipped_duplicates = 0;
    const errors: ImportErrorDetail[] = [];
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      const rowNum = Number(r._rowNumber ?? i + 1);
      const username = String(r.username ?? '').trim().toLowerCase();
      const nama = String(r.nama ?? '').trim();
      const kelas = String(r.kelas ?? '').trim();
      const rawPassword = String(r.password ?? '').trim();
      const password = rawPassword || 'SiswaKir2026!';
      const role = req.authUser!.role === 'PROFESSOR' ? 'SISWA' : String(r.role || 'SISWA').trim().toUpperCase();

      if (!username || !nama) {
        errors.push({ row: rowNum, identifier: username || nama, reason: 'Username dan nama lengkap wajib diisi.' });
        continue;
      }
      if (!/^[a-z0-9._-]+$/.test(username)) {
        errors.push({ row: rowNum, identifier: username, reason: `Format username "${username}" tidak valid.` });
        continue;
      }
      if (password.length < 6) {
        errors.push({ row: rowNum, identifier: username, reason: 'Password minimal 6 karakter.' });
        continue;
      }
      if (!['SUPER_ADMIN', 'PROFESSOR', 'SISWA'].includes(role)) {
        errors.push({ row: rowNum, identifier: username, reason: `Role "${role}" tidak valid.` });
        continue;
      }
      if (seenInBatch.has(username)) {
        skipped_duplicates++;
        continue;
      }
      seenInBatch.add(username);

      const exists = db.prepare('SELECT user_id FROM USERS WHERE lower(username) = ?').get(username);
      if (exists) {
        skipped_duplicates++;
        continue;
      }

      const { hash, salt } = hashPassword(password);
      db.prepare(
        'INSERT INTO USERS (user_id, username, password_hash, password_salt, nama, kelas, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(uid('usr'), username, hash, salt, nama, kelas, role, 'ACTIVE', nowIso());
      imported++;
    }

    if (imported > 0) bumpSyncVersion(db, 'users');
    logAudit(db, req.authUser!.user_id, 'USER_IMPORT', {
      imported,
      skipped_duplicates,
      failed_count: errors.length,
    });
    res.json({
      imported,
      skipped_duplicates,
      failed_count: errors.length,
      errors,
    });
  });

  // 6. Categories & Question Bank
  router.get('/categories', requireAuth, (_req, res) => {
    const db = getDb();
    const categories = db.prepare('SELECT * FROM EXAM_CATEGORIES ORDER BY category_name ASC').all();
    res.json({ categories });
  });

  router.post('/categories', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const name = String(req.body?.category_name ?? '').trim();
    const description = String(req.body?.description ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'Nama kategori wajib diisi.' });
      return;
    }
    const catId = uid('cat');
    db.prepare(
      'INSERT OR IGNORE INTO EXAM_CATEGORIES (category_id, category_name, description, created_at) VALUES (?, ?, ?, ?)',
    ).run(catId, name, description, nowIso());
    res.status(201).json({ ok: true, category_id: catId });
  });

  router.get('/questions', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const category = String(req.query.category ?? '');
    const type = String(req.query.type ?? '');
    const difficulty = String(req.query.difficulty ?? '');
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const globalAccess = req.authUser!.role === 'SUPER_ADMIN' || canProfessorAccessAll(db);

    let sql = `SELECT q.*, u.nama as creator_name FROM QUESTIONS q LEFT JOIN USERS u ON u.user_id = q.created_by WHERE 1=1`;
    const params: string[] = [];

    if (!globalAccess) {
      sql += ' AND q.created_by = ?';
      params.push(req.authUser!.user_id);
    }
    if (category) {
      sql += ' AND q.category = ?';
      params.push(category);
    }
    if (type) {
      sql += ' AND q.question_type = ?';
      params.push(type);
    }
    if (difficulty) {
      sql += ' AND q.difficulty = ?';
      params.push(difficulty);
    }
    if (search) {
      sql += ' AND (lower(q.question_text) LIKE ? OR lower(q.materi) LIKE ? OR lower(q.category) LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY q.created_at DESC';
    const questions = db.prepare(sql).all(...params);
    res.json({ questions });
  });

  router.post('/questions', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const b = req.body ?? {};
    const questionType = String(b.question_type ?? 'PG');
    const questionText = sanitizeRichHtml(String(b.question_text ?? '').trim());
    if (!questionText) {
      res.status(400).json({ error: 'Konten pertanyaan tidak boleh kosong.' });
      return;
    }

    const validTypes = ['PG', 'PGK', 'BENAR_SALAH', 'ESAI', 'ISIAN_SINGKAT', 'MENJODOHKAN', 'MENGURUTKAN'];
    if (!validTypes.includes(questionType)) {
      res.status(400).json({ error: 'Tipe soal tidak valid.' });
      return;
    }

    const questionId = uid('q');
    const optionsJson = typeof b.options_json === 'string' ? b.options_json : JSON.stringify(b.options ?? {});
    const correctAnswer =
      typeof b.correct_answer === 'string' ? b.correct_answer : JSON.stringify(b.correct_answer ?? '');

    db.prepare(
      `INSERT INTO QUESTIONS (question_id, question_type, question_text, options_json, correct_answer, explanation, image_url, category, materi, difficulty, score, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      questionId,
      questionType,
      questionText,
      optionsJson,
      correctAnswer,
      sanitizeRichHtml(String(b.explanation ?? '')),
      String(b.image_url ?? ''),
      String(b.category ?? 'Umum'),
      String(b.materi ?? ''),
      String(b.difficulty ?? 'SEDANG'),
      Number(b.score ?? 10),
      req.authUser!.user_id,
      nowIso(),
    );

    bumpSyncVersion(db, 'questions');
    logAudit(db, req.authUser!.user_id, 'QUESTION_CREATE', { question_id: questionId, type: questionType });
    res.status(201).json({ question_id: questionId });
  });

  router.put('/questions/:questionId', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM QUESTIONS WHERE question_id = ?')
      .get(req.params.questionId) as QuestionRecord | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Soal tidak ditemukan.' });
      return;
    }
    if (
      req.authUser!.role === 'PROFESSOR' &&
      !canProfessorAccessAll(db) &&
      existing.created_by !== req.authUser!.user_id
    ) {
      res.status(403).json({ error: 'Anda tidak berwenang mengedit soal milik pembuat lain.' });
      return;
    }

    const b = req.body ?? {};
    const optionsJson =
      typeof b.options_json === 'string'
        ? b.options_json
        : b.options
          ? JSON.stringify(b.options)
          : existing.options_json;
    const correctAnswer =
      typeof b.correct_answer === 'string'
        ? b.correct_answer
        : b.correct_answer !== undefined
          ? JSON.stringify(b.correct_answer)
          : existing.correct_answer;

    db.prepare(
      `UPDATE QUESTIONS
       SET question_type = ?, question_text = ?, options_json = ?, correct_answer = ?, explanation = ?,
           image_url = ?, category = ?, materi = ?, difficulty = ?, score = ?
       WHERE question_id = ?`,
    ).run(
      String(b.question_type ?? existing.question_type),
      sanitizeRichHtml(String(b.question_text ?? existing.question_text)),
      optionsJson,
      correctAnswer,
      sanitizeRichHtml(String(b.explanation ?? existing.explanation)),
      String(b.image_url ?? existing.image_url),
      String(b.category ?? existing.category),
      String(b.materi ?? existing.materi ?? ''),
      String(b.difficulty ?? existing.difficulty),
      Number(b.score ?? existing.score),
      existing.question_id,
    );

    bumpSyncVersion(db, 'questions');
    logAudit(db, req.authUser!.user_id, 'QUESTION_UPDATE', { question_id: existing.question_id });
    res.json({ ok: true });
  });

  router.post('/questions/:questionId/duplicate', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const q = db
      .prepare('SELECT * FROM QUESTIONS WHERE question_id = ?')
      .get(req.params.questionId) as QuestionRecord | undefined;
    if (!q) {
      res.status(404).json({ error: 'Soal tidak ditemukan.' });
      return;
    }
    const newId = uid('q');
    db.prepare(
      `INSERT INTO QUESTIONS (question_id, question_type, question_text, options_json, correct_answer, explanation, image_url, category, materi, difficulty, score, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId,
      q.question_type,
      `${q.question_text} <p><em>(Salinan)</em></p>`,
      q.options_json,
      q.correct_answer,
      q.explanation,
      q.image_url,
      q.category,
      q.materi ?? '',
      q.difficulty,
      q.score,
      req.authUser!.user_id,
      nowIso(),
    );
    bumpSyncVersion(db, 'questions');
    logAudit(db, req.authUser!.user_id, 'QUESTION_DUPLICATE', { source: q.question_id, target: newId });
    res.status(201).json({ question_id: newId });
  });

  router.post('/questions/move-category', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const ids = Array.isArray(req.body?.question_ids) ? req.body.question_ids.map(String) : [];
    const targetCategory = String(req.body?.category ?? '').trim();
    if (!ids.length || !targetCategory) {
      res.status(400).json({ error: 'Pilih soal dan kategori tujuan.' });
      return;
    }
    const upd = db.prepare('UPDATE QUESTIONS SET category = ? WHERE question_id = ?');
    for (const id of ids) upd.run(targetCategory, id);
    bumpSyncVersion(db, 'questions');
    logAudit(db, req.authUser!.user_id, 'QUESTION_MOVE_CATEGORY', { count: ids.length, targetCategory });
    res.json({ ok: true, moved: ids.length });
  });

  router.post('/questions/import', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const rows = Array.isArray(req.body?.questions) ? req.body.questions : [];
    const skipDuplicates = req.body?.skip_duplicates !== false;
    let imported = 0;
    let skipped_duplicates = 0;
    const errors: ImportErrorDetail[] = [];

    const existingQuestions = db
      .prepare('SELECT question_id, question_type, question_text FROM QUESTIONS')
      .all() as Array<{ question_id: string; question_type: string; question_text: string }>;
    const existingKeys = new Set(
      existingQuestions.map((q) => buildQuestionDedupeKey(q.question_type, q.question_text)),
    );
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      const rowNum = Number(r._rowNumber ?? i + 1);
      const parsedType = normalizeQuestionTypeAlias(String(r.question_type ?? ''));
      const rawText = sanitizeRichHtml(String(r.question_text ?? '').trim());
      const answerRaw = r.correct_answer;

      if (!parsedType) {
        errors.push({ row: rowNum, reason: `Jenis soal "${String(r.question_type ?? '')}" tidak valid.` });
        continue;
      }
      if (!rawText) {
        errors.push({ row: rowNum, reason: 'Teks soal kosong.' });
        continue;
      }

      const imageUrl = String(r.image_url ?? '').trim();
      if (imageUrl && !isValidImageReference(imageUrl)) {
        errors.push({ row: rowNum, reason: 'Format URL gambar tidak valid.' });
        continue;
      }

      const dedupeKey = buildQuestionDedupeKey(parsedType, rawText);
      if (seenInBatch.has(dedupeKey) || (skipDuplicates && existingKeys.has(dedupeKey))) {
        skipped_duplicates++;
        continue;
      }
      seenInBatch.add(dedupeKey);

      let optionsObj: QuestionOptionsPayload = {};
      let formattedAnswer = '';

      if (r.options && typeof r.options === 'object' && !Array.isArray(r.options)) {
        optionsObj = r.options as QuestionOptionsPayload;
        formattedAnswer = typeof answerRaw === 'string' ? answerRaw : JSON.stringify(answerRaw ?? '');
      } else {
        const answerStr = String(answerRaw ?? '').trim();
        if (parsedType !== 'ESAI' && !answerStr) {
          errors.push({ row: rowNum, reason: 'Kunci jawaban wajib diisi untuk soal objektif.' });
          continue;
        }
        if (parsedType === 'PG' || parsedType === 'PGK') {
          const choices = ['A', 'B', 'C', 'D', 'E']
            .map((lbl) => ({
              id: lbl,
              label: lbl,
              text: String(r[`option_${lbl.toLowerCase()}`] ?? '').trim(),
            }))
            .filter((c) => c.text.length > 0);
          if (choices.length < 2) {
            errors.push({ row: rowNum, reason: 'Minimal harus ada 2 pilihan jawaban (A dan B).' });
            continue;
          }
          optionsObj =
            parsedType === 'PGK'
              ? { choices, pgk_scoring: 'PARTIAL', pgk_penalty: 0 }
              : { choices };
          formattedAnswer =
            parsedType === 'PGK'
              ? JSON.stringify(
                  answerStr
                    .split(/[,|;]/)
                    .map((s) => s.trim().toUpperCase())
                    .filter(Boolean),
                )
              : answerStr.toUpperCase();
        } else if (parsedType === 'ISIAN_SINGKAT') {
          const variants = answerStr.split('|').map((s) => s.trim()).filter(Boolean);
          optionsObj = { accepted_answers: variants, case_sensitive: false };
          formattedAnswer = variants[0] || answerStr;
        } else if (parsedType === 'MENJODOHKAN') {
          const pairs = answerStr
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((seg, idx) => {
              const parts = seg.split(/=>|->|:/);
              return parts.length >= 2
                ? { id: `p${idx + 1}`, left: parts[0].trim(), right: parts.slice(1).join(':').trim() }
                : null;
            })
            .filter((x): x is { id: string; left: string; right: string } => Boolean(x && x.left && x.right));
          if (pairs.length < 2) {
            errors.push({ row: rowNum, reason: 'Menjodohkan butuh minimal 2 pasangan (Kiri=>Kanan).' });
            continue;
          }
          optionsObj = { matching_pairs: pairs };
          const ansMap: Record<string, string> = {};
          pairs.forEach((p) => {
            ansMap[p.id] = p.right;
          });
          formattedAnswer = JSON.stringify(ansMap);
        } else if (parsedType === 'MENGURUTKAN') {
          const items = answerStr.split('|').map((s) => s.trim()).filter(Boolean);
          if (items.length < 2) {
            errors.push({ row: rowNum, reason: 'Mengurutkan butuh minimal 2 item dipisahkan |.' });
            continue;
          }
          const orderingItems = items.map((text, idx) => ({ id: `ord_${idx + 1}`, text }));
          optionsObj = { ordering_items: orderingItems };
          formattedAnswer = JSON.stringify(orderingItems.map((it) => it.id));
        } else {
          formattedAnswer = answerStr;
        }
      }

      const rawDiff = String(r.difficulty ?? 'SEDANG').trim().toUpperCase();
      const difficulty = ['MUDAH', 'SEDANG', 'SULIT', 'OLIMPIADE'].includes(rawDiff) ? rawDiff : 'SEDANG';

      db.prepare(
        `INSERT INTO QUESTIONS (question_id, question_type, question_text, options_json, correct_answer, explanation, image_url, category, materi, difficulty, score, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        uid('q'),
        parsedType,
        rawText,
        JSON.stringify(optionsObj),
        formattedAnswer,
        sanitizeRichHtml(String(r.explanation ?? '')),
        imageUrl,
        String(r.category ?? '').trim() || 'Umum',
        String(r.materi ?? '').trim(),
        difficulty,
        Number(r.score ?? 10) || 10,
        req.authUser!.user_id,
        nowIso(),
      );
      existingKeys.add(dedupeKey);
      imported++;
    }

    if (imported > 0) bumpSyncVersion(db, 'questions');
    logAudit(db, req.authUser!.user_id, 'QUESTION_IMPORT', {
      imported,
      skipped_duplicates,
      failed_count: errors.length,
    });
    res.json({
      imported,
      skipped_duplicates,
      failed_count: errors.length,
      failed: errors,
      errors,
    });
  });

  router.delete('/questions/:questionId', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM QUESTIONS WHERE question_id = ?')
      .get(req.params.questionId) as QuestionRecord | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Soal tidak ditemukan.' });
      return;
    }
    if (
      req.authUser!.role === 'PROFESSOR' &&
      !canProfessorAccessAll(db) &&
      existing.created_by !== req.authUser!.user_id
    ) {
      res.status(403).json({ error: 'Anda tidak berwenang menghapus soal milik pembuat lain.' });
      return;
    }
    db.prepare('DELETE FROM EXAM_QUESTIONS WHERE question_id = ?').run(existing.question_id);
    db.prepare('DELETE FROM QUESTIONS WHERE question_id = ?').run(existing.question_id);
    bumpSyncVersion(db, 'questions');
    bumpSyncVersion(db, 'exams');
    logAudit(db, req.authUser!.user_id, 'QUESTION_DELETE', { question_id: existing.question_id });
    res.json({ ok: true });
  });

  // 7. Exams & Participant Assignment
  router.get('/exams', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const user = req.authUser!;
    if (user.role === 'SISWA') {
      const exams = db
        .prepare(
          `SELECT e.*, ep.status as participant_status, ep.started_at, ep.submitted_at, ep.score as participant_score,
                  r.total_score as published_score, r.published
           FROM EXAMS e
           JOIN EXAM_PARTICIPANTS ep ON ep.exam_id = e.exam_id AND ep.user_id = ?
           LEFT JOIN RESULTS r ON r.exam_id = e.exam_id AND r.user_id = ?
           WHERE e.status IN ('SCHEDULED', 'ACTIVE', 'COMPLETED')
           ORDER BY e.start_time DESC`,
        )
        .all(user.user_id, user.user_id);
      res.json({ exams });
      return;
    }

    const globalAccess = user.role === 'SUPER_ADMIN' || canProfessorAccessAll(db);
    const sql = globalAccess
      ? `SELECT e.*, u.nama as creator_name,
                (SELECT COUNT(*) FROM EXAM_PARTICIPANTS ep WHERE ep.exam_id = e.exam_id) as participant_count
         FROM EXAMS e LEFT JOIN USERS u ON u.user_id = e.created_by ORDER BY e.start_time DESC`
      : `SELECT e.*, u.nama as creator_name,
                (SELECT COUNT(*) FROM EXAM_PARTICIPANTS ep WHERE ep.exam_id = e.exam_id) as participant_count
         FROM EXAMS e LEFT JOIN USERS u ON u.user_id = e.created_by WHERE e.created_by = ? ORDER BY e.start_time DESC`;
    const exams = globalAccess ? db.prepare(sql).all() : db.prepare(sql).all(user.user_id);
    res.json({ exams });
  });

  router.get('/exams/:examId', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    const questions = db
      .prepare(
        `SELECT q.*, eq.question_order, eq.score as exam_score
         FROM EXAM_QUESTIONS eq
         JOIN QUESTIONS q ON q.question_id = eq.question_id
         WHERE eq.exam_id = ?
         ORDER BY eq.question_order ASC`,
      )
      .all(exam.exam_id);
    const participants = db
      .prepare(
        `SELECT ep.*, u.username, u.nama, u.kelas
         FROM EXAM_PARTICIPANTS ep
         JOIN USERS u ON u.user_id = ep.user_id
         WHERE ep.exam_id = ?
         ORDER BY u.nama ASC`,
      )
      .all(exam.exam_id);
    res.json({ exam, questions, participants });
  });

  router.post('/exams', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const b = req.body ?? {};
    const title = String(b.title ?? '').trim();
    if (!title) {
      res.status(400).json({ error: 'Judul ujian wajib diisi.' });
      return;
    }

    const examId = uid('exm');
    const selectedQuestions: Array<{ question_id: string; score?: number }> = Array.isArray(b.questions)
      ? b.questions
      : [];
    const participantIds: string[] = Array.isArray(b.participant_ids) ? b.participant_ids : [];
    const status = String(b.status ?? 'DRAFT');

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(
        `INSERT INTO EXAMS (exam_id, title, description, subject, start_time, end_time, duration, status, total_questions, created_by, settings_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        examId,
        title,
        String(b.description ?? ''),
        String(b.subject ?? 'IPA Terpadu'),
        String(b.start_time ?? nowIso()),
        String(b.end_time ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
        Math.max(1, Number(b.duration ?? 60)),
        status,
        selectedQuestions.length,
        req.authUser!.user_id,
        typeof b.settings_json === 'string' ? b.settings_json : JSON.stringify(b.settings ?? {}),
      );

      const insEQ = db.prepare(
        'INSERT INTO EXAM_QUESTIONS (id, exam_id, question_id, question_order, score) VALUES (?, ?, ?, ?, ?)',
      );
      selectedQuestions.forEach((item, idx) => {
        insEQ.run(uid('eq'), examId, item.question_id, idx + 1, Number(item.score ?? 10));
      });

      const insPart = db.prepare(
        "INSERT OR IGNORE INTO EXAM_PARTICIPANTS (id, exam_id, user_id, status, started_at, submitted_at, score, session_id) VALUES (?, ?, ?, 'BELUM_MULAI', '', '', 0, '')",
      );
      for (const pid of participantIds) {
        insPart.run(uid('prt'), examId, pid);
      }

      bumpSyncVersion(db, 'exams');
      logAudit(db, req.authUser!.user_id, 'EXAM_CREATE', { exam_id: examId, title, status });
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    res.status(201).json({ exam_id: examId });
  });

  router.put('/exams/:examId', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    if (
      req.authUser!.role === 'PROFESSOR' &&
      !canProfessorAccessAll(db) &&
      existing.created_by !== req.authUser!.user_id
    ) {
      res.status(403).json({ error: 'Anda tidak berwenang mengubah ujian milik Professor lain.' });
      return;
    }

    const b = req.body ?? {};
    const selectedQuestions: Array<{ question_id: string; score?: number }> | null = Array.isArray(
      b.questions,
    )
      ? b.questions
      : null;

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(
        `UPDATE EXAMS
         SET title = ?, description = ?, subject = ?, start_time = ?, end_time = ?, duration = ?,
             status = ?, total_questions = ?, settings_json = ?
         WHERE exam_id = ?`,
      ).run(
        String(b.title ?? existing.title),
        String(b.description ?? existing.description),
        String(b.subject ?? existing.subject),
        String(b.start_time ?? existing.start_time),
        String(b.end_time ?? existing.end_time),
        Math.max(1, Number(b.duration ?? existing.duration)),
        String(b.status ?? existing.status),
        selectedQuestions ? selectedQuestions.length : existing.total_questions,
        typeof b.settings_json === 'string'
          ? b.settings_json
          : b.settings
            ? JSON.stringify(b.settings)
            : existing.settings_json,
        existing.exam_id,
      );

      if (selectedQuestions) {
        db.prepare('DELETE FROM EXAM_QUESTIONS WHERE exam_id = ?').run(existing.exam_id);
        const insEQ = db.prepare(
          'INSERT INTO EXAM_QUESTIONS (id, exam_id, question_id, question_order, score) VALUES (?, ?, ?, ?, ?)',
        );
        selectedQuestions.forEach((item, idx) => {
          insEQ.run(uid('eq'), existing.exam_id, item.question_id, idx + 1, Number(item.score ?? 10));
        });
      }

      if (Array.isArray(b.participant_ids)) {
        const nextParticipantIds = b.participant_ids.map(String);
        if (b.sync_participants) {
          const existingParts = db
            .prepare('SELECT user_id FROM EXAM_PARTICIPANTS WHERE exam_id = ?')
            .all(existing.exam_id) as Array<{ user_id: string }>;
          const keepSet = new Set(nextParticipantIds);
          const delPart = db.prepare(
            'DELETE FROM EXAM_PARTICIPANTS WHERE exam_id = ? AND user_id = ?',
          );
          for (const ep of existingParts) {
            if (!keepSet.has(ep.user_id)) {
              delPart.run(existing.exam_id, ep.user_id);
            }
          }
        }
        const insPart = db.prepare(
          "INSERT OR IGNORE INTO EXAM_PARTICIPANTS (id, exam_id, user_id, status, started_at, submitted_at, score, session_id) VALUES (?, ?, ?, 'BELUM_MULAI', '', '', 0, '')",
        );
        for (const pid of nextParticipantIds) {
          insPart.run(uid('prt'), existing.exam_id, pid);
        }
      }

      bumpSyncVersion(db, 'exams');
      logAudit(db, req.authUser!.user_id, 'EXAM_UPDATE', {
        exam_id: existing.exam_id,
        status: b.status ?? existing.status,
      });
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    res.json({ ok: true });
  });

  router.delete('/exams/:examId', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    if (
      req.authUser!.role === 'PROFESSOR' &&
      !canProfessorAccessAll(db) &&
      existing.created_by !== req.authUser!.user_id
    ) {
      res.status(403).json({ error: 'Anda tidak berwenang menghapus ujian milik Professor lain.' });
      return;
    }
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('DELETE FROM EXAM_QUESTIONS WHERE exam_id = ?').run(existing.exam_id);
      db.prepare('DELETE FROM EXAM_PARTICIPANTS WHERE exam_id = ?').run(existing.exam_id);
      db.prepare('DELETE FROM ANSWERS WHERE exam_id = ?').run(existing.exam_id);
      db.prepare('DELETE FROM VIOLATION_LOGS WHERE exam_id = ?').run(existing.exam_id);
      db.prepare('DELETE FROM RESULTS WHERE exam_id = ?').run(existing.exam_id);
      db.prepare('DELETE FROM ESSAY_GRADES WHERE exam_id = ?').run(existing.exam_id);
      db.prepare('DELETE FROM EXAM_LOGS WHERE exam_id = ?').run(existing.exam_id);
      db.prepare('DELETE FROM EXAMS WHERE exam_id = ?').run(existing.exam_id);
      bumpSyncVersion(db, 'exams');
      logAudit(db, req.authUser!.user_id, 'EXAM_DELETE', { exam_id: existing.exam_id, title: existing.title });
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
    res.json({ ok: true });
  });

  router.post('/exams/:examId/status', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    const nextStatus = String(req.body?.status ?? '');
    if (!['DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'ARCHIVED'].includes(nextStatus)) {
      res.status(400).json({ error: 'Status ujian tidak valid.' });
      return;
    }
    db.prepare('UPDATE EXAMS SET status = ? WHERE exam_id = ?').run(nextStatus, exam.exam_id);
    bumpSyncVersion(db, 'exams');
    logAudit(db, req.authUser!.user_id, 'EXAM_STATUS_CHANGE', {
      exam_id: exam.exam_id,
      from: exam.status,
      to: nextStatus,
    });
    res.json({ ok: true });
  });

  router.post('/exams/:examId/emergency-stop', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    const activeParts = db
      .prepare("SELECT user_id FROM EXAM_PARTICIPANTS WHERE exam_id = ? AND status IN ('MENGERJAKAN', 'GANGGUAN')")
      .all(exam.exam_id) as Array<{ user_id: string }>;

    for (const p of activeParts) {
      finalizeParticipantSubmission(db, exam, p.user_id, 'ADMIN_FORCE_STOP');
    }
    db.prepare("UPDATE EXAMS SET status = 'COMPLETED' WHERE exam_id = ?").run(exam.exam_id);
    bumpSyncVersion(db, 'exams');
    bumpSyncVersion(db, 'results');
    logAudit(db, req.authUser!.user_id, 'EMERGENCY_STOP_EXAM', {
      exam_id: exam.exam_id,
      forced_participants: activeParts.length,
    });
    res.json({ ok: true, stopped_participants: activeParts.length });
  });

  router.post('/exams/:examId/participants', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const userIds: string[] = Array.isArray(req.body?.user_ids) ? req.body.user_ids.map(String) : [];
    const ins = db.prepare(
      "INSERT OR IGNORE INTO EXAM_PARTICIPANTS (id, exam_id, user_id, status, started_at, submitted_at, score, session_id) VALUES (?, ?, ?, 'BELUM_MULAI', '', '', 0, '')",
    );
    for (const uidVal of userIds) ins.run(uid('prt'), req.params.examId, uidVal);
    bumpSyncVersion(db, 'exams');
    logAudit(db, req.authUser!.user_id, 'EXAM_ASSIGN_PARTICIPANTS', {
      exam_id: req.params.examId,
      count: userIds.length,
    });
    res.json({ ok: true });
  });

  // Bulk Import Questions directly into a specific Exam (deduplicating Bank Soal & EXAM_QUESTIONS)
  router.post('/exams/:examId/questions/import', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as ExamRecord | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    if (req.authUser!.role === 'PROFESSOR' && !canProfessorAccessAll(db) && exam.created_by !== req.authUser!.user_id) {
      res.status(403).json({ error: 'Anda tidak berwenang mengubah ujian milik Professor lain.' });
      return;
    }

    const rows = Array.isArray(req.body?.questions) ? req.body.questions : [];
    const existingBank = db
      .prepare('SELECT question_id, question_type, question_text, score FROM QUESTIONS')
      .all() as Array<{ question_id: string; question_type: string; question_text: string; score: number }>;
    const bankByKey = new Map<string, { question_id: string; score: number }>();
    for (const bq of existingBank) {
      bankByKey.set(buildQuestionDedupeKey(bq.question_type, bq.question_text), {
        question_id: bq.question_id,
        score: bq.score,
      });
    }

    const currentExamLinks = db
      .prepare('SELECT question_id, question_order FROM EXAM_QUESTIONS WHERE exam_id = ?')
      .all(exam.exam_id) as Array<{ question_id: string; question_order: number }>;
    const linkedQIds = new Set(currentExamLinks.map((l) => l.question_id));
    let nextOrder = currentExamLinks.reduce((m, l) => Math.max(m, l.question_order), 0) + 1;

    let imported = 0;
    let linked = 0;
    let skipped_duplicates = 0;
    const errors: ImportErrorDetail[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      const rowNum = Number(r._rowNumber ?? i + 1);
      const qType = normalizeQuestionTypeAlias(String(r.question_type ?? ''));
      const qText = sanitizeRichHtml(String(r.question_text ?? '').trim());

      if (!qType) {
        errors.push({ row: rowNum, reason: `Jenis soal "${String(r.question_type ?? '')}" tidak valid.` });
        continue;
      }
      if (!qText) {
        errors.push({ row: rowNum, reason: 'Teks pertanyaan kosong.' });
        continue;
      }

      const key = buildQuestionDedupeKey(qType, qText);
      const rowScore = Number(r.score ?? 10) || 10;
      let targetQuestionId: string | null = null;

      if (bankByKey.has(key)) {
        const existingQ = bankByKey.get(key)!;
        targetQuestionId = existingQ.question_id;
        if (linkedQIds.has(targetQuestionId)) {
          skipped_duplicates++;
          continue;
        }
        linked++;
      } else {
        const answerStr =
          typeof r.correct_answer === 'string'
            ? r.correct_answer.trim()
            : JSON.stringify(r.correct_answer ?? '');
        if (qType !== 'ESAI' && !answerStr) {
          errors.push({ row: rowNum, reason: 'Kunci jawaban wajib diisi untuk soal objektif.' });
          continue;
        }
        let optionsObj: QuestionOptionsPayload =
          r.options && typeof r.options === 'object' ? (r.options as QuestionOptionsPayload) : {};
        let formattedAnswer = answerStr;

        if (!r.options) {
          if (qType === 'PG' || qType === 'PGK') {
            const choices = ['A', 'B', 'C', 'D', 'E']
              .map((lbl) => ({ id: lbl, label: lbl, text: String(r[`option_${lbl.toLowerCase()}`] ?? '').trim() }))
              .filter((c) => c.text.length > 0);
            if (choices.length < 2) {
              errors.push({ row: rowNum, reason: 'PG/PGK butuh minimal 2 opsi (A dan B).' });
              continue;
            }
            optionsObj = qType === 'PGK' ? { choices, pgk_scoring: 'PARTIAL', pgk_penalty: 0 } : { choices };
            formattedAnswer =
              qType === 'PGK'
                ? JSON.stringify(answerStr.split(/[,|;]/).map((s: string) => s.trim().toUpperCase()).filter(Boolean))
                : answerStr.toUpperCase();
          } else if (qType === 'ISIAN_SINGKAT') {
            const variants = answerStr.split('|').map((s: string) => s.trim()).filter(Boolean);
            optionsObj = { accepted_answers: variants, case_sensitive: false };
            formattedAnswer = variants[0] || answerStr;
          } else if (qType === 'MENJODOHKAN') {
            const pairs = answerStr
              .split('|')
              .map((s: string) => s.trim())
              .filter(Boolean)
              .map((seg: string, idx: number) => {
                const parts = seg.split(/=>|->|:/);
                return parts.length >= 2
                  ? { id: `p${idx + 1}`, left: parts[0].trim(), right: parts.slice(1).join(':').trim() }
                  : null;
              })
              .filter((x: { id: string; left: string; right: string } | null): x is { id: string; left: string; right: string } => Boolean(x && x.left && x.right));
            if (pairs.length < 2) {
              errors.push({ row: rowNum, reason: 'Menjodohkan butuh minimal 2 pasangan.' });
              continue;
            }
            optionsObj = { matching_pairs: pairs };
            const ansMap: Record<string, string> = {};
            pairs.forEach((p: { id: string; right: string }) => { ansMap[p.id] = p.right; });
            formattedAnswer = JSON.stringify(ansMap);
          } else if (qType === 'MENGURUTKAN') {
            const items = answerStr.split('|').map((s: string) => s.trim()).filter(Boolean);
            if (items.length < 2) {
              errors.push({ row: rowNum, reason: 'Mengurutkan butuh minimal 2 item dipisahkan |.' });
              continue;
            }
            const ord = items.map((text: string, idx: number) => ({ id: `ord_${idx + 1}`, text }));
            optionsObj = { ordering_items: ord };
            formattedAnswer = JSON.stringify(ord.map((it: { id: string }) => it.id));
          }
        }

        const newQId = uid('q');
        const imageUrl = isValidImageReference(String(r.image_url ?? '')) ? String(r.image_url ?? '').trim() : '';
        const rawDiff = String(r.difficulty ?? 'SEDANG').trim().toUpperCase();
        const difficulty = ['MUDAH', 'SEDANG', 'SULIT', 'OLIMPIADE'].includes(rawDiff) ? rawDiff : 'SEDANG';

        db.prepare(
          `INSERT INTO QUESTIONS (question_id, question_type, question_text, options_json, correct_answer, explanation, image_url, category, materi, difficulty, score, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          newQId,
          qType,
          qText,
          JSON.stringify(optionsObj),
          formattedAnswer,
          sanitizeRichHtml(String(r.explanation ?? '')),
          imageUrl,
          String(r.category ?? '').trim() || 'Umum',
          String(r.materi ?? '').trim(),
          difficulty,
          rowScore,
          req.authUser!.user_id,
          nowIso(),
        );
        targetQuestionId = newQId;
        bankByKey.set(key, { question_id: newQId, score: rowScore });
        imported++;
      }

      if (targetQuestionId && !linkedQIds.has(targetQuestionId)) {
        db.prepare(
          'INSERT OR IGNORE INTO EXAM_QUESTIONS (id, exam_id, question_id, question_order, score) VALUES (?, ?, ?, ?, ?)',
        ).run(uid('eq'), exam.exam_id, targetQuestionId, nextOrder++, rowScore);
        linkedQIds.add(targetQuestionId);
      }
    }

    db.prepare('UPDATE EXAMS SET total_questions = ? WHERE exam_id = ?').run(linkedQIds.size, exam.exam_id);
    if (imported > 0 || linked > 0) {
      bumpSyncVersion(db, 'questions');
      bumpSyncVersion(db, 'exams');
    }
    logAudit(db, req.authUser!.user_id, 'EXAM_QUESTIONS_IMPORT', {
      exam_id: exam.exam_id,
      imported,
      linked,
      skipped_duplicates,
      failed_count: errors.length,
    });

    res.json({
      imported: imported + linked,
      linked,
      skipped_duplicates,
      failed_count: errors.length,
      errors,
    });
  });

  // Bulk Import / Assign Participants directly into a specific Exam
  router.post('/exams/:examId/participants/import', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as ExamRecord | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    const rows = Array.isArray(req.body?.participants) ? req.body.participants : [];
    const existingAssigned = new Set(
      (db.prepare('SELECT user_id FROM EXAM_PARTICIPANTS WHERE exam_id = ?').all(exam.exam_id) as Array<{ user_id: string }>).map(
        (x) => x.user_id,
      ),
    );
    const seenUsernames = new Set<string>();
    let imported = 0;
    let linked = 0;
    let skipped_duplicates = 0;
    const errors: ImportErrorDetail[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      const rowNum = Number(r._rowNumber ?? i + 1);
      const username = String(r.username ?? '').trim().toLowerCase();
      const nama = String(r.nama ?? '').trim();
      const kelas = String(r.kelas ?? '').trim();
      const password = String(r.password ?? '').trim() || 'SiswaKir2026!';

      if (!username || !/^[a-z0-9._-]+$/.test(username)) {
        errors.push({ row: rowNum, identifier: username, reason: 'Username/NIS tidak valid atau kosong.' });
        continue;
      }
      if (seenUsernames.has(username)) {
        skipped_duplicates++;
        continue;
      }
      seenUsernames.add(username);

      const userRow = db
        .prepare('SELECT user_id, role FROM USERS WHERE lower(username) = ?')
        .get(username) as { user_id: string; role: string } | undefined;

      let targetUserId: string;
      if (userRow) {
        if (existingAssigned.has(userRow.user_id)) {
          skipped_duplicates++;
          continue;
        }
        targetUserId = userRow.user_id;
        linked++;
      } else {
        if (!nama) {
          errors.push({
            row: rowNum,
            identifier: username,
            reason: `Akun "${username}" belum terdaftar dan Nama Lengkap kosong.`,
          });
          continue;
        }
        const { hash, salt } = hashPassword(password);
        targetUserId = uid('usr');
        db.prepare(
          'INSERT INTO USERS (user_id, username, password_hash, password_salt, nama, kelas, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(targetUserId, username, hash, salt, nama, kelas, 'SISWA', 'ACTIVE', nowIso());
        imported++;
      }

      db.prepare(
        "INSERT OR IGNORE INTO EXAM_PARTICIPANTS (id, exam_id, user_id, status, started_at, submitted_at, score, session_id) VALUES (?, ?, ?, 'BELUM_MULAI', '', '', 0, '')",
      ).run(uid('prt'), exam.exam_id, targetUserId);
      existingAssigned.add(targetUserId);
    }

    if (imported > 0) bumpSyncVersion(db, 'users');
    if (imported > 0 || linked > 0) bumpSyncVersion(db, 'exams');
    logAudit(db, req.authUser!.user_id, 'EXAM_PARTICIPANTS_IMPORT', {
      exam_id: exam.exam_id,
      imported,
      linked,
      skipped_duplicates,
      failed_count: errors.length,
    });

    res.json({
      imported: imported + linked,
      linked,
      skipped_duplicates,
      failed_count: errors.length,
      errors,
    });
  });

  // 8. CBT Exam Runner (Student Endpoints — ZERO Answer Key Leakage!)
  router.post('/cbt/exams/:examId/start', requireAuth, requireRole('SISWA'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    if (exam.status !== 'ACTIVE') {
      res.status(403).json({ error: 'Ujian saat ini tidak berstatus aktif.' });
      return;
    }

    const nowMs = Date.now();
    if (nowMs < new Date(exam.start_time).getTime()) {
      res.status(403).json({ error: 'Ujian belum memasuki waktu mulai.' });
      return;
    }
    if (nowMs > new Date(exam.end_time).getTime()) {
      res.status(403).json({ error: 'Waktu pelaksanaan ujian telah berakhir.' });
      return;
    }

    const participant = db
      .prepare('SELECT * FROM EXAM_PARTICIPANTS WHERE exam_id = ? AND user_id = ?')
      .get(exam.exam_id, req.authUser!.user_id) as
      | { id: string; status: string; started_at: string; session_id: string }
      | undefined;

    if (!participant) {
      res.status(403).json({ error: 'Anda tidak terdaftar sebagai peserta pada ujian ini.' });
      return;
    }

    if (participant.status === 'TERKUMPUL' || participant.status === 'DIHENTIKAN') {
      res.status(403).json({ error: 'Ujian Anda sudah dikumpulkan dan dikunci.' });
      return;
    }

    const settings = safeJsonParse<ExamSettings>(exam.settings_json, {} as ExamSettings);
    const recoverSession = Boolean(req.body?.recover_session);
    const currentSessionId = req.authSessionId!;

    if (
      settings.anti_cheat_single_session &&
      participant.session_id &&
      participant.session_id !== currentSessionId &&
      !recoverSession
    ) {
      const prevSess = db
        .prepare('SELECT status, expires_at FROM SESSIONS WHERE session_id = ?')
        .get(participant.session_id) as { status: string; expires_at: string } | undefined;
      const isPrevStillActive =
        Boolean(prevSess) &&
        prevSess!.status === 'ACTIVE' &&
        new Date(prevSess!.expires_at).getTime() > Date.now();

      if (isPrevStillActive) {
        db.prepare(
          'INSERT INTO VIOLATION_LOGS (log_id, exam_id, user_id, event_type, event_time, description) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(
          uid('vio'),
          exam.exam_id,
          req.authUser!.user_id,
          'MULTI_SESSION',
          nowIso(),
          'Terdeteksi upaya membuka ujian dari sesi login berbeda.',
        );
        res.status(409).json({
          code: 'MULTIPLE_SESSION_DETECTED',
          error:
            'Ujian sedang aktif di sesi/perangkat lain. Jika mengalami kendala teknis, gunakan opsi Pulihkan Sesi.',
        });
        return;
      }
    }

    const startedAt = participant.started_at || nowIso();
    db.prepare(
      "UPDATE EXAM_PARTICIPANTS SET status = 'MENGERJAKAN', started_at = ?, session_id = ? WHERE id = ?",
    ).run(startedAt, currentSessionId, participant.id);

    if (!participant.started_at) {
      logExamEvent(db, exam.exam_id, req.authUser!.user_id, 'EXAM_START', 'Peserta memulai ujian.');
    } else if (recoverSession) {
      logExamEvent(db, exam.exam_id, req.authUser!.user_id, 'SESSION_RECOVER', 'Peserta memulihkan sesi ujian.');
    }

    const startMs = new Date(startedAt).getTime();
    const durationEndMs = startMs + exam.duration * 60 * 1000;
    const hardEndMs = Math.min(durationEndMs, new Date(exam.end_time).getTime());
    const remainingSeconds = Math.max(0, Math.floor((hardEndMs - Date.now()) / 1000));

    if (remainingSeconds <= 0) {
      const result = finalizeParticipantSubmission(db, exam, req.authUser!.user_id, 'AUTO_TIME_UP');
      res.json({ locked: true, auto_submitted: true, result });
      return;
    }

    // Load questions WITHOUT correct_answer or explanation!
    const rawQuestions = db
      .prepare(
        `SELECT q.question_id, q.question_type, q.question_text, q.options_json, q.image_url,
                q.category, q.materi, q.difficulty, eq.score as exam_score, eq.question_order
         FROM EXAM_QUESTIONS eq
         JOIN QUESTIONS q ON q.question_id = eq.question_id
         WHERE eq.exam_id = ?
         ORDER BY eq.question_order ASC`,
      )
      .all(exam.exam_id) as Array<{
      question_id: string;
      question_type: string;
      question_text: string;
      options_json: string;
      image_url: string;
      category: string;
      materi: string;
      difficulty: string;
      exam_score: number;
      question_order: number;
    }>;

    // Deterministic order per student if shuffle_questions is enabled
    let orderedQuestions = rawQuestions.map((q) => {
      const opts = safeJsonParse<QuestionOptionsPayload>(q.options_json, {});
      // For ordering/matching, shuffle choices deterministically for display without exposing answer
      return {
        question_id: q.question_id,
        question_type: q.question_type,
        question_text: q.question_text,
        options: opts,
        image_url: q.image_url,
        category: q.category,
        materi: q.materi,
        difficulty: q.difficulty,
        score: q.exam_score,
        question_order: q.question_order,
      };
    });

    if (settings.shuffle_questions) {
      orderedQuestions = [...orderedQuestions].sort((a, b) => {
        const ha = crypto
          .createHash('md5')
          .update(`${req.authUser!.user_id}:${a.question_id}`)
          .digest('hex');
        const hb = crypto
          .createHash('md5')
          .update(`${req.authUser!.user_id}:${b.question_id}`)
          .digest('hex');
        return ha.localeCompare(hb);
      });
    }

    const savedAnswers = db
      .prepare('SELECT question_id, answer_json, is_doubtful, saved_at FROM ANSWERS WHERE exam_id = ? AND user_id = ?')
      .all(exam.exam_id, req.authUser!.user_id);

    const violationsCount = (
      db
        .prepare('SELECT COUNT(*) as c FROM VIOLATION_LOGS WHERE exam_id = ? AND user_id = ?')
        .get(exam.exam_id, req.authUser!.user_id) as { c: number }
    ).c;

    res.json({
      locked: false,
      exam: {
        exam_id: exam.exam_id,
        title: exam.title,
        description: exam.description,
        subject: exam.subject,
        duration: exam.duration,
        settings,
      },
      started_at: startedAt,
      server_time: nowIso(),
      expires_at: new Date(hardEndMs).toISOString(),
      remaining_seconds: remainingSeconds,
      questions: orderedQuestions,
      saved_answers: savedAnswers,
      violations_count: violationsCount,
    });
  });

  router.get('/cbt/exams/:examId/timer', requireAuth, requireRole('SISWA'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    const participant = db
      .prepare('SELECT * FROM EXAM_PARTICIPANTS WHERE exam_id = ? AND user_id = ?')
      .get(req.params.examId, req.authUser!.user_id) as
      | { status: string; started_at: string; session_id: string }
      | undefined;

    if (!exam || !participant) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
      return;
    }

    if (participant.status === 'TERKUMPUL' || participant.status === 'DIHENTIKAN') {
      res.json({ locked: true, remaining_seconds: 0, status: participant.status });
      return;
    }

    const startMs = new Date(participant.started_at || nowIso()).getTime();
    const hardEndMs = Math.min(
      startMs + exam.duration * 60 * 1000,
      new Date(exam.end_time).getTime(),
    );
    const remainingSeconds = Math.max(0, Math.floor((hardEndMs - Date.now()) / 1000));

    if (remainingSeconds <= 0) {
      finalizeParticipantSubmission(db, exam, req.authUser!.user_id, 'AUTO_TIME_UP');
      res.json({ locked: true, auto_submitted: true, remaining_seconds: 0 });
      return;
    }

    res.json({
      locked: false,
      remaining_seconds: remainingSeconds,
      server_time: nowIso(),
      session_conflict:
        Boolean(participant.session_id) && participant.session_id !== req.authSessionId,
    });
  });

  router.post('/cbt/exams/:examId/answer', requireAuth, requireRole('SISWA'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    const participant = db
      .prepare('SELECT * FROM EXAM_PARTICIPANTS WHERE exam_id = ? AND user_id = ?')
      .get(req.params.examId, req.authUser!.user_id) as
      | { status: string; started_at: string }
      | undefined;

    if (!exam || !participant) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
      return;
    }
    if (participant.status === 'TERKUMPUL' || participant.status === 'DIHENTIKAN') {
      res.status(423).json({ error: 'Ujian sudah dikumpulkan dan terkunci.', locked: true });
      return;
    }

    const startMs = new Date(participant.started_at).getTime();
    const hardEndMs = Math.min(startMs + exam.duration * 60 * 1000, new Date(exam.end_time).getTime());
    if (Date.now() > hardEndMs + 5000) {
      finalizeParticipantSubmission(db, exam, req.authUser!.user_id, 'AUTO_TIME_UP');
      res.status(423).json({ error: 'Waktu ujian telah habis dan jawaban dikumpulkan otomatis.', locked: true });
      return;
    }

    const questionId = String(req.body?.question_id ?? '');
    if (!questionId) {
      res.status(400).json({ error: 'question_id wajib disertakan.' });
      return;
    }

    const answerJson = JSON.stringify(req.body?.answer ?? null);
    const isDoubtful = req.body?.is_doubtful ? 1 : 0;
    const savedAt = nowIso();

    db.prepare(
      `INSERT INTO ANSWERS (answer_id, exam_id, user_id, question_id, answer_json, is_doubtful, saved_at, score)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(exam_id, user_id, question_id) DO UPDATE SET
         answer_json = excluded.answer_json,
         is_doubtful = excluded.is_doubtful,
         saved_at = excluded.saved_at`,
    ).run(uid('ans'), exam.exam_id, req.authUser!.user_id, questionId, answerJson, isDoubtful, savedAt);

    res.json({ ok: true, saved_at: savedAt });
  });

  router.post('/cbt/exams/:examId/violation', requireAuth, requireRole('SISWA'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const eventType = String(req.body?.event_type ?? 'TAB_SWITCH');
    const description = String(req.body?.description ?? '');
    db.prepare(
      'INSERT INTO VIOLATION_LOGS (log_id, exam_id, user_id, event_type, event_time, description) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(uid('vio'), req.params.examId, req.authUser!.user_id, eventType, nowIso(), description);

    const count = (
      db
        .prepare('SELECT COUNT(*) as c FROM VIOLATION_LOGS WHERE exam_id = ? AND user_id = ?')
        .get(req.params.examId, req.authUser!.user_id) as { c: number }
    ).c;

    res.json({ ok: true, total_violations: count });
  });

  router.post('/cbt/exams/:examId/submit', requireAuth, requireRole('SISWA'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    // Persist any final pending answer payload if sent alongside submit
    if (Array.isArray(req.body?.pending_answers)) {
      const upsert = db.prepare(
        `INSERT INTO ANSWERS (answer_id, exam_id, user_id, question_id, answer_json, is_doubtful, saved_at, score)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(exam_id, user_id, question_id) DO UPDATE SET
           answer_json = excluded.answer_json,
           is_doubtful = excluded.is_doubtful,
           saved_at = excluded.saved_at`,
      );
      for (const pa of req.body.pending_answers) {
        if (pa?.question_id) {
          upsert.run(
            uid('ans'),
            exam.exam_id,
            req.authUser!.user_id,
            String(pa.question_id),
            JSON.stringify(pa.answer ?? null),
            pa.is_doubtful ? 1 : 0,
            nowIso(),
          );
        }
      }
    }

    const reason = req.body?.auto_submit ? 'AUTO_TIME_UP' : 'MANUAL_SUBMIT';
    const result = finalizeParticipantSubmission(db, exam, req.authUser!.user_id, reason);
    bumpSyncVersion(db, 'results');
    bumpSyncVersion(db, 'exams');
    res.json({ ok: true, result });
  });

  // 9. Live Exam Monitoring & Violations
  router.get('/monitoring/:examId', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    const participants = db
      .prepare(
        `SELECT ep.*, u.username, u.nama, u.kelas,
                (SELECT COUNT(*) FROM VIOLATION_LOGS v WHERE v.exam_id = ep.exam_id AND v.user_id = ep.user_id) as violation_count,
                (SELECT COUNT(*) FROM ANSWERS a WHERE a.exam_id = ep.exam_id AND a.user_id = ep.user_id AND a.answer_json != 'null') as answered_count
         FROM EXAM_PARTICIPANTS ep
         JOIN USERS u ON u.user_id = ep.user_id
         WHERE ep.exam_id = ?
         ORDER BY u.nama ASC`,
      )
      .all(exam.exam_id) as Array<Record<string, unknown>>;

    const enriched = participants.map((p) => {
      let remainingSeconds = exam.duration * 60;
      if (p.started_at && (p.status === 'MENGERJAKAN' || p.status === 'GANGGUAN')) {
        const startMs = new Date(String(p.started_at)).getTime();
        const hardEndMs = Math.min(
          startMs + exam.duration * 60 * 1000,
          new Date(exam.end_time).getTime(),
        );
        remainingSeconds = Math.max(0, Math.floor((hardEndMs - Date.now()) / 1000));
      } else if (p.status === 'TERKUMPUL' || p.status === 'DIHENTIKAN') {
        remainingSeconds = 0;
      }
      return { ...p, remaining_seconds: remainingSeconds };
    });

    const violations = db
      .prepare(
        `SELECT v.*, u.nama, u.username, u.kelas
         FROM VIOLATION_LOGS v
         JOIN USERS u ON u.user_id = v.user_id
         WHERE v.exam_id = ?
         ORDER BY v.event_time DESC`,
      )
      .all(exam.exam_id);

    res.json({ exam, participants: enriched, violations });
  });

  router.post('/monitoring/:examId/action', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const targetUserId = String(req.body?.user_id ?? '');
    const action = String(req.body?.action ?? '');
    const note = String(req.body?.note ?? '');

    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!exam || !targetUserId) {
      res.status(400).json({ error: 'Ujian atau peserta tidak valid.' });
      return;
    }

    if (action === 'WARN') {
      createNotification(
        db,
        targetUserId,
        'Peringatan Pengawas Ujian',
        note || `Mohon tetap fokus pada halaman ujian "${exam.title}". Aktivitas Anda tercatat oleh pengawas.`,
      );
      logExamEvent(db, exam.exam_id, targetUserId, 'PROCTOR_WARNING', note || 'Peringatan pengawas dikirim');
    } else if (action === 'FLAG_REVIEW') {
      db.prepare("UPDATE EXAM_PARTICIPANTS SET status = 'GANGGUAN' WHERE exam_id = ? AND user_id = ?").run(
        exam.exam_id,
        targetUserId,
      );
      logExamEvent(db, exam.exam_id, targetUserId, 'FLAGGED_FOR_REVIEW', note || 'Ditandai untuk pemeriksaan');
    } else if (action === 'FORCE_FINISH') {
      finalizeParticipantSubmission(db, exam, targetUserId, 'ADMIN_FORCE_STOP');
      createNotification(
        db,
        targetUserId,
        'Ujian Diakhiri oleh Pengawas',
        note || `Sesi ujian "${exam.title}" telah diakhiri secara manual oleh pengawas.`,
      );
    } else if (action === 'RESET_ATTEMPT') {
      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare(
          "UPDATE EXAM_PARTICIPANTS SET status = 'BELUM_MULAI', started_at = '', submitted_at = '', score = 0, session_id = '' WHERE exam_id = ? AND user_id = ?",
        ).run(exam.exam_id, targetUserId);
        db.prepare('DELETE FROM ANSWERS WHERE exam_id = ? AND user_id = ?').run(exam.exam_id, targetUserId);
        db.prepare('DELETE FROM RESULTS WHERE exam_id = ? AND user_id = ?').run(exam.exam_id, targetUserId);
        db.prepare('DELETE FROM ESSAY_GRADES WHERE exam_id = ? AND user_id = ?').run(exam.exam_id, targetUserId);
        logExamEvent(db, exam.exam_id, targetUserId, 'RESET_ATTEMPT', note || 'Sesi ujian direset oleh admin/pengawas.');
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    } else {
      logExamEvent(db, exam.exam_id, targetUserId, 'ADMIN_NOTE', note);
    }

    logAudit(db, req.authUser!.user_id, `MONITOR_${action}`, {
      exam_id: exam.exam_id,
      target_user_id: targetUserId,
      note,
    });
    res.json({ ok: true });
  });

  // 10. Essay Grading
  router.get('/grading/essays', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req, res) => {
    const db = getDb();
    const examId = String(req.query.exam_id ?? '');
    let sql = `
      SELECT a.answer_id, a.exam_id, a.user_id, a.question_id, a.answer_json, a.saved_at,
             q.question_text, q.options_json, eq.score as max_score,
             e.title as exam_title, u.nama as student_name, u.kelas as student_kelas, u.username,
             eg.grade_id, eg.score as graded_score, eg.feedback, eg.graded_at
      FROM ANSWERS a
      JOIN QUESTIONS q ON q.question_id = a.question_id
      JOIN EXAMS e ON e.exam_id = a.exam_id
      JOIN EXAM_QUESTIONS eq ON eq.exam_id = a.exam_id AND eq.question_id = a.question_id
      JOIN EXAM_PARTICIPANTS ep ON ep.exam_id = a.exam_id AND ep.user_id = a.user_id
      JOIN USERS u ON u.user_id = a.user_id
      LEFT JOIN ESSAY_GRADES eg ON eg.exam_id = a.exam_id AND eg.question_id = a.question_id AND eg.user_id = a.user_id
      WHERE q.question_type = 'ESAI' AND ep.status IN ('TERKUMPUL', 'DIHENTIKAN')
    `;
    const params: string[] = [];
    if (examId) {
      sql += ' AND a.exam_id = ?';
      params.push(examId);
    }
    sql += ' ORDER BY eg.grade_id IS NULL DESC, a.saved_at DESC';
    const items = db.prepare(sql).all(...params);
    res.json({ essays: items });
  });

  router.post('/grading/essays', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const examId = String(req.body?.exam_id ?? '');
    const questionId = String(req.body?.question_id ?? '');
    const userId = String(req.body?.user_id ?? '');
    const score = Number(req.body?.score ?? 0);
    const feedback = String(req.body?.feedback ?? '');

    const eq = db
      .prepare('SELECT score FROM EXAM_QUESTIONS WHERE exam_id = ? AND question_id = ?')
      .get(examId, questionId) as { score: number } | undefined;

    if (!eq) {
      res.status(404).json({ error: 'Soal ujian tidak ditemukan.' });
      return;
    }

    const boundedScore = Math.max(0, Math.min(eq.score, score));
    const gradedAt = nowIso();

    db.prepare(
      `INSERT INTO ESSAY_GRADES (grade_id, exam_id, question_id, user_id, score, feedback, graded_by, graded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(exam_id, question_id, user_id) DO UPDATE SET
         score = excluded.score,
         feedback = excluded.feedback,
         graded_by = excluded.graded_by,
         graded_at = excluded.graded_at`,
    ).run(uid('eg'), examId, questionId, userId, boundedScore, feedback, req.authUser!.user_id, gradedAt);

    db.prepare(
      'UPDATE ANSWERS SET score = ? WHERE exam_id = ? AND question_id = ? AND user_id = ?',
    ).run(boundedScore, examId, questionId, userId);

    recalculateExamResultForStudent(db, examId, userId);
    bumpSyncVersion(db, 'results');
    logAudit(db, req.authUser!.user_id, 'ESSAY_GRADED', {
      exam_id: examId,
      question_id: questionId,
      student_id: userId,
      score: boundedScore,
    });
    res.json({ ok: true, score: boundedScore });
  });

  // 11. Results, Score Correction, Publication & Student Result Detail
  router.get('/results/:examId', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    const maxScoreRow = db
      .prepare('SELECT COALESCE(SUM(score), 0) as max_score FROM EXAM_QUESTIONS WHERE exam_id = ?')
      .get(exam.exam_id) as { max_score: number };
    const maxScore = maxScoreRow.max_score || 100;

    if (req.authUser!.role === 'SISWA') {
      const r = db
        .prepare('SELECT * FROM RESULTS WHERE exam_id = ? AND user_id = ?')
        .get(exam.exam_id, req.authUser!.user_id) as Record<string, unknown> | undefined;

      if (!r || Number(r.published) !== 1) {
        res.status(403).json({ error: 'Hasil ujian ini belum dipublikasikan oleh pembina.' });
        return;
      }

      const part = db
        .prepare('SELECT started_at, submitted_at FROM EXAM_PARTICIPANTS WHERE exam_id = ? AND user_id = ?')
        .get(exam.exam_id, req.authUser!.user_id) as { started_at: string; submitted_at: string } | undefined;

      const settings = safeJsonParse<ExamSettings>(exam.settings_json, {} as ExamSettings);
      const breakdown = settings.show_explanation_after_publish
        ? db
            .prepare(
              `SELECT q.question_id, q.question_type, q.question_text, q.explanation, eq.score as max_score,
                      a.answer_json, a.score as earned_score, eg.feedback as essay_feedback
               FROM EXAM_QUESTIONS eq
               JOIN QUESTIONS q ON q.question_id = eq.question_id
               LEFT JOIN ANSWERS a ON a.exam_id = eq.exam_id AND a.question_id = eq.question_id AND a.user_id = ?
               LEFT JOIN ESSAY_GRADES eg ON eg.exam_id = eq.exam_id AND eg.question_id = eq.question_id AND eg.user_id = ?
               WHERE eq.exam_id = ?
               ORDER BY eq.question_order ASC`,
            )
            .all(req.authUser!.user_id, req.authUser!.user_id, exam.exam_id)
        : [];

      res.json({ exam, max_score: maxScore, result: r, participant: part, breakdown });
      return;
    }

    const rows = db
      .prepare(
        `SELECT r.*, u.username, u.nama, u.kelas, ep.started_at, ep.submitted_at, ep.status as participant_status
         FROM RESULTS r
         JOIN USERS u ON u.user_id = r.user_id
         LEFT JOIN EXAM_PARTICIPANTS ep ON ep.exam_id = r.exam_id AND ep.user_id = r.user_id
         WHERE r.exam_id = ?
         ORDER BY r.total_score DESC`,
      )
      .all(exam.exam_id);

    res.json({ exam, max_score: maxScore, results: rows });
  });

  router.post('/results/:examId/publish', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const published = req.body?.published ? 1 : 0;
    db.prepare('UPDATE RESULTS SET published = ? WHERE exam_id = ?').run(published, req.params.examId);
    bumpSyncVersion(db, 'results');
    logAudit(db, req.authUser!.user_id, published ? 'RESULTS_PUBLISH' : 'RESULTS_UNPUBLISH', {
      exam_id: req.params.examId,
    });
    res.json({ ok: true, published });
  });

  router.post('/results/:examId/correct', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const userId = String(req.body?.user_id ?? '');
    const newScore = Number(req.body?.new_score ?? 0);
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) {
      res.status(400).json({ error: 'Alasan koreksi nilai wajib diisi untuk audit log.' });
      return;
    }
    const existing = db
      .prepare('SELECT total_score FROM RESULTS WHERE exam_id = ? AND user_id = ?')
      .get(req.params.examId, userId) as { total_score: number } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Data hasil ujian tidak ditemukan.' });
      return;
    }
    db.prepare('UPDATE RESULTS SET total_score = ?, graded_at = ? WHERE exam_id = ? AND user_id = ?').run(
      newScore,
      nowIso(),
      req.params.examId,
      userId,
    );
    db.prepare('UPDATE EXAM_PARTICIPANTS SET score = ? WHERE exam_id = ? AND user_id = ?').run(
      newScore,
      req.params.examId,
      userId,
    );
    bumpSyncVersion(db, 'results');
    logAudit(db, req.authUser!.user_id, 'SCORE_CORRECTION', {
      exam_id: req.params.examId,
      student_id: userId,
      old_score: existing.total_score,
      new_score: newScore,
      reason,
    });
    res.json({ ok: true });
  });

  // 12. Leaderboard
  router.get('/leaderboard/:examId', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    const settings = safeJsonParse<ExamSettings>(exam.settings_json, {} as ExamSettings);
    if (req.authUser!.role === 'SISWA' && !settings.show_leaderboard) {
      res.status(403).json({ error: 'Leaderboard dinonaktifkan untuk ujian ini.' });
      return;
    }

    const maxScoreRow = db
      .prepare('SELECT COALESCE(SUM(score), 0) as max_score FROM EXAM_QUESTIONS WHERE exam_id = ?')
      .get(exam.exam_id) as { max_score: number };
    const maxScore = maxScoreRow.max_score || 100;

    const rows = db
      .prepare(
        `SELECT r.user_id, r.total_score, r.published, u.nama, u.kelas, ep.started_at, ep.submitted_at
         FROM RESULTS r
         JOIN USERS u ON u.user_id = r.user_id
         LEFT JOIN EXAM_PARTICIPANTS ep ON ep.exam_id = r.exam_id AND ep.user_id = r.user_id
         WHERE r.exam_id = ? ${req.authUser!.role === 'SISWA' ? 'AND r.published = 1' : ''}`,
      )
      .all(exam.exam_id) as Array<{
      user_id: string;
      total_score: number;
      published: number;
      nama: string;
      kelas: string;
      started_at: string;
      submitted_at: string;
    }>;

    const entries = rows.map((r, idx) => {
      const durSec =
        r.started_at && r.submitted_at
          ? Math.max(
              1,
              Math.round((new Date(r.submitted_at).getTime() - new Date(r.started_at).getTime()) / 1000),
            )
          : exam.duration * 60;
      const maskName =
        req.authUser!.role === 'SISWA' &&
        settings.leaderboard_anonymous &&
        r.user_id !== req.authUser!.user_id;
      return {
        user_id: r.user_id,
        nama: maskName ? `Peserta #${idx + 1}` : r.nama,
        kelas: maskName ? '—' : r.kelas,
        total_score: Number(r.total_score.toFixed(2)),
        max_score: maxScore,
        percentage: Number(((r.total_score / maxScore) * 100).toFixed(1)),
        duration_seconds: durSec,
      };
    });

    const ranked = computeLeaderboardRanks(entries);
    res.json({ exam, leaderboard: ranked });
  });

  // 13. Item Analysis & Reports / Berita Acara
  router.get('/analytics/:examId', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    const questions = db
      .prepare(
        `SELECT q.*, eq.score as exam_score
         FROM EXAM_QUESTIONS eq
         JOIN QUESTIONS q ON q.question_id = eq.question_id
         WHERE eq.exam_id = ?
         ORDER BY eq.question_order ASC`,
      )
      .all(exam.exam_id) as unknown as Array<QuestionRecord & { exam_score: number }>;

    const results = db
      .prepare('SELECT user_id, total_score FROM RESULTS WHERE exam_id = ?')
      .all(exam.exam_id) as Array<{ user_id: string; total_score: number }>;

    const answers = db
      .prepare('SELECT user_id, question_id, answer_json, score FROM ANSWERS WHERE exam_id = ?')
      .all(exam.exam_id) as Array<{ user_id: string; question_id: string; answer_json: string; score: number }>;

    const analysis = computeItemAnalysis(questions, results, answers);
    res.json({ exam, total_respondents: results.length, analysis });
  });

  router.get('/reports/:examId/berita-acara', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as
      | ExamRecord
      | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    const settings = getSettingsMap(db);
    const participants = db
      .prepare('SELECT status FROM EXAM_PARTICIPANTS WHERE exam_id = ?')
      .all(exam.exam_id) as Array<{ status: string }>;

    const totalRegistered = participants.length;
    const finished = participants.filter((p) => p.status === 'TERKUMPUL' || p.status === 'DIHENTIKAN').length;
    const present = participants.filter((p) => p.status !== 'BELUM_MULAI').length;
    const absent = totalRegistered - present;
    const technicalIssues = participants.filter((p) => p.status === 'GANGGUAN').length;

    const violationSummary = db
      .prepare(
        `SELECT v.event_type, COUNT(*) as count
         FROM VIOLATION_LOGS v WHERE v.exam_id = ? GROUP BY v.event_type`,
      )
      .all(exam.exam_id);

    const creator = db
      .prepare('SELECT nama FROM USERS WHERE user_id = ?')
      .get(exam.created_by) as { nama: string } | undefined;

    res.json({
      exam,
      identity: {
        app_name: settings.app_name,
        org_name: settings.org_name,
        school_name: settings.school_name,
        logo_url: settings.logo_url,
        academic_year: settings.academic_year,
        report_footer: settings.report_footer,
      },
      summary: {
        registered: totalRegistered,
        present,
        absent,
        finished,
        technical_issues: technicalIssues,
        violations: violationSummary,
        supervisor_name: creator?.nama ?? 'Pembina KIR IPA',
        generated_at: nowIso(),
      },
    });
  });

  // 13B. Rekapitulasi Jawaban Peserta per Soal, Rekap Semua Ujian, & Live Document Context
  router.get('/reports/all-results', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const globalAccess = req.authUser!.role === 'SUPER_ADMIN' || canProfessorAccessAll(db);
    let sql = `
      SELECT r.*, e.title as exam_title, e.subject as exam_subject, e.start_time,
             u.username, u.nama, u.kelas, ep.started_at, ep.submitted_at, ep.status as participant_status,
             COALESCE((SELECT SUM(score) FROM EXAM_QUESTIONS eq WHERE eq.exam_id = e.exam_id), 100) as max_score
      FROM RESULTS r
      JOIN EXAMS e ON e.exam_id = r.exam_id
      JOIN USERS u ON u.user_id = r.user_id
      LEFT JOIN EXAM_PARTICIPANTS ep ON ep.exam_id = r.exam_id AND ep.user_id = r.user_id
      WHERE 1=1
    `;
    const params: string[] = [];
    if (!globalAccess) {
      sql += ' AND e.created_by = ?';
      params.push(req.authUser!.user_id);
    }
    sql += ' ORDER BY e.start_time DESC, r.total_score DESC';
    const rows = db.prepare(sql).all(...params);
    res.json({ results: rows });
  });

  router.get('/reports/:examId/answers-recap', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as ExamRecord | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    const questions = db
      .prepare(
        `SELECT q.question_id, q.question_type, q.question_text, q.correct_answer, eq.question_order, eq.score as max_score
         FROM EXAM_QUESTIONS eq
         JOIN QUESTIONS q ON q.question_id = eq.question_id
         WHERE eq.exam_id = ?
         ORDER BY eq.question_order ASC`,
      )
      .all(exam.exam_id) as Array<{
      question_id: string;
      question_type: string;
      question_text: string;
      correct_answer: string;
      question_order: number;
      max_score: number;
    }>;

    const participants = db
      .prepare(
        `SELECT ep.user_id, ep.status as participant_status, ep.started_at, ep.submitted_at, ep.score as participant_score,
                u.username, u.nama, u.kelas,
                r.correct_count, r.incorrect_count, r.unanswered_count, r.total_score, r.published
         FROM EXAM_PARTICIPANTS ep
         JOIN USERS u ON u.user_id = ep.user_id
         LEFT JOIN RESULTS r ON r.exam_id = ep.exam_id AND r.user_id = ep.user_id
         WHERE ep.exam_id = ?
         ORDER BY COALESCE(r.total_score, 0) DESC, u.nama ASC`,
      )
      .all(exam.exam_id) as Array<Record<string, unknown>>;

    const answers = db
      .prepare(
        'SELECT user_id, question_id, answer_json, is_doubtful, saved_at, score FROM ANSWERS WHERE exam_id = ?',
      )
      .all(exam.exam_id) as Array<{
      user_id: string;
      question_id: string;
      answer_json: string;
      is_doubtful: number;
      saved_at: string;
      score: number;
    }>;

    const answerLookup = new Map<string, typeof answers[number]>();
    for (const a of answers) {
      answerLookup.set(`${a.user_id}:${a.question_id}`, a);
    }

    const recapRows: Array<Record<string, unknown>> = [];
    for (const p of participants) {
      for (const q of questions) {
        const ans = answerLookup.get(`${String(p.user_id)}:${q.question_id}`);
        const parsedVal = ans ? safeJsonParse<unknown>(ans.answer_json, null) : null;
        const formattedAnswer =
          parsedVal === null || parsedVal === undefined
            ? ''
            : Array.isArray(parsedVal)
              ? parsedVal.join(', ')
              : typeof parsedVal === 'object'
                ? JSON.stringify(parsedVal)
                : String(parsedVal);
        recapRows.push({
          user_id: p.user_id,
          username: p.username,
          nama: p.nama,
          kelas: p.kelas,
          participant_status: p.participant_status,
          question_order: q.question_order,
          question_id: q.question_id,
          question_type: q.question_type,
          question_text_plain: q.question_text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          student_answer: formattedAnswer,
          correct_answer: q.correct_answer,
          earned_score: ans ? Number(ans.score) : 0,
          max_score: Number(q.max_score),
          is_doubtful: ans ? Boolean(ans.is_doubtful) : false,
          saved_at: ans?.saved_at || '',
        });
      }
    }

    res.json({ exam, questions, participants, recap_rows: recapRows });
  });

  router.get('/reports/:examId/live-context', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req, res) => {
    const db = getDb();
    const exam = db.prepare('SELECT * FROM EXAMS WHERE exam_id = ?').get(req.params.examId) as ExamRecord | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    const settings = getSettingsMap(db);
    const examSettings = safeJsonParse<ExamSettings>(exam.settings_json, {} as ExamSettings);
    const maxScoreRow = db
      .prepare('SELECT COALESCE(SUM(score), 0) as max_score FROM EXAM_QUESTIONS WHERE exam_id = ?')
      .get(exam.exam_id) as { max_score: number };
    const maxScore = maxScoreRow.max_score || 100;

    const participants = db
      .prepare(
        `SELECT ep.*, u.username, u.nama, u.kelas
         FROM EXAM_PARTICIPANTS ep
         JOIN USERS u ON u.user_id = ep.user_id
         WHERE ep.exam_id = ?
         ORDER BY u.nama ASC`,
      )
      .all(exam.exam_id) as Array<Record<string, unknown>>;

    const results = db
      .prepare(
        `SELECT r.*, u.username, u.nama, u.kelas, ep.started_at, ep.submitted_at, ep.status as participant_status
         FROM RESULTS r
         JOIN USERS u ON u.user_id = r.user_id
         LEFT JOIN EXAM_PARTICIPANTS ep ON ep.exam_id = r.exam_id AND ep.user_id = r.user_id
         WHERE r.exam_id = ?
         ORDER BY r.total_score DESC`,
      )
      .all(exam.exam_id) as Array<Record<string, unknown>>;

    const violations = db
      .prepare(
        `SELECT v.*, u.nama, u.username, u.kelas
         FROM VIOLATION_LOGS v
         JOIN USERS u ON u.user_id = v.user_id
         WHERE v.exam_id = ?
         ORDER BY v.event_time DESC`,
      )
      .all(exam.exam_id) as Array<Record<string, unknown>>;

    const violationSummary = db
      .prepare('SELECT event_type, COUNT(*) as count FROM VIOLATION_LOGS WHERE exam_id = ? GROUP BY event_type')
      .all(exam.exam_id) as Array<{ event_type: string; count: number }>;

    const creator = db
      .prepare('SELECT nama FROM USERS WHERE user_id = ?')
      .get(exam.created_by) as { nama: string } | undefined;

    const leaderboardEntries = results.map((r) => {
      const durSec =
        r.started_at && r.submitted_at
          ? Math.max(1, Math.round((new Date(String(r.submitted_at)).getTime() - new Date(String(r.started_at)).getTime()) / 1000))
          : exam.duration * 60;
      const total = Number(r.total_score || 0);
      return {
        user_id: String(r.user_id),
        nama: String(r.nama),
        kelas: String(r.kelas || '—'),
        total_score: Number(total.toFixed(2)),
        max_score: maxScore,
        percentage: Number(((total / maxScore) * 100).toFixed(1)),
        duration_seconds: durSec,
      };
    });

    const leaderboard = computeLeaderboardRanks(leaderboardEntries);
    const passingGrade = Number(examSettings.passing_grade ?? 75);
    const winners = buildDefaultWinnerRows(leaderboard, passingGrade);

    const scores = results.map((r) => Number(r.total_score || 0));
    const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const passedCount = leaderboard.filter((l) => l.percentage >= passingGrade).length;

    const registeredCount = participants.length;
    const completedCount = participants.filter((p) => p.status === 'TERKUMPUL' || p.status === 'DIHENTIKAN').length;
    const attendedCount = participants.filter((p) => p.status !== 'BELUM_MULAI').length;
    const absentCount = registeredCount - attendedCount;
    const technicalIssuesCount = participants.filter((p) => p.status === 'GANGGUAN').length;

    const variables = computeDocumentVariables({
      exam,
      settings,
      registeredCount,
      attendedCount,
      absentCount,
      completedCount,
      technicalIssuesCount,
      highestScore,
      lowestScore,
      averageScore,
      passingGrade,
      passedCount,
      violationsCount: violations.length,
      supervisorName: creator?.nama ?? 'Pembina KIR IPA',
      winners,
    });

    res.json({
      exam,
      max_score: maxScore,
      passing_grade: passingGrade,
      settings,
      variables,
      summary: {
        registered: registeredCount,
        present: attendedCount,
        absent: absentCount,
        finished: completedCount,
        technical_issues: technicalIssuesCount,
        highest_score: Number(highestScore.toFixed(2)),
        lowest_score: Number(lowestScore.toFixed(2)),
        average_score: Number(averageScore.toFixed(2)),
        passed_count: passedCount,
        violations_count: violations.length,
        violation_summary: violationSummary,
        supervisor_name: creator?.nama ?? 'Pembina KIR IPA',
      },
      results,
      leaderboard,
      winners,
      violations,
      participants,
    });
  });

  // 13C. Report Templates CRUD (Editable Report Format / Berita Acara / Pengumuman Pemenang)
  function sanitizeDocumentPayload(rawPayload: unknown, fallbackSettings: ReturnType<typeof getSettingsMap>): string {
    const p = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as Partial<DocumentContentPayload>;
    const sanitizedSections = Array.isArray(p.sections)
      ? p.sections.map((s) => ({
          ...s,
          title: String(s.title ?? ''),
          content: sanitizeRichHtml(String(s.content ?? '')),
          infoRows: Array.isArray(s.infoRows)
            ? s.infoRows.map((row) => ({ label: String(row.label ?? ''), value: String(row.value ?? '') }))
            : undefined,
        }))
      : [];

    const cleaned: Partial<DocumentContentPayload> = {
      ...p,
      letterhead: p.letterhead
        ? {
            ...p.letterhead,
            logoUrl: sanitizeLogoUrl(p.letterhead.logoUrl || fallbackSettings.logo_url),
          }
        : undefined,
      sections: sanitizedSections,
    };
    return JSON.stringify(cleaned);
  }

  router.get('/report-templates', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req, res) => {
    const db = getDb();
    ensureDefaultReportTemplates(db, false);
    const category = String(req.query.doc_category ?? '').trim();
    let sql = 'SELECT * FROM REPORT_TEMPLATES WHERE 1=1';
    const params: string[] = [];
    if (category) {
      sql += ' AND doc_category = ?';
      params.push(category);
    }
    sql += ' ORDER BY is_default DESC, updated_at DESC';
    const templates = db.prepare(sql).all(...params);
    res.json({ templates });
  });

  router.post('/report-templates', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    const docCategory = String(b.doc_category ?? 'LAPORAN_HASIL') as DocumentCategory;
    if (!name || !['LAPORAN_HASIL', 'BERITA_ACARA', 'PENGUMUMAN_PEMENANG'].includes(docCategory)) {
      res.status(400).json({ error: 'Nama dan kategori template wajib valid.' });
      return;
    }

    const templateId = uid('tpl');
    const ts = nowIso();
    const settings = getSettingsMap(db);
    const contentJson = sanitizeDocumentPayload(
      typeof b.content === 'string' ? safeJsonParse(b.content, {}) : b.content ?? safeJsonParse(b.content_json, {}),
      settings,
    );

    db.prepare(
      `INSERT INTO REPORT_TEMPLATES (template_id, name, doc_category, exam_id, is_default, content_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    ).run(templateId, name, docCategory, String(b.exam_id ?? ''), contentJson, req.authUser!.user_id, ts, ts);

    bumpSyncVersion(db, 'documents');
    logAudit(db, req.authUser!.user_id, 'REPORT_TEMPLATE_CREATE', { template_id: templateId, name, doc_category: docCategory });
    const created = db.prepare('SELECT * FROM REPORT_TEMPLATES WHERE template_id = ?').get(templateId);
    res.status(201).json({ template: created });
  });

  router.put('/report-templates/:templateId', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM REPORT_TEMPLATES WHERE template_id = ?')
      .get(req.params.templateId) as { template_id: string; name: string; exam_id: string; content_json: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Template laporan tidak ditemukan.' });
      return;
    }
    const b = req.body ?? {};
    const settings = getSettingsMap(db);
    const nextName = String(b.name ?? existing.name).trim() || existing.name;
    const nextExamId = b.exam_id !== undefined ? String(b.exam_id) : existing.exam_id;
    const nextContent =
      b.content !== undefined || b.content_json !== undefined
        ? sanitizeDocumentPayload(
            typeof b.content === 'string'
              ? safeJsonParse(b.content, {})
              : b.content ?? safeJsonParse(b.content_json, {}),
            settings,
          )
        : existing.content_json;

    db.prepare(
      'UPDATE REPORT_TEMPLATES SET name = ?, exam_id = ?, content_json = ?, updated_at = ? WHERE template_id = ?',
    ).run(nextName, nextExamId, nextContent, nowIso(), existing.template_id);

    bumpSyncVersion(db, 'documents');
    logAudit(db, req.authUser!.user_id, 'REPORT_TEMPLATE_UPDATE', { template_id: existing.template_id, name: nextName });
    const updated = db.prepare('SELECT * FROM REPORT_TEMPLATES WHERE template_id = ?').get(existing.template_id);
    res.json({ template: updated });
  });

  router.post('/report-templates/:templateId/duplicate', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const src = db
      .prepare('SELECT * FROM REPORT_TEMPLATES WHERE template_id = ?')
      .get(req.params.templateId) as { template_id: string; name: string; doc_category: string; exam_id: string; content_json: string } | undefined;
    if (!src) {
      res.status(404).json({ error: 'Template sumber tidak ditemukan.' });
      return;
    }
    const newId = uid('tpl');
    const ts = nowIso();
    const copyName = String(req.body?.name ?? `${src.name} (Salinan)`).trim();
    db.prepare(
      `INSERT INTO REPORT_TEMPLATES (template_id, name, doc_category, exam_id, is_default, content_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    ).run(newId, copyName, src.doc_category, src.exam_id, src.content_json, req.authUser!.user_id, ts, ts);

    bumpSyncVersion(db, 'documents');
    logAudit(db, req.authUser!.user_id, 'REPORT_TEMPLATE_DUPLICATE', { source: src.template_id, target: newId });
    const created = db.prepare('SELECT * FROM REPORT_TEMPLATES WHERE template_id = ?').get(newId);
    res.status(201).json({ template: created });
  });

  router.delete('/report-templates/:templateId', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM REPORT_TEMPLATES WHERE template_id = ?')
      .get(req.params.templateId) as { template_id: string; doc_category: string; is_default: number } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Template tidak ditemukan.' });
      return;
    }
    const countSameCategory = (
      db
        .prepare('SELECT COUNT(*) as c FROM REPORT_TEMPLATES WHERE doc_category = ?')
        .get(existing.doc_category) as { c: number }
    ).c;
    if (countSameCategory <= 1) {
      res.status(400).json({ error: 'Minimal harus tersisa satu template aktif untuk kategori ini.' });
      return;
    }
    db.prepare('DELETE FROM REPORT_TEMPLATES WHERE template_id = ?').run(existing.template_id);
    bumpSyncVersion(db, 'documents');
    logAudit(db, req.authUser!.user_id, 'REPORT_TEMPLATE_DELETE', { template_id: existing.template_id });
    res.json({ ok: true });
  });

  router.post('/report-templates/restore-defaults', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    ensureDefaultReportTemplates(db, true, req.authUser!.user_id);
    bumpSyncVersion(db, 'documents');
    logAudit(db, req.authUser!.user_id, 'REPORT_TEMPLATES_RESTORE_DEFAULT', {});
    const templates = db.prepare('SELECT * FROM REPORT_TEMPLATES ORDER BY is_default DESC, updated_at DESC').all();
    res.json({ ok: true, templates });
  });

  // 13D. Official Documents CRUD (Draft / Publish / History for Laporan, Berita Acara, Pengumuman Pemenang)
  router.get('/official-documents', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req, res) => {
    const db = getDb();
    const examId = String(req.query.exam_id ?? '').trim();
    const docCategory = String(req.query.doc_category ?? '').trim();
    let sql = `
      SELECT d.*, u.nama as creator_name
      FROM OFFICIAL_DOCUMENTS d
      LEFT JOIN USERS u ON u.user_id = d.created_by
      WHERE 1=1
    `;
    const params: string[] = [];
    if (examId) {
      sql += ' AND d.exam_id = ?';
      params.push(examId);
    }
    if (docCategory) {
      sql += ' AND d.doc_category = ?';
      params.push(docCategory);
    }
    sql += ' ORDER BY d.updated_at DESC';
    const documents = db.prepare(sql).all(...params);
    res.json({ documents });
  });

  router.post('/official-documents', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const b = req.body ?? {};
    const docCategory = String(b.doc_category ?? 'BERITA_ACARA') as DocumentCategory;
    const title = String(b.title ?? '').trim();
    if (!title || !['LAPORAN_HASIL', 'BERITA_ACARA', 'PENGUMUMAN_PEMENANG'].includes(docCategory)) {
      res.status(400).json({ error: 'Judul dan kategori dokumen wajib valid.' });
      return;
    }

    const docId = uid('doc');
    const ts = nowIso();
    const status = b.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';
    const settings = getSettingsMap(db);
    const contentJson = sanitizeDocumentPayload(
      typeof b.content === 'string' ? safeJsonParse(b.content, {}) : b.content ?? safeJsonParse(b.content_json, {}),
      settings,
    );

    db.prepare(
      `INSERT INTO OFFICIAL_DOCUMENTS (doc_id, exam_id, template_id, doc_category, title, doc_number, status, content_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      docId,
      String(b.exam_id ?? ''),
      String(b.template_id ?? ''),
      docCategory,
      title,
      String(b.doc_number ?? ''),
      status,
      contentJson,
      req.authUser!.user_id,
      ts,
      ts,
    );

    bumpSyncVersion(db, 'documents');
    logAudit(db, req.authUser!.user_id, 'OFFICIAL_DOCUMENT_SAVE', {
      doc_id: docId,
      doc_category: docCategory,
      status,
      title,
    });
    const created = db.prepare('SELECT * FROM OFFICIAL_DOCUMENTS WHERE doc_id = ?').get(docId);
    res.status(201).json({ document: created });
  });

  router.put('/official-documents/:docId', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM OFFICIAL_DOCUMENTS WHERE doc_id = ?')
      .get(req.params.docId) as { doc_id: string; title: string; doc_number: string; status: string; exam_id: string; template_id: string; content_json: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
      return;
    }
    const b = req.body ?? {};
    const settings = getSettingsMap(db);
    const nextStatus = b.status === 'PUBLISHED' ? 'PUBLISHED' : b.status === 'DRAFT' ? 'DRAFT' : existing.status;
    const nextContent =
      b.content !== undefined || b.content_json !== undefined
        ? sanitizeDocumentPayload(
            typeof b.content === 'string'
              ? safeJsonParse(b.content, {})
              : b.content ?? safeJsonParse(b.content_json, {}),
            settings,
          )
        : existing.content_json;

    db.prepare(
      `UPDATE OFFICIAL_DOCUMENTS
       SET exam_id = ?, template_id = ?, title = ?, doc_number = ?, status = ?, content_json = ?, updated_at = ?
       WHERE doc_id = ?`,
    ).run(
      b.exam_id !== undefined ? String(b.exam_id) : existing.exam_id,
      b.template_id !== undefined ? String(b.template_id) : existing.template_id,
      String(b.title ?? existing.title).trim() || existing.title,
      b.doc_number !== undefined ? String(b.doc_number) : existing.doc_number,
      nextStatus,
      nextContent,
      nowIso(),
      existing.doc_id,
    );

    bumpSyncVersion(db, 'documents');
    logAudit(db, req.authUser!.user_id, 'OFFICIAL_DOCUMENT_UPDATE', { doc_id: existing.doc_id, status: nextStatus });
    const updated = db.prepare('SELECT * FROM OFFICIAL_DOCUMENTS WHERE doc_id = ?').get(existing.doc_id);
    res.json({ document: updated });
  });

  router.post('/official-documents/:docId/duplicate', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const src = db
      .prepare('SELECT * FROM OFFICIAL_DOCUMENTS WHERE doc_id = ?')
      .get(req.params.docId) as { doc_id: string; exam_id: string; template_id: string; doc_category: string; title: string; doc_number: string; content_json: string } | undefined;
    if (!src) {
      res.status(404).json({ error: 'Dokumen sumber tidak ditemukan.' });
      return;
    }
    const newId = uid('doc');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO OFFICIAL_DOCUMENTS (doc_id, exam_id, template_id, doc_category, title, doc_number, status, content_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`,
    ).run(
      newId,
      src.exam_id,
      src.template_id,
      src.doc_category,
      `${src.title} (Salinan)`,
      src.doc_number,
      src.content_json,
      req.authUser!.user_id,
      ts,
      ts,
    );
    bumpSyncVersion(db, 'documents');
    logAudit(db, req.authUser!.user_id, 'OFFICIAL_DOCUMENT_DUPLICATE', { source: src.doc_id, target: newId });
    const created = db.prepare('SELECT * FROM OFFICIAL_DOCUMENTS WHERE doc_id = ?').get(newId);
    res.status(201).json({ document: created });
  });

  router.delete('/official-documents/:docId', requireAuth, requireRole('SUPER_ADMIN', 'PROFESSOR'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = db.prepare('SELECT doc_id FROM OFFICIAL_DOCUMENTS WHERE doc_id = ?').get(req.params.docId);
    if (!existing) {
      res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
      return;
    }
    db.prepare('DELETE FROM OFFICIAL_DOCUMENTS WHERE doc_id = ?').run(req.params.docId);
    bumpSyncVersion(db, 'documents');
    logAudit(db, req.authUser!.user_id, 'OFFICIAL_DOCUMENT_DELETE', { doc_id: req.params.docId });
    res.json({ ok: true });
  });

  // 14. Super Admin: Audit Logs, Persistent Assets, Backups, Settings Versioning, Server Monitoring & Guarded Factory Reset
  router.get('/audit-logs', requireAuth, requireRole('SUPER_ADMIN'), (req, res) => {
    const db = getDb();
    const activity = String(req.query.activity ?? '').trim().toLowerCase();
    const search = String(req.query.search ?? '').trim().toLowerCase();

    let sql = `
      SELECT a.*, u.username, u.nama, u.role
      FROM AUDIT_LOGS a
      LEFT JOIN USERS u ON u.user_id = a.user_id
      WHERE 1=1
    `;
    const params: string[] = [];
    if (activity) {
      sql += ' AND lower(a.activity) LIKE ?';
      params.push(`%${activity}%`);
    }
    if (search) {
      sql += ' AND (lower(a.details) LIKE ? OR lower(u.nama) LIKE ? OR lower(u.username) LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY a.timestamp DESC LIMIT 200';
    const logs = db.prepare(sql).all(...params);
    res.json({ logs });
  });

  router.post('/uploads/logo', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const dataUrl = String(req.body?.data_url ?? '');
    const originalName = String(req.body?.filename ?? 'logo.png').slice(0, 120);
    const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
    if (!match) {
      res.status(400).json({ error: 'Format logo tidak didukung. Gunakan file PNG, JPG, WEBP, atau GIF.' });
      return;
    }
    const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (buffer.length === 0 || buffer.length > 3 * 1024 * 1024) {
      res.status(400).json({ error: 'Ukuran file logo harus antara 1 byte hingga 3 MB.' });
      return;
    }

    const saved = saveUploadedLogoFile(db, {
      buffer,
      originalName,
      mimeType,
      ext: extMap[mimeType] || 'png',
      uploadedBy: req.authUser!.user_id,
    });

    const saveLogoImmediately = req.body?.apply_immediately !== false;
    let configVersion = getConfigVersion(db);
    if (saveLogoImmediately) {
      const updated = updateSettingsWithVersioning(
        db,
        { logo_url: saved.logo_url },
        req.authUser!.user_id,
        {
          expectedVersion:
            req.body?.expected_version !== undefined ? Number(req.body.expected_version) : undefined,
          note: `Unggah logo permanen (${saved.filename})`,
        },
      );
      configVersion = updated.config_version;
    }

    res.status(201).json({
      ok: true,
      logo_url: saved.logo_url,
      asset: saved,
      config_version: configVersion,
      verified: true,
    });
  });

  router.get('/backups', requireAuth, requireRole('SUPER_ADMIN'), (_req, res) => {
    const db = getDb();
    const backups = listBackupsWithVerification(db);
    res.json({ backups });
  });

  router.post('/backups', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const result = createBackupSnapshot(db, req.authUser!.user_id, { backupType: 'MANUAL' });
    res.status(201).json(result);
  });

  router.get('/backups/:fileId/download', requireAuth, requireRole('SUPER_ADMIN'), (req, res) => {
    const safeName = path.basename(String(req.params.fileId));
    const backupDir = getDefaultDbPaths().backupDir;
    const fullPath = path.resolve(backupDir, safeName);
    if (!fullPath.startsWith(path.resolve(backupDir) + path.sep) || !fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Berkas backup tidak ditemukan di penyimpanan server.' });
      return;
    }
    res.download(fullPath, safeName);
  });

  router.post('/backups/restore', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    let snapshot = req.body?.snapshot;

    // Also support restoring directly from a verified server backup fileId
    if (!snapshot && req.body?.file_id) {
      const safeName = path.basename(String(req.body.file_id));
      const backupDir = getDefaultDbPaths().backupDir;
      const fullPath = path.resolve(backupDir, safeName);
      if (!fullPath.startsWith(path.resolve(backupDir) + path.sep) || !fs.existsSync(fullPath)) {
        res.status(404).json({ error: 'Berkas backup server tidak ditemukan.' });
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as {
        snapshot?: Record<string, Record<string, unknown>[]>;
      };
      snapshot = parsed.snapshot || parsed;
    }

    if (!snapshot || typeof snapshot !== 'object') {
      res.status(400).json({ error: 'Format snapshot JSON backup tidak valid.' });
      return;
    }

    restoreBackupSnapshot(db, snapshot, req.authUser!.user_id);
    res.json({ ok: true, config_version: getConfigVersion(db) });
  });

  router.get('/settings', requireAuth, requireRole('SUPER_ADMIN'), (_req, res) => {
    const db = getDb();
    res.json({
      settings: getSettingsMap(db, { strict: true }),
      config_version: getConfigVersion(db),
      last_save_at: getMetaValue(db, 'LAST_SAVE_AT', ''),
    });
  });

  router.put('/settings', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const updates = req.body?.settings ?? {};
    const expectedVersion =
      req.body?.expected_version !== undefined ? Number(req.body.expected_version) : undefined;
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 200) : '';

    const result = updateSettingsWithVersioning(db, updates, req.authUser!.user_id, {
      expectedVersion,
      note,
    });
    res.json({
      ok: true,
      verified: result.verified,
      changed_keys: result.changed_keys,
      config_version: result.config_version,
      settings: result.settings,
    });
  });

  router.get('/settings/versions', requireAuth, requireRole('SUPER_ADMIN'), (req, res) => {
    const db = getDb();
    const limit = Math.min(200, Math.max(10, Number(req.query.limit ?? 50)));
    const monitoring = getSystemMonitoringStatus(db, { gasFilesCount: GAS_PROJECT_FILES.length });
    res.json({
      config_version: monitoring.config_version,
      versions: monitoring.config_versions.slice(0, limit),
    });
  });

  router.post('/settings/rollback/:versionId', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const result = rollbackConfigVersion(db, String(req.params.versionId), req.authUser!.user_id);
    res.json({
      ok: true,
      verified: result.verified,
      config_version: result.config_version,
      settings: result.settings,
    });
  });

  router.get('/system/monitoring', requireAuth, requireRole('SUPER_ADMIN'), (_req, res) => {
    const db = getDb();
    const monitoring = getSystemMonitoringStatus(db, {
      gasFilesCount: GAS_PROJECT_FILES.length,
    });
    res.json(monitoring);
  });

  router.post('/system/factory-reset', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const password = String(req.body?.password ?? '');
    const confirmationPhrase = String(req.body?.confirmation_phrase ?? '').trim();
    const acknowledged = Boolean(req.body?.acknowledge_backup_and_reset);

    if (!acknowledged) {
      res.status(400).json({ error: 'Anda wajib menyetujui pembuatan backup otomatis dan penghapusan data.' });
      return;
    }
    if (confirmationPhrase !== FACTORY_RESET_CONFIRMATION_PHRASE) {
      res.status(400).json({
        error: `Frasa konfirmasi tidak cocok. Ketik persis: ${FACTORY_RESET_CONFIRMATION_PHRASE}`,
      });
      return;
    }

    const adminRow = db
      .prepare('SELECT password_hash, password_salt FROM USERS WHERE user_id = ?')
      .get(req.authUser!.user_id) as { password_hash: string; password_salt: string } | undefined;
    if (!adminRow || !verifyPassword(password, adminRow.password_hash, adminRow.password_salt)) {
      res.status(403).json({ error: 'Password Super Admin tidak valid. Reset pabrik dibatalkan.' });
      return;
    }

    const result = executeFactoryReset(db, {
      actorUserId: req.authUser!.user_id,
      confirmationPhrase,
    });
    res.json(result);
  });

  // Centralized API Error Handler (logs server/persistence errors without masking failures)
  router.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ConflictError) {
      res.status(409).json({
        error: err.message,
        code: err.code,
        current_version: err.currentVersion,
      });
      return;
    }
    const status =
      err instanceof DatabasePersistenceError
        ? err.status
        : typeof (err as { status?: number })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
    const message = err instanceof Error ? err.message : 'Terjadi kesalahan internal server.';
    try {
      const db = getDb();
      recordServerEvent(db, {
        level: status >= 500 ? 'ERROR' : 'WARN',
        source: `${req.method} ${req.path}`,
        event_type:
          err instanceof DatabasePersistenceError ? err.code : 'API_ROUTE_ERROR',
        message,
      });
    } catch {
      // Ignore if DB itself is unreachable
    }
    res.status(status).json({
      error: message,
      code: err instanceof DatabasePersistenceError ? err.code : undefined,
    });
  });

  return router;
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.ts';
import type { AppSettingsMap, ExamSettings } from '../shared/types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'cbt_kir_ipa.sqlite');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

let dbInstance: DatabaseSync | null = null;

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    initializeDatabase();
  }
  return dbInstance!;
}

export function initializeDatabase(): DatabaseSync {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
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
      status TEXT NOT NULL
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
  `);

  dbInstance = db;
  seedInitialData(db);
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

export function getSettingsMap(db: DatabaseSync): AppSettingsMap {
  const rows = db.prepare('SELECT setting_key, setting_value FROM SETTINGS').all() as Array<{
    setting_key: string;
    setting_value: string;
  }>;
  const map: Record<string, string> = { ...DEFAULT_APP_SETTINGS };
  for (const r of rows) {
    map[r.setting_key] = r.setting_value;
  }
  return map as unknown as AppSettingsMap;
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
    const legacyAdmin = db
      .prepare('SELECT user_id, username FROM USERS WHERE user_id = ?')
      .get('usr_admin_01') as { user_id: string; username: string } | undefined;
    if (legacyAdmin && legacyAdmin.username === 'admin.kir') {
      const { hash, salt } = hashPassword(process.env.SUPER_ADMIN_INITIAL_PASSWORD || 'guakeren');
      db.prepare('UPDATE USERS SET username = ?, password_hash = ?, password_salt = ? WHERE user_id = ?').run(
        'aetherium22',
        hash,
        salt,
        'usr_admin_01',
      );
      db.prepare('DELETE FROM SESSIONS WHERE user_id = ?').run('usr_admin_01');
      db.prepare('DELETE FROM LOGIN_ATTEMPTS WHERE username IN (?, ?)').run('admin.kir', 'aetherium22');
    }
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

  // Exam 1: Active OSN Selection Exam with all 7 question types
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

  // Exam 2: Completed Exam with rich analytics & leaderboard data (6+ participants)
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

  // Register all 7 students to Exam 1 (BELUM_MULAI) and 6 students completed + 1 pending essay on Exam 2
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

  // Seed initial violation & audit log for realism
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

export function createBackupSnapshot(db: DatabaseSync, createdBy: string) {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  const tables = [
    'USERS',
    'EXAMS',
    'QUESTIONS',
    'EXAM_QUESTIONS',
    'EXAM_PARTICIPANTS',
    'ANSWERS',
    'VIOLATION_LOGS',
    'RESULTS',
    'SETTINGS',
    'AUDIT_LOGS',
    'EXAM_LOGS',
    'ESSAY_GRADES',
    'EXAM_CATEGORIES',
    'NOTIFICATIONS',
  ];
  const snapshot: Record<string, unknown[]> = {};
  for (const t of tables) {
    snapshot[t] = db.prepare(`SELECT * FROM ${t}`).all();
  }
  const backupId = uid('bkp');
  const fileName = `backup_${backupId}_${Date.now()}.json`;
  const filePath = path.join(BACKUP_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify({ backup_id: backupId, created_at: nowIso(), snapshot }, null, 2));

  db.prepare(
    'INSERT INTO BACKUP_LOGS (backup_id, file_id, created_at, created_by, status) VALUES (?, ?, ?, ?, ?)',
  ).run(backupId, fileName, nowIso(), createdBy, 'SUCCESS');

  logAudit(db, createdBy, 'DATABASE_BACKUP', { backup_id: backupId, file: fileName });
  return { backup_id: backupId, file_id: fileName, snapshot };
}

export function restoreBackupSnapshot(
  db: DatabaseSync,
  snapshot: Record<string, Record<string, unknown>[]>,
  restoredBy: string,
) {
  const allowedTables = [
    'USERS',
    'EXAMS',
    'QUESTIONS',
    'EXAM_QUESTIONS',
    'EXAM_PARTICIPANTS',
    'ANSWERS',
    'VIOLATION_LOGS',
    'RESULTS',
    'SETTINGS',
    'AUDIT_LOGS',
    'EXAM_LOGS',
    'ESSAY_GRADES',
    'EXAM_CATEGORIES',
    'NOTIFICATIONS',
  ];

  db.exec('BEGIN TRANSACTION;');
  try {
    for (const table of allowedTables) {
      const rows = snapshot[table];
      if (!Array.isArray(rows)) continue;
      db.prepare(`DELETE FROM ${table}`).run();
      if (rows.length === 0) continue;
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map(() => '?').join(', ');
      const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
      for (const row of rows) {
        stmt.run(...cols.map((c) => (row[c] ?? null) as string | number | null));
      }
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  logAudit(db, restoredBy, 'DATABASE_RESTORE', {
    restored_tables: Object.keys(snapshot).filter((k) => allowedTables.includes(k)),
  });
}

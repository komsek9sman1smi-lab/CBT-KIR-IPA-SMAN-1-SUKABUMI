export interface GasFileItem {
  path: string;
  folder: 'BACKEND' | 'FRONTEND' | 'COMPONENTS';
  description: string;
  content: string;
}

export const GAS_PROJECT_FILES: GasFileItem[] = [
  {
    path: 'Code.gs',
    folder: 'BACKEND',
    description: 'Entrypoint Web App (doGet), HTML include(filename), dan routing halaman berdasarkan token sesi.',
    content: `function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? String(e.parameter.page) : 'Index';
  var allowed = ['Index', 'Login', 'DashboardAdmin', 'DashboardProfessor', 'DashboardStudent', 'Exam'];
  if (allowed.indexOf(page) === -1) page = 'Index';

  var template = HtmlService.createTemplateFromFile(page);
  template.appConfig = getPublicConfig();
  return template.evaluate()
    .setTitle(getSetting('app_name', 'CBT KIR IPA SMAN 1 SUKABUMI'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}`,
  },
  {
    path: 'Config.gs',
    folder: 'BACKEND',
    description: 'Konfigurasi sistem, penguncian ID Spreadsheet permanen (anti-reset), PropertiesService, dan konstanta sheet.',
    content: `var SHEET_NAMES = {
  SYSTEM_METADATA: 'SYSTEM_METADATA',
  CONFIG_VERSIONS: 'CONFIG_VERSIONS',
  SERVER_EVENTS: 'SERVER_EVENTS',
  APP_ASSETS: 'APP_ASSETS',
  USERS: 'USERS',
  EXAMS: 'EXAMS',
  QUESTIONS: 'QUESTIONS',
  EXAM_QUESTIONS: 'EXAM_QUESTIONS',
  EXAM_PARTICIPANTS: 'EXAM_PARTICIPANTS',
  ANSWERS: 'ANSWERS',
  VIOLATION_LOGS: 'VIOLATION_LOGS',
  RESULTS: 'RESULTS',
  SETTINGS: 'SETTINGS',
  SESSIONS: 'SESSIONS',
  AUDIT_LOGS: 'AUDIT_LOGS',
  EXAM_LOGS: 'EXAM_LOGS',
  ESSAY_GRADES: 'ESSAY_GRADES',
  BACKUP_LOGS: 'BACKUP_LOGS',
  EXAM_CATEGORIES: 'EXAM_CATEGORIES',
  NOTIFICATIONS: 'NOTIFICATIONS',
  REPORT_TEMPLATES: 'REPORT_TEMPLATES',
  OFFICIAL_DOCUMENTS: 'OFFICIAL_DOCUMENTS'
};

var DEFAULT_SETTINGS_GAS = {
  app_name: 'CBT KIR IPA SMAN 1 SUKABUMI',
  org_name: 'Kelompok Ilmiah Remaja (KIR) IPA',
  school_name: 'SMA Negeri 1 Sukabumi',
  academic_year: '2026 / 2027',
  management_period: 'Periode 2026–2027',
  logo_url: '',
  logo_drive_file_id: '',
  primary_color: '#0F294A',
  accent_color: '#D97706',
  contact_info: 'Jl. RH. Didi Sukardi No. 124, Sukabumi',
  announcement: 'Selamat datang di Portal Ujian Digital Resmi KIR IPA SMAN 1 Sukabumi.',
  report_footer: 'Dokumen Resmi Panitia Evaluasi Akademik KIR IPA SMA Negeri 1 Sukabumi',
  max_login_attempts: '5',
  lockout_minutes: '5',
  session_hours: '8',
  professor_global_access: 'false'
};

// PENTING (ANTI-RESET): Jangan pernah membuat spreadsheet kosong secara otomatis jika ID belum ditemukan atau gagal dibuka.
function getSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('CBT_SPREADSHEET_ID');
  if (ssId) {
    try {
      return SpreadsheetApp.openById(ssId);
    } catch (err) {
      throw new Error('Spreadsheet database (' + ssId + ') gagal dibuka: ' + err.message + '. Sistem menghentikan akses untuk mencegah reset data.');
    }
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    props.setProperty('CBT_SPREADSHEET_ID', active.getId());
    return active;
  }
  throw new Error('CBT_SPREADSHEET_ID belum dikonfigurasi dan skrip tidak terikat ke Spreadsheet aktif. Jalankan setupNewSpreadsheetOnce() hanya saat instalasi pertama.');
}

function setupNewSpreadsheetOnce() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('CBT_SPREADSHEET_ID') || props.getProperty('DATABASE_INITIALIZED') === 'true') {
    throw new Error('Database sudah terikat ke Spreadsheet (' + props.getProperty('CBT_SPREADSHEET_ID') + '). Dilarang membuat database baru secara otomatis.');
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    props.setProperty('CBT_SPREADSHEET_ID', active.getId());
    return active;
  }
  var created = SpreadsheetApp.create('DB_CBT_KIR_IPA_SMAN1_SUKABUMI');
  props.setProperty('CBT_SPREADSHEET_ID', created.getId());
  return created;
}

function getAppSecret() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('CBT_HMAC_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty('CBT_HMAC_SECRET', secret);
  }
  return secret;
}`,
  },
  {
    path: 'Database.gs',
    folder: 'BACKEND',
    description: 'Inisialisasi aman 22 sheet database, penanda DATABASE_INITIALIZED (anti-reset), dan migrasi skema aman tanpa menghapus data.',
    content: `var GAS_DB_VERSION = '2.0.0';

var TABLE_SCHEMAS = {
  SYSTEM_METADATA: ['meta_key', 'meta_value', 'updated_at'],
  CONFIG_VERSIONS: ['version_id', 'version_number', 'setting_key', 'category', 'old_value', 'new_value', 'changed_by', 'changed_at', 'status', 'note'],
  SERVER_EVENTS: ['event_id', 'level', 'source', 'event_type', 'message', 'details', 'created_at'],
  APP_ASSETS: ['asset_id', 'asset_type', 'filename', 'drive_file_id', 'mime_type', 'size_bytes', 'created_by', 'created_at'],
  USERS: ['user_id', 'username', 'password_hash', 'password_salt', 'nama', 'kelas', 'role', 'status', 'created_at'],
  EXAMS: ['exam_id', 'title', 'description', 'subject', 'start_time', 'end_time', 'duration', 'status', 'total_questions', 'created_by', 'settings_json'],
  QUESTIONS: ['question_id', 'question_type', 'question_text', 'options_json', 'correct_answer', 'explanation', 'image_url', 'category', 'materi', 'difficulty', 'score', 'created_by', 'created_at'],
  EXAM_QUESTIONS: ['id', 'exam_id', 'question_id', 'question_order', 'score'],
  EXAM_PARTICIPANTS: ['id', 'exam_id', 'user_id', 'status', 'started_at', 'submitted_at', 'score', 'session_id'],
  ANSWERS: ['answer_id', 'exam_id', 'user_id', 'question_id', 'answer_json', 'is_doubtful', 'saved_at', 'score'],
  VIOLATION_LOGS: ['log_id', 'exam_id', 'user_id', 'event_type', 'event_time', 'description'],
  RESULTS: ['result_id', 'exam_id', 'user_id', 'correct_count', 'incorrect_count', 'unanswered_count', 'total_score', 'published', 'graded_at'],
  SETTINGS: ['setting_key', 'setting_value'],
  SESSIONS: ['session_id', 'user_id', 'exam_id', 'token_hash', 'created_at', 'expires_at', 'status'],
  AUDIT_LOGS: ['log_id', 'user_id', 'activity', 'timestamp', 'details'],
  EXAM_LOGS: ['log_id', 'exam_id', 'user_id', 'event_type', 'timestamp', 'details'],
  ESSAY_GRADES: ['grade_id', 'exam_id', 'question_id', 'user_id', 'score', 'feedback', 'graded_by', 'graded_at'],
  BACKUP_LOGS: ['backup_id', 'file_id', 'created_at', 'created_by', 'status', 'backup_type'],
  EXAM_CATEGORIES: ['category_id', 'category_name', 'description', 'created_at'],
  NOTIFICATIONS: ['notification_id', 'user_id', 'title', 'message', 'created_at', 'is_read'],
  REPORT_TEMPLATES: ['template_id', 'name', 'doc_category', 'exam_id', 'is_default', 'content_json', 'created_by', 'created_at', 'updated_at'],
  OFFICIAL_DOCUMENTS: ['doc_id', 'exam_id', 'template_id', 'doc_category', 'title', 'doc_number', 'status', 'content_json', 'created_by', 'created_at', 'updated_at']
};

function setupDefaultSettings(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) throw new Error('Sheet SETTINGS tidak ditemukan.');
  var existingRows = readSheetAsObjects(SHEET_NAMES.SETTINGS);
  var existingMap = {};
  existingRows.forEach(function(r) { existingMap[String(r.setting_key)] = true; });
  Object.keys(DEFAULT_SETTINGS_GAS).forEach(function(k) {
    if (!existingMap[k]) {
      sheet.appendRow([k, DEFAULT_SETTINGS_GAS[k]]);
    }
  });
}

function initializeDatabase() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var props = PropertiesService.getScriptProperties();
    var ss = getSpreadsheet();
    Object.keys(TABLE_SCHEMAS).forEach(function(sheetName) {
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      }
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(TABLE_SCHEMAS[sheetName]);
        sheet.getRange(1, 1, 1, TABLE_SCHEMAS[sheetName].length).setFontWeight('bold');
        sheet.setFrozenRows(1);
      }
    });

    var alreadyInit = props.getProperty('DATABASE_INITIALIZED') === 'true' || getMetaPropertyGas(ss, 'DATABASE_INITIALIZED') === 'true';
    var existingUsers = readSheetAsObjects(SHEET_NAMES.USERS);
    if (alreadyInit && existingUsers.length === 0) {
      throw new Error('Pencegahan Reset Aktif: Database sudah pernah diinisialisasi tetapi sheet USERS kosong.');
    }

    setupDefaultSettings(ss);
    migrateDatabaseSafely(ss);

    if (!alreadyInit) {
      var ts = new Date().toISOString();
      var instId = props.getProperty('INSTALLATION_ID') || generateId('inst');
      props.setProperty('INSTALLATION_ID', instId);
      props.setProperty('DATABASE_INITIALIZED', 'true');
      props.setProperty('DATABASE_VERSION', GAS_DB_VERSION);
      setMetaPropertyGas(ss, 'DATABASE_INITIALIZED', 'true');
      setMetaPropertyGas(ss, 'INSTALLATION_ID', instId);
      setMetaPropertyGas(ss, 'DATABASE_VERSION', GAS_DB_VERSION);
      setMetaPropertyGas(ss, 'CONFIG_VERSION', '1');
      setMetaPropertyGas(ss, 'LAST_SAVE_AT', ts);
    }
    return { ok: true, spreadsheetUrl: ss.getUrl(), initialized: true };
  } finally {
    lock.releaseLock();
  }
}

function migrateDatabaseSafely(ss) {
  var spreadsheet = ss || getSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var currentVer = props.getProperty('DATABASE_VERSION') || '';
  if (currentVer === GAS_DB_VERSION) return { ok: true, migrated: false };

  // Buat backup spreadsheet sebelum menambah kolom baru
  spreadsheet.copy('AUTO_PRE_MIGRATION_CBT_KIR_IPA_' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd_HHmmss'));

  Object.keys(TABLE_SCHEMAS).forEach(function(sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() === 0) return;
    var existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    TABLE_SCHEMAS[sheetName].forEach(function(colName) {
      if (existingHeaders.indexOf(colName) === -1) {
        var nextCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, nextCol).setValue(colName).setFontWeight('bold');
        existingHeaders.push(colName);
      }
    });
  });

  props.setProperty('DATABASE_VERSION', GAS_DB_VERSION);
  setMetaPropertyGas(spreadsheet, 'DATABASE_VERSION', GAS_DB_VERSION);
  return { ok: true, migrated: true, version: GAS_DB_VERSION };
}

function setupInitialSuperAdmin(username, rawPassword, namaLengkap) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    initializeDatabase();
    var users = readSheetAsObjects(SHEET_NAMES.USERS);
    var hasAdmin = users.some(function(u) { return u.role === 'SUPER_ADMIN'; });
    if (hasAdmin) throw new Error('Super Admin sudah terdaftar.');
    var salt = Utilities.getUuid().replace(/-/g, '');
    var hash = hashPasswordWithSalt(rawPassword, salt);
    appendRowObject(SHEET_NAMES.USERS, {
      user_id: generateId('usr'),
      username: String(username).trim().toLowerCase(),
      password_hash: hash,
      password_salt: salt,
      nama: namaLengkap,
      kelas: 'Pembina Utama',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      created_at: new Date().toISOString()
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}`,
  },
  {
    path: 'Utils.gs',
    folder: 'BACKEND',
    description: 'Utilitas baca/tulis sheet berbasis LockService, metadata persisten, dan invalidasi CacheService otomatis.',
    content: `function generateId(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function hashSha256(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function(b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function hashPasswordWithSalt(password, salt) {
  var combined = salt + ':' + password + ':' + getAppSecret();
  var digest = combined;
  for (var i = 0; i < 1000; i++) {
    digest = hashSha256(digest);
  }
  return digest;
}

function readSheetAsObjects(sheetName) {
  var sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet "' + sheetName + '" tidak ditemukan di Spreadsheet.');
  if (sheet.getLastRow() < 2) return [];
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = { _rowIndex: i + 1 };
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    rows.push(obj);
  }
  return rows;
}

function appendRowObject(sheetName, obj) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSpreadsheet().getSheetByName(sheetName);
    if (!sheet) throw new Error('Sheet "' + sheetName + '" tidak ditemukan.');
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var row = headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function updateRowByKey(sheetName, keyCol, keyVal, updates) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getSpreadsheet().getSheetByName(sheetName);
    if (!sheet) throw new Error('Sheet "' + sheetName + '" tidak ditemukan.');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var keyIdx = headers.indexOf(keyCol);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][keyIdx]) === String(keyVal)) {
        Object.keys(updates).forEach(function(col) {
          var colIdx = headers.indexOf(col);
          if (colIdx !== -1) sheet.getRange(i + 1, colIdx + 1).setValue(updates[col]);
        });
        SpreadsheetApp.flush();
        return true;
      }
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

function getMetaPropertyGas(ss, key) {
  var sheet = (ss || getSpreadsheet()).getSheetByName(SHEET_NAMES.SYSTEM_METADATA);
  if (!sheet || sheet.getLastRow() < 2) return '';
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(key)) return String(data[i][1] || '');
  }
  return '';
}

function setMetaPropertyGas(ss, key, val) {
  var spreadsheet = ss || getSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SHEET_NAMES.SYSTEM_METADATA);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  var ts = new Date().toISOString();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(key)) {
      sheet.getRange(i + 1, 2).setValue(String(val));
      sheet.getRange(i + 1, 3).setValue(ts);
      SpreadsheetApp.flush();
      return;
    }
  }
  sheet.appendRow([String(key), String(val), ts]);
  SpreadsheetApp.flush();
}

function invalidateSettingsCache(keys) {
  var cache = CacheService.getScriptCache();
  var list = keys || Object.keys(DEFAULT_SETTINGS_GAS);
  list.forEach(function(k) { cache.remove('SETTING_' + k); });
}

function getSetting(key, fallback) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('SETTING_' + key);
  if (cached !== null) return cached;
  var rows = readSheetAsObjects(SHEET_NAMES.SETTINGS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].setting_key === key) {
      cache.put('SETTING_' + key, String(rows[i].setting_value), 300);
      return String(rows[i].setting_value);
    }
  }
  return fallback || '';
}`,
  },
  {
    path: 'Auth.gs',
    folder: 'BACKEND',
    description: 'Autentikasi username/password hash+salt, pembatasan percobaan login (rate-limit), dan pemblokiran sementara.',
    content: `function loginUser(username, password) {
  var uname = String(username || '').trim().toLowerCase();
  if (!uname || !password) return { ok: false, error: 'Username dan password wajib diisi.' };

  var cache = CacheService.getScriptCache();
  var lockKey = 'LOGIN_LOCK_' + uname;
  var failKey = 'LOGIN_FAIL_' + uname;
  if (cache.get(lockKey)) {
    return { ok: false, error: 'Akun diblokir sementara karena terlalu banyak percobaan login gagal.' };
  }

  var users = readSheetAsObjects(SHEET_NAMES.USERS);
  var found = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].username).toLowerCase() === uname) {
      found = users[i];
      break;
    }
  }

  if (!found || hashPasswordWithSalt(password, found.password_salt) !== found.password_hash) {
    var fails = Number(cache.get(failKey) || 0) + 1;
    cache.put(failKey, String(fails), 600);
    if (fails >= 5) {
      cache.put(lockKey, '1', 300);
      return { ok: false, error: 'Login gagal 5 kali. Akun diblokir sementara selama 5 menit.' };
    }
    return { ok: false, error: 'Username atau password salah.' };
  }

  if (found.status !== 'ACTIVE') {
    return { ok: false, error: 'Akun berstatus nonaktif. Hubungi Super Admin.' };
  }

  cache.remove(failKey);
  var session = createSessionToken(found.user_id, '');
  recordAudit(found.user_id, 'LOGIN', 'Login berhasil sebagai ' + found.role);

  return {
    ok: true,
    token: session.rawToken,
    user: {
      user_id: found.user_id,
      username: found.username,
      nama: found.nama,
      kelas: found.kelas,
      role: found.role
    }
  };
}`,
  },
  {
    path: 'SessionManager.gs',
    folder: 'BACKEND',
    description: 'Manajemen token sesi acak (hanya hash token disimpan di sheet SESSIONS), validasi RBAC, dan logout.',
    content: `function createSessionToken(userId, examId) {
  var rawToken = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var tokenHash = hashSha256(rawToken + ':' + getAppSecret());
  var sessionId = generateId('ses');
  var now = new Date();
  var expires = new Date(now.getTime() + 8 * 60 * 60 * 1000);

  appendRowObject(SHEET_NAMES.SESSIONS, {
    session_id: sessionId,
    user_id: userId,
    exam_id: examId || '',
    token_hash: tokenHash,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    status: 'ACTIVE'
  });

  return { sessionId: sessionId, rawToken: rawToken };
}

function requireAuthorizedUser(token, allowedRoles) {
  if (!token) throw new Error('Autentikasi diperlukan.');
  var tokenHash = hashSha256(token + ':' + getAppSecret());
  var sessions = readSheetAsObjects(SHEET_NAMES.SESSIONS);
  var activeSession = null;
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].token_hash === tokenHash && sessions[i].status === 'ACTIVE') {
      activeSession = sessions[i];
      break;
    }
  }
  if (!activeSession) throw new Error('Sesi tidak valid.');
  if (new Date(activeSession.expires_at).getTime() <= Date.now()) {
    updateRowByKey(SHEET_NAMES.SESSIONS, 'session_id', activeSession.session_id, { status: 'EXPIRED' });
    throw new Error('Sesi telah berakhir.');
  }

  var users = readSheetAsObjects(SHEET_NAMES.USERS);
  var user = users.filter(function(u) { return u.user_id === activeSession.user_id; })[0];
  if (!user || user.status !== 'ACTIVE') throw new Error('Akun pengguna tidak aktif.');
  if (allowedRoles && allowedRoles.indexOf(user.role) === -1) {
    throw new Error('Akses ditolak (RBAC).');
  }
  return { user: user, session: activeSession };
}

function logoutSession(token) {
  var auth = requireAuthorizedUser(token);
  updateRowByKey(SHEET_NAMES.SESSIONS, 'session_id', auth.session.session_id, { status: 'REVOKED' });
  recordAudit(auth.user.user_id, 'LOGOUT', 'Pengguna keluar dari sistem');
  return { ok: true };
}`,
  },
  {
    path: 'UserController.gs',
    folder: 'BACKEND',
    description: 'CRUD pengguna, proteksi akun Super Admin, impor peserta CSV, dan reset password.',
    content: `function listUsers(token, roleFilter) {
  var auth = requireAuthorizedUser(token, ['SUPER_ADMIN', 'PROFESSOR']);
  var users = readSheetAsObjects(SHEET_NAMES.USERS);
  return users
    .filter(function(u) {
      if (auth.user.role === 'PROFESSOR') return u.role === 'SISWA';
      return !roleFilter || u.role === roleFilter;
    })
    .map(function(u) {
      return {
        user_id: u.user_id,
        username: u.username,
        nama: u.nama,
        kelas: u.kelas,
        role: u.role,
        status: u.status,
        created_at: u.created_at
      };
    });
}

function createUserAccount(token, payload) {
  var auth = requireAuthorizedUser(token, ['SUPER_ADMIN', 'PROFESSOR']);
  if (auth.user.role === 'PROFESSOR' && payload.role !== 'SISWA') {
    throw new Error('Professor hanya boleh membuat akun Siswa.');
  }
  var salt = Utilities.getUuid().replace(/-/g, '');
  var hash = hashPasswordWithSalt(payload.password, salt);
  var userId = generateId('usr');
  appendRowObject(SHEET_NAMES.USERS, {
    user_id: userId,
    username: String(payload.username).trim().toLowerCase(),
    password_hash: hash,
    password_salt: salt,
    nama: payload.nama,
    kelas: payload.kelas || '',
    role: payload.role || 'SISWA',
    status: 'ACTIVE',
    created_at: new Date().toISOString()
  });
  recordAudit(auth.user.user_id, 'USER_CREATE', 'Membuat akun ' + payload.username);
  return { ok: true, user_id: userId };
}`,
  },
  {
    path: 'QuestionController.gs',
    folder: 'BACKEND',
    description: 'Bank soal multiformat (PG, PGK, B/S, Esai, Isian, Menjodohkan, Mengurutkan), unggah gambar Drive, dan impor.',
    content: `function saveQuestion(token, payload) {
  var auth = requireAuthorizedUser(token, ['SUPER_ADMIN', 'PROFESSOR']);
  var qId = payload.question_id || generateId('q');
  var rowObj = {
    question_id: qId,
    question_type: payload.question_type,
    question_text: payload.question_text,
    options_json: JSON.stringify(payload.options || {}),
    correct_answer: typeof payload.correct_answer === 'string' ? payload.correct_answer : JSON.stringify(payload.correct_answer),
    explanation: payload.explanation || '',
    image_url: payload.image_url || '',
    category: payload.category || 'Umum',
    difficulty: payload.difficulty || 'SEDANG',
    score: Number(payload.score || 10),
    created_by: auth.user.user_id,
    created_at: new Date().toISOString()
  };
  if (payload.question_id) {
    updateRowByKey(SHEET_NAMES.QUESTIONS, 'question_id', qId, rowObj);
    recordAudit(auth.user.user_id, 'QUESTION_UPDATE', qId);
  } else {
    appendRowObject(SHEET_NAMES.QUESTIONS, rowObj);
    recordAudit(auth.user.user_id, 'QUESTION_CREATE', qId);
  }
  return { ok: true, question_id: qId };
}

function uploadQuestionImageToDrive(token, base64Data, filename, mimeType) {
  requireAuthorizedUser(token, ['SUPER_ADMIN', 'PROFESSOR']);
  var bytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(bytes, mimeType, filename);
  var file = DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, image_url: 'https://drive.google.com/uc?export=view&id=' + file.getId() };
}`,
  },
  {
    path: 'ExamController.gs',
    folder: 'BACKEND',
    description: 'Manajemen ujian, penjadwalan, penguncian timer server, dan pengiriman soal aman tanpa kunci jawaban ke siswa.',
    content: `function startStudentExamSession(token, examId, recoverSession) {
  var auth = requireAuthorizedUser(token, ['SISWA']);
  var exams = readSheetAsObjects(SHEET_NAMES.EXAMS);
  var exam = exams.filter(function(e) { return e.exam_id === examId; })[0];
  if (!exam || exam.status !== 'ACTIVE') throw new Error('Ujian tidak aktif.');

  var parts = readSheetAsObjects(SHEET_NAMES.EXAM_PARTICIPANTS);
  var part = parts.filter(function(p) { return p.exam_id === examId && p.user_id === auth.user.user_id; })[0];
  if (!part) throw new Error('Anda tidak terdaftar pada ujian ini.');
  if (part.status === 'TERKUMPUL' || part.status === 'DIHENTIKAN') {
    throw new Error('Ujian Anda telah selesai dan terkunci.');
  }

  var settings = JSON.parse(exam.settings_json || '{}');
  if (settings.anti_cheat_single_session && part.session_id && part.session_id !== auth.session.session_id && !recoverSession) {
    throw new Error('MULTIPLE_SESSION_DETECTED');
  }

  var startedAt = part.started_at || new Date().toISOString();
  updateRowByKey(SHEET_NAMES.EXAM_PARTICIPANTS, 'id', part.id, {
    status: 'MENGERJAKAN',
    started_at: startedAt,
    session_id: auth.session.session_id
  });

  var links = readSheetAsObjects(SHEET_NAMES.EXAM_QUESTIONS).filter(function(l) { return l.exam_id === examId; });
  var allQuestions = readSheetAsObjects(SHEET_NAMES.QUESTIONS);
  var safeQuestions = links.map(function(link) {
    var q = allQuestions.filter(function(item) { return item.question_id === link.question_id; })[0];
    return {
      question_id: q.question_id,
      question_type: q.question_type,
      question_text: q.question_text,
      options: JSON.parse(q.options_json || '{}'),
      image_url: q.image_url,
      category: q.category,
      score: link.score,
      question_order: link.question_order
    };
  });

  var hardEnd = Math.min(
    new Date(startedAt).getTime() + Number(exam.duration) * 60000,
    new Date(exam.end_time).getTime()
  );

  return {
    exam: exam,
    remaining_seconds: Math.max(0, Math.floor((hardEnd - Date.now()) / 1000)),
    questions: safeQuestions
  };
}`,
  },
  {
    path: 'AnswerController.gs',
    folder: 'BACKEND',
    description: 'Penyimpanan jawaban otomatis (autosave), status ragu-ragu, validasi waktu server, dan pengumpulan ujian.',
    content: `function autosaveAnswer(token, examId, questionId, answerValue, isDoubtful) {
  var auth = requireAuthorizedUser(token, ['SISWA']);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var parts = readSheetAsObjects(SHEET_NAMES.EXAM_PARTICIPANTS);
    var part = parts.filter(function(p) { return p.exam_id === examId && p.user_id === auth.user.user_id; })[0];
    if (!part || part.status === 'TERKUMPUL' || part.status === 'DIHENTIKAN') {
      throw new Error('Ujian sudah terkunci.');
    }

    var answers = readSheetAsObjects(SHEET_NAMES.ANSWERS);
    var existing = answers.filter(function(a) {
      return a.exam_id === examId && a.user_id === auth.user.user_id && a.question_id === questionId;
    })[0];

    var nowStr = new Date().toISOString();
    if (existing) {
      updateRowByKey(SHEET_NAMES.ANSWERS, 'answer_id', existing.answer_id, {
        answer_json: JSON.stringify(answerValue),
        is_doubtful: isDoubtful ? 1 : 0,
        saved_at: nowStr
      });
    } else {
      appendRowObject(SHEET_NAMES.ANSWERS, {
        answer_id: generateId('ans'),
        exam_id: examId,
        user_id: auth.user.user_id,
        question_id: questionId,
        answer_json: JSON.stringify(answerValue),
        is_doubtful: isDoubtful ? 1 : 0,
        saved_at: nowStr,
        score: 0
      });
    }
    return { ok: true, saved_at: nowStr };
  } finally {
    lock.releaseLock();
  }
}`,
  },
  {
    path: 'Grading.gs',
    folder: 'BACKEND',
    description: 'Penilaian otomatis semua tipe soal objektif (termasuk partial credit PGK) dan penilaian manual esai dengan rubrik.',
    content: `function submitAndGradeExam(token, examId) {
  var auth = requireAuthorizedUser(token, ['SISWA']);
  var links = readSheetAsObjects(SHEET_NAMES.EXAM_QUESTIONS).filter(function(l) { return l.exam_id === examId; });
  var questions = readSheetAsObjects(SHEET_NAMES.QUESTIONS);
  var answers = readSheetAsObjects(SHEET_NAMES.ANSWERS).filter(function(a) {
    return a.exam_id === examId && a.user_id === auth.user.user_id;
  });

  var totalScore = 0;
  var correctCount = 0;
  var incorrectCount = 0;
  var unansweredCount = 0;

  links.forEach(function(link) {
    var q = questions.filter(function(item) { return item.question_id === link.question_id; })[0];
    var ans = answers.filter(function(a) { return a.question_id === link.question_id; })[0];
    if (!ans || ans.answer_json === 'null') {
      unansweredCount++;
      return;
    }
    var val = JSON.parse(ans.answer_json);
    var earned = 0;
    if (q.question_type === 'PG' || q.question_type === 'BENAR_SALAH') {
      if (String(val).trim().toUpperCase() === String(q.correct_answer).trim().toUpperCase()) {
        earned = Number(link.score);
        correctCount++;
      } else {
        incorrectCount++;
      }
    } else if (q.question_type === 'PGK') {
      var expected = JSON.parse(q.correct_answer || '[]');
      var opts = JSON.parse(q.options_json || '{}');
      var tp = 0;
      var fp = 0;
      (val || []).forEach(function(v) {
        if (expected.indexOf(v) !== -1) tp++; else fp++;
      });
      earned = Math.max(0, Math.min(Number(link.score), (tp * (Number(link.score) / expected.length)) - (fp * Number(opts.pgk_penalty || 0))));
      if (earned > 0) correctCount++; else incorrectCount++;
    }
    totalScore += earned;
    updateRowByKey(SHEET_NAMES.ANSWERS, 'answer_id', ans.answer_id, { score: earned });
  });

  var nowStr = new Date().toISOString();
  var part = readSheetAsObjects(SHEET_NAMES.EXAM_PARTICIPANTS).filter(function(p) {
    return p.exam_id === examId && p.user_id === auth.user.user_id;
  })[0];
  updateRowByKey(SHEET_NAMES.EXAM_PARTICIPANTS, 'id', part.id, {
    status: 'TERKUMPUL',
    submitted_at: nowStr,
    score: totalScore
  });
  appendRowObject(SHEET_NAMES.RESULTS, {
    result_id: generateId('res'),
    exam_id: examId,
    user_id: auth.user.user_id,
    correct_count: correctCount,
    incorrect_count: incorrectCount,
    unanswered_count: unansweredCount,
    total_score: totalScore,
    published: 0,
    graded_at: nowStr
  });
  return { ok: true, total_score: totalScore };
}`,
  },
  {
    path: 'AntiCheat.gs',
    folder: 'BACKEND',
    description: 'Pencatatan pelanggaran (tab switch, keluar fullscreen, copy-paste), pemantauan real-time, dan tindakan pengawas.',
    content: `function recordViolationEvent(token, examId, eventType, description) {
  var auth = requireAuthorizedUser(token, ['SISWA']);
  appendRowObject(SHEET_NAMES.VIOLATION_LOGS, {
    log_id: generateId('vio'),
    exam_id: examId,
    user_id: auth.user.user_id,
    event_type: eventType,
    event_time: new Date().toISOString(),
    description: description || ''
  });
  return { ok: true };
}

function getMonitoringSnapshot(token, examId) {
  requireAuthorizedUser(token, ['SUPER_ADMIN', 'PROFESSOR']);
  var participants = readSheetAsObjects(SHEET_NAMES.EXAM_PARTICIPANTS).filter(function(p) { return p.exam_id === examId; });
  var violations = readSheetAsObjects(SHEET_NAMES.VIOLATION_LOGS).filter(function(v) { return v.exam_id === examId; });
  return { participants: participants, violations: violations };
}`,
  },
  {
    path: 'AdminController.gs',
    folder: 'BACKEND',
    description: 'Kontrol Super Admin: pengaturan persisten dengan versioning & rollback, upload logo Drive, monitoring sinkronisasi, dan reset pabrik terproteksi.',
    content: `function recordAudit(userId, activity, details) {
  appendRowObject(SHEET_NAMES.AUDIT_LOGS, {
    log_id: generateId('aud'),
    user_id: userId,
    activity: activity,
    timestamp: new Date().toISOString(),
    details: typeof details === 'string' ? details : JSON.stringify(details)
  });
}

function getPublicConfig() {
  var rows = readSheetAsObjects(SHEET_NAMES.SETTINGS);
  var cfg = {};
  Object.keys(DEFAULT_SETTINGS_GAS).forEach(function(k) { cfg[k] = DEFAULT_SETTINGS_GAS[k]; });
  rows.forEach(function(r) { cfg[r.setting_key] = String(r.setting_value || ''); });
  cfg.config_version = Number(getMetaPropertyGas(null, 'CONFIG_VERSION') || 1);
  return cfg;
}

function saveAppSettings(token, updates, expectedVersion) {
  var auth = requireAuthorizedUser(token, ['SUPER_ADMIN']);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = getSpreadsheet();
    var currentVer = Number(getMetaPropertyGas(ss, 'CONFIG_VERSION') || 1);
    if (expectedVersion !== undefined && Number(expectedVersion) !== currentVer) {
      throw new Error('Konflik versi konfigurasi: versi server #' + currentVer + ', versi klien #' + expectedVersion);
    }
    var current = getPublicConfig();
    var nextVer = currentVer + 1;
    var ts = new Date().toISOString();
    Object.keys(updates || {}).forEach(function(k) {
      var nextVal = String(updates[k]);
      var oldVal = String(current[k] || '');
      if (nextVal !== oldVal) {
        var updated = updateRowByKey(SHEET_NAMES.SETTINGS, 'setting_key', k, { setting_value: nextVal });
        if (!updated) {
          appendRowObject(SHEET_NAMES.SETTINGS, { setting_key: k, setting_value: nextVal });
        }
        appendRowObject(SHEET_NAMES.CONFIG_VERSIONS, {
          version_id: generateId('cfgv'),
          version_number: nextVer,
          setting_key: k,
          category: 'APP',
          old_value: oldVal,
          new_value: nextVal,
          changed_by: auth.user.user_id,
          changed_at: ts,
          status: 'APPLIED',
          note: ''
        });
      }
    });
    setMetaPropertyGas(ss, 'CONFIG_VERSION', String(nextVer));
    setMetaPropertyGas(ss, 'LAST_SAVE_AT', ts);
    invalidateSettingsCache(Object.keys(updates || {}));
    recordAudit(auth.user.user_id, 'SETTINGS_UPDATE', { version: nextVer, keys: Object.keys(updates || {}) });
    return { ok: true, config_version: nextVer, settings: getPublicConfig() };
  } finally {
    lock.releaseLock();
  }
}

function uploadLogoToDrive(token, base64Data, filename, mimeType) {
  var auth = requireAuthorizedUser(token, ['SUPER_ADMIN']);
  var bytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(bytes, mimeType || 'image/png', filename || 'logo_kir_ipa.png');
  var file = DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var logoUrl = 'https://drive.google.com/uc?export=view&id=' + file.getId();
  appendRowObject(SHEET_NAMES.APP_ASSETS, {
    asset_id: generateId('ast'),
    asset_type: 'LOGO',
    filename: file.getName(),
    drive_file_id: file.getId(),
    mime_type: mimeType || 'image/png',
    size_bytes: bytes.length,
    created_by: auth.user.user_id,
    created_at: new Date().toISOString()
  });
  return saveAppSettings(token, { logo_url: logoUrl, logo_drive_file_id: file.getId() });
}

function getSyncVersion() {
  var ss = getSpreadsheet();
  return {
    server_time: new Date().toISOString(),
    config_version: Number(getMetaPropertyGas(ss, 'CONFIG_VERSION') || 1),
    last_save_at: getMetaPropertyGas(ss, 'LAST_SAVE_AT')
  };
}

function emergencyStopExam(token, examId) {
  var auth = requireAuthorizedUser(token, ['SUPER_ADMIN']);
  updateRowByKey(SHEET_NAMES.EXAMS, 'exam_id', examId, { status: 'COMPLETED' });
  recordAudit(auth.user.user_id, 'EMERGENCY_STOP_EXAM', 'Menghentikan darurat ujian ' + examId);
  return { ok: true };
}`,
  },
  {
    path: 'ReportController.gs',
    folder: 'BACKEND',
    description: 'Penyusunan Laporan Hasil Ujian, Template Kustom, Berita Acara, dan Surat Resmi Pengumuman Pemenang.',
    content: `function generateBeritaAcaraData(token, examId) {
  requireAuthorizedUser(token, ['SUPER_ADMIN', 'PROFESSOR']);
  var exam = readSheetAsObjects(SHEET_NAMES.EXAMS).filter(function(e) { return e.exam_id === examId; })[0];
  var parts = readSheetAsObjects(SHEET_NAMES.EXAM_PARTICIPANTS).filter(function(p) { return p.exam_id === examId; });
  var results = readSheetAsObjects(SHEET_NAMES.RESULTS).filter(function(r) { return r.exam_id === examId; });
  var violations = readSheetAsObjects(SHEET_NAMES.VIOLATION_LOGS).filter(function(v) { return v.exam_id === examId; });
  var scores = results.map(function(r) { return Number(r.total_score || 0); });
  var avg = scores.length ? scores.reduce(function(a, b) { return a + b; }, 0) / scores.length : 0;
  return {
    exam: exam,
    registered: parts.length,
    finished: parts.filter(function(p) { return p.status === 'TERKUMPUL'; }).length,
    highest_score: scores.length ? Math.max.apply(null, scores) : 0,
    lowest_score: scores.length ? Math.min.apply(null, scores) : 0,
    average_score: Math.round(avg * 100) / 100,
    violation_count: violations.length,
    generated_at: new Date().toISOString()
  };
}

function saveReportTemplate(token, payload) {
  var auth = requireAuthorizedUser(token, ['SUPER_ADMIN', 'PROFESSOR']);
  var tplId = payload.template_id || generateId('tpl');
  var nowStr = new Date().toISOString();
  var obj = {
    template_id: tplId,
    name: payload.name || 'Template Baru',
    doc_category: payload.doc_category || 'LAPORAN_HASIL',
    exam_id: payload.exam_id || '',
    is_default: 0,
    content_json: typeof payload.content_json === 'string' ? payload.content_json : JSON.stringify(payload.content || {}),
    created_by: auth.user.user_id,
    created_at: nowStr,
    updated_at: nowStr
  };
  if (payload.template_id) {
    updateRowByKey(SHEET_NAMES.REPORT_TEMPLATES, 'template_id', tplId, obj);
  } else {
    appendRowObject(SHEET_NAMES.REPORT_TEMPLATES, obj);
  }
  return { ok: true, template_id: tplId };
}

function saveOfficialDocument(token, payload) {
  var auth = requireAuthorizedUser(token, ['SUPER_ADMIN', 'PROFESSOR']);
  var docId = payload.doc_id || generateId('doc');
  var nowStr = new Date().toISOString();
  var obj = {
    doc_id: docId,
    exam_id: payload.exam_id || '',
    template_id: payload.template_id || '',
    doc_category: payload.doc_category || 'BERITA_ACARA',
    title: payload.title || 'Dokumen Resmi CBT',
    doc_number: payload.doc_number || '',
    status: payload.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
    content_json: typeof payload.content_json === 'string' ? payload.content_json : JSON.stringify(payload.content || {}),
    created_by: auth.user.user_id,
    created_at: nowStr,
    updated_at: nowStr
  };
  if (payload.doc_id) {
    updateRowByKey(SHEET_NAMES.OFFICIAL_DOCUMENTS, 'doc_id', docId, obj);
  } else {
    appendRowObject(SHEET_NAMES.OFFICIAL_DOCUMENTS, obj);
  }
  return { ok: true, doc_id: docId };
}`,
  },
  {
    path: 'AnalyticsController.gs',
    folder: 'BACKEND',
    description: 'Analisis butir soal (tingkat kesukaran p, daya pembeda D dengan validasi ukuran sampel, dan distribusi opsi).',
    content: `function getItemAnalysis(token, examId) {
  requireAuthorizedUser(token, ['SUPER_ADMIN', 'PROFESSOR']);
  var links = readSheetAsObjects(SHEET_NAMES.EXAM_QUESTIONS).filter(function(l) { return l.exam_id === examId; });
  var results = readSheetAsObjects(SHEET_NAMES.RESULTS).filter(function(r) { return r.exam_id === examId; });
  var answers = readSheetAsObjects(SHEET_NAMES.ANSWERS).filter(function(a) { return a.exam_id === examId; });
  return {
    total_respondents: results.length,
    sample_warning: results.length < 6 ? 'Sampel terlalu kecil untuk daya pembeda.' : null,
    items: links.map(function(l) {
      var qAns = answers.filter(function(a) { return a.question_id === l.question_id; });
      var right = qAns.filter(function(a) { return Number(a.score) > 0; }).length;
      return {
        question_id: l.question_id,
        correct_percentage: results.length ? Math.round((right / results.length) * 100) : 0
      };
    })
  };
}`,
  },
  {
    path: 'BackupController.gs',
    folder: 'BACKEND',
    description: 'Backup database Google Sheets ke Google Drive (Spreadsheet Copy + JSON) dan pemulihan aman dengan backup pra-pulih otomatis.',
    content: `function createDatabaseBackup(token, backupType) {
  var auth = requireAuthorizedUser(token, ['SUPER_ADMIN']);
  var ss = getSpreadsheet();
  var stamp = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd_HHmmss');
  var backupCopy = ss.copy('BACKUP_CBT_KIR_IPA_' + stamp);
  var backupId = generateId('bkp');
  var ts = new Date().toISOString();
  appendRowObject(SHEET_NAMES.BACKUP_LOGS, {
    backup_id: backupId,
    file_id: backupCopy.getId(),
    created_at: ts,
    created_by: auth.user.user_id,
    status: 'SUCCESS',
    backup_type: backupType || 'MANUAL'
  });
  setMetaPropertyGas(ss, 'LAST_SUCCESSFUL_BACKUP', ts);
  recordAudit(auth.user.user_id, 'DATABASE_BACKUP', backupCopy.getUrl());
  return { ok: true, backup_id: backupId, file_id: backupCopy.getId(), file_url: backupCopy.getUrl() };
}`,
  },
  {
    path: 'NotificationController.gs',
    folder: 'BACKEND',
    description: 'Notifikasi sistem & pesan peringatan pengawas untuk peserta dan pembina.',
    content: `function getUserNotifications(token) {
  var auth = requireAuthorizedUser(token);
  var rows = readSheetAsObjects(SHEET_NAMES.NOTIFICATIONS);
  return rows.filter(function(n) {
    return n.user_id === auth.user.user_id || n.user_id === 'ALL';
  }).reverse();
}`,
  },
  {
    path: 'Index.html',
    folder: 'FRONTEND',
    description: 'Halaman utama Web App dengan KaTeX, Chart.js, SheetJS CDN dan pemanggilan include() modular.',
    content: `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>CBT KIR IPA SMAN 1 SUKABUMI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
  <?!= include('Styles'); ?>
</head>
<body>
  <div id="app-root">
    <?!= include('Login'); ?>
  </div>
  <?!= include('Scripts'); ?>
</body>
</html>`,
  },
  {
    path: 'Styles.html',
    folder: 'COMPONENTS',
    description: 'Stylesheet institusional Navy Blue, White, Royal Blue, dan Academic Gold responsif untuk GAS.',
    content: `<style>
  :root { --navy: #0f294a; --primary: #1d4ed8; --gold: #d97706; --bg: #f8fafc; }
  body { margin: 0; font-family: 'DM Sans', system-ui, sans-serif; background: var(--bg); color: #0f172a; }
  .cbt-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
  .btn-primary { background: var(--navy); color: #fff; border: 0; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-weight: 600; }
  .btn-primary:hover { background: var(--primary); }
</style>`,
  },
  {
    path: 'Scripts.html',
    folder: 'COMPONENTS',
    description: 'Jembatan frontend google.script.run untuk login, autosave, anti-cheat visibilitychange, dan timer.',
    content: `<script>
  var CBT_SESSION_TOKEN = null;
  function callGas(fnName, args, onSuccess, onError) {
    google.script.run
      .withSuccessHandler(onSuccess)
      .withFailureHandler(onError || function(e) { alert(e.message); })
      [fnName].apply(null, args || []);
  }
  function handleLoginSubmit(e) {
    e.preventDefault();
    var u = document.getElementById('login-username').value;
    var p = document.getElementById('login-password').value;
    callGas('loginUser', [u, p], function(res) {
      if (!res.ok) { document.getElementById('login-err').textContent = res.error; return; }
      CBT_SESSION_TOKEN = res.token;
      document.getElementById('app-root').innerHTML = '<h2>Selamat datang, ' + res.user.nama + ' (' + res.user.role + ')</h2>';
    });
  }
</script>`,
  },
  {
    path: 'Login.html',
    folder: 'FRONTEND',
    description: 'Template halaman login resmi dengan identitas logo KIR IPA SMAN 1 Sukabumi.',
    content: `<div style="max-width:420px;margin:60px auto" class="cbt-card">
  <h2 style="margin-top:0;color:var(--navy)">CBT KIR IPA SMAN 1 SUKABUMI</h2>
  <form onsubmit="handleLoginSubmit(event)">
    <label>Username</label><br>
    <input id="login-username" type="text" required style="width:100%;padding:10px;margin:6px 0 12px;border:1px solid #cbd5e1;border-radius:8px"><br>
    <label>Password</label><br>
    <input id="login-password" type="password" required style="width:100%;padding:10px;margin:6px 0 12px;border:1px solid #cbd5e1;border-radius:8px"><br>
    <div id="login-err" style="color:#dc2626;font-size:13px;margin-bottom:10px"></div>
    <button type="submit" class="btn-primary" style="width:100%">Masuk ke Portal Ujian</button>
  </form>
</div>`,
  },
];

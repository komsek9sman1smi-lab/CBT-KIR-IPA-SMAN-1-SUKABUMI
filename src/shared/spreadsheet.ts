import * as XLSX from 'xlsx';
import type {
  ImportEntityType,
  QuestionOptionsPayload,
  QuestionType,
} from './types.ts';

export interface ImportFieldDef {
  key: string;
  label: string;
  required: boolean;
  description: string;
  aliases: string[];
}

export const IMPORT_FIELD_DEFINITIONS: Record<ImportEntityType, ImportFieldDef[]> = {
  USERS: [
    {
      key: 'username',
      label: 'Username / NIS / ID',
      required: true,
      description: 'Identitas login unik peserta/pengguna',
      aliases: ['username', 'user', 'nis', 'nisn', 'id_peserta', 'no_peserta', 'kode_peserta', 'akun'],
    },
    {
      key: 'nama',
      label: 'Nama Lengkap',
      required: true,
      description: 'Nama lengkap peserta atau pembina',
      aliases: ['nama', 'nama_lengkap', 'name', 'full_name', 'nama_peserta', 'nama_siswa', 'peserta'],
    },
    {
      key: 'kelas',
      label: 'Kelas / Divisi / Asal',
      required: false,
      description: 'Contoh: XI-IPA-1 atau Divisi Fisika',
      aliases: ['kelas', 'class', 'divisi', 'asal_kelas', 'rombongan_belajar', 'rombel', 'unit'],
    },
    {
      key: 'password',
      label: 'Password Awal',
      required: false,
      description: 'Opsional (default: SiswaKir2026!)',
      aliases: ['password', 'pass', 'sandi', 'kata_sandi', 'pin'],
    },
    {
      key: 'role',
      label: 'Role',
      required: false,
      description: 'SISWA, PROFESSOR, atau SUPER_ADMIN',
      aliases: ['role', 'peran', 'hak_akses', 'level'],
    },
  ],
  QUESTIONS: [
    {
      key: 'question_type',
      label: 'Jenis Soal',
      required: true,
      description: 'PG, PGK, BENAR_SALAH, ISIAN_SINGKAT, MENJODOHKAN, MENGURUTKAN, ESAI',
      aliases: ['question_type', 'tipe', 'jenis_soal', 'jenis', 'type', 'bentuk_soal'],
    },
    {
      key: 'question_text',
      label: 'Teks Pertanyaan',
      required: true,
      description: 'Mendukung teks Indonesia, simbol ilmiah, LaTeX $...$, dan HTML',
      aliases: ['question_text', 'pertanyaan', 'soal', 'isi_soal', 'teks_soal', 'question'],
    },
    {
      key: 'option_a',
      label: 'Opsi A',
      required: false,
      description: 'Pilihan jawaban A (wajib untuk PG/PGK)',
      aliases: ['option_a', 'opsi_a', 'pilihan_a', 'a', 'opt_a'],
    },
    {
      key: 'option_b',
      label: 'Opsi B',
      required: false,
      description: 'Pilihan jawaban B (wajib untuk PG/PGK)',
      aliases: ['option_b', 'opsi_b', 'pilihan_b', 'b', 'opt_b'],
    },
    {
      key: 'option_c',
      label: 'Opsi C',
      required: false,
      description: 'Pilihan jawaban C',
      aliases: ['option_c', 'opsi_c', 'pilihan_c', 'c', 'opt_c'],
    },
    {
      key: 'option_d',
      label: 'Opsi D',
      required: false,
      description: 'Pilihan jawaban D',
      aliases: ['option_d', 'opsi_d', 'pilihan_d', 'd', 'opt_d'],
    },
    {
      key: 'option_e',
      label: 'Opsi E',
      required: false,
      description: 'Pilihan jawaban E',
      aliases: ['option_e', 'opsi_e', 'pilihan_e', 'e', 'opt_e'],
    },
    {
      key: 'correct_answer',
      label: 'Kunci Jawaban',
      required: false,
      description: 'Mis. A | A,C | BENAR | Na|natrium | Kiri=>Kanan | Item1|Item2',
      aliases: ['correct_answer', 'kunci_jawaban', 'kunci', 'jawaban', 'answer', 'key'],
    },
    {
      key: 'explanation',
      label: 'Pembahasan',
      required: false,
      description: 'Penjelasan jawaban',
      aliases: ['explanation', 'pembahasan', 'penjelasan', 'uraian'],
    },
    {
      key: 'image_url',
      label: 'URL / Path Gambar',
      required: false,
      description: 'URL atau path gambar ilustrasi soal (opsional)',
      aliases: ['image_url', 'gambar', 'image', 'url_gambar', 'ilustrasi', 'foto'],
    },
    {
      key: 'category',
      label: 'Kategori / Bidang',
      required: false,
      description: 'Fisika, Kimia, Biologi, Metode Ilmiah, dll.',
      aliases: ['category', 'kategori', 'bidang', 'mapel', 'mata_pelajaran', 'subject'],
    },
    {
      key: 'materi',
      label: 'Topik / Materi',
      required: false,
      description: 'Subtopik materi',
      aliases: ['materi', 'topik', 'subtopik', 'topic', 'kompetensi'],
    },
    {
      key: 'difficulty',
      label: 'Tingkat Kesulitan',
      required: false,
      description: 'MUDAH, SEDANG, SULIT, atau OLIMPIADE',
      aliases: ['difficulty', 'kesulitan', 'tingkat_kesulitan', 'level'],
    },
    {
      key: 'score',
      label: 'Bobot Skor',
      required: false,
      description: 'Angka bobot nilai soal (default 10)',
      aliases: ['score', 'bobot', 'skor', 'poin', 'nilai', 'weight'],
    },
  ],
  EXAM_QUESTIONS: [],
  EXAM_PARTICIPANTS: [
    {
      key: 'username',
      label: 'Username / NIS',
      required: true,
      description: 'Username siswa (otomatis dibuat jika belum terdaftar dan Nama diisi)',
      aliases: ['username', 'user', 'nis', 'nisn', 'id_peserta', 'no_peserta', 'akun'],
    },
    {
      key: 'nama',
      label: 'Nama Lengkap',
      required: false,
      description: 'Wajib jika siswa belum terdaftar di sistem',
      aliases: ['nama', 'nama_lengkap', 'name', 'nama_peserta', 'nama_siswa', 'peserta'],
    },
    {
      key: 'kelas',
      label: 'Kelas / Divisi',
      required: false,
      description: 'Kelas peserta jika membuat akun baru',
      aliases: ['kelas', 'class', 'divisi', 'asal_kelas', 'rombel'],
    },
    {
      key: 'password',
      label: 'Password Awal',
      required: false,
      description: 'Dipakai hanya jika akun belum terdaftar',
      aliases: ['password', 'pass', 'sandi'],
    },
  ],
};

IMPORT_FIELD_DEFINITIONS.EXAM_QUESTIONS = IMPORT_FIELD_DEFINITIONS.QUESTIONS;

export interface ParsedSheetData {
  headers: string[];
  rows: Record<string, string>[];
}

export interface ParsedWorkbookData {
  sheetNames: string[];
  sheets: Record<string, ParsedSheetData>;
}

function normalizeHeaderToken(h: string): string {
  return String(h ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseSpreadsheetBuffer(
  input: ArrayBuffer | Uint8Array,
  fileName = 'import.xlsx',
): ParsedWorkbookData {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const lower = fileName.toLowerCase();
  let workbook: XLSX.WorkBook;

  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    let text = new TextDecoder('utf-8').decode(bytes);
    text = text.replace(/^\uFEFF/, '');
    workbook = XLSX.read(text, { type: 'string', codepage: 65001, raw: false });
  } else {
    workbook = XLSX.read(bytes, { type: 'array', codepage: 65001, raw: false });
  }

  const sheets: Record<string, ParsedSheetData> = {};
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    if (matrix.length === 0) {
      sheets[name] = { headers: [], rows: [] };
      continue;
    }

    const rawHeaderRow = (matrix[0] || []).map((cell, idx) => {
      const cleaned = String(cell ?? '')
        .replace(/^\uFEFF/, '')
        .trim();
      return cleaned || `Kolom_${idx + 1}`;
    });

    // Ensure unique header names so duplicate column titles don't overwrite each other
    const seenCounts = new Map<string, number>();
    const headers = rawHeaderRow.map((h) => {
      const count = seenCounts.get(h) ?? 0;
      seenCounts.set(h, count + 1);
      return count === 0 ? h : `${h}_${count + 1}`;
    });

    const rows: Record<string, string>[] = [];
    for (let r = 1; r < matrix.length; r++) {
      const rawRow = matrix[r] || [];
      const rowObj: Record<string, string> = {};
      let hasAnyValue = false;
      for (let c = 0; c < headers.length; c++) {
        const val = String(rawRow[c] ?? '').trim();
        if (val.length > 0) hasAnyValue = true;
        rowObj[headers[c]] = val;
      }
      if (hasAnyValue) {
        rows.push(rowObj);
      }
    }

    sheets[name] = { headers, rows };
  }

  return {
    sheetNames: workbook.SheetNames,
    sheets,
  };
}

export function autoMapColumns(
  sourceHeaders: string[],
  entityType: ImportEntityType,
): Record<string, string> {
  const fields = IMPORT_FIELD_DEFINITIONS[entityType];
  const mapping: Record<string, string> = {};
  const normalizedSource = sourceHeaders.map((h) => ({
    raw: h,
    norm: normalizeHeaderToken(h),
  }));

  for (const field of fields) {
    const exactMatch = normalizedSource.find((s) => s.norm === field.key);
    if (exactMatch) {
      mapping[field.key] = exactMatch.raw;
      continue;
    }
    const aliasMatch = normalizedSource.find((s) => field.aliases.includes(s.norm));
    if (aliasMatch) {
      mapping[field.key] = aliasMatch.raw;
      continue;
    }
    mapping[field.key] = '';
  }

  return mapping;
}

export function normalizeQuestionTypeAlias(raw: string): QuestionType | null {
  const t = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, '_');
  if (['PG', 'PILIHAN_GANDA', 'MULTIPLE_CHOICE', 'MC'].includes(t)) return 'PG';
  if (['PGK', 'PG_KOMPLEKS', 'PILIHAN_GANDA_KOMPLEKS', 'CHECKBOX', 'MULTI'].includes(t)) return 'PGK';
  if (['BENAR_SALAH', 'B_S', 'BS', 'TRUE_FALSE', 'TF'].includes(t)) return 'BENAR_SALAH';
  if (['ISIAN_SINGKAT', 'ISIAN', 'SHORT_ANSWER', 'FILL_BLANK'].includes(t)) return 'ISIAN_SINGKAT';
  if (['MENJODOHKAN', 'MATCHING', 'JODOH'].includes(t)) return 'MENJODOHKAN';
  if (['MENGURUTKAN', 'ORDERING', 'URUT', 'SORT'].includes(t)) return 'MENGURUTKAN';
  if (['ESAI', 'ESSAY', 'URAIAN'].includes(t)) return 'ESAI';
  return null;
}

export function buildQuestionDedupeKey(questionType: string, questionText: string): string {
  const plain = String(questionText ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return `${String(questionType ?? '').trim().toUpperCase()}::${plain}`;
}

export function isValidImageReference(url: string): boolean {
  const trimmed = String(url ?? '').trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('/')) return true;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(trimmed)) return true;
  return false;
}

export function buildNormalizedQuestionFromMapped(mapped: Record<string, string>): {
  valid: boolean;
  reason?: string;
  normalized?: {
    question_type: QuestionType;
    question_text: string;
    options: QuestionOptionsPayload;
    correct_answer: unknown;
    explanation: string;
    image_url: string;
    category: string;
    materi: string;
    difficulty: 'MUDAH' | 'SEDANG' | 'SULIT' | 'OLIMPIADE';
    score: number;
    dedupe_key: string;
  };
} {
  const qType = normalizeQuestionTypeAlias(mapped.question_type || '');
  if (!qType) {
    return {
      valid: false,
      reason: `Jenis soal "${mapped.question_type || '(kosong)'}" tidak dikenal (gunakan PG/PGK/BENAR_SALAH/ISIAN_SINGKAT/MENJODOHKAN/MENGURUTKAN/ESAI).`,
    };
  }

  const qText = String(mapped.question_text ?? '').trim();
  if (!qText) {
    return { valid: false, reason: 'Teks pertanyaan kosong.' };
  }

  const imageUrl = String(mapped.image_url ?? '').trim();
  if (!isValidImageReference(imageUrl)) {
    return { valid: false, reason: 'Format URL gambar tidak valid (gunakan https://, /assets/..., atau data:image/...).' };
  }

  const rawAnswer = String(mapped.correct_answer ?? '').trim();
  if (qType !== 'ESAI' && !rawAnswer) {
    return { valid: false, reason: `Kunci jawaban wajib diisi untuk jenis soal ${qType}.` };
  }

  const rawDiff = String(mapped.difficulty ?? 'SEDANG').trim().toUpperCase();
  const difficulty = (['MUDAH', 'SEDANG', 'SULIT', 'OLIMPIADE'].includes(rawDiff)
    ? rawDiff
    : 'SEDANG') as 'MUDAH' | 'SEDANG' | 'SULIT' | 'OLIMPIADE';

  const parsedScore = Number(mapped.score ?? 10);
  if (mapped.score && (!Number.isFinite(parsedScore) || parsedScore <= 0)) {
    return { valid: false, reason: `Bobot skor "${mapped.score}" harus angka lebih dari 0.` };
  }
  const score = Number.isFinite(parsedScore) && parsedScore > 0 ? parsedScore : 10;

  let options: QuestionOptionsPayload = {};
  let correctAnswer: unknown = rawAnswer;

  if (qType === 'PG' || qType === 'PGK') {
    const choices = (['A', 'B', 'C', 'D', 'E'] as const)
      .map((lbl) => ({
        id: lbl,
        label: lbl,
        text: String(mapped[`option_${lbl.toLowerCase()}`] ?? '').trim(),
      }))
      .filter((c) => c.text.length > 0);
    if (choices.length < 2) {
      return { valid: false, reason: 'Soal PG/PGK membutuhkan minimal 2 pilihan jawaban (mis. Opsi A dan Opsi B).' };
    }
    const availableLabels = new Set<string>(choices.map((c) => c.label));
    if (qType === 'PG') {
      const normalizedKey = rawAnswer.toUpperCase();
      if (!availableLabels.has(normalizedKey)) {
        return { valid: false, reason: `Kunci jawaban "${rawAnswer}" tidak sesuai dengan opsi yang terisi.` };
      }
      options = { choices };
      correctAnswer = normalizedKey;
    } else {
      const keys = rawAnswer
        .split(/[,|;]/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (keys.length === 0 || keys.some((k) => !availableLabels.has(k))) {
        return { valid: false, reason: `Kunci PGK "${rawAnswer}" harus merujuk opsi yang tersedia (mis. A,C).` };
      }
      options = { choices, pgk_scoring: 'PARTIAL', pgk_penalty: 0 };
      correctAnswer = keys;
    }
  } else if (qType === 'BENAR_SALAH') {
    const norm = rawAnswer.toUpperCase();
    const mappedBs = ['BENAR', 'B', 'TRUE', 'YA'].includes(norm)
      ? 'BENAR'
      : ['SALAH', 'S', 'FALSE', 'TIDAK'].includes(norm)
        ? 'SALAH'
        : null;
    if (!mappedBs) {
      return { valid: false, reason: `Kunci Benar/Salah "${rawAnswer}" tidak valid (isi BENAR atau SALAH).` };
    }
    correctAnswer = mappedBs;
  } else if (qType === 'ISIAN_SINGKAT') {
    const variants = rawAnswer
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (variants.length === 0) {
      return { valid: false, reason: 'Variasi jawaban singkat kosong.' };
    }
    options = { accepted_answers: variants, case_sensitive: false };
    correctAnswer = variants[0];
  } else if (qType === 'MENJODOHKAN') {
    // Support JSON object OR "Kiri1=>Kanan1 | Kiri2=>Kanan2" in correct_answer (or option_a..e)
    let pairs: Array<{ id: string; left: string; right: string }> = [];
    if (rawAnswer.startsWith('{')) {
      try {
        const obj = JSON.parse(rawAnswer) as Record<string, string>;
        pairs = Object.entries(obj).map(([left, right], i) => ({
          id: `p${i + 1}`,
          left: String(left).trim(),
          right: String(right).trim(),
        }));
      } catch {
        pairs = [];
      }
    } else {
      const segments = rawAnswer.split('|').map((s) => s.trim()).filter(Boolean);
      pairs = segments
        .map((seg, i) => {
          const parts = seg.split(/=>|->|:/);
          if (parts.length < 2) return null;
          return {
            id: `p${i + 1}`,
            left: parts[0].trim(),
            right: parts.slice(1).join(':').trim(),
          };
        })
        .filter((x): x is { id: string; left: string; right: string } => Boolean(x && x.left && x.right));
    }
    if (pairs.length < 2) {
      return { valid: false, reason: 'Menjodohkan butuh minimal 2 pasangan (format: Kiri1=>Kanan1 | Kiri2=>Kanan2).' };
    }
    options = { matching_pairs: pairs };
    const ansMap: Record<string, string> = {};
    pairs.forEach((p) => {
      ansMap[p.id] = p.right;
    });
    correctAnswer = ansMap;
  } else if (qType === 'MENGURUTKAN') {
    let items: string[] = [];
    if (rawAnswer.startsWith('[')) {
      try {
        const arr = JSON.parse(rawAnswer) as unknown[];
        items = arr.map((x) => String(x).trim()).filter(Boolean);
      } catch {
        items = [];
      }
    } else {
      items = rawAnswer.split('|').map((s) => s.trim()).filter(Boolean);
    }
    if (items.length < 2) {
      return { valid: false, reason: 'Mengurutkan butuh minimal 2 item dipisahkan tanda | (urutan dari awal ke akhir).' };
    }
    const orderingItems = items.map((text, idx) => ({ id: `ord_${idx + 1}`, text }));
    options = { ordering_items: orderingItems };
    correctAnswer = orderingItems.map((i) => i.id);
  } else if (qType === 'ESAI') {
    options = { essay_max_chars: 1500 };
    correctAnswer = rawAnswer || 'RUBRIK_MANUAL';
  }

  return {
    valid: true,
    normalized: {
      question_type: qType,
      question_text: qText,
      options,
      correct_answer: correctAnswer,
      explanation: String(mapped.explanation ?? '').trim(),
      image_url: imageUrl,
      category: String(mapped.category ?? '').trim() || 'Umum',
      materi: String(mapped.materi ?? '').trim(),
      difficulty,
      score,
      dedupe_key: buildQuestionDedupeKey(qType, qText),
    },
  };
}

export interface ValidatedPreviewRow {
  rowNumber: number;
  mapped: Record<string, string>;
  status: 'VALID' | 'DUPLICATE_IN_FILE' | 'DUPLICATE_IN_DB' | 'ERROR';
  reason: string;
  normalizedPayload?: Record<string, unknown>;
}

export function applyMappingAndValidate(
  rawRows: Record<string, unknown>[],
  mapping: Record<string, string>,
  entityType: ImportEntityType,
  existingKeys: Set<string> = new Set(),
): {
  previewRows: ValidatedPreviewRow[];
  validRows: ValidatedPreviewRow[];
  duplicateRows: ValidatedPreviewRow[];
  errorRows: ValidatedPreviewRow[];
} {
  const fields = IMPORT_FIELD_DEFINITIONS[entityType];
  const seenInFile = new Set<string>();
  const previewRows: ValidatedPreviewRow[] = [];

  for (let idx = 0; idx < rawRows.length; idx++) {
    const raw = rawRows[idx] ?? {};
    const mapped: Record<string, string> = {};
    for (const f of fields) {
      const sourceCol = mapping[f.key];
      mapped[f.key] = sourceCol ? String(raw[sourceCol] ?? '').trim() : '';
    }

    if (entityType === 'USERS' || entityType === 'EXAM_PARTICIPANTS') {
      const username = (mapped.username || '').toLowerCase().trim();
      const nama = (mapped.nama || '').trim();
      if (!username) {
        previewRows.push({
          rowNumber: idx + 1,
          mapped,
          status: 'ERROR',
          reason: 'Username / NIS wajib diisi dan tidak boleh kosong.',
        });
        continue;
      }
      if (!/^[a-z0-9._-]+$/.test(username)) {
        previewRows.push({
          rowNumber: idx + 1,
          mapped,
          status: 'ERROR',
          reason: `Username "${username}" mengandung karakter tidak valid (gunakan huruf, angka, titik, garis bawah, atau strip).`,
        });
        continue;
      }
      if (entityType === 'USERS' && !nama) {
        previewRows.push({
          rowNumber: idx + 1,
          mapped,
          status: 'ERROR',
          reason: 'Nama lengkap wajib diisi.',
        });
        continue;
      }
      const role = (mapped.role || 'SISWA').toUpperCase();
      if (entityType === 'USERS' && !['SUPER_ADMIN', 'PROFESSOR', 'SISWA'].includes(role)) {
        previewRows.push({
          rowNumber: idx + 1,
          mapped,
          status: 'ERROR',
          reason: `Role "${role}" tidak valid (gunakan SISWA, PROFESSOR, atau SUPER_ADMIN).`,
        });
        continue;
      }
      if (mapped.password && mapped.password.length < 6) {
        previewRows.push({
          rowNumber: idx + 1,
          mapped,
          status: 'ERROR',
          reason: 'Password minimal 6 karakter jika diisi.',
        });
        continue;
      }
      if (seenInFile.has(username)) {
        previewRows.push({
          rowNumber: idx + 1,
          mapped,
          status: 'DUPLICATE_IN_FILE',
          reason: `Duplikat dalam berkas: username "${username}" muncul lebih dari satu kali.`,
        });
        continue;
      }
      seenInFile.add(username);

      if (entityType === 'USERS' && existingKeys.has(username)) {
        previewRows.push({
          rowNumber: idx + 1,
          mapped,
          status: 'DUPLICATE_IN_DB',
          reason: `Username "${username}" sudah terdaftar di sistem (akan dilewati agar tidak duplikat).`,
        });
        continue;
      }
      if (entityType === 'EXAM_PARTICIPANTS' && existingKeys.has(username)) {
        previewRows.push({
          rowNumber: idx + 1,
          mapped,
          status: 'DUPLICATE_IN_DB',
          reason: `Peserta "${username}" sudah terdaftar pada ujian ini (akan dilewati agar tidak duplikat).`,
        });
        continue;
      }

      previewRows.push({
        rowNumber: idx + 1,
        mapped,
        status: 'VALID',
        reason: 'Siap diimpor',
        normalizedPayload: {
          username,
          nama,
          kelas: mapped.kelas || '',
          password: mapped.password || '',
          role,
        },
      });
    } else {
      // QUESTIONS or EXAM_QUESTIONS
      const res = buildNormalizedQuestionFromMapped(mapped);
      if (!res.valid || !res.normalized) {
        previewRows.push({
          rowNumber: idx + 1,
          mapped,
          status: 'ERROR',
          reason: res.reason || 'Format soal tidak valid.',
        });
        continue;
      }
      const key = res.normalized.dedupe_key;
      if (seenInFile.has(key)) {
        previewRows.push({
          rowNumber: idx + 1,
          mapped,
          status: 'DUPLICATE_IN_FILE',
          reason: 'Soal identik muncul lebih dari satu kali dalam berkas ini.',
        });
        continue;
      }
      seenInFile.add(key);

      if (existingKeys.has(key)) {
        previewRows.push({
          rowNumber: idx + 1,
          mapped,
          status: 'DUPLICATE_IN_DB',
          reason:
            entityType === 'EXAM_QUESTIONS'
              ? 'Soal sudah ada di Bank Soal / Ujian ini (akan ditautkan tanpa duplikasi Bank Soal).'
              : 'Soal identik sudah tersimpan di Bank Soal (akan dilewati agar tidak duplikat).',
          normalizedPayload: res.normalized,
        });
        continue;
      }

      previewRows.push({
        rowNumber: idx + 1,
        mapped,
        status: 'VALID',
        reason: 'Siap diimpor',
        normalizedPayload: res.normalized,
      });
    }
  }

  return {
    previewRows,
    validRows: previewRows.filter((r) => r.status === 'VALID'),
    duplicateRows: previewRows.filter(
      (r) => r.status === 'DUPLICATE_IN_FILE' || r.status === 'DUPLICATE_IN_DB',
    ),
    errorRows: previewRows.filter((r) => r.status === 'ERROR'),
  };
}

export function generateUtf8Csv(
  rows: Record<string, unknown>[],
  orderedColumns?: string[],
): string {
  const columns =
    orderedColumns && orderedColumns.length > 0
      ? orderedColumns
      : Array.from(
          rows.reduce<Set<string>>((acc, row) => {
            Object.keys(row).forEach((k) => acc.add(k));
            return acc;
          }, new Set<string>()),
        );

  if (columns.length === 0) return '\uFEFF';

  const escapeCsvCell = (value: unknown): string => {
    const str = value === null || value === undefined ? '' : String(value);
    if (/[",\r\n;]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [columns.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((col) => escapeCsvCell(row[col])).join(','));
  }

  // Include UTF-8 BOM so Microsoft Excel properly renders Indonesian characters & scientific symbols (Δ, α, °C)
  return `\uFEFF${lines.join('\r\n')}`;
}

export function buildMultiSheetWorkbook(
  sheets: Array<{ name: string; rows: Record<string, unknown>[] }>,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  for (const sheet of sheets) {
    let cleanName = (sheet.name || 'Data').replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Data';
    let suffix = 1;
    while (usedNames.has(cleanName)) {
      const tag = `_${suffix++}`;
      cleanName = cleanName.slice(0, 31 - tag.length) + tag;
    }
    usedNames.add(cleanName);

    const safeRows = sheet.rows.length > 0 ? sheet.rows : [{ Keterangan: 'Belum ada data' }];
    const ws = XLSX.utils.json_to_sheet(safeRows);

    // Auto-calculate readable column widths clamped to [12, 56]
    const keys = Object.keys(safeRows[0] || {});
    ws['!cols'] = keys.map((k) => {
      let maxLen = k.length;
      for (const r of safeRows.slice(0, 200)) {
        const valLen = String(r[k] ?? '').split('\n')[0].length;
        if (valLen > maxLen) maxLen = valLen;
      }
      return { wch: Math.min(56, Math.max(12, maxLen + 3)) };
    });

    XLSX.utils.book_append_sheet(wb, ws, cleanName);
  }

  return wb;
}

export function getSampleTemplateRows(entityType: ImportEntityType): Record<string, unknown>[] {
  if (entityType === 'USERS') {
    return [
      {
        username: 'siswa08',
        nama: 'Rizky Ramadhan',
        kelas: 'X-MIPA-1',
        password: 'SiswaKir2026!',
        role: 'SISWA',
      },
      {
        username: 'siswa09',
        nama: 'Putri Amanda',
        kelas: 'XI-IPA-1',
        password: 'SiswaKir2026!',
        role: 'SISWA',
      },
    ];
  }
  if (entityType === 'EXAM_PARTICIPANTS') {
    return [
      {
        username: 'siswa01',
        nama: 'Nadia Putri Ramadhani',
        kelas: 'XI-IPA-1',
        password: '',
      },
      {
        username: 'siswa10',
        nama: 'Bagas Aditya Pratama',
        kelas: 'X-MIPA-2',
        password: 'SiswaKir2026!',
      },
    ];
  }
  return [
    {
      question_type: 'PG',
      question_text: '<p>Rumus energi kinetik benda bermassa $m$ dengan kecepatan $v$ adalah...</p>',
      option_a: '$\\frac{1}{2}mv^2$',
      option_b: '$mv$',
      option_c: '$mgh$',
      option_d: '$ma$',
      option_e: '$\\frac{1}{2}kx^2$',
      correct_answer: 'A',
      explanation: 'Energi kinetik translasi dirumuskan $E_k = \\frac{1}{2}mv^2$.',
      image_url: '',
      category: 'Fisika',
      materi: 'Usaha dan Energi',
      difficulty: 'MUDAH',
      score: 10,
    },
    {
      question_type: 'PGK',
      question_text: '<p>Manakah gas rumah kaca utama di atmosfer?</p>',
      option_a: 'Karbon dioksida ($\\text{CO}_2$)',
      option_b: 'Nitrogen ($\\text{N}_2$)',
      option_c: 'Metana ($\\text{CH}_4$)',
      option_d: 'Argon ($\\text{Ar}$)',
      option_e: '',
      correct_answer: 'A,C',
      explanation: '$\\text{CO}_2$ dan $\\text{CH}_4$ menyerap radiasi inframerah.',
      image_url: '',
      category: 'Kimia',
      materi: 'Kimia Lingkungan',
      difficulty: 'SEDANG',
      score: 15,
    },
    {
      question_type: 'BENAR_SALAH',
      question_text: '<p>Titik didih air murni pada tekanan 1 atm adalah $100^\\circ\\text{C}$.</p>',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      option_e: '',
      correct_answer: 'BENAR',
      explanation: 'Pada tekanan standar 1 atm, air mendidih pada suhu 100 °C.',
      image_url: '',
      category: 'Fisika',
      materi: 'Suhu dan Kalor',
      difficulty: 'MUDAH',
      score: 10,
    },
    {
      question_type: 'ISIAN_SINGKAT',
      question_text: '<p>Simbol unsur kimia untuk Natrium adalah...</p>',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      option_e: '',
      correct_answer: 'Na|natrium',
      explanation: 'Natrium berasal dari bahasa Latin Natrium (Na).',
      image_url: '',
      category: 'Kimia',
      materi: 'Sistem Periodik Unsur',
      difficulty: 'MUDAH',
      score: 10,
    },
    {
      question_type: 'MENJODOHKAN',
      question_text: '<p>Pasangkan besaran berikut dengan satuan SI yang tepat:</p>',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      option_e: '',
      correct_answer: 'Gaya=>Newton | Usaha=>Joule | Daya=>Watt',
      explanation: 'Gaya dalam Newton, Usaha dalam Joule, Daya dalam Watt.',
      image_url: '',
      category: 'Fisika',
      materi: 'Besaran dan Satuan',
      difficulty: 'MUDAH',
      score: 15,
    },
    {
      question_type: 'MENGURUTKAN',
      question_text: '<p>Urutkan langkah metode ilmiah secara sistematis:</p>',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      option_e: '',
      correct_answer: 'Observasi | Rumuskan Masalah | Hipotesis | Eksperimen | Kesimpulan',
      explanation: 'Metode ilmiah dimulai dari observasi hingga penarikan kesimpulan.',
      image_url: '',
      category: 'Metode Ilmiah & Matematika',
      materi: 'Metode Ilmiah',
      difficulty: 'MUDAH',
      score: 15,
    },
    {
      question_type: 'ESAI',
      question_text: '<p>Jelaskan pengaruh suhu terhadap laju reaksi kimia berdasarkan teori tumbukan!</p>',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      option_e: '',
      correct_answer: 'Rubrik: kenaikan suhu meningkatkan energi kinetik molekul dan frekuensi tumbukan efektif.',
      explanation: 'Semakin tinggi suhu, semakin banyak partikel melampaui energi aktivasi.',
      image_url: '',
      category: 'Kimia',
      materi: 'Laju Reaksi',
      difficulty: 'SEDANG',
      score: 20,
    },
  ];
}

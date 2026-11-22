import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  applyMappingAndValidate,
  autoMapColumns,
  buildMultiSheetWorkbook,
  buildQuestionDedupeKey,
  generateUtf8Csv,
  parseSpreadsheetBuffer,
} from './spreadsheet.ts';

test('UTF-8 CSV with BOM preserves Indonesian characters, chemical equations, and LaTeX math', () => {
  const rows = [
    {
      question_type: 'PG',
      question_text: '<p>Reaksi $\\text{CH}_4 + 2\\text{O}_2 \\rightarrow \\text{CO}_2 + 2\\text{H}_2\\text{O}$ pada 25°C menghasilkan ΔH = −890 kJ/mol</p>',
      option_a: 'Eksoterm (ΔH < 0)',
      option_b: 'Endoterm (ΔH > 0)',
      correct_answer: 'A',
    },
  ];
  const csv = generateUtf8Csv(rows);
  assert.equal(csv.startsWith('\uFEFF'), true);

  const encoded = new TextEncoder().encode(csv);
  const parsed = parseSpreadsheetBuffer(encoded, 'soal_kir.csv');
  assert.equal(parsed.sheetNames.length, 1);
  const firstSheet = parsed.sheets[parsed.sheetNames[0]];
  assert.equal(firstSheet.rows.length, 1);
  assert.equal(firstSheet.rows[0].question_type, 'PG');
  assert.equal(firstSheet.rows[0].question_text.includes('ΔH = −890 kJ/mol'), true);
  assert.equal(firstSheet.rows[0].question_text.includes('25°C'), true);
});

test('Auto column mapping handles reordered Indonesian column headers and detects errors/duplicates', () => {
  const rawRows = [
    { NIS: 'siswa10', 'Nama Siswa': 'Budi Santoso', Rombel: 'XI-IPA-1', Sandi: 'Rahasia123' },
    { NIS: 'siswa10', 'Nama Siswa': 'Budi Duplikat File', Rombel: 'XI-IPA-1', Sandi: 'Rahasia123' },
    { NIS: 'siswa01', 'Nama Siswa': 'Nadia (Sudah di DB)', Rombel: 'XI-IPA-1', Sandi: 'Rahasia123' },
    { NIS: '', 'Nama Siswa': 'Tanpa Username', Rombel: 'X-MIPA-1', Sandi: 'Rahasia123' },
    { NIS: 'siswa11', 'Nama Siswa': 'Siti Aminah', Rombel: 'X-MIPA-2', Sandi: '123' }, // password < 6 chars
  ];
  const headers = Object.keys(rawRows[0]);
  const mapping = autoMapColumns(headers, 'USERS');
  assert.equal(mapping.username, 'NIS');
  assert.equal(mapping.nama, 'Nama Siswa');
  assert.equal(mapping.kelas, 'Rombel');
  assert.equal(mapping.password, 'Sandi');

  const existing = new Set(['siswa01']);
  const res = applyMappingAndValidate(rawRows, mapping, 'USERS', existing);

  assert.equal(res.validRows.length, 1);
  assert.equal(res.validRows[0].mapped.username, 'siswa10');
  assert.equal(res.duplicateRows.length, 2); // 1 intra-file dup + 1 DB dup
  assert.equal(res.errorRows.length, 2); // empty username + short password
});

test('Question validation supports all 7 types including MENJODOHKAN and MENGURUTKAN and deduplicates re-uploads', () => {
  const rows = [
    {
      jenis_soal: 'MENJODOHKAN',
      pertanyaan: '<p>Pasangkan besaran:</p>',
      kunci: 'Gaya=>Newton | Energi=>Joule',
      bobot: '15',
    },
    {
      jenis_soal: 'MENGURUTKAN',
      pertanyaan: '<p>Urutkan langkah:</p>',
      kunci: 'Amati | Hipotesis | Uji',
      bobot: '10',
    },
    {
      jenis_soal: 'PG',
      pertanyaan: '<p>Tanpa Opsi B</p>',
      opsi_a: 'Hanya A',
      opsi_b: '',
      kunci: 'A',
      bobot: '10',
    },
  ];
  const mapping = autoMapColumns(Object.keys(rows[0]), 'QUESTIONS');
  // Add opsi_a and opsi_b explicitly for PG test
  mapping.option_a = 'opsi_a';
  mapping.option_b = 'opsi_b';

  const existingQKey = buildQuestionDedupeKey('MENGURUTKAN', '<p>Urutkan langkah:</p>');
  const res = applyMappingAndValidate(rows, mapping, 'QUESTIONS', new Set([existingQKey]));

  assert.equal(res.validRows.length, 1);
  assert.equal(res.validRows[0].normalizedPayload?.question_type, 'MENJODOHKAN');
  assert.equal(res.duplicateRows.length, 1); // re-upload dedupe hit on MENGURUTKAN
  assert.equal(res.errorRows.length, 1); // PG missing 2nd option
});

test('Multi-sheet XLSX round-trip preserves structure and data across worksheets', () => {
  const wb = buildMultiSheetWorkbook([
    { name: 'Ringkasan', rows: [{ Ujian: 'Seleksi OSN', Peserta: 30 }] },
    { name: 'Daftar Nilai', rows: [{ Nama: 'Nadia Putri', Nilai: 95.5, Peringkat: 1 }] },
  ]);
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const parsed = parseSpreadsheetBuffer(bytes, 'laporan.xlsx');
  assert.deepEqual(parsed.sheetNames, ['Ringkasan', 'Daftar Nilai']);
  assert.equal(parsed.sheets['Ringkasan'].rows[0].Ujian, 'Seleksi OSN');
  assert.equal(parsed.sheets['Daftar Nilai'].rows[0].Nama, 'Nadia Putri');
});

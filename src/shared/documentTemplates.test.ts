import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultWinnerRows,
  computeDocumentVariables,
  createDefaultTemplatePayload,
  interpolateTemplateVariables,
  sanitizeLogoUrl,
} from './documentTemplates.ts';

test('computeDocumentVariables derives accurate metrics from DB context', () => {
  const vars = computeDocumentVariables({
    exam: {
      title: 'Seleksi Internal OSN 2026',
      subject: 'Fisika & Biologi',
      start_time: '2026-10-12T01:00:00.000Z',
      end_time: '2026-10-12T02:30:00.000Z',
      duration: 90,
    },
    settings: {
      org_name: 'KIR IPA',
      school_name: 'SMA Negeri 1 Sukabumi',
      academic_year: '2026 / 2027',
    },
    registeredCount: 30,
    attendedCount: 28,
    absentCount: 2,
    completedCount: 27,
    technicalIssuesCount: 1,
    highestScore: 98,
    lowestScore: 45,
    averageScore: 76.25,
    passingGrade: 75,
    passedCount: 20,
    violationsCount: 2,
    supervisorName: 'Drs. Hendra Wijaya, M.Pd.',
    winners: [
      {
        rank: 1,
        nama: 'Nadia Putri',
        kelas: 'XI-IPA-1',
        total_score: 98,
        max_score: 100,
        percentage: 98,
        kategori_juara: 'Juara I (Terbaik 1)',
      },
    ],
  });

  assert.equal(vars.nama_ujian, 'Seleksi Internal OSN 2026');
  assert.equal(vars.peserta_terdaftar, '30');
  assert.equal(vars.peserta_hadir, '28');
  assert.equal(vars.peserta_tidak_hadir, '2');
  assert.equal(vars.nilai_tertinggi, '98');
  assert.equal(vars.nilai_rata_rata, '76.25');
  assert.equal(vars.pemenang_utama, 'Nadia Putri (XI-IPA-1)');

  const text = interpolateTemplateVariables(
    'Ujian {{nama_ujian}} diikuti {{peserta_hadir}} peserta dengan rata-rata {{nilai_rata_rata}}.',
    vars,
  );
  assert.equal(text, 'Ujian Seleksi Internal OSN 2026 diikuti 28 peserta dengan rata-rata 76.25.');
});

test('Default templates for LAPORAN_HASIL, BERITA_ACARA, and PENGUMUMAN_PEMENANG are editable and complete', () => {
  const laporan = createDefaultTemplatePayload('LAPORAN_HASIL');
  const berita = createDefaultTemplatePayload('BERITA_ACARA');
  const pemenang = createDefaultTemplatePayload('PENGUMUMAN_PEMENANG');

  assert.equal(laporan.page.paperSize, 'A4');
  assert.equal(berita.page.paperSize, 'F4');
  assert.equal(berita.signatories.length, 3);
  assert.equal(pemenang.sections.some((s) => s.kind === 'winners_table'), true);

  const winners = buildDefaultWinnerRows([
    { rank: 1, nama: 'A', kelas: 'X-1', total_score: 95, max_score: 100, percentage: 95 },
    { rank: 2, nama: 'B', kelas: 'X-2', total_score: 88, max_score: 100, percentage: 88 },
  ]);
  assert.equal(winners[0].kategori_juara, 'Juara I (Terbaik 1)');
  assert.equal(winners[1].kategori_juara, 'Juara II (Terbaik 2)');
});

test('sanitizeLogoUrl rejects javascript: or unsafe data payloads', () => {
  assert.equal(sanitizeLogoUrl('javascript:alert(1)').startsWith('/src/assets'), true);
  assert.equal(sanitizeLogoUrl('data:text/html,<script>').startsWith('/src/assets'), true);
  assert.equal(sanitizeLogoUrl('https://example.com/logo.png'), 'https://example.com/logo.png');
  assert.equal(sanitizeLogoUrl('/assets/logo.png'), '/assets/logo.png');
});

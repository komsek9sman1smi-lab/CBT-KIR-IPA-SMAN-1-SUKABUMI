import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Award,
  Download,
  Edit,
  Eye,
  FileSpreadsheet,
  Layers,
  ListChecks,
  Printer,
  Search,
  X,
} from 'lucide-react';
import { AppLogo } from './AppLogo';
import { ChartCanvas } from './ChartCanvas';
import { OfficialDocumentStudio } from './OfficialDocumentStudio';
import { PrintPreviewModal } from './PrintPreviewModal';
import { RichMathRenderer } from './RichMathRenderer';
import { apiFetch } from '../utils/api';
import {
  exportMultiSheetExcel,
  exportRowsToCsv,
  exportRowsToExcel,
  exportTableToPdf,
} from '../utils/exporters';
import { safeJsonParse, type ItemAnalysisResult, type RankedLeaderboardEntry } from '../shared/grading';
import type { AppSettingsMap, ExamRecord, UserRecord } from '../shared/types';

export function ResultsManagementView({
  config,
  currentUser,
  syncTick = 0,
}: {
  config: Partial<AppSettingsMap>;
  currentUser: UserRecord;
  syncTick?: number;
}) {
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [results, setResults] = useState<Array<Record<string, unknown>>>([]);
  const [maxScore, setMaxScore] = useState(100);
  const [correctModal, setCorrectModal] = useState<Record<string, unknown> | null>(null);
  const [newScore, setNewScore] = useState(0);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState('');

  const [kelasFilter, setKelasFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [printOpen, setPrintOpen] = useState(false);
  const [recapModalOpen, setRecapModalOpen] = useState(false);
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapPrintOpen, setRecapPrintOpen] = useState(false);
  const [recapData, setRecapData] = useState<{
    exam: ExamRecord;
    questions: Array<{
      question_id: string;
      question_type: string;
      question_text: string;
      correct_answer: string;
      question_order: number;
      max_score: number;
    }>;
    participants: Array<Record<string, unknown>>;
    recap_rows: Array<Record<string, unknown>>;
  } | null>(null);

  useEffect(() => {
    void apiFetch<{ exams: ExamRecord[] }>('/exams').then((res) => {
      setExams(res.exams);
      const pref = res.exams.find((e) => e.status === 'COMPLETED') || res.exams[0];
      if (pref) setSelectedExamId((prev) => prev || pref.exam_id);
    });
  }, [syncTick]);

  const loadResults = async (examId: string) => {
    if (!examId) return;
    const res = await apiFetch<{ results: Array<Record<string, unknown>>; max_score: number }>(
      `/results/${examId}`,
    );
    setResults(res.results);
    setMaxScore(res.max_score || 100);
  };

  useEffect(() => {
    if (selectedExamId) {
      setKelasFilter('ALL');
      setSearch('');
      void loadResults(selectedExamId);
    }
  }, [selectedExamId]);

  useEffect(() => {
    if (syncTick > 0 && selectedExamId && !correctModal) {
      void loadResults(selectedExamId);
    }
  }, [syncTick, selectedExamId]);

  const selectedExam = exams.find((e) => e.exam_id === selectedExamId);
  const uniqueClasses = useMemo(
    () =>
      Array.from(new Set(results.map((r) => String(r.kelas || '').trim()).filter(Boolean))).sort(),
    [results],
  );

  const filteredResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    return results.filter((r) => {
      const kelas = String(r.kelas || '').trim();
      if (kelasFilter !== 'ALL' && kelas !== kelasFilter) return false;
      if (q) {
        const match =
          String(r.nama || '').toLowerCase().includes(q) ||
          String(r.username || '').toLowerCase().includes(q) ||
          kelas.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [results, kelasFilter, search]);

  const allPublished = results.length > 0 && results.every((r) => Number(r.published) === 1);

  const handleTogglePublish = async () => {
    await apiFetch(`/results/${selectedExamId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ published: !allPublished }),
    });
    setToast(!allPublished ? 'Nilai dipublikasikan ke peserta.' : 'Publikasi nilai ditarik kembali.');
    setTimeout(() => setToast(''), 3000);
    await loadResults(selectedExamId);
  };

  const handleCorrectScore = async (e: FormEvent) => {
    e.preventDefault();
    if (!correctModal) return;
    await apiFetch(`/results/${selectedExamId}/correct`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: correctModal.user_id,
        new_score: newScore,
        reason,
      }),
    });
    setCorrectModal(null);
    setReason('');
    setToast('Koreksi nilai disimpan dan dicatat ke Audit Log.');
    setTimeout(() => setToast(''), 3000);
    await loadResults(selectedExamId);
  };

  const mapResultRows = (list: Array<Record<string, unknown>>) =>
    list.map((r, i) => ({
      No: i + 1,
      Username: String(r.username || ''),
      Nama: String(r.nama || ''),
      Kelas: String(r.kelas || '—'),
      Benar: Number(r.correct_count || 0),
      Salah: Number(r.incorrect_count || 0),
      Kosong: Number(r.unanswered_count || 0),
      Nilai_Akhir: Number(r.total_score || 0),
      Skor_Maksimal: maxScore,
      Persentase: `${((Number(r.total_score || 0) / (maxScore || 100)) * 100).toFixed(1)}%`,
      Publikasi: Number(r.published) === 1 ? 'Terpublikasi' : 'Draft',
      Waktu_Nilai: r.graded_at ? new Date(String(r.graded_at)).toLocaleString('id-ID') : '—',
    }));

  const exportExcel = () => {
    exportRowsToExcel(
      `Hasil_Ujian_${selectedExamId}.xlsx`,
      'Hasil_Ujian',
      mapResultRows(filteredResults),
    );
  };

  const exportCsv = () => {
    exportRowsToCsv(`Hasil_Ujian_${selectedExamId}.csv`, mapResultRows(filteredResults));
  };

  const exportAllExamsExcel = async () => {
    try {
      const res = await apiFetch<{ results: Array<Record<string, unknown>> }>('/reports/all-results');
      const allRows = res.results.map((r, i) => {
        const mScore = Number(r.max_score || 100) || 100;
        return {
          No: i + 1,
          Ujian: String(r.exam_title || ''),
          Mata_Pelajaran: String(r.exam_subject || ''),
          Username: String(r.username || ''),
          Nama_Peserta: String(r.nama || ''),
          Kelas: String(r.kelas || '—'),
          Benar: Number(r.correct_count || 0),
          Salah: Number(r.incorrect_count || 0),
          Kosong: Number(r.unanswered_count || 0),
          Nilai_Akhir: Number(r.total_score || 0),
          Skor_Maksimal: mScore,
          Persentase: `${((Number(r.total_score || 0) / mScore) * 100).toFixed(1)}%`,
          Status_Publikasi: Number(r.published) === 1 ? 'Terpublikasi' : 'Draft',
        };
      });

      const examMap = new Map<string, { title: string; subject: string; scores: number[]; maxScore: number }>();
      for (const r of res.results) {
        const eid = String(r.exam_id || '');
        if (!examMap.has(eid)) {
          examMap.set(eid, {
            title: String(r.exam_title || ''),
            subject: String(r.exam_subject || ''),
            scores: [],
            maxScore: Number(r.max_score || 100) || 100,
          });
        }
        examMap.get(eid)!.scores.push(Number(r.total_score || 0));
      }

      const summaryRows = Array.from(examMap.entries()).map(([, v], idx) => {
        const sum = v.scores.reduce((a, b) => a + b, 0);
        return {
          No: idx + 1,
          Judul_Ujian: v.title,
          Mata_Pelajaran: v.subject,
          Jumlah_Peserta: v.scores.length,
          Skor_Maksimal: v.maxScore,
          Nilai_Tertinggi: v.scores.length ? Math.max(...v.scores) : 0,
          Nilai_Terendah: v.scores.length ? Math.min(...v.scores) : 0,
          Rata_Rata: v.scores.length ? Number((sum / v.scores.length).toFixed(2)) : 0,
        };
      });

      exportMultiSheetExcel('Rekap_Hasil_Seluruh_Ujian.xlsx', [
        { name: 'Ringkasan_Ujian', rows: summaryRows },
        { name: 'Seluruh_Nilai_Peserta', rows: allRows },
      ]);
      setToast('Ekspor Excel seluruh ujian (multi-sheet) berhasil diunduh.');
      setTimeout(() => setToast(''), 3000);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Gagal mengekspor seluruh hasil ujian.');
      setTimeout(() => setToast(''), 3500);
    }
  };

  const openAnswersRecap = async () => {
    if (!selectedExamId) return;
    setRecapModalOpen(true);
    setRecapLoading(true);
    try {
      const data = await apiFetch<typeof recapData>(`/reports/${selectedExamId}/answers-recap`);
      setRecapData(data);
    } finally {
      setRecapLoading(false);
    }
  };

  const exportRecapExcel = () => {
    if (!recapData) return;
    const perQuestionRows = recapData.recap_rows.map((r, i) => ({
      No: i + 1,
      No_Soal: Number(r.question_order),
      Tipe: String(r.question_type || ''),
      Pertanyaan: String(r.question_text_plain || ''),
      Username: String(r.username || ''),
      Nama_Peserta: String(r.nama || ''),
      Kelas: String(r.kelas || '—'),
      Jawaban_Peserta: String(r.student_answer || '—'),
      Kunci_Jawaban: String(r.correct_answer || ''),
      Skor_Diperoleh: Number(r.earned_score || 0),
      Skor_Maksimal: Number(r.max_score || 0),
      Ragu_Ragu: r.is_doubtful ? 'Ya' : 'Tidak',
    }));

    const participantSummary = recapData.participants.map((p, i) => ({
      No: i + 1,
      Username: String(p.username || ''),
      Nama_Peserta: String(p.nama || ''),
      Kelas: String(p.kelas || '—'),
      Status: String(p.participant_status || ''),
      Benar: Number(p.correct_count ?? 0),
      Salah: Number(p.incorrect_count ?? 0),
      Kosong: Number(p.unanswered_count ?? 0),
      Nilai_Akhir: Number(p.total_score ?? p.participant_score ?? 0),
    }));

    exportMultiSheetExcel(`Rekap_Jawaban_${selectedExamId}.xlsx`, [
      { name: 'Rekap_Per_Soal', rows: perQuestionRows },
      { name: 'Ringkasan_Nilai', rows: participantSummary },
    ]);
  };

  const exportRecapCsv = () => {
    if (!recapData) return;
    const rows = recapData.recap_rows.map((r, i) => ({
      No: i + 1,
      No_Soal: Number(r.question_order),
      Tipe: String(r.question_type || ''),
      Nama_Peserta: String(r.nama || ''),
      Kelas: String(r.kelas || '—'),
      Jawaban_Peserta: String(r.student_answer || '—'),
      Kunci_Jawaban: String(r.correct_answer || ''),
      Skor: `${Number(r.earned_score || 0)}/${Number(r.max_score || 0)}`,
    }));
    exportRowsToCsv(`Rekap_Jawaban_${selectedExamId}.csv`, rows);
  };

  const exportPdf = () => {
    exportTableToPdf(
      `Hasil_Ujian_${selectedExamId}.pdf`,
      {
        appName: config.app_name || 'CBT KIR IPA SMAN 1 SUKABUMI',
        orgName: config.org_name || 'KIR IPA',
        schoolName: config.school_name || 'SMAN 1 Sukabumi',
        title: `Daftar Nilai Peserta: ${selectedExam?.title || ''}`,
        activityName: selectedExam?.subject || 'Evaluasi Akademik',
        authorName: currentUser.nama,
      },
      ['No', 'Nama Peserta', 'Kelas', 'Benar', 'Salah', 'Kosong', 'Nilai', 'Status'],
      filteredResults.map((r, i) => [
        i + 1,
        String(r.nama),
        String(r.kelas || '—'),
        Number(r.correct_count),
        Number(r.incorrect_count),
        Number(r.unanswered_count),
        `${r.total_score}/${maxScore}`,
        Number(r.published) === 1 ? 'Terpublikasi' : 'Draft',
      ]),
    );
  };

  const printRows = filteredResults.map((r, i) => ({
    no: i + 1,
    username: String(r.username || ''),
    nama: String(r.nama || ''),
    kelas: String(r.kelas || '—'),
    bsk: `${Number(r.correct_count || 0)} / ${Number(r.incorrect_count || 0)} / ${Number(r.unanswered_count || 0)}`,
    nilai: `${Number(r.total_score || 0)} / ${maxScore}`,
    persen: `${((Number(r.total_score || 0) / (maxScore || 100)) * 100).toFixed(1)}%`,
    publikasi: Number(r.published) === 1 ? 'Terpublikasi' : 'Draft',
  }));

  const avgFiltered = useMemo(() => {
    if (filteredResults.length === 0) return 0;
    const sum = filteredResults.reduce((s, r) => s + Number(r.total_score || 0), 0);
    return Number((sum / filteredResults.length).toFixed(2));
  }, [filteredResults]);

  return (
    <div className="space-y-4">
      {toast && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {toast}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <select
              aria-label="Pilih ujian"
              value={selectedExamId}
              onChange={(e) => setSelectedExamId(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white min-w-[240px]"
            >
              {exams.map((e) => (
                <option key={e.exam_id} value={e.exam_id}>
                  {e.title} ({e.status})
                </option>
              ))}
            </select>

            <div className="relative min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari peserta / username..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs"
              />
            </div>

            <select
              aria-label="Filter kelas hasil ujian"
              value={kelasFilter}
              onChange={(e) => setKelasFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
            >
              <option value="ALL">Semua Kelas</option>
              {uniqueClasses.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleTogglePublish}
            className={`px-4 py-2 rounded-lg text-xs font-semibold text-white cursor-pointer ${
              allPublished ? 'bg-slate-600 hover:bg-slate-700' : 'bg-emerald-700 hover:bg-emerald-800'
            }`}
          >
            {allPublished ? 'Tarik Publikasi Nilai' : 'Publikasikan Nilai ke Siswa'}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="text-xs text-slate-500">
            Menampilkan <strong className="text-slate-900">{filteredResults.length}</strong> dari{' '}
            <strong>{results.length}</strong> peserta · Rata-rata tampil:{' '}
            <strong className="font-mono text-[#0F294A]">{avgFiltered}</strong>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openAnswersRecap}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-xs font-medium text-[#0F294A] hover:bg-blue-100 cursor-pointer"
            >
              <ListChecks className="w-3.5 h-3.5" />
              Rekapitulasi Jawaban
            </button>
            <button
              type="button"
              onClick={exportExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
              Ekspor Excel
            </button>
            <button
              type="button"
              onClick={exportAllExamsExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              title="Ekspor gabungan seluruh ujian dalam 1 file Excel multi-sheet"
            >
              <Layers className="w-3.5 h-3.5 text-blue-700" />
              Ekspor Semua Ujian
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Ekspor CSV
            </button>
            <button
              type="button"
              onClick={exportPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              PDF
            </button>
            <button
              type="button"
              onClick={() => setPrintOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F294A] text-white text-xs font-semibold hover:bg-blue-800 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Cetak Daftar Nilai
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Peserta</th>
                <th className="px-4 py-3">Kelas</th>
                <th className="px-4 py-3">Benar / Salah / Kosong</th>
                <th className="px-4 py-3">Nilai Akhir</th>
                <th className="px-4 py-3">Persentase</th>
                <th className="px-4 py-3">Publikasi</th>
                <th className="px-4 py-3 text-right">Koreksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredResults.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {results.length === 0
                      ? 'Belum ada hasil peserta yang dikumpulkan pada ujian ini.'
                      : 'Tidak ada data nilai peserta yang cocok dengan filter aktif.'}
                  </td>
                </tr>
              ) : (
                filteredResults.map((r) => (
                  <tr key={String(r.result_id)} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{String(r.nama)}</div>
                      <div className="text-[11px] font-mono text-slate-500">{String(r.username || '')}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{String(r.kelas)}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {Number(r.correct_count)} / {Number(r.incorrect_count)} / {Number(r.unanswered_count)}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-[#0F294A]">
                      {Number(r.total_score)} <span className="text-slate-400 font-normal">/ {maxScore}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {((Number(r.total_score) / maxScore) * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {Number(r.published) === 1 ? (
                        <span className="text-emerald-700 font-medium">Terpublikasi</span>
                      ) : (
                        <span className="text-slate-500">Belum</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setCorrectModal(r);
                          setNewScore(Number(r.total_score));
                          setReason('');
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <Edit className="w-3 h-3" />
                        Koreksi
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {correctModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-[#0F294A]">
              Koreksi Nilai: {String(correctModal.nama)}
            </h3>
            <form onSubmit={handleCorrectScore} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nilai Baru</label>
                <input
                  required
                  type="number"
                  step={0.5}
                  value={newScore}
                  onChange={(e) => setNewScore(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Alasan Koreksi (wajib tercatat di Audit Log)
                </label>
                <textarea
                  required
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Contoh: Penyesuaian bonus soal esai #5"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCorrectModal(null)}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 text-xs cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#0F294A] text-white text-xs font-semibold cursor-pointer"
                >
                  Simpan Koreksi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {recapModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-6xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
              <div>
                <h3 className="text-base font-bold text-[#0F294A]">
                  Rekapitulasi Jawaban Peserta per Soal
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedExam?.title} · {recapData?.questions.length || 0} butir soal ·{' '}
                  {recapData?.participants.length || 0} peserta terdaftar
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={exportRecapExcel}
                  disabled={!recapData}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                  Excel (Multi-Sheet)
                </button>
                <button
                  type="button"
                  onClick={exportRecapCsv}
                  disabled={!recapData}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  CSV (UTF-8)
                </button>
                <button
                  type="button"
                  onClick={() => setRecapPrintOpen(true)}
                  disabled={!recapData}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F294A] text-white text-xs font-semibold hover:bg-blue-800 cursor-pointer disabled:opacity-50"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Cetak Rekap Jawaban
                </button>
                <button
                  type="button"
                  onClick={() => setRecapModalOpen(false)}
                  aria-label="Tutup rekap jawaban"
                  className="p-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-5">
              {recapLoading ? (
                <div className="py-12 text-center text-sm text-slate-500">
                  Memuat rekapitulasi jawaban peserta...
                </div>
              ) : !recapData || recapData.recap_rows.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-500">
                  Belum ada peserta atau butir soal untuk direkap pada ujian ini.
                </div>
              ) : (
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 sticky top-0">
                    <tr>
                      <th className="px-3 py-2.5">Soal</th>
                      <th className="px-3 py-2.5">Peserta & Kelas</th>
                      <th className="px-3 py-2.5">Jawaban Peserta</th>
                      <th className="px-3 py-2.5">Kunci</th>
                      <th className="px-3 py-2.5">Skor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recapData.recap_rows.slice(0, 300).map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2 align-top">
                          <span className="font-mono font-bold text-[#0F294A]">
                            #{String(row.question_order)}
                          </span>{' '}
                          <span className="text-[11px] text-slate-500">
                            ({String(row.question_type)})
                          </span>
                          <div className="text-[11px] text-slate-600 line-clamp-1 max-w-xs">
                            {String(row.question_text_plain || '')}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium text-slate-900">{String(row.nama)}</div>
                          <div className="text-[11px] text-slate-500">{String(row.kelas || '—')}</div>
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-800 align-top">
                          {String(row.student_answer || '—')}
                        </td>
                        <td className="px-3 py-2 font-mono text-emerald-700 align-top">
                          {String(row.correct_answer || '—')}
                        </td>
                        <td className="px-3 py-2 font-mono font-semibold align-top">
                          {Number(row.earned_score || 0)} / {Number(row.max_score || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {recapData && recapData.recap_rows.length > 300 && (
                <p className="text-[11px] text-slate-500 mt-3">
                  Pratinjau tabel menampilkan 300 baris pertama. Gunakan Ekspor Excel / CSV atau Cetak untuk mengunduh seluruh {recapData.recap_rows.length} baris.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <PrintPreviewModal
        isOpen={printOpen}
        onClose={() => setPrintOpen(false)}
        documentTitle={`Daftar Nilai Ujian: ${selectedExam?.title || ''}`}
        subtitle={`Bidang: ${selectedExam?.subject || 'Umum'} · Filter Kelas: ${kelasFilter === 'ALL' ? 'Semua Kelas' : kelasFilter}`}
        activityName={selectedExam?.title || 'Evaluasi Akademik CBT'}
        appName={config.app_name}
        orgName={config.org_name}
        schoolName={config.school_name}
        logoUrl={config.logo_url}
        authorName={currentUser.nama}
        filePrefix={`Daftar_Nilai_${selectedExamId}`}
        defaultOrientation="landscape"
        summaryPairs={[
          { label: 'Total Peserta Ditampilkan', value: filteredResults.length },
          { label: 'Rata-rata Nilai', value: avgFiltered },
          { label: 'Skor Maksimal Ujian', value: maxScore },
        ]}
        columns={[
          { key: 'no', label: 'No', align: 'center' },
          { key: 'username', label: 'Username' },
          { key: 'nama', label: 'Nama Peserta' },
          { key: 'kelas', label: 'Kelas' },
          { key: 'bsk', label: 'B / S / K', align: 'center' },
          { key: 'nilai', label: 'Nilai Akhir', align: 'right' },
          { key: 'persen', label: '%', align: 'right' },
          { key: 'publikasi', label: 'Status' },
        ]}
        rows={printRows}
      />

      {recapData && (
        <PrintPreviewModal
          isOpen={recapPrintOpen}
          onClose={() => setRecapPrintOpen(false)}
          documentTitle={`Rekapitulasi Jawaban Peserta: ${selectedExam?.title || ''}`}
          subtitle={`${recapData.questions.length} Butir Soal · ${recapData.participants.length} Peserta`}
          activityName={selectedExam?.title || 'Rekap Jawaban Ujian'}
          appName={config.app_name}
          orgName={config.org_name}
          schoolName={config.school_name}
          logoUrl={config.logo_url}
          authorName={currentUser.nama}
          filePrefix={`Rekap_Jawaban_${selectedExamId}`}
          defaultOrientation="landscape"
          columns={[
            { key: 'soal', label: 'No Soal', align: 'center' },
            { key: 'tipe', label: 'Tipe' },
            { key: 'nama', label: 'Nama Peserta' },
            { key: 'kelas', label: 'Kelas' },
            { key: 'jawaban', label: 'Jawaban Peserta' },
            { key: 'kunci', label: 'Kunci' },
            { key: 'skor', label: 'Skor', align: 'right' },
          ]}
          rows={recapData.recap_rows.map((r) => ({
            soal: `#${String(r.question_order)}`,
            tipe: String(r.question_type || ''),
            nama: String(r.nama || ''),
            kelas: String(r.kelas || '—'),
            jawaban: String(r.student_answer || '—'),
            kunci: String(r.correct_answer || '—'),
            skor: `${Number(r.earned_score || 0)}/${Number(r.max_score || 0)}`,
          }))}
        />
      )}
    </div>
  );
}

export function LeaderboardView({
  config,
  currentUser,
  syncTick = 0,
}: {
  config?: Partial<AppSettingsMap>;
  currentUser?: UserRecord;
  syncTick?: number;
} = {}) {
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [leaderboard, setLeaderboard] = useState<RankedLeaderboardEntry[]>([]);
  const [error, setError] = useState('');
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    void apiFetch<{ exams: ExamRecord[] }>('/exams').then((res) => {
      setExams(res.exams);
      const pref = res.exams.find((e) => e.status === 'COMPLETED') || res.exams[0];
      if (pref) setSelectedExamId((prev) => prev || pref.exam_id);
    });
  }, [syncTick]);

  useEffect(() => {
    if (!selectedExamId) return;
    setError('');
    void apiFetch<{ leaderboard: RankedLeaderboardEntry[] }>(`/leaderboard/${selectedExamId}`)
      .then((res) => setLeaderboard(res.leaderboard))
      .catch((err) => {
        setLeaderboard([]);
        setError(err instanceof Error ? err.message : 'Leaderboard tidak tersedia.');
      });
  }, [selectedExamId, syncTick]);

  const selectedExam = exams.find((e) => e.exam_id === selectedExamId);

  const exportRows = leaderboard.map((row) => ({
    Peringkat: row.rank,
    Nama_Peserta: row.nama,
    Kelas: row.kelas,
    Nilai: row.total_score,
    Skor_Maksimal: row.max_score,
    Persentase: `${row.percentage}%`,
    Durasi_Pengerjaan: `${Math.floor(row.duration_seconds / 60)}m ${row.duration_seconds % 60}d`,
  }));

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[#0F294A] font-bold">
          <Award className="w-5 h-5 text-amber-600" />
          <span>Peringkat & Leaderboard Peserta</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter ujian leaderboard"
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white min-w-[240px]"
          >
            {exams.map((e) => (
              <option key={e.exam_id} value={e.exam_id}>
                {e.title}
              </option>
            ))}
          </select>

          {leaderboard.length > 0 && (
            <>
              <button
                type="button"
                onClick={() =>
                  exportRowsToExcel(
                    `Peringkat_${selectedExamId}.xlsx`,
                    'Peringkat_Peserta',
                    exportRows,
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                Excel
              </button>
              <button
                type="button"
                onClick={() => exportRowsToCsv(`Peringkat_${selectedExamId}.csv`, exportRows)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
              <button
                type="button"
                onClick={() => setPrintOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0F294A] text-white text-xs font-semibold hover:bg-blue-800 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Cetak Peringkat
              </button>
            </>
          )}
        </div>
      </div>

      {error ? (
        <div className="bg-white border border-amber-200 rounded-xl p-6 text-sm text-amber-800">
          {error}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Peringkat</th>
                <th className="px-4 py-3">Nama Peserta</th>
                <th className="px-4 py-3">Kelas</th>
                <th className="px-4 py-3">Nilai</th>
                <th className="px-4 py-3">Persentase</th>
                <th className="px-4 py-3">Durasi Pengerjaan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Belum ada nilai yang dipublikasikan untuk peringkat ujian ini.
                  </td>
                </tr>
              ) : (
                leaderboard.map((row) => (
                  <tr key={row.user_id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono font-bold text-[#0F294A]">#{row.rank}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{row.nama}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{row.kelas}</td>
                    <td className="px-4 py-3 font-mono font-bold text-blue-800">
                      {row.total_score} / {row.max_score}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{row.percentage}%</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {Math.floor(row.duration_seconds / 60)}m {row.duration_seconds % 60}d
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <PrintPreviewModal
        isOpen={printOpen}
        onClose={() => setPrintOpen(false)}
        documentTitle={`Hasil dan Peringkat Ujian: ${selectedExam?.title || ''}`}
        subtitle={`Bidang: ${selectedExam?.subject || 'Evaluasi Akademik'}`}
        activityName={selectedExam?.title || 'Peringkat Peserta'}
        appName={config?.app_name}
        orgName={config?.org_name}
        schoolName={config?.school_name}
        logoUrl={config?.logo_url}
        authorName={currentUser?.nama || 'Pembina KIR IPA'}
        filePrefix={`Peringkat_${selectedExamId}`}
        columns={[
          { key: 'rank', label: 'Peringkat', align: 'center' },
          { key: 'nama', label: 'Nama Peserta' },
          { key: 'kelas', label: 'Kelas' },
          { key: 'nilai', label: 'Nilai', align: 'right' },
          { key: 'persen', label: 'Persentase', align: 'right' },
          { key: 'durasi', label: 'Durasi', align: 'center' },
        ]}
        rows={leaderboard.map((row) => ({
          rank: `#${row.rank}`,
          nama: row.nama,
          kelas: row.kelas,
          nilai: `${row.total_score} / ${row.max_score}`,
          persen: `${row.percentage}%`,
          durasi: `${Math.floor(row.duration_seconds / 60)}m ${row.duration_seconds % 60}d`,
        }))}
      />
    </div>
  );
}

export function ItemAnalysisView({
  config,
  currentUser,
  syncTick = 0,
}: {
  config?: Partial<AppSettingsMap>;
  currentUser?: UserRecord;
  syncTick?: number;
} = {}) {
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [analysis, setAnalysis] = useState<ItemAnalysisResult[]>([]);
  const [totalRespondents, setTotalRespondents] = useState(0);
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    void apiFetch<{ exams: ExamRecord[] }>('/exams').then((res) => {
      setExams(res.exams);
      const pref = res.exams.find((e) => e.status === 'COMPLETED') || res.exams[0];
      if (pref) setSelectedExamId((prev) => prev || pref.exam_id);
    });
  }, [syncTick]);

  useEffect(() => {
    if (!selectedExamId) return;
    void apiFetch<{ total_respondents: number; analysis: ItemAnalysisResult[] }>(
      `/analytics/${selectedExamId}`,
    ).then((res) => {
      setTotalRespondents(res.total_respondents);
      setAnalysis(res.analysis);
    });
  }, [selectedExamId, syncTick]);

  const selectedExam = exams.find((e) => e.exam_id === selectedExamId);

  const exportStatsExcel = () => {
    const avgPct =
      analysis.length > 0
        ? Number(
            (analysis.reduce((s, a) => s + a.correct_percentage, 0) / analysis.length).toFixed(1),
          )
        : 0;
    const problematicCount = analysis.filter((a) => a.problematic).length;

    exportMultiSheetExcel(`Laporan_Statistik_Ujian_${selectedExamId}.xlsx`, [
      {
        name: 'Ringkasan_Statistik',
        rows: [
          {
            Judul_Ujian: selectedExam?.title || '',
            Mata_Pelajaran: selectedExam?.subject || '',
            Total_Responden: totalRespondents,
            Jumlah_Butir_Soal: analysis.length,
            Rata_Rata_Persen_Benar: `${avgPct}%`,
            Jumlah_Soal_Perlu_Review: problematicCount,
            Tanggal_Ekspor: new Date().toLocaleString('id-ID'),
          },
        ],
      },
      {
        name: 'Analisis_Butir_Soal',
        rows: analysis.map((item, idx) => ({
          No_Soal: idx + 1,
          Tipe: item.question_type,
          Cuplikan_Soal: item.question_text_preview,
          Benar: item.correct_count,
          Salah: item.incorrect_count,
          Kosong: item.unanswered_count,
          Persen_Benar: `${item.correct_percentage}%`,
          Tingkat_Kesukaran: item.difficulty_label,
          Daya_Pembeda:
            item.discrimination_index !== null
              ? `${item.discrimination_index} (${item.discrimination_label})`
              : item.discrimination_label,
          Distribusi_Opsi: Object.entries(item.option_distribution)
            .map(([k, v]) => `${k}:${v}`)
            .join(', '),
          Catatan: item.problematic ? item.problem_reason : 'Valid',
        })),
      },
    ]);
  };

  const exportStatsCsv = () => {
    exportRowsToCsv(
      `Analisis_Butir_${selectedExamId}.csv`,
      analysis.map((item, idx) => ({
        No_Soal: idx + 1,
        Tipe: item.question_type,
        Cuplikan_Soal: item.question_text_preview,
        Benar: item.correct_count,
        Salah: item.incorrect_count,
        Kosong: item.unanswered_count,
        Persen_Benar: `${item.correct_percentage}%`,
        Tingkat_Kesukaran: item.difficulty_label,
        Daya_Pembeda:
          item.discrimination_index !== null
            ? `${item.discrimination_index} (${item.discrimination_label})`
            : item.discrimination_label,
      })),
    );
  };

  const chartConfig = useMemo(
    () => ({
      type: 'bar' as const,
      data: {
        labels: analysis.map((_, i) => `Soal ${i + 1}`),
        datasets: [
          {
            label: '% Jawaban Benar',
            data: analysis.map((a) => a.correct_percentage),
            backgroundColor: '#1d4ed8',
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 } },
      },
    }),
    [analysis],
  );

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#0F294A]">Analisis Butir Soal & Statistik Ujian</h2>
          <p className="text-xs text-slate-500">
            Total responden dianalisis: <strong className="font-mono">{totalRespondents}</strong> peserta
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Pilih ujian untuk analisis"
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white min-w-[240px]"
          >
            {exams.map((e) => (
              <option key={e.exam_id} value={e.exam_id}>
                {e.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={exportStatsExcel}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            Excel Statistik
          </button>
          <button
            type="button"
            onClick={exportStatsCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => setPrintOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0F294A] text-white text-xs font-semibold hover:bg-blue-800 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Cetak Statistik
          </button>
        </div>
      </div>

      {totalRespondents > 0 && totalRespondents < 6 && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            Jumlah peserta ({totalRespondents}) masih di bawah batas minimal 6 peserta untuk menarik kesimpulan daya pembeda dan soal bermasalah secara statistik.
          </span>
        </div>
      )}

      {analysis.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-[#0F294A] mb-3">
            Grafik Persentase Jawaban Benar per Butir Soal
          </h3>
          <ChartCanvas config={chartConfig} height={240} />
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">No & Cuplikan Soal</th>
                <th className="px-4 py-3">Benar / Salah / Kosong</th>
                <th className="px-4 py-3">% Benar</th>
                <th className="px-4 py-3">Tingkat Kesukaran</th>
                <th className="px-4 py-3">Daya Pembeda (D)</th>
                <th className="px-4 py-3">Distribusi Opsi PG</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {analysis.map((item, idx) => (
                <tr key={item.question_id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 max-w-xs">
                    <div className="font-mono font-bold text-[#0F294A]">
                      #{idx + 1} · {item.question_type}
                    </div>
                    <RichMathRenderer
                      content={item.question_text_preview}
                      className="text-xs text-slate-600 line-clamp-2 mt-0.5"
                    />
                    {item.problematic && (
                      <div className="text-red-700 font-semibold mt-1">{item.problem_reason}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {item.correct_count} / {item.incorrect_count} / {item.unanswered_count}
                  </td>
                  <td className="px-4 py-3 font-mono font-bold">{item.correct_percentage}%</td>
                  <td className="px-4 py-3">{item.difficulty_label}</td>
                  <td className="px-4 py-3 font-mono">
                    {item.discrimination_index !== null ? `${item.discrimination_index} (${item.discrimination_label})` : item.discrimination_label}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600">
                    {Object.keys(item.option_distribution).length > 0
                      ? Object.entries(item.option_distribution)
                          .map(([k, v]) => `${k}:${v}`)
                          .join(' · ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PrintPreviewModal
        isOpen={printOpen}
        onClose={() => setPrintOpen(false)}
        documentTitle={`Laporan Statistik & Analisis Butir Soal: ${selectedExam?.title || ''}`}
        subtitle={`Total Responden: ${totalRespondents} peserta · Total Butir: ${analysis.length} soal`}
        activityName={selectedExam?.title || 'Analisis Statistik Ujian'}
        appName={config?.app_name}
        orgName={config?.org_name}
        schoolName={config?.school_name}
        logoUrl={config?.logo_url}
        authorName={currentUser?.nama || 'Pembina KIR IPA'}
        filePrefix={`Analisis_Statistik_${selectedExamId}`}
        defaultOrientation="landscape"
        columns={[
          { key: 'no', label: 'No', align: 'center' },
          { key: 'tipe', label: 'Tipe' },
          { key: 'cuplikan', label: 'Cuplikan Soal' },
          { key: 'bsk', label: 'B / S / K', align: 'center' },
          { key: 'pct', label: '% Benar', align: 'right' },
          { key: 'kesukaran', label: 'Kesukaran' },
          { key: 'daya', label: 'Daya Pembeda' },
        ]}
        rows={analysis.map((item, idx) => ({
          no: `#${idx + 1}`,
          tipe: item.question_type,
          cuplikan: item.question_text_preview,
          bsk: `${item.correct_count} / ${item.incorrect_count} / ${item.unanswered_count}`,
          pct: `${item.correct_percentage}%`,
          kesukaran: item.difficulty_label,
          daya:
            item.discrimination_index !== null
              ? `${item.discrimination_index} (${item.discrimination_label})`
              : item.discrimination_label,
        }))}
      />
    </div>
  );
}

export function ReportsAndBeritaAcaraView({
  config,
  currentUser,
  syncTick = 0,
}: {
  config: Partial<AppSettingsMap>;
  currentUser: UserRecord;
  syncTick?: number;
}) {
  return <OfficialDocumentStudio config={config} currentUser={currentUser} syncTick={syncTick} />;
}

export function StudentResultDetailModal({
  examId,
  config,
  onClose,
}: {
  examId: string;
  config: Partial<AppSettingsMap>;
  onClose: () => void;
}) {
  const [data, setData] = useState<{
    exam: ExamRecord;
    max_score: number;
    result: Record<string, unknown>;
    breakdown: Array<Record<string, unknown>>;
  } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    void apiFetch<typeof data>(`/results/${examId}`)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Gagal memuat hasil.'));
  }, [examId]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-3">
            <AppLogo src={config.logo_url} sizeClass="w-10 h-10" />
            <div>
              <h3 className="text-base font-bold text-[#0F294A]">Hasil Evaluasi Ujian</h3>
              <p className="text-xs text-slate-500">{data?.exam?.title || ''}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium cursor-pointer"
          >
            Tutup
          </button>
        </div>

        {err ? (
          <p className="text-sm text-red-600">{err}</p>
        ) : !data ? (
          <p className="text-sm text-slate-500">Memuat detail hasil...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div>
                <div className="text-xs text-slate-500">Nilai Akhir</div>
                <div className="text-xl font-bold font-mono text-[#0F294A]">
                  {String(data.result.total_score)} / {data.max_score}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Benar</div>
                <div className="text-xl font-bold font-mono text-emerald-700">
                  {String(data.result.correct_count)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Salah</div>
                <div className="text-xl font-bold font-mono text-red-600">
                  {String(data.result.incorrect_count)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Tidak Dijawab</div>
                <div className="text-xl font-bold font-mono text-slate-600">
                  {String(data.result.unanswered_count)}
                </div>
              </div>
            </div>

            {data.breakdown.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-[#0F294A] flex items-center gap-1.5">
                  <Eye className="w-4 h-4" />
                  Pembahasan & Umpan Balik Soal
                </h4>
                {data.breakdown.map((b, i) => (
                  <div key={String(b.question_id)} className="p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                    <div className="flex justify-between font-semibold text-[#0F294A]">
                      <span>Soal #{i + 1} ({String(b.question_type)})</span>
                      <span className="font-mono">
                        Skor: {Number(b.earned_score ?? 0)} / {Number(b.max_score)}
                      </span>
                    </div>
                    <RichMathRenderer content={String(b.question_text)} className="text-sm" />
                    <div className="text-slate-600">
                      <strong>Jawaban Anda:</strong>{' '}
                      <span className="font-mono">{String(safeJsonParse(String(b.answer_json), '—'))}</span>
                    </div>
                    {Boolean(b.essay_feedback) && (
                      <div className="p-2 rounded bg-blue-50 text-blue-900">
                        <strong>Catatan Penilai:</strong> {String(b.essay_feedback)}
                      </div>
                    )}
                    {Boolean(b.explanation) && (
                      <div className="p-2.5 rounded bg-emerald-50/70 border border-emerald-200 text-slate-800">
                        <strong>Pembahasan:</strong>
                        <RichMathRenderer content={String(b.explanation)} className="text-xs mt-1" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

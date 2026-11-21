import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Download,
  Edit,
  Eye,
  FileSpreadsheet,
  Printer,
} from 'lucide-react';
import { AppLogo } from './AppLogo';
import { ChartCanvas } from './ChartCanvas';
import { RichMathRenderer } from './RichMathRenderer';
import { apiFetch } from '../utils/api';
import { exportRowsToCsv, exportRowsToExcel, exportTableToPdf } from '../utils/exporters';
import { safeJsonParse, type ItemAnalysisResult, type RankedLeaderboardEntry } from '../shared/grading';
import type { AppSettingsMap, ExamRecord, UserRecord } from '../shared/types';

export function ResultsManagementView({
  config,
  currentUser,
}: {
  config: Partial<AppSettingsMap>;
  currentUser: UserRecord;
}) {
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [results, setResults] = useState<Array<Record<string, unknown>>>([]);
  const [maxScore, setMaxScore] = useState(100);
  const [correctModal, setCorrectModal] = useState<Record<string, unknown> | null>(null);
  const [newScore, setNewScore] = useState(0);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    void apiFetch<{ exams: ExamRecord[] }>('/exams').then((res) => {
      setExams(res.exams);
      const pref = res.exams.find((e) => e.status === 'COMPLETED') || res.exams[0];
      if (pref) setSelectedExamId(pref.exam_id);
    });
  }, []);

  const loadResults = async (examId: string) => {
    if (!examId) return;
    const res = await apiFetch<{ results: Array<Record<string, unknown>>; max_score: number }>(
      `/results/${examId}`,
    );
    setResults(res.results);
    setMaxScore(res.max_score);
  };

  useEffect(() => {
    if (selectedExamId) void loadResults(selectedExamId);
  }, [selectedExamId]);

  const selectedExam = exams.find((e) => e.exam_id === selectedExamId);
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

  const exportExcel = () => {
    const rows = results.map((r, i) => ({
      No: i + 1,
      Username: r.username,
      Nama: r.nama,
      Kelas: r.kelas,
      Benar: r.correct_count,
      Salah: r.incorrect_count,
      Kosong: r.unanswered_count,
      Nilai_Akhir: r.total_score,
      Persentase: `${((Number(r.total_score) / maxScore) * 100).toFixed(1)}%`,
      Dipublikasikan: Number(r.published) === 1 ? 'Ya' : 'Belum',
    }));
    exportRowsToExcel(`Hasil_Ujian_${selectedExamId}.xlsx`, 'Hasil_Ujian', rows);
  };

  const exportPdf = () => {
    exportTableToPdf(
      `Hasil_Ujian_${selectedExamId}.pdf`,
      {
        appName: config.app_name || 'CBT KIR IPA SMAN 1 SUKABUMI',
        orgName: config.org_name || 'KIR IPA',
        schoolName: config.school_name || 'SMAN 1 Sukabumi',
        title: `Rekap Hasil Ujian: ${selectedExam?.title || ''}`,
        activityName: selectedExam?.subject || 'Evaluasi Akademik',
        authorName: currentUser.nama,
      },
      ['No', 'Nama Peserta', 'Kelas', 'Benar', 'Salah', 'Skor', 'Status'],
      results.map((r, i) => [
        i + 1,
        String(r.nama),
        String(r.kelas),
        Number(r.correct_count),
        Number(r.incorrect_count),
        `${r.total_score}/${maxScore}`,
        Number(r.published) === 1 ? 'Terpublikasi' : 'Draft',
      ]),
    );
  };

  return (
    <div className="space-y-4">
      {toast && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {toast}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <select
          aria-label="Pilih ujian"
          value={selectedExamId}
          onChange={(e) => setSelectedExamId(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white min-w-[260px]"
        >
          {exams.map((e) => (
            <option key={e.exam_id} value={e.exam_id}>
              {e.title} ({e.status})
            </option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportExcel}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Excel
          </button>
          <button
            type="button"
            onClick={exportPdf}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </button>
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
              {results.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Belum ada hasil peserta yang dikumpulkan pada ujian ini.
                  </td>
                </tr>
              ) : (
                results.map((r) => (
                  <tr key={String(r.result_id)} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-medium text-slate-900">{String(r.nama)}</td>
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
    </div>
  );
}

export function LeaderboardView() {
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [leaderboard, setLeaderboard] = useState<RankedLeaderboardEntry[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiFetch<{ exams: ExamRecord[] }>('/exams').then((res) => {
      setExams(res.exams);
      const pref = res.exams.find((e) => e.status === 'COMPLETED') || res.exams[0];
      if (pref) setSelectedExamId(pref.exam_id);
    });
  }, []);

  useEffect(() => {
    if (!selectedExamId) return;
    setError('');
    void apiFetch<{ leaderboard: RankedLeaderboardEntry[] }>(`/leaderboard/${selectedExamId}`)
      .then((res) => setLeaderboard(res.leaderboard))
      .catch((err) => {
        setLeaderboard([]);
        setError(err instanceof Error ? err.message : 'Leaderboard tidak tersedia.');
      });
  }, [selectedExamId]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[#0F294A] font-bold">
          <Award className="w-5 h-5 text-amber-600" />
          <span>Peringkat & Leaderboard Peserta</span>
        </div>
        <select
          aria-label="Filter ujian leaderboard"
          value={selectedExamId}
          onChange={(e) => setSelectedExamId(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white min-w-[260px]"
        >
          {exams.map((e) => (
            <option key={e.exam_id} value={e.exam_id}>
              {e.title}
            </option>
          ))}
        </select>
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
    </div>
  );
}

export function ItemAnalysisView() {
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [analysis, setAnalysis] = useState<ItemAnalysisResult[]>([]);
  const [totalRespondents, setTotalRespondents] = useState(0);

  useEffect(() => {
    void apiFetch<{ exams: ExamRecord[] }>('/exams').then((res) => {
      setExams(res.exams);
      const pref = res.exams.find((e) => e.status === 'COMPLETED') || res.exams[0];
      if (pref) setSelectedExamId(pref.exam_id);
    });
  }, []);

  useEffect(() => {
    if (!selectedExamId) return;
    void apiFetch<{ total_respondents: number; analysis: ItemAnalysisResult[] }>(
      `/analytics/${selectedExamId}`,
    ).then((res) => {
      setTotalRespondents(res.total_respondents);
      setAnalysis(res.analysis);
    });
  }, [selectedExamId]);

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
          <h2 className="text-base font-bold text-[#0F294A]">Analisis Butir Soal</h2>
          <p className="text-xs text-slate-500">
            Total responden dianalisis: <strong className="font-mono">{totalRespondents}</strong> peserta
          </p>
        </div>
        <select
          aria-label="Pilih ujian untuk analisis"
          value={selectedExamId}
          onChange={(e) => setSelectedExamId(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white min-w-[260px]"
        >
          {exams.map((e) => (
            <option key={e.exam_id} value={e.exam_id}>
              {e.title}
            </option>
          ))}
        </select>
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
    </div>
  );
}

export function ReportsAndBeritaAcaraView({
  config,
  currentUser,
}: {
  config: Partial<AppSettingsMap>;
  currentUser: UserRecord;
}) {
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [berita, setBerita] = useState<{
    exam: ExamRecord;
    identity: Record<string, string>;
    summary: {
      registered: number;
      present: number;
      absent: number;
      finished: number;
      technical_issues: number;
      violations: Array<{ event_type: string; count: number }>;
      supervisor_name: string;
      generated_at: string;
    };
  } | null>(null);
  const [notes, setNotes] = useState('Pelaksanaan ujian berjalan tertib, aman, dan sesuai tata tertib KIR IPA SMAN 1 Sukabumi.');

  useEffect(() => {
    void apiFetch<{ exams: ExamRecord[] }>('/exams').then((res) => {
      setExams(res.exams);
      const pref = res.exams.find((e) => e.status === 'COMPLETED') || res.exams[0];
      if (pref) setSelectedExamId(pref.exam_id);
    });
  }, []);

  useEffect(() => {
    if (!selectedExamId) return;
    void apiFetch<typeof berita>(`/reports/${selectedExamId}/berita-acara`).then(setBerita);
  }, [selectedExamId]);

  const handleExportAll = async (type: 'EXCEL' | 'CSV' | 'PDF') => {
    if (!selectedExamId || !berita) return;
    const [resData, monData] = await Promise.all([
      apiFetch<{ results: Array<Record<string, unknown>>; max_score: number }>(`/results/${selectedExamId}`),
      apiFetch<{ violations: Array<Record<string, unknown>> }>(`/monitoring/${selectedExamId}`),
    ]);

    const rows = resData.results.map((r, i) => ({
      No: i + 1,
      Nama: r.nama,
      Kelas: r.kelas,
      Benar: r.correct_count,
      Salah: r.incorrect_count,
      Nilai: r.total_score,
      Maksimal: resData.max_score,
    }));

    if (type === 'EXCEL') {
      exportRowsToExcel(`Laporan_Lengkap_${selectedExamId}.xlsx`, 'Rekap_Nilai', rows);
    } else if (type === 'CSV') {
      exportRowsToCsv(`Laporan_Nilai_${selectedExamId}.csv`, rows);
    } else {
      exportTableToPdf(
        `Berita_Acara_${selectedExamId}.pdf`,
        {
          appName: config.app_name || 'CBT KIR IPA SMAN 1 SUKABUMI',
          orgName: config.org_name || 'KIR IPA',
          schoolName: config.school_name || 'SMAN 1 Sukabumi',
          title: `Berita Acara & Rekap Ujian: ${berita.exam.title}`,
          activityName: berita.exam.subject,
          authorName: currentUser.nama,
        },
        ['Keterangan', 'Nilai / Jumlah'],
        [
          ['Nama Ujian', berita.exam.title],
          ['Tanggal Pelaksanaan', new Date(berita.exam.start_time).toLocaleDateString('id-ID')],
          ['Peserta Terdaftar', berita.summary.registered],
          ['Peserta Hadir', berita.summary.present],
          ['Tidak Hadir', berita.summary.absent],
          ['Selesai Mengumpulkan', berita.summary.finished],
          ['Gangguan Teknis', berita.summary.technical_issues],
          ['Total Catatan Pelanggaran', monData.violations.length],
          ['Catatan Pelaksanaan', notes],
          ['Penanggung Jawab', berita.summary.supervisor_name],
        ],
      );
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <select
          aria-label="Pilih ujian untuk laporan"
          value={selectedExamId}
          onChange={(e) => setSelectedExamId(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white min-w-[260px]"
        >
          {exams.map((e) => (
            <option key={e.exam_id} value={e.exam_id}>
              {e.title} ({e.status})
            </option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleExportAll('EXCEL')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Ekspor Excel
          </button>
          <button
            type="button"
            onClick={() => handleExportAll('CSV')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Ekspor CSV
          </button>
          <button
            type="button"
            onClick={() => handleExportAll('PDF')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0F294A] text-white text-xs font-semibold hover:bg-blue-800 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Ekspor Berita Acara PDF
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Cetak
          </button>
        </div>
      </div>

      {berita && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-4 border-b-2 border-[#0F294A] pb-4">
            <AppLogo src={config.logo_url} sizeClass="w-16 h-16" />
            <div>
              <div className="text-xs font-semibold text-amber-700">
                {berita.identity.org_name} · {berita.identity.school_name}
              </div>
              <h2 className="text-xl font-bold text-[#0F294A]">BERITA ACARA PELAKSANAAN UJIAN DIGITAL</h2>
              <p className="text-xs text-slate-600">
                Tahun Ajaran {berita.identity.academic_year} · {berita.identity.app_name}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-1.5">
              <div><span className="text-slate-500">Nama Ujian:</span> <strong>{berita.exam.title}</strong></div>
              <div><span className="text-slate-500">Bidang / Mata Pelajaran:</span> <strong>{berita.exam.subject}</strong></div>
              <div>
                <span className="text-slate-500">Tanggal Pelaksanaan:</span>{' '}
                <strong>{new Date(berita.exam.start_time).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
              </div>
              <div><span className="text-slate-500">Durasi:</span> <strong className="font-mono">{berita.exam.duration} Menit</strong></div>
            </div>
            <div className="grid grid-cols-2 gap-2 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs">
              <div>Terdaftar: <strong className="font-mono text-sm block">{berita.summary.registered}</strong></div>
              <div>Hadir: <strong className="font-mono text-sm block text-blue-700">{berita.summary.present}</strong></div>
              <div>Tidak Hadir: <strong className="font-mono text-sm block text-slate-600">{berita.summary.absent}</strong></div>
              <div>Selesai: <strong className="font-mono text-sm block text-emerald-700">{berita.summary.finished}</strong></div>
              <div>Gangguan Teknis: <strong className="font-mono text-sm block text-amber-700">{berita.summary.technical_issues}</strong></div>
              <div>
                Pelanggaran:{' '}
                <strong className="font-mono text-sm block text-red-700">
                  {berita.summary.violations.reduce((s, v) => s + v.count, 0)}
                </strong>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Catatan Pelaksanaan Pengawas
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="pt-4 flex justify-between items-end text-xs text-slate-600 border-t border-slate-200">
            <div>{berita.identity.report_footer}</div>
            <div className="text-right">
              <div>Sukabumi, {new Date().toLocaleDateString('id-ID')}</div>
              <div className="mt-10 font-bold text-slate-900">{berita.summary.supervisor_name}</div>
              <div>Penanggung Jawab Pelaksanaan</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
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

import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquareWarning,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  StopCircle,
} from 'lucide-react';
import { RichMathRenderer } from './RichMathRenderer';
import { apiFetch } from '../utils/api';
import { safeJsonParse } from '../shared/grading';
import type { ExamRecord, QuestionOptionsPayload } from '../shared/types';

export function MonitoringView() {
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [participants, setParticipants] = useState<Array<Record<string, unknown>>>([]);
  const [violations, setViolations] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    void apiFetch<{ exams: ExamRecord[] }>('/exams').then((res) => {
      setExams(res.exams);
      const active = res.exams.find((e) => e.status === 'ACTIVE') || res.exams[0];
      if (active) setSelectedExamId(active.exam_id);
    });
  }, []);

  const loadMonitoring = async (exId: string) => {
    if (!exId) return;
    const res = await apiFetch<{
      participants: Array<Record<string, unknown>>;
      violations: Array<Record<string, unknown>>;
    }>(`/monitoring/${exId}`);
    setParticipants(res.participants);
    setViolations(res.violations);
  };

  useEffect(() => {
    if (!selectedExamId) return;
    void loadMonitoring(selectedExamId);
    const timer = setInterval(() => void loadMonitoring(selectedExamId), 15000);
    return () => clearInterval(timer);
  }, [selectedExamId]);

  const handleAction = async (userId: string, action: string, defaultNote: string) => {
    await apiFetch(`/monitoring/${selectedExamId}/action`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, action, note: defaultNote }),
    });
    setToast(`Tindakan ${action} berhasil dijalankan.`);
    setTimeout(() => setToast(''), 3000);
    await loadMonitoring(selectedExamId);
  };

  const filtered = participants.filter((p) => {
    if (statusFilter && p.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        String(p.nama || '').toLowerCase().includes(q) ||
        String(p.username || '').toLowerCase().includes(q) ||
        String(p.kelas || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-5">
      {toast && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {toast}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <select
            aria-label="Pilih ujian untuk dipantau"
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

          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari peserta..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <select
            aria-label="Filter status peserta"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="">Semua Status</option>
            <option value="BELUM_MULAI">Belum Mulai</option>
            <option value="MENGERJAKAN">Sedang Mengerjakan</option>
            <option value="TERKUMPUL">Sudah Mengumpulkan</option>
            <option value="GANGGUAN">Ditandai / Gangguan</option>
            <option value="DIHENTIKAN">Dihentikan Pengawas</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => void loadMonitoring(selectedExamId)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Segarkan Data
        </button>
      </div>

      {/* Participant Live Status Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Peserta</th>
                <th className="px-4 py-3">Kelas</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Dijawab</th>
                <th className="px-4 py-3">Sisa Waktu</th>
                <th className="px-4 py-3">Pelanggaran</th>
                <th className="px-4 py-3 text-right">Tindakan Pengawas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Tidak ada peserta pada filter ini.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const remMin = Math.floor(Number(p.remaining_seconds || 0) / 60);
                  const vCount = Number(p.violation_count || 0);
                  return (
                    <tr key={String(p.id)} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{String(p.nama)}</div>
                        <div className="text-xs font-mono text-slate-500">{String(p.username)}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{String(p.kelas)}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-[#0F294A]">
                        {String(p.status)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{Number(p.answered_count || 0)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{remMin} mnt</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        <span className={vCount > 0 ? 'text-red-600 font-bold' : 'text-slate-500'}>
                          {vCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            title="Kirim peringatan ke peserta"
                            onClick={() =>
                              handleAction(
                                String(p.user_id),
                                'WARN',
                                'Mohon tetap fokus dan tidak berpindah jendela browser selama ujian.',
                              )
                            }
                            className="p-1.5 rounded border border-slate-200 text-amber-700 hover:bg-amber-50 cursor-pointer"
                          >
                            <MessageSquareWarning className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Tandai untuk pemeriksaan"
                            onClick={() =>
                              handleAction(
                                String(p.user_id),
                                'FLAG_REVIEW',
                                'Ditandai pengawas untuk verifikasi.',
                              )
                            }
                            className="p-1.5 rounded border border-slate-200 text-blue-700 hover:bg-blue-50 cursor-pointer"
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                          </button>
                          {(p.status === 'MENGERJAKAN' || p.status === 'GANGGUAN') && (
                            <button
                              type="button"
                              title="Akhiri sesi ujian peserta secara manual"
                              onClick={() =>
                                handleAction(
                                  String(p.user_id),
                                  'FORCE_FINISH',
                                  'Diakhiri manual oleh pengawas.',
                                )
                              }
                              className="p-1.5 rounded border border-red-200 text-red-700 hover:bg-red-50 cursor-pointer"
                            >
                              <StopCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {p.status !== 'BELUM_MULAI' && (
                            <button
                              type="button"
                              title="Reset sesi ujian peserta (ulang dari awal)"
                              onClick={() =>
                                handleAction(
                                  String(p.user_id),
                                  'RESET_ATTEMPT',
                                  'Sesi peserta direset agar dapat mengulang ujian.',
                                )
                              }
                              className="p-1.5 rounded border border-slate-200 text-slate-600 hover:text-[#0F294A] hover:bg-slate-50 cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Violation Log Feed */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-[#0F294A] font-bold text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <h3>Catatan Indikasi Pelanggaran ({violations.length})</h3>
        </div>
        {violations.length === 0 ? (
          <p className="text-xs text-slate-500">Belum ada catatan pelanggaran untuk ujian ini.</p>
        ) : (
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {violations.map((v) => (
              <div key={String(v.log_id)} className="py-2.5 flex items-start justify-between gap-4 text-xs">
                <div>
                  <span className="font-semibold text-slate-900">{String(v.nama)}</span>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span className="font-mono font-semibold text-red-700">{String(v.event_type)}</span>
                  <p className="text-slate-600 mt-0.5">{String(v.description)}</p>
                </div>
                <span className="font-mono text-slate-400 shrink-0">
                  {new Date(String(v.event_time)).toLocaleString('id-ID')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function EssayGradingView() {
  const [essays, setEssays] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [scoreInputs, setScoreInputs] = useState<Record<string, number>>({});
  const [feedbackInputs, setFeedbackInputs] = useState<Record<string, string>>({});
  const [toast, setToast] = useState('');

  const loadEssays = async () => {
    setLoading(true);
    const res = await apiFetch<{ essays: Array<Record<string, unknown>> }>('/grading/essays');
    setEssays(res.essays);
    const initialScores: Record<string, number> = {};
    const initialFeedback: Record<string, string> = {};
    for (const item of res.essays) {
      const key = `${item.exam_id}:${item.question_id}:${item.user_id}`;
      initialScores[key] = Number(item.graded_score ?? 0);
      initialFeedback[key] = String(item.feedback ?? '');
    }
    setScoreInputs(initialScores);
    setFeedbackInputs(initialFeedback);
    setLoading(false);
  };

  useEffect(() => {
    void loadEssays();
  }, []);

  const handleGradeSubmit = async (e: FormEvent, item: Record<string, unknown>) => {
    e.preventDefault();
    const key = `${item.exam_id}:${item.question_id}:${item.user_id}`;
    await apiFetch('/grading/essays', {
      method: 'POST',
      body: JSON.stringify({
        exam_id: item.exam_id,
        question_id: item.question_id,
        user_id: item.user_id,
        score: scoreInputs[key] ?? 0,
        feedback: feedbackInputs[key] ?? '',
      }),
    });
    setToast(`Nilai esai untuk ${String(item.student_name)} tersimpan dan total nilai diperbarui.`);
    setTimeout(() => setToast(''), 3500);
    await loadEssays();
  };

  return (
    <div className="space-y-4">
      {toast && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {toast}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          Memuat antrean penilaian esai...
        </div>
      ) : essays.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          Belum ada jawaban esai yang terkumpul untuk dinilai.
        </div>
      ) : (
        essays.map((item) => {
          const key = `${item.exam_id}:${item.question_id}:${item.user_id}`;
          const opts = safeJsonParse<QuestionOptionsPayload>(String(item.options_json || '{}'), {});
          const studentAnswer = safeJsonParse<string>(String(item.answer_json || '""'), '');
          const isGraded = Boolean(item.grade_id);

          return (
            <div key={key} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <div className="text-xs text-slate-500">{String(item.exam_title)}</div>
                  <div className="text-base font-bold text-[#0F294A]">
                    {String(item.student_name)} ·{' '}
                    <span className="text-xs font-normal text-slate-600">{String(item.student_kelas)}</span>
                  </div>
                </div>
                <div className="text-xs font-semibold flex items-center gap-1.5">
                  {isGraded ? (
                    <span className="text-emerald-700 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Sudah Dinilai ({String(item.graded_score)}/{String(item.max_score)})
                    </span>
                  ) : (
                    <span className="text-amber-700">Menunggu Penilaian Manual</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-slate-500">Pertanyaan</div>
                  <RichMathRenderer content={String(item.question_text)} className="text-sm" />

                  {opts.essay_rubric && opts.essay_rubric.length > 0 && (
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                      <div className="text-xs font-bold text-[#0F294A]">Rubrik Penilaian</div>
                      {opts.essay_rubric.map((rub, rIdx) => (
                        <div key={rIdx} className="text-xs text-slate-700">
                          <strong>{rub.criterion} (Maks {rub.max_points}):</strong> {rub.description}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-semibold text-slate-500">Jawaban Peserta</div>
                  <div className="p-3.5 rounded-lg bg-blue-50/40 border border-slate-200 text-sm text-slate-800 whitespace-pre-wrap">
                    {studentAnswer || <em className="text-slate-400">Peserta tidak mengisi jawaban.</em>}
                  </div>

                  <form onSubmit={(e) => handleGradeSubmit(e, item)} className="space-y-2.5 pt-2">
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-slate-700">
                        Skor (Maks {String(item.max_score)}):
                      </label>
                      <input
                        type="number"
                        step={0.5}
                        min={0}
                        max={Number(item.max_score)}
                        value={scoreInputs[key] ?? 0}
                        onChange={(e) =>
                          setScoreInputs({ ...scoreInputs, [key]: Number(e.target.value) })
                        }
                        className="w-24 px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-mono"
                      />
                    </div>
                    <textarea
                      rows={2}
                      value={feedbackInputs[key] ?? ''}
                      onChange={(e) =>
                        setFeedbackInputs({ ...feedbackInputs, [key]: e.target.value })
                      }
                      placeholder="Catatan umpan balik penilai untuk peserta..."
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
                    >
                      Simpan Nilai Esai
                    </button>
                  </form>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

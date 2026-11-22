import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertOctagon,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  FileSpreadsheet,
  Plus,
  Printer,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { PrintPreviewModal } from './PrintPreviewModal';
import { SpreadsheetImportModal } from './SpreadsheetImportModal';
import { apiFetch } from '../utils/api';
import { exportRowsToCsv, exportRowsToExcel } from '../utils/exporters';
import { safeJsonParse } from '../shared/grading';
import type { ValidatedPreviewRow } from '../shared/spreadsheet';
import type {
  ExamRecord,
  ExamSettings,
  ExamStatus,
  ImportSummaryResult,
  QuestionRecord,
  UserRecord,
} from '../shared/types';

interface ExamManagerViewProps {
  currentUser: UserRecord;
  openBuilderImmediately?: boolean;
}

const DEFAULT_EXAM_SETTINGS: ExamSettings = {
  exam_type: 'EVALUASI',
  total_score_target: 100,
  passing_grade: 75,
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

export function ExamManagerView({
  currentUser,
  openBuilderImmediately = false,
}: ExamManagerViewProps) {
  const [exams, setExams] = useState<Array<ExamRecord & { participant_count?: number; creator_name?: string }>>([]);
  const [bankQuestions, setBankQuestions] = useState<QuestionRecord[]>([]);
  const [students, setStudents] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  // Builder Modal State
  const [builderOpen, setBuilderOpen] = useState(openBuilderImmediately);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('IPA Terpadu');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [duration, setDuration] = useState(60);
  const [status, setStatus] = useState<ExamStatus>('DRAFT');
  const [settings, setSettings] = useState<ExamSettings>(DEFAULT_EXAM_SETTINGS);
  const [pickedQuestions, setPickedQuestions] = useState<Array<{ question_id: string; score: number }>>([]);
  const [pickedStudentIds, setPickedStudentIds] = useState<string[]>([]);

  // Quick Schedule / Duration Modal State
  const [scheduleExam, setScheduleExam] = useState<ExamRecord | null>(null);
  const [schedStart, setSchedStart] = useState('');
  const [schedEnd, setSchedEnd] = useState('');
  const [schedDuration, setSchedDuration] = useState(60);
  const [schedStatus, setSchedStatus] = useState<ExamStatus>('ACTIVE');

  // Inline Quick Question Input inside Exam Builder
  const [quickQOpen, setQuickQOpen] = useState(false);
  const [quickQType, setQuickQType] = useState<'PG' | 'BENAR_SALAH' | 'ISIAN_SINGKAT' | 'ESAI'>('PG');
  const [quickQCategory, setQuickQCategory] = useState('IPA Terpadu');
  const [quickQText, setQuickQText] = useState('');
  const [quickQChoices, setQuickQChoices] = useState({ A: '', B: '', C: '', D: '', E: '' });
  const [quickQAnswer, setQuickQAnswer] = useState('A');
  const [quickQScore, setQuickQScore] = useState(10);

  // Delete Exam Confirmation
  const [deleteTargetExam, setDeleteTargetExam] = useState<ExamRecord | null>(null);

  // Per-Exam Spreadsheet Import & Print Participants States
  const [importExamTarget, setImportExamTarget] = useState<{
    exam: ExamRecord;
    mode: 'EXAM_QUESTIONS' | 'EXAM_PARTICIPANTS';
  } | null>(null);
  const [printParticipantsData, setPrintParticipantsData] = useState<{
    exam: ExamRecord;
    participants: Array<{
      username: string;
      nama: string;
      kelas: string;
      status: string;
      score: number;
    }>;
  } | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [eRes, qRes, uRes] = await Promise.all([
        apiFetch<{ exams: Array<ExamRecord & { participant_count?: number; creator_name?: string }> }>('/exams'),
        apiFetch<{ questions: QuestionRecord[] }>('/questions'),
        apiFetch<{ users: UserRecord[] }>('/users?role=SISWA'),
      ]);
      setExams(eRes.exams);
      setBankQuestions(qRes.questions);
      setStudents(uRes.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data ujian.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const toLocalInput = (iso: string) => {
    const d = iso ? new Date(iso) : new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openNewBuilder = () => {
    setEditingExamId(null);
    setTitle('');
    setDescription('');
    setSubject('IPA Terpadu');
    const now = new Date();
    const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    setStartTime(toLocalInput(now.toISOString()));
    setEndTime(toLocalInput(nextDay.toISOString()));
    setDuration(60);
    setStatus('DRAFT');
    setSettings(DEFAULT_EXAM_SETTINGS);
    setPickedQuestions([]);
    setPickedStudentIds(students.map((s) => s.user_id));
    setBuilderOpen(true);
  };

  useEffect(() => {
    if (openBuilderImmediately && students.length > 0 && !editingExamId) {
      openNewBuilder();
    }
  }, [openBuilderImmediately]);

  const openEditBuilder = async (examId: string) => {
    try {
      const detail = await apiFetch<{
        exam: ExamRecord;
        questions: Array<QuestionRecord & { exam_score: number }>;
        participants: Array<{ user_id: string }>;
      }>(`/exams/${examId}`);
      setEditingExamId(detail.exam.exam_id);
      setTitle(detail.exam.title);
      setDescription(detail.exam.description);
      setSubject(detail.exam.subject);
      setStartTime(toLocalInput(detail.exam.start_time));
      setEndTime(toLocalInput(detail.exam.end_time));
      setDuration(detail.exam.duration);
      setStatus(detail.exam.status);
      setSettings(safeJsonParse<ExamSettings>(detail.exam.settings_json, DEFAULT_EXAM_SETTINGS));
      setPickedQuestions(
        detail.questions.map((q) => ({ question_id: q.question_id, score: q.exam_score || q.score })),
      );
      setPickedStudentIds(detail.participants.map((p) => p.user_id));
      setBuilderOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuka detail ujian.');
    }
  };

  const handleSaveExam = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const payload = {
      title,
      description,
      subject,
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      duration,
      status,
      settings,
      questions: pickedQuestions,
      participant_ids: pickedStudentIds,
    };
    try {
      if (editingExamId) {
        await apiFetch(`/exams/${editingExamId}`, {
          method: 'PUT',
          body: JSON.stringify({ ...payload, sync_participants: true }),
        });
        showToast('Pengaturan ujian berhasil diperbarui.');
      } else {
        await apiFetch('/exams', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Ujian baru berhasil dibuat.');
      }
      setBuilderOpen(false);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan ujian.');
    }
  };

  const openScheduleModal = (ex: ExamRecord) => {
    setScheduleExam(ex);
    setSchedStart(toLocalInput(ex.start_time));
    setSchedEnd(toLocalInput(ex.end_time));
    setSchedDuration(ex.duration);
    setSchedStatus(ex.status);
  };

  const handleSaveSchedule = async (e: FormEvent) => {
    e.preventDefault();
    if (!scheduleExam) return;
    setError('');
    try {
      await apiFetch(`/exams/${scheduleExam.exam_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          start_time: new Date(schedStart).toISOString(),
          end_time: new Date(schedEnd).toISOString(),
          duration: Math.max(1, schedDuration),
          status: schedStatus,
        }),
      });
      setScheduleExam(null);
      showToast('Jadwal dan durasi waktu ujian berhasil diperbarui.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui waktu ujian.');
    }
  };

  const handleQuickCreateQuestion = async () => {
    setError('');
    if (!quickQText.trim()) {
      setError('Teks soal tidak boleh kosong.');
      return;
    }
    let options: Record<string, unknown> = {};
    let answer: unknown = quickQAnswer;
    if (quickQType === 'PG') {
      const choices = (['A', 'B', 'C', 'D', 'E'] as const)
        .map((lbl) => ({ id: lbl, label: lbl, text: quickQChoices[lbl].trim() }))
        .filter((c) => c.text.length > 0);
      if (choices.length < 2) {
        setError('Minimal isi 2 opsi jawaban untuk Pilihan Ganda.');
        return;
      }
      options = { choices };
    } else if (quickQType === 'BENAR_SALAH') {
      answer = quickQAnswer === 'SALAH' ? 'SALAH' : 'BENAR';
    } else if (quickQType === 'ISIAN_SINGKAT') {
      const variants = quickQAnswer
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      if (variants.length === 0) {
        setError('Isi kunci jawaban untuk Isian Singkat.');
        return;
      }
      options = { accepted_answers: variants, case_sensitive: false };
      answer = variants[0];
    } else {
      options = { essay_max_chars: 1500 };
      answer = '';
    }

    try {
      const res = await apiFetch<{ question_id: string }>('/questions', {
        method: 'POST',
        body: JSON.stringify({
          question_type: quickQType,
          question_text: quickQText.trim(),
          options,
          correct_answer: answer,
          category: quickQCategory.trim() || 'IPA Terpadu',
          difficulty: 'SEDANG',
          score: Math.max(1, quickQScore),
        }),
      });
      const qRes = await apiFetch<{ questions: QuestionRecord[] }>('/questions');
      setBankQuestions(qRes.questions);
      setPickedQuestions((prev) => [
        ...prev,
        { question_id: res.question_id, score: Math.max(1, quickQScore) },
      ]);
      setQuickQText('');
      setQuickQChoices({ A: '', B: '', C: '', D: '', E: '' });
      setQuickQOpen(false);
      showToast('Soal baru tersimpan ke Bank Soal dan ditambahkan ke ujian.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat soal.');
    }
  };

  const handleConfirmDeleteExam = async () => {
    if (!deleteTargetExam) return;
    try {
      await apiFetch(`/exams/${deleteTargetExam.exam_id}`, { method: 'DELETE' });
      setDeleteTargetExam(null);
      showToast('Ujian berhasil dihapus.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus ujian.');
    }
  };

  const changeExamStatus = async (examId: string, nextStatus: ExamStatus) => {
    await apiFetch(`/exams/${examId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: nextStatus }),
    });
    showToast(`Status ujian diubah menjadi ${nextStatus}.`);
    await loadAll();
  };

  const handleEmergencyStop = async (examId: string) => {
    const res = await apiFetch<{ stopped_participants: number }>(`/exams/${examId}/emergency-stop`, {
      method: 'POST',
    });
    showToast(`Ujian dihentikan darurat. ${res.stopped_participants} sesi aktif dikumpulkan.`);
    await loadAll();
  };

  const toggleQuestion = (q: QuestionRecord) => {
    setPickedQuestions((prev) => {
      const exists = prev.some((item) => item.question_id === q.question_id);
      if (exists) return prev.filter((item) => item.question_id !== q.question_id);
      return [...prev, { question_id: q.question_id, score: q.score }];
    });
  };

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= pickedQuestions.length) return;
    const next = [...pickedQuestions];
    const tmp = next[idx];
    next[idx] = next[target];
    next[target] = tmp;
    setPickedQuestions(next);
  };

  const handleExportExams = (format: 'xlsx' | 'csv') => {
    const rows = exams.map((ex, idx) => ({
      No: idx + 1,
      ID_Ujian: ex.exam_id,
      Nama_Ujian: ex.title,
      Bidang_Mapel: ex.subject,
      Status: ex.status,
      Mulai: ex.start_time ? new Date(ex.start_time).toLocaleString('id-ID') : '',
      Selesai: ex.end_time ? new Date(ex.end_time).toLocaleString('id-ID') : '',
      Durasi_Menit: ex.duration,
      Jumlah_Soal: ex.total_questions,
      Jumlah_Peserta: ex.participant_count ?? 0,
    }));
    if (format === 'csv') {
      exportRowsToCsv('Daftar_Ujian_KIR_IPA.csv', rows);
    } else {
      exportRowsToExcel('Daftar_Ujian_KIR_IPA.xlsx', 'Daftar_Ujian', rows);
    }
  };

  const handleOpenPrintParticipants = async (ex: ExamRecord) => {
    try {
      const detail = await apiFetch<{
        exam: ExamRecord;
        participants: Array<{
          username: string;
          nama: string;
          kelas: string;
          status: string;
          score: number;
        }>;
      }>(`/exams/${ex.exam_id}`);
      setPrintParticipantsData({
        exam: detail.exam,
        participants: detail.participants,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar peserta ujian.');
    }
  };

  const handleExamImportSubmit = async (
    validRows: ValidatedPreviewRow[],
    duplicateRows: ValidatedPreviewRow[],
  ): Promise<ImportSummaryResult> => {
    if (!importExamTarget) {
      return { imported: 0, skipped_duplicates: 0, failed_count: 0, errors: [] };
    }
    const { exam, mode } = importExamTarget;
    if (mode === 'EXAM_QUESTIONS') {
      const allRows = [...validRows, ...duplicateRows].map((r) => ({
        _rowNumber: r.rowNumber,
        ...(r.normalizedPayload || r.mapped),
      }));
      const res = await apiFetch<ImportSummaryResult>(`/exams/${exam.exam_id}/questions/import`, {
        method: 'POST',
        body: JSON.stringify({ questions: allRows }),
      });
      await loadAll();
      return res;
    }

    const payloadParts = validRows.map((r) => ({
      _rowNumber: r.rowNumber,
      ...(r.normalizedPayload || r.mapped),
    }));
    const res = await apiFetch<ImportSummaryResult>(`/exams/${exam.exam_id}/participants/import`, {
      method: 'POST',
      body: JSON.stringify({ participants: payloadParts }),
    });
    await loadAll();
    return res;
  };

  return (
    <div className="space-y-4">
      {toast && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {toast}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-[#0F294A]">Daftar Ujian & Jadwal Pelaksanaan</h2>
          <p className="text-xs text-slate-500">
            Kelola siklus ujian dari Draft, Terjadwal, Aktif, Selesai, impor massal soal/peserta, hingga ekspor.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleExportExams('xlsx')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            Ekspor Excel
          </button>
          <button
            type="button"
            onClick={() => handleExportExams('csv')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-blue-700" />
            Ekspor CSV
          </button>
          <button
            type="button"
            onClick={openNewBuilder}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Buat Ujian Baru
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            Memuat daftar ujian...
          </div>
        ) : exams.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            Belum ada ujian terdaftar.
          </div>
        ) : (
          exams.map((ex) => (
            <div
              key={ex.exam_id}
              className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono font-bold text-[#0F294A]">{ex.status}</span>
                  <span>·</span>
                  <span>{ex.subject}</span>
                  <span>·</span>
                  <span className="font-mono">{ex.total_questions} Soal</span>
                  <span>·</span>
                  <span className="font-mono">{ex.duration} Menit</span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> {ex.participant_count ?? 0} Peserta
                  </span>
                </div>
                <h3 className="text-base font-bold text-[#0F294A]">{ex.title}</h3>
                <p className="text-xs text-slate-600">{ex.description}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setImportExamTarget({ exam: ex, mode: 'EXAM_QUESTIONS' })}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50/60 text-xs font-medium text-blue-800 hover:bg-blue-100 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Impor Soal
                </button>
                <button
                  type="button"
                  onClick={() => setImportExamTarget({ exam: ex, mode: 'EXAM_PARTICIPANTS' })}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Impor Peserta
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpenPrintParticipants(ex)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Cetak Peserta
                </button>
                <button
                  type="button"
                  onClick={() => openScheduleModal(ex)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5" />
                  Ubah Waktu
                </button>
                <button
                  type="button"
                  onClick={() => openEditBuilder(ex.exam_id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Atur Soal & Peserta
                </button>
                {ex.status !== 'ACTIVE' && (
                  <button
                    type="button"
                    onClick={() => changeExamStatus(ex.exam_id, 'ACTIVE')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Aktifkan
                  </button>
                )}
                {ex.status === 'ACTIVE' && (
                  <button
                    type="button"
                    onClick={() => changeExamStatus(ex.exam_id, 'COMPLETED')}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Akhiri Ujian
                  </button>
                )}
                {currentUser.role === 'SUPER_ADMIN' && ex.status === 'ACTIVE' && (
                  <button
                    type="button"
                    onClick={() => handleEmergencyStop(ex.exam_id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    <AlertOctagon className="w-3.5 h-3.5" />
                    Hentikan Darurat
                  </button>
                )}
                {currentUser.role === 'SUPER_ADMIN' && (
                  <button
                    type="button"
                    aria-label={`Hapus ujian ${ex.title}`}
                    onClick={() => setDeleteTargetExam(ex)}
                    className="p-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Exam Builder Modal */}
      {builderOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-5xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-[#0F294A]">
                {editingExamId ? 'Edit Konfigurasi Ujian' : 'Buat Ujian Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setBuilderOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                Tutup
              </button>
            </div>

            <form onSubmit={handleSaveExam} className="space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Ujian</label>
                  <input
                    required
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Mata Pelajaran / Bidang</label>
                  <input
                    required
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Deskripsi</label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Waktu Mulai</label>
                  <input
                    required
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Waktu Selesai</label>
                  <input
                    required
                    type="datetime-local"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              {/* Exam Settings */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jenis Ujian</label>
                  <select
                    value={settings.exam_type}
                    onChange={(e) =>
                      setSettings({ ...settings, exam_type: e.target.value as ExamSettings['exam_type'] })
                    }
                    className="w-full px-2.5 py-2 rounded border border-slate-300 text-xs bg-white"
                  >
                    <option value="EVALUASI">Evaluasi</option>
                    <option value="SELEKSI">Seleksi KIR</option>
                    <option value="LATIHAN">Latihan</option>
                    <option value="SIMULASI_OSN">Simulasi OSN</option>
                    <option value="KUIS">Kuis</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Durasi (Menit)</label>
                  <input
                    type="number"
                    min={1}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 text-xs bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Passing Grade (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={settings.passing_grade}
                    onChange={(e) => setSettings({ ...settings, passing_grade: Number(e.target.value) })}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 text-xs bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status Ujian</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ExamStatus)}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 text-xs bg-white"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="SCHEDULED">Scheduled</option>
                    <option value="ACTIVE">Active</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="ARCHIVED">Archived</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Maks Percobaan</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={settings.max_attempts}
                    onChange={(e) => setSettings({ ...settings, max_attempts: Number(e.target.value) })}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 text-xs bg-white font-mono"
                  />
                </div>

                <div className="col-span-2 sm:col-span-5 grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-xs text-slate-700">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.shuffle_questions}
                      onChange={(e) => setSettings({ ...settings, shuffle_questions: e.target.checked })}
                    />
                    Acak Urutan Soal
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.shuffle_options}
                      onChange={(e) => setSettings({ ...settings, shuffle_options: e.target.checked })}
                    />
                    Acak Pilihan PG
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.anti_cheat_tab_switch}
                      onChange={(e) => setSettings({ ...settings, anti_cheat_tab_switch: e.target.checked })}
                    />
                    Deteksi Pindah Tab
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.anti_cheat_fullscreen}
                      onChange={(e) => setSettings({ ...settings, anti_cheat_fullscreen: e.target.checked })}
                    />
                    Wajib Fullscreen
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.anti_cheat_block_copy}
                      onChange={(e) => setSettings({ ...settings, anti_cheat_block_copy: e.target.checked })}
                    />
                    Batasi Copy-Paste
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.anti_cheat_block_context_menu}
                      onChange={(e) => setSettings({ ...settings, anti_cheat_block_context_menu: e.target.checked })}
                    />
                    Blokir Klik Kanan
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.show_leaderboard}
                      onChange={(e) => setSettings({ ...settings, show_leaderboard: e.target.checked })}
                    />
                    Aktifkan Leaderboard
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.leaderboard_anonymous}
                      onChange={(e) => setSettings({ ...settings, leaderboard_anonymous: e.target.checked })}
                    />
                    Sembunyikan Nama di Leaderboard
                  </label>
                </div>
              </div>

              {/* Pick Questions & Reorder */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#0F294A]">
                      Pilih Soal dari Bank Soal ({bankQuestions.length} tersedia)
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuickQOpen((v) => !v)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-blue-700 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      {quickQOpen ? 'Tutup Input Soal' : 'Input Soal Baru'}
                    </button>
                  </div>

                  {quickQOpen && (
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
                      <div className="grid grid-cols-3 gap-2">
                        <select
                          aria-label="Tipe soal cepat"
                          value={quickQType}
                          onChange={(e) => {
                            const t = e.target.value as typeof quickQType;
                            setQuickQType(t);
                            setQuickQAnswer(t === 'BENAR_SALAH' ? 'BENAR' : t === 'PG' ? 'A' : '');
                          }}
                          className="px-2 py-1.5 rounded border border-slate-300 bg-white"
                        >
                          <option value="PG">Pilihan Ganda</option>
                          <option value="BENAR_SALAH">Benar / Salah</option>
                          <option value="ISIAN_SINGKAT">Isian Singkat</option>
                          <option value="ESAI">Esai</option>
                        </select>
                        <input
                          type="text"
                          value={quickQCategory}
                          onChange={(e) => setQuickQCategory(e.target.value)}
                          placeholder="Kategori (mis. Fisika)"
                          className="px-2 py-1.5 rounded border border-slate-300 bg-white"
                        />
                        <input
                          type="number"
                          min={1}
                          value={quickQScore}
                          onChange={(e) => setQuickQScore(Number(e.target.value))}
                          placeholder="Bobot"
                          className="px-2 py-1.5 rounded border border-slate-300 bg-white font-mono"
                        />
                      </div>
                      <textarea
                        rows={2}
                        value={quickQText}
                        onChange={(e) => setQuickQText(e.target.value)}
                        placeholder="Tulis pertanyaan (mendukung KaTeX $...$)..."
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                      />
                      {quickQType === 'PG' && (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-2 gap-1.5">
                            {(['A', 'B', 'C', 'D'] as const).map((lbl) => (
                              <input
                                key={lbl}
                                type="text"
                                value={quickQChoices[lbl]}
                                onChange={(e) =>
                                  setQuickQChoices({ ...quickQChoices, [lbl]: e.target.value })
                                }
                                placeholder={`Opsi ${lbl}`}
                                className="px-2 py-1 rounded border border-slate-300 bg-white"
                              />
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <span>Kunci Benar:</span>
                            <select
                              value={quickQAnswer}
                              onChange={(e) => setQuickQAnswer(e.target.value)}
                              className="px-2 py-1 rounded border border-slate-300 bg-white"
                            >
                              <option value="A">A</option>
                              <option value="B">B</option>
                              <option value="C">C</option>
                              <option value="D">D</option>
                            </select>
                          </div>
                        </div>
                      )}
                      {quickQType === 'BENAR_SALAH' && (
                        <select
                          value={quickQAnswer}
                          onChange={(e) => setQuickQAnswer(e.target.value)}
                          className="px-2 py-1 rounded border border-slate-300 bg-white"
                        >
                          <option value="BENAR">BENAR</option>
                          <option value="SALAH">SALAH</option>
                        </select>
                      )}
                      {quickQType === 'ISIAN_SINGKAT' && (
                        <input
                          type="text"
                          value={quickQAnswer}
                          onChange={(e) => setQuickQAnswer(e.target.value)}
                          placeholder="Kunci jawaban (pisahkan variasi dengan |)"
                          className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white"
                        />
                      )}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => void handleQuickCreateQuestion()}
                          className="px-3 py-1.5 rounded bg-[#0F294A] text-white font-semibold cursor-pointer"
                        >
                          Simpan & Masukkan ke Ujian
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                    {bankQuestions.map((q) => {
                      const picked = pickedQuestions.some((p) => p.question_id === q.question_id);
                      const cleanText = q.question_text.replace(/<[^>]+>/g, ' ').trim();
                      return (
                        <label
                          key={q.question_id}
                          className="py-2 flex items-start gap-2.5 text-xs cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={picked}
                            onChange={() => toggleQuestion(q)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0">
                            <span className="font-mono font-semibold text-[#0F294A]">{q.question_type}</span>
                            <span className="text-slate-400 mx-1">·</span>
                            <span>{q.category}</span>
                            <p className="text-slate-600 line-clamp-1">{cleanText}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                  <div className="text-xs font-bold text-[#0F294A]">
                    Urutan & Bobot Soal Ujian ({pickedQuestions.length} dipilih · Total Skor:{' '}
                    {pickedQuestions.reduce((acc, q) => acc + Number(q.score), 0)})
                  </div>
                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                    {pickedQuestions.map((item, idx) => {
                      const q = bankQuestions.find((b) => b.question_id === item.question_id);
                      return (
                        <div key={item.question_id} className="py-2 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0 flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-500">#{idx + 1}</span>
                            <span className="truncate">{q?.question_text.replace(/<[^>]+>/g, ' ').slice(0, 60)}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="number"
                              min={1}
                              value={item.score}
                              onChange={(e) => {
                                const next = [...pickedQuestions];
                                next[idx] = { ...next[idx], score: Number(e.target.value) };
                                setPickedQuestions(next);
                              }}
                              className="w-14 px-1.5 py-1 border border-slate-300 rounded font-mono text-right"
                            />
                            <button type="button" onClick={() => moveQuestion(idx, -1)} className="p-1 border rounded">
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button type="button" onClick={() => moveQuestion(idx, 1)} className="p-1 border rounded">
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Pick Participants */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#0F294A]">
                    Peserta Sasaran ({pickedStudentIds.length} siswa dipilih)
                  </span>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setPickedStudentIds(students.map((s) => s.user_id))}
                      className="text-blue-700 hover:underline cursor-pointer"
                    >
                      Pilih Semua
                    </button>
                    <button
                      type="button"
                      onClick={() => setPickedStudentIds([])}
                      className="text-slate-500 hover:underline cursor-pointer"
                    >
                      Kosongkan
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                  {students.map((s) => (
                    <label key={s.user_id} className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pickedStudentIds.includes(s.user_id)}
                        onChange={(e) => {
                          setPickedStudentIds((prev) =>
                            e.target.checked
                              ? [...prev, s.user_id]
                              : prev.filter((id) => id !== s.user_id),
                          );
                        }}
                      />
                      <span className="truncate">{s.nama} ({s.kelas})</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setBuilderOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white text-sm font-semibold cursor-pointer"
                >
                  Simpan Ujian
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Schedule / Duration Modal */}
      {scheduleExam && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-[#0F294A]">
              Ubah Waktu & Jadwal: {scheduleExam.title}
            </h3>
            <form onSubmit={handleSaveSchedule} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Waktu Mulai</label>
                <input
                  required
                  type="datetime-local"
                  value={schedStart}
                  onChange={(e) => setSchedStart(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Waktu Selesai</label>
                <input
                  required
                  type="datetime-local"
                  value={schedEnd}
                  onChange={(e) => setSchedEnd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Durasi (Menit)</label>
                  <input
                    required
                    type="number"
                    min={1}
                    value={schedDuration}
                    onChange={(e) => setSchedDuration(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={schedStatus}
                    onChange={(e) => setSchedStatus(e.target.value as ExamStatus)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="SCHEDULED">Scheduled</option>
                    <option value="ACTIVE">Active</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="ARCHIVED">Archived</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setScheduleExam(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#0F294A] text-white text-sm font-semibold cursor-pointer"
                >
                  Simpan Jadwal & Waktu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Exam Confirmation Modal */}
      {deleteTargetExam && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-red-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-red-700">Hapus Ujian</h3>
            <p className="text-sm text-slate-600">
              Anda yakin ingin menghapus ujian <strong>{deleteTargetExam.title}</strong> beserta seluruh data peserta dan jawabannya?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTargetExam(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteExam()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold cursor-pointer"
              >
                Ya, Hapus Ujian
              </button>
            </div>
          </div>
        </div>
      )}

      <SpreadsheetImportModal
        isOpen={Boolean(importExamTarget)}
        onClose={() => setImportExamTarget(null)}
        entityType={importExamTarget?.mode || 'EXAM_QUESTIONS'}
        title={
          importExamTarget?.mode === 'EXAM_PARTICIPANTS'
            ? `Impor Daftar Peserta ke Ujian: ${importExamTarget.exam.title}`
            : `Impor Daftar Soal ke Ujian: ${importExamTarget?.exam.title || ''}`
        }
        subtitle={
          importExamTarget?.mode === 'EXAM_PARTICIPANTS'
            ? 'Masukkan username/NIS siswa dari Excel/CSV ke ujian ini (siswa baru otomatis dibuatkan akun jika Nama Lengkap diisi).'
            : 'Impor soal langsung ke ujian ini. Soal yang sudah ada di Bank Soal akan ditautkan otomatis tanpa duplikasi.'
        }
        existingKeys={new Set<string>()}
        onImportSubmit={handleExamImportSubmit}
      />

      <PrintPreviewModal
        isOpen={Boolean(printParticipantsData)}
        onClose={() => setPrintParticipantsData(null)}
        documentTitle={`DAFTAR PESERTA UJIAN: ${printParticipantsData?.exam.title || ''}`}
        subtitle={`Bidang: ${printParticipantsData?.exam.subject || ''} · Durasi: ${printParticipantsData?.exam.duration || 0} Menit`}
        activityName={printParticipantsData?.exam.title || ''}
        authorName={currentUser.nama}
        filePrefix={`Daftar_Peserta_${printParticipantsData?.exam.exam_id || 'Ujian'}`}
        columns={[
          { key: 'no', label: 'No', align: 'center' },
          { key: 'username', label: 'Username / NIS' },
          { key: 'nama', label: 'Nama Lengkap Peserta' },
          { key: 'kelas', label: 'Kelas / Divisi' },
          { key: 'status', label: 'Status Ujian', align: 'center' },
          { key: 'paraf', label: 'Tanda Tangan / Ket.', align: 'center' },
        ]}
        rows={(printParticipantsData?.participants || []).map((p, idx) => ({
          no: idx + 1,
          username: p.username,
          nama: p.nama,
          kelas: p.kelas || '—',
          status: p.status,
          paraf: `${idx + 1}. ..............`,
        }))}
        summaryPairs={[
          { label: 'Total Peserta Terdaftar', value: printParticipantsData?.participants.length || 0 },
          { label: 'Jumlah Soal', value: printParticipantsData?.exam.total_questions || 0 },
          { label: 'Durasi', value: `${printParticipantsData?.exam.duration || 0} Menit` },
          { label: 'Status Ujian', value: printParticipantsData?.exam.status || '' },
        ]}
      />
    </div>
  );
}

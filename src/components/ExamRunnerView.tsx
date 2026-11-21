import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Clock,
  Flag,
  LayoutGrid,
  Maximize2,
  Minimize2,
  RefreshCw,
  Send,
  ShieldAlert,
  WifiOff,
} from 'lucide-react';
import { AppLogo } from './AppLogo';
import { RichMathRenderer } from './RichMathRenderer';
import { ApiError, apiFetch } from '../utils/api';
import { isAnswerProvided, safeJsonParse } from '../shared/grading';
import type {
  AppSettingsMap,
  ExamSettings,
  StudentSafeQuestion,
  UserRecord,
} from '../shared/types';

interface ExamRunnerViewProps {
  examId: string;
  user: UserRecord;
  config: Partial<AppSettingsMap>;
  onExitToDashboard: () => void;
}

interface StartExamResponse {
  locked: boolean;
  auto_submitted?: boolean;
  exam: {
    exam_id: string;
    title: string;
    description: string;
    subject: string;
    duration: number;
    settings: ExamSettings;
  };
  remaining_seconds: number;
  questions: StudentSafeQuestion[];
  saved_answers: Array<{
    question_id: string;
    answer_json: string;
    is_doubtful: number;
    saved_at: string;
  }>;
  violations_count: number;
}

function formatCountdown(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return [hrs, mins, secs].map((v) => String(v).padStart(2, '0')).join(':');
}

export function ExamRunnerView({
  examId,
  user,
  config,
  onExitToDashboard,
}: ExamRunnerViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sessionConflictPrompt, setSessionConflictPrompt] = useState(false);

  const [examMeta, setExamMeta] = useState<StartExamResponse['exam'] | null>(null);
  const [questions, setQuestions] = useState<StudentSafeQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answersMap, setAnswersMap] = useState<Record<string, unknown>>({});
  const [doubtfulMap, setDoubtfulMap] = useState<Record<string, boolean>>({});
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const [saveState, setSaveState] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'RETRYING'>('IDLE');
  const [lastSavedAt, setLastSavedAt] = useState<string>('');
  const [violationsCount, setViolationsCount] = useState(0);
  const [antiCheatBanner, setAntiCheatBanner] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedNotice, setSubmittedNotice] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const pendingRetryQueue = useRef<Map<string, { answer: unknown; is_doubtful: boolean }>>(
    new Map(),
  );
  const lastBlurEventAt = useRef<number>(0);
  const hasAutoSubmitted = useRef(false);

  const startOrResumeExam = useCallback(
    async (recoverSession = false) => {
      setLoading(true);
      setError('');
      setSessionConflictPrompt(false);
      try {
        const res = await apiFetch<StartExamResponse>(`/cbt/exams/${examId}/start`, {
          method: 'POST',
          body: JSON.stringify({ recover_session: recoverSession }),
        });

        if (res.locked) {
          setSubmittedNotice(true);
          setLoading(false);
          return;
        }

        setExamMeta(res.exam);
        setQuestions(res.questions);
        setRemainingSeconds(res.remaining_seconds);
        setViolationsCount(res.violations_count || 0);

        const initialAnswers: Record<string, unknown> = {};
        const initialDoubtful: Record<string, boolean> = {};
        for (const sa of res.saved_answers || []) {
          const parsed = safeJsonParse<unknown>(sa.answer_json, null);
          if (parsed !== null) {
            initialAnswers[sa.question_id] = parsed;
          }
          if (sa.is_doubtful === 1) {
            initialDoubtful[sa.question_id] = true;
          }
        }

        setAnswersMap(initialAnswers);
        setDoubtfulMap(initialDoubtful);
        setSaveState('SAVED');
      } catch (err) {
        if (err instanceof ApiError && err.code === 'MULTIPLE_SESSION_DETECTED') {
          setSessionConflictPrompt(true);
        } else {
          setError(err instanceof Error ? err.message : 'Gagal memuat sesi ujian.');
        }
      } finally {
        setLoading(false);
      }
    },
    [examId],
  );

  useEffect(() => {
    void startOrResumeExam(false);
  }, [startOrResumeExam]);

  const persistAnswerToServer = useCallback(
    async (questionId: string, answer: unknown, isDoubtful: boolean) => {
      setSaveState('SAVING');
      try {
        const res = await apiFetch<{ ok: boolean; saved_at: string }>(
          `/cbt/exams/${examId}/answer`,
          {
            method: 'POST',
            body: JSON.stringify({
              question_id: questionId,
              answer,
              is_doubtful: isDoubtful,
            }),
          },
        );
        pendingRetryQueue.current.delete(questionId);
        setSaveState('SAVED');
        setLastSavedAt(res.saved_at);
      } catch {
        pendingRetryQueue.current.set(questionId, { answer, is_doubtful: isDoubtful });
        setSaveState('RETRYING');
      }
    },
    [examId],
  );

  // Retry queue processor & periodic flush
  useEffect(() => {
    const flushQueue = async () => {
      if (pendingRetryQueue.current.size === 0) return;
      for (const [qId, payload] of pendingRetryQueue.current.entries()) {
        await persistAnswerToServer(qId, payload.answer, payload.is_doubtful);
      }
    };
    const interval = setInterval(() => {
      void flushQueue();
    }, 5000);
    const onOnline = () => void flushQueue();
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
    };
  }, [persistAnswerToServer]);

  // Final Submit (Manual or Auto)
  const executeFinalSubmit = useCallback(
    async (autoSubmit: boolean) => {
      if (hasAutoSubmitted.current && autoSubmit) return;
      if (autoSubmit) hasAutoSubmitted.current = true;
      setSubmitting(true);
      try {
        const pendingAnswers = Array.from(pendingRetryQueue.current.entries()).map(
          ([question_id, val]) => ({ question_id, ...val }),
        );
        await apiFetch(`/cbt/exams/${examId}/submit`, {
          method: 'POST',
          body: JSON.stringify({
            auto_submit: autoSubmit,
            pending_answers: pendingAnswers,
          }),
        });
        setConfirmSubmitOpen(false);
        setSubmittedNotice(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal mengumpulkan ujian.');
      } finally {
        setSubmitting(false);
      }
    },
    [examId],
  );

  // Countdown tick + Server timer synchronization every 15s
  useEffect(() => {
    if (!examMeta || submittedNotice) return;

    const tick = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          void executeFinalSubmit(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const serverSync = setInterval(async () => {
      try {
        const sync = await apiFetch<{
          locked: boolean;
          remaining_seconds: number;
          auto_submitted?: boolean;
          session_conflict?: boolean;
        }>(`/cbt/exams/${examId}/timer`);
        if (sync.locked) {
          setSubmittedNotice(true);
          return;
        }
        if (sync.session_conflict) {
          setAntiCheatBanner(
            'Terdeteksi aktivitas login di perangkat/tab lain. Sesi ini mungkin tidak sinkron.',
          );
        }
        setRemainingSeconds(sync.remaining_seconds);
      } catch {
        // Ignore transient sync blip; retry next cycle
      }
    }, 15000);

    return () => {
      clearInterval(tick);
      clearInterval(serverSync);
    };
  }, [examId, examMeta, submittedNotice, executeFinalSubmit]);

  // Anti-cheat listeners (deduplicated visibilitychange + blur, fullscreen, copy/paste, contextmenu)
  const recordViolation = useCallback(
    async (eventType: string, description: string) => {
      if (submittedNotice) return;
      try {
        const res = await apiFetch<{ total_violations: number }>(`/cbt/exams/${examId}/violation`, {
          method: 'POST',
          body: JSON.stringify({ event_type: eventType, description }),
        });
        setViolationsCount(res.total_violations);
      } catch {
        // Non-blocking
      }
    },
    [examId, submittedNotice],
  );

  useEffect(() => {
    if (!examMeta || submittedNotice) return;
    const settings = examMeta.settings;

    const handleLeaveFocus = (source: 'visibility' | 'blur') => {
      if (!settings.anti_cheat_tab_switch) return;
      if (source === 'visibility' && !document.hidden) return;
      const now = Date.now();
      // Deduplicate blur & visibilitychange fired within 1500ms of the same switch
      if (now - lastBlurEventAt.current < 1500) return;
      lastBlurEventAt.current = now;
      setAntiCheatBanner(
        'Peringatan: Perpindahan tab atau jendela browser terdeteksi dan dicatat ke log pengawas.',
      );
      void recordViolation('TAB_SWITCH', `Peserta meninggalkan jendela ujian (${source}).`);
    };

    const onVisChange = () => handleLeaveFocus('visibility');
    const onBlur = () => handleLeaveFocus('blur');

    const onFullscreenChange = () => {
      const fsActive = Boolean(document.fullscreenElement);
      setIsFullscreen(fsActive);
      if (!fsActive && settings.anti_cheat_fullscreen) {
        setAntiCheatBanner(
          'Peringatan: Anda keluar dari mode layar penuh (Fullscreen). Silakan aktifkan kembali.',
        );
        void recordViolation('FULLSCREEN_EXIT', 'Peserta keluar dari mode layar penuh.');
      }
    };

    const onCopy = (e: ClipboardEvent) => {
      if (!settings.anti_cheat_block_copy) return;
      e.preventDefault();
      setAntiCheatBanner('Aktivitas menyalin soal dibatasi dan dicatat oleh sistem.');
      void recordViolation('COPY_ATTEMPT', 'Percobaan copy teks selama ujian.');
    };

    const onContextMenu = (e: MouseEvent) => {
      if (!settings.anti_cheat_block_context_menu) return;
      e.preventDefault();
      void recordViolation('CONTEXT_MENU', 'Percobaan klik kanan pada halaman ujian.');
    };

    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('copy', onCopy);
    document.addEventListener('contextmenu', onContextMenu);

    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, [examMeta, submittedNotice, recordViolation]);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Browser may block fullscreen outside user gesture
    }
  };

  const currentQuestion = questions[currentIndex];

  const updateAnswer = (qId: string, val: unknown, immediateSave = true) => {
    setAnswersMap((prev) => ({ ...prev, [qId]: val }));
    if (immediateSave) {
      void persistAnswerToServer(qId, val, Boolean(doubtfulMap[qId]));
    }
  };

  const toggleDoubtful = (qId: string) => {
    const nextVal = !doubtfulMap[qId];
    setDoubtfulMap((prev) => ({ ...prev, [qId]: nextVal }));
    void persistAnswerToServer(qId, answersMap[qId] ?? null, nextVal);
  };

  const switchQuestion = (nextIdx: number) => {
    if (
      currentQuestion &&
      (answersMap[currentQuestion.question_id] !== undefined ||
        Boolean(doubtfulMap[currentQuestion.question_id]))
    ) {
      // Ensure modified answer or doubtful flag is synced when switching
      void persistAnswerToServer(
        currentQuestion.question_id,
        answersMap[currentQuestion.question_id] ?? null,
        Boolean(doubtfulMap[currentQuestion.question_id]),
      );
    }
    setCurrentIndex(nextIdx);
    setMobileNavOpen(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3 max-w-md w-full">
          <AppLogo src={config.logo_url} sizeClass="w-12 h-12 mx-auto" />
          <p className="text-sm font-medium text-slate-700">Menyiapkan ruang ujian CBT KIR IPA...</p>
        </div>
      </div>
    );
  }

  if (sessionConflictPrompt) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-amber-300 rounded-2xl p-6 max-w-md w-full space-y-4">
          <div className="flex items-center gap-3 text-amber-700">
            <ShieldAlert className="w-6 h-6 shrink-0" />
            <h2 className="text-lg font-bold">Sesi Ujian Ganda Terdeteksi</h2>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Akun Anda tercatat sedang aktif mengerjakan ujian ini pada sesi atau perangkat lain. Jika Anda mengalami gangguan koneksi atau berpindah perangkat, klik tombol pemulihan di bawah.
          </p>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onExitToDashboard}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 cursor-pointer"
            >
              Kembali
            </button>
            <button
              type="button"
              onClick={() => startOrResumeExam(true)}
              className="px-4 py-2 rounded-lg bg-[#0F294A] text-white text-sm font-semibold cursor-pointer"
            >
              Pulihkan Sesi di Sini
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (submittedNotice) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md w-full text-center space-y-4">
          <AppLogo src={config.logo_url} sizeClass="w-14 h-14 mx-auto" />
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <h2 className="text-xl font-bold text-[#0F294A]">Ujian Telah Dikumpulkan</h2>
          <p className="text-sm text-slate-600">
            Seluruh jawaban Anda telah tersimpan dan dikunci oleh server. Nilai dapat dilihat pada dashboard apabila sudah dipublikasikan oleh pembina.
          </p>
          <button
            type="button"
            onClick={onExitToDashboard}
            className="w-full py-2.5 px-4 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white text-sm font-semibold cursor-pointer"
          >
            Kembali ke Dashboard Siswa
          </button>
        </div>
      </div>
    );
  }

  if (error || !examMeta || !currentQuestion) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-red-200 rounded-xl p-6 max-w-md w-full space-y-4 text-center">
          <p className="text-sm text-red-700">{error || 'Tidak ada soal dalam ujian ini.'}</p>
          <button
            type="button"
            onClick={onExitToDashboard}
            className="px-4 py-2 rounded-lg bg-[#0F294A] text-white text-sm font-semibold cursor-pointer"
          >
            Kembali ke Dashboard
          </button>
        </div>
      </div>
    );
  }

  const answeredCount = questions.filter((q) =>
    isAnswerProvided(q.question_type, answersMap[q.question_id]),
  ).length;
  const doubtfulCount = questions.filter((q) => doubtfulMap[q.question_id]).length;
  const unansweredCount = questions.length - answeredCount;
  const currentAns = answersMap[currentQuestion.question_id];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* OSN-Style Focused Top Header */}
      <header className="bg-[#0F294A] text-white border-b border-slate-800 px-4 sm:px-6 py-3 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo src={config.logo_url} sizeClass="w-10 h-10" />
            <div className="min-w-0">
              <div className="text-sm font-bold truncate">{examMeta.title}</div>
              <div className="text-xs text-amber-300 truncate">
                {user.nama} · {user.kelas || user.username}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Save status */}
            <div
              data-testid="autosave-status"
              className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-white/10 text-slate-200"
            >
              {saveState === 'RETRYING' ? (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-300" />
                  <span>Menunggu koneksi (retry)...</span>
                </>
              ) : saveState === 'SAVING' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-300" />
                  <span>Menyimpan...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    Tersimpan{lastSavedAt ? ` (${new Date(lastSavedAt).toLocaleTimeString('id-ID')})` : ''}
                  </span>
                </>
              )}
            </div>

            {/* Server-Authoritative Timer */}
            <div
              data-testid="exam-timer"
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-mono text-sm font-bold tabular-nums ${
                remainingSeconds <= 300
                  ? 'bg-red-600 text-white'
                  : 'bg-white text-[#0F294A]'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>{formatCountdown(remainingSeconds)}</span>
            </div>

            <button
              type="button"
              aria-label="Mode layar penuh"
              onClick={toggleFullscreen}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Anti-Cheat Warning Strip */}
      {antiCheatBanner && (
        <div className="bg-amber-50 border-b border-amber-300 px-4 py-2.5 text-xs text-amber-900">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                {antiCheatBanner} (Tercatat: {violationsCount} kejadian)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAntiCheatBanner('')}
              className="font-semibold underline shrink-0 cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* Mobile Quick Navigator Strip (<lg only) */}
      <div className="lg:hidden bg-white border-b border-slate-200 px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-600 font-medium truncate">
            <span className="font-mono font-bold text-[#0F294A]">
              {answeredCount}/{questions.length}
            </span>{' '}
            terjawab ·{' '}
            <span className="font-mono font-semibold text-amber-700">{doubtfulCount} ragu</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileNavOpen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-xs font-semibold text-[#0F294A] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            {mobileNavOpen ? 'Tutup Nomor' : 'Daftar Nomor'}
          </button>
        </div>

        {mobileNavOpen && (
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
            <div className="grid grid-cols-7 gap-1.5">
              {questions.map((q, idx) => {
                const isCurrent = idx === currentIndex;
                const isDoubt = Boolean(doubtfulMap[q.question_id]);
                const isAns = isAnswerProvided(q.question_type, answersMap[q.question_id]);

                let btnStyle = 'bg-slate-100 text-slate-700 border-slate-300';
                if (isCurrent) {
                  btnStyle = 'bg-blue-700 text-white border-blue-800';
                } else if (isDoubt) {
                  btnStyle = 'bg-amber-400 text-slate-900 border-amber-500';
                } else if (isAns) {
                  btnStyle = 'bg-emerald-600 text-white border-emerald-700';
                }

                return (
                  <button
                    key={q.question_id}
                    type="button"
                    onClick={() => switchQuestion(idx)}
                    className={`h-9 rounded-lg border font-mono text-xs font-bold cursor-pointer ${btnStyle}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                setConfirmSubmitOpen(true);
              }}
              className="w-full py-2 px-3 rounded-lg bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              Kumpulkan Ujian
            </button>
          </div>
        )}
      </div>

      {/* Main Two-Column OSN Exam Workspace */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left/Main Question & Answer Area */}
        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 sm:p-7 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2.5 pb-4 border-b border-slate-200">
            <div className="min-w-0">
              <span className="text-xs font-medium text-slate-500 block truncate">
                {currentQuestion.category} · {currentQuestion.question_type} · Bobot{' '}
                <span className="font-mono font-semibold">{currentQuestion.score}</span>
              </span>
              <h2 className="text-base sm:text-lg font-bold text-[#0F294A] mt-0.5 whitespace-nowrap">
                Soal {currentIndex + 1} dari {questions.length}
              </h2>
            </div>

            <button
              type="button"
              onClick={() => toggleDoubtful(currentQuestion.question_id)}
              className={`inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                doubtfulMap[currentQuestion.question_id]
                  ? 'bg-amber-400 border-amber-500 text-slate-900'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-amber-50'
              }`}
            >
              <Flag className="w-3.5 h-3.5 shrink-0" />
              {doubtfulMap[currentQuestion.question_id] ? 'Ditandai Ragu-Ragu' : 'Tandai Ragu-Ragu'}
            </button>
          </div>

          {/* Question Content */}
          <div className="space-y-4">
            <RichMathRenderer content={currentQuestion.question_text} className="text-base" />
            {currentQuestion.image_url && (
              <img
                src={currentQuestion.image_url}
                alt="Gambar ilustrasi soal"
                referrerPolicy="no-referrer"
                className="max-h-72 rounded-lg border border-slate-200"
              />
            )}
          </div>

          {/* Answer Area for All 7 Types */}
          <div className="pt-2 space-y-3">
            {currentQuestion.question_type === 'PG' &&
              (currentQuestion.options.choices || []).map((choice) => {
                const selected = String(currentAns ?? '') === choice.label;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => updateAnswer(currentQuestion.question_id, choice.label)}
                    className={`w-full text-left p-3.5 rounded-xl border flex items-start gap-3 transition-colors cursor-pointer ${
                      selected
                        ? 'border-blue-700 bg-blue-50/70 text-[#0F294A]'
                        : 'border-slate-200 hover:border-slate-400 bg-white'
                    }`}
                  >
                    <span
                      className={`w-7 h-7 rounded-lg font-mono text-xs font-bold flex items-center justify-center shrink-0 border ${
                        selected
                          ? 'bg-blue-700 text-white border-blue-700'
                          : 'bg-slate-50 text-slate-700 border-slate-300'
                      }`}
                    >
                      {choice.label}
                    </span>
                    <RichMathRenderer content={choice.text} className="text-sm flex-1 pt-0.5" />
                  </button>
                );
              })}

            {currentQuestion.question_type === 'PGK' &&
              (currentQuestion.options.choices || []).map((choice) => {
                const arr = Array.isArray(currentAns) ? (currentAns as string[]) : [];
                const checked = arr.includes(choice.label);
                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => {
                      const next = checked
                        ? arr.filter((x) => x !== choice.label)
                        : [...arr, choice.label];
                      updateAnswer(currentQuestion.question_id, next);
                    }}
                    className={`w-full text-left p-3.5 rounded-xl border flex items-start gap-3 transition-colors cursor-pointer ${
                      checked
                        ? 'border-blue-700 bg-blue-50/70'
                        : 'border-slate-200 hover:border-slate-400 bg-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={checked}
                      className="mt-1 shrink-0"
                    />
                    <span className="font-mono text-xs font-bold text-slate-600 pt-0.5">
                      {choice.label}.
                    </span>
                    <RichMathRenderer content={choice.text} className="text-sm flex-1" />
                  </button>
                );
              })}

            {currentQuestion.question_type === 'BENAR_SALAH' && (
              <div className="grid grid-cols-2 gap-3">
                {(['BENAR', 'SALAH'] as const).map((opt) => {
                  const selected = currentAns === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => updateAnswer(currentQuestion.question_id, opt)}
                      className={`p-4 rounded-xl border font-semibold text-sm transition-colors cursor-pointer ${
                        selected
                          ? 'border-blue-700 bg-blue-50 text-blue-900'
                          : 'border-slate-200 hover:border-slate-400 text-slate-700'
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}

            {currentQuestion.question_type === 'ISIAN_SINGKAT' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Jawaban Singkat Anda
                </label>
                <input
                  type="text"
                  value={typeof currentAns === 'string' ? currentAns : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateAnswer(currentQuestion.question_id, val, false);
                  }}
                  onBlur={(e) =>
                    void persistAnswerToServer(
                      currentQuestion.question_id,
                      e.target.value,
                      Boolean(doubtfulMap[currentQuestion.question_id]),
                    )
                  }
                  placeholder="Ketik jawaban singkat Anda..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none"
                />
              </div>
            )}

            {currentQuestion.question_type === 'MENJODOHKAN' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  Pilih pasangan yang sesuai di sebelah kanan untuk setiap pernyataan di kiri:
                </p>
                {(currentQuestion.options.matching_pairs || []).map((pair) => {
                  const currentMap =
                    currentAns && typeof currentAns === 'object' && !Array.isArray(currentAns)
                      ? (currentAns as Record<string, string>)
                      : {};
                  const rightPool = (currentQuestion.options.matching_pairs || []).map((p) => p.right);
                  return (
                    <div
                      key={pair.id}
                      className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center p-3 rounded-xl border border-slate-200 bg-slate-50"
                    >
                      <RichMathRenderer content={pair.left} className="text-sm font-medium" />
                      <select
                        aria-label={`Pasangan untuk ${pair.left}`}
                        value={currentMap[pair.id] || ''}
                        onChange={(e) => {
                          const nextMap = { ...currentMap, [pair.id]: e.target.value };
                          updateAnswer(currentQuestion.question_id, nextMap);
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                      >
                        <option value="">-- Pilih Pasangan --</option>
                        {rightPool.map((optText, i) => (
                          <option key={i} value={optText}>
                            {optText.replace(/\$/g, '')}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}

            {currentQuestion.question_type === 'MENGURUTKAN' && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">
                    Gunakan tombol panah untuk menyusun langkah dari urutan pertama hingga terakhir:
                  </p>
                  {Array.isArray(currentAns) ? (
                    <span className="text-xs font-medium text-emerald-700">
                      Urutan tersimpan sebagai jawaban
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        updateAnswer(
                          currentQuestion.question_id,
                          (currentQuestion.options.ordering_items || []).map((i) => i.id),
                        )
                      }
                      className="px-3 py-1 rounded-lg border border-blue-700 text-xs font-semibold text-blue-700 hover:bg-blue-50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Konfirmasi Urutan Saat Ini
                    </button>
                  )}
                </div>
                {(() => {
                  const items = currentQuestion.options.ordering_items || [];
                  const orderIds = Array.isArray(currentAns)
                    ? (currentAns as string[])
                    : items.map((i) => i.id);
                  const orderedItems = orderIds
                    .map((id) => items.find((i) => i.id === id))
                    .filter(Boolean) as Array<{ id: string; text: string }>;

                  const moveOrder = (idx: number, dir: -1 | 1) => {
                    const target = idx + dir;
                    if (target < 0 || target >= orderIds.length) return;
                    const next = [...orderIds];
                    const tmp = next[idx];
                    next[idx] = next[target];
                    next[target] = tmp;
                    updateAnswer(currentQuestion.question_id, next);
                  };

                  return orderedItems.map((item, idx) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl border border-slate-200 bg-white flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 text-sm">
                        <span className="w-6 h-6 rounded bg-[#0F294A] text-white font-mono text-xs font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <RichMathRenderer content={item.text} className="text-sm" />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          aria-label="Naikkan urutan"
                          disabled={idx === 0}
                          onClick={() => moveOrder(idx, -1)}
                          className="p-1.5 rounded border border-slate-300 disabled:opacity-30 hover:bg-slate-50 cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Turunkan urutan"
                          disabled={idx === orderedItems.length - 1}
                          onClick={() => moveOrder(idx, 1)}
                          className="p-1.5 rounded border border-slate-300 disabled:opacity-30 hover:bg-slate-50 cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}

            {currentQuestion.question_type === 'ESAI' && (
              <div className="space-y-1.5">
                <textarea
                  rows={7}
                  maxLength={currentQuestion.options.essay_max_chars || 2000}
                  value={typeof currentAns === 'string' ? currentAns : ''}
                  onChange={(e) => updateAnswer(currentQuestion.question_id, e.target.value, false)}
                  onBlur={(e) =>
                    void persistAnswerToServer(
                      currentQuestion.question_id,
                      e.target.value,
                      Boolean(doubtfulMap[currentQuestion.question_id]),
                    )
                  }
                  placeholder="Tuliskan jawaban uraian ilmiah Anda secara jelas dan sistematis..."
                  className="w-full p-4 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none"
                />
                <div className="text-right text-xs font-mono text-slate-500">
                  {typeof currentAns === 'string' ? currentAns.length : 0} /{' '}
                  {currentQuestion.options.essay_max_chars || 2000} karakter
                </div>
              </div>
            )}
          </div>

          {/* Bottom Prev / Next / Finish Controls */}
          <div className="pt-5 border-t border-slate-200 flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={currentIndex === 0}
              onClick={() => switchQuestion(currentIndex - 1)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 disabled:opacity-40 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" />
              Sebelumnya
            </button>

            <div className="flex items-center gap-2 shrink-0">
              {currentIndex < questions.length - 1 ? (
                <button
                  type="button"
                  onClick={() => switchQuestion(currentIndex + 1)}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Selanjutnya
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmSubmitOpen(true)}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Send className="w-4 h-4 shrink-0" />
                  Selesai Ujian
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Right Question Navigator Panel */}
        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-5 lg:sticky lg:top-20">
          <div>
            <h3 className="text-sm font-bold text-[#0F294A]">Navigasi Nomor Soal</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Klik nomor untuk berpindah soal. Status tersimpan di server.
            </p>
          </div>

          <div
            data-testid="question-navigator"
            className="grid grid-cols-5 gap-2"
          >
            {questions.map((q, idx) => {
              const isCurrent = idx === currentIndex;
              const isDoubt = Boolean(doubtfulMap[q.question_id]);
              const isAns = isAnswerProvided(q.question_type, answersMap[q.question_id]);

              // Color indicators: Blue (current), Yellow (doubtful), Green (answered), Gray (unanswered)
              let btnStyle = 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200';
              if (isCurrent) {
                btnStyle = 'bg-blue-700 text-white border-blue-800 ring-2 ring-blue-200';
              } else if (isDoubt) {
                btnStyle = 'bg-amber-400 text-slate-900 border-amber-500';
              } else if (isAns) {
                btnStyle = 'bg-emerald-600 text-white border-emerald-700';
              }

              return (
                <button
                  key={q.question_id}
                  type="button"
                  aria-label={`Soal ${idx + 1}${isDoubt ? ' ragu-ragu' : ''}${isAns ? ' terjawab' : ' belum dijawab'}`}
                  onClick={() => switchQuestion(idx)}
                  className={`relative h-11 rounded-lg border font-mono text-sm font-bold transition-colors cursor-pointer ${btnStyle}`}
                >
                  {idx + 1}
                  {/* Consistent sub-indicator when both answered & doubtful or current+doubtful */}
                  {isDoubt && isAns && (
                    <span
                      title="Sudah dijawab & ditandai ragu-ragu"
                      className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-700"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-200 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-blue-700 inline-block shrink-0" />
              <span>Sedang dibuka</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-emerald-600 inline-block shrink-0" />
              <span>Dijawab ({answeredCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-amber-400 inline-block shrink-0" />
              <span>Ragu-ragu ({doubtfulCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-slate-200 border border-slate-300 inline-block shrink-0" />
              <span>Belum ({unansweredCount})</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setConfirmSubmitOpen(true)}
            className="w-full py-2.5 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            Kumpulkan Ujian
          </button>
        </aside>
      </div>

      {/* Confirmation Modal Before Final Submission */}
      {confirmSubmitOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-[#0F294A]">Konfirmasi Pengumpulan Ujian</h3>
            <p className="text-sm text-slate-600">
              Setelah dikumpulkan, seluruh jawaban Anda akan dikunci dan tidak dapat diubah kembali.
            </p>
            <div className="grid grid-cols-3 gap-2 text-center bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
              <div>
                <div className="text-slate-500">Dijawab</div>
                <div className="text-lg font-bold font-mono text-emerald-700">{answeredCount}</div>
              </div>
              <div>
                <div className="text-slate-500">Ragu-Ragu</div>
                <div className="text-lg font-bold font-mono text-amber-600">{doubtfulCount}</div>
              </div>
              <div>
                <div className="text-slate-500">Kosong</div>
                <div className="text-lg font-bold font-mono text-slate-700">{unansweredCount}</div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmSubmitOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 cursor-pointer"
              >
                Periksa Lagi
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => executeFinalSubmit(false)}
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold cursor-pointer"
              >
                {submitting ? 'Mengumpulkan...' : 'Ya, Kumpulkan Sekarang'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

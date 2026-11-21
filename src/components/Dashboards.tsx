import {
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  FileCheck2,
  Play,
  Users,
} from 'lucide-react';
import { AppLogo } from './AppLogo';
import { formatAuditDetails } from '../shared/grading';
import type { AppSettingsMap, UserRecord } from '../shared/types';

export interface AdminStatsData {
  total_users: number;
  total_students: number;
  total_professors: number;
  total_exams: number;
  total_questions: number;
  active_exams: number;
  completed_exams: number;
  total_attempts: number;
}

export interface ProfessorStatsData {
  total_questions: number;
  total_exams: number;
  active_exams: number;
  scheduled_exams: number;
  completed_exams: number;
  total_participants: number;
  done_participants: number;
  pending_participants: number;
  pending_essays: number;
}

export interface StudentExamRow {
  exam_id: string;
  title: string;
  description: string;
  subject: string;
  start_time: string;
  end_time: string;
  duration: number;
  status: string;
  total_questions: number;
  participant_status: string;
  started_at: string;
  submitted_at: string;
  published: number;
  published_score: number | null;
  correct_count: number | null;
  incorrect_count: number | null;
  unanswered_count: number | null;
}

function StatTile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-2xl font-bold text-[#0F294A] mt-1 font-mono tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

export function AdminDashboardView({
  stats,
  recentAudit,
  onNavigate,
}: {
  stats: AdminStatsData | null;
  recentAudit: Array<{ log_id: string; nama?: string; activity: string; timestamp: string; details: string }>;
  onNavigate: (nav: string) => void;
}) {
  if (!stats) {
    return <div className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">Memuat statistik sistem...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatTile label="Total Pengguna" value={stats.total_users} />
        <StatTile label="Total Siswa" value={stats.total_students} />
        <StatTile label="Total Professor" value={stats.total_professors} />
        <StatTile label="Bank Soal" value={stats.total_questions} />
        <StatTile label="Total Ujian" value={stats.total_exams} />
        <StatTile label="Ujian Aktif" value={stats.active_exams} />
        <StatTile label="Ujian Selesai" value={stats.completed_exams} />
        <StatTile label="Total Pengerjaan" value={stats.total_attempts} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-[#0F294A]">Aktivitas Audit Terbaru</h2>
            <button
              type="button"
              onClick={() => onNavigate('audit')}
              className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              Lihat Semua <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {recentAudit.length === 0 ? (
              <p className="text-sm text-slate-500 py-4">Belum ada aktivitas tercatat.</p>
            ) : (
              recentAudit.map((a) => (
                <div key={a.log_id} className="py-2.5 flex items-start justify-between gap-4 text-xs">
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-900">{a.nama || 'Sistem'}</span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="font-mono text-blue-700">{a.activity}</span>
                    <p className="text-slate-500 truncate mt-0.5">{formatAuditDetails(a.details)}</p>
                  </div>
                  <span className="text-slate-400 font-mono shrink-0">
                    {new Date(a.timestamp).toLocaleTimeString('id-ID')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-base font-bold text-[#0F294A]">Aksi Cepat Administrator</h2>
          <div className="grid grid-cols-1 gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('create_question')}
              className="p-3 rounded-lg border border-slate-200 hover:border-blue-600 hover:bg-blue-50/40 text-left flex items-center justify-between transition-colors cursor-pointer"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">Input & Buat Soal Baru</div>
                <div className="text-xs text-slate-500">Tambah soal semua tipe ke Bank Soal</div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('students')}
              className="p-3 rounded-lg border border-slate-200 hover:border-blue-600 hover:bg-blue-50/40 text-left flex items-center justify-between transition-colors cursor-pointer"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">Kelola Akun Peserta</div>
                <div className="text-xs text-slate-500">Buat, ubah username/password, atau impor peserta</div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('exams')}
              className="p-3 rounded-lg border border-slate-200 hover:border-blue-600 hover:bg-blue-50/40 text-left flex items-center justify-between transition-colors cursor-pointer"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">Kelola Ujian, Jadwal & Waktu</div>
                <div className="text-xs text-slate-500">Atur soal, durasi, jadwal, atau hentikan ujian darurat</div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('backup')}
              className="p-3 rounded-lg border border-slate-200 hover:border-blue-600 hover:bg-blue-50/40 text-left flex items-center justify-between transition-colors cursor-pointer"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">Backup & Pemulihan Database</div>
                <div className="text-xs text-slate-500">Buat snapshot keamanan data ujian</div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('gas_export')}
              className="p-3 rounded-lg border border-slate-200 hover:border-blue-600 hover:bg-blue-50/40 text-left flex items-center justify-between transition-colors cursor-pointer"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">Paket Google Apps Script</div>
                <div className="text-xs text-slate-500">Salin modul .gs/.html dan panduan deploy Spreadsheet</div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProfessorDashboardView({
  stats,
  onNavigate,
}: {
  stats: ProfessorStatsData | null;
  onNavigate: (nav: string) => void;
}) {
  if (!stats) {
    return <div className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500">Memuat ringkasan pembina...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatTile label="Soal Dibuat" value={stats.total_questions} />
        <StatTile label="Total Ujian" value={stats.total_exams} />
        <StatTile label="Ujian Aktif" value={stats.active_exams} />
        <StatTile label="Ujian Mendatang" value={stats.scheduled_exams} />
        <StatTile label="Ujian Selesai" value={stats.completed_exams} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatTile label="Total Peserta" value={stats.total_participants} />
        <StatTile label="Sudah Mengerjakan" value={stats.done_participants} />
        <StatTile label="Belum Selesai" value={stats.pending_participants} />
        <StatTile
          label="Esai Belum Dinilai"
          value={stats.pending_essays}
          sub={stats.pending_essays > 0 ? 'Perlu pemeriksaan manual' : 'Semua sudah dinilai'}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('create_question')}
          className="p-4 bg-white border border-slate-200 rounded-xl hover:border-blue-600 text-left transition-colors cursor-pointer"
        >
          <BookOpen className="w-5 h-5 text-blue-700 mb-2" />
          <div className="font-semibold text-sm text-[#0F294A]">Tambah Soal ke Bank Soal</div>
          <p className="text-xs text-slate-500 mt-1">Editor rumus KaTeX, kimia, dan 7 tipe soal.</p>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('monitoring')}
          className="p-4 bg-white border border-slate-200 rounded-xl hover:border-blue-600 text-left transition-colors cursor-pointer"
        >
          <Users className="w-5 h-5 text-blue-700 mb-2" />
          <div className="font-semibold text-sm text-[#0F294A]">Monitoring Ujian Real-Time</div>
          <p className="text-xs text-slate-500 mt-1">Pantau sisa waktu dan catatan pelanggaran peserta.</p>
        </button>
        <button
          type="button"
          onClick={() => onNavigate('essay_grading')}
          className="p-4 bg-white border border-slate-200 rounded-xl hover:border-blue-600 text-left transition-colors cursor-pointer"
        >
          <FileCheck2 className="w-5 h-5 text-amber-600 mb-2" />
          <div className="font-semibold text-sm text-[#0F294A]">
            Periksa Jawaban Esai ({stats.pending_essays})
          </div>
          <p className="text-xs text-slate-500 mt-1">Nilai uraian peserta dengan rubrik terstruktur.</p>
        </button>
      </div>
    </div>
  );
}

export function StudentDashboardView({
  user,
  config,
  exams,
  onStartExam,
  onViewResult,
}: {
  user: UserRecord;
  config: Partial<AppSettingsMap>;
  exams: StudentExamRow[];
  onStartExam: (examId: string) => void;
  onViewResult: (examId: string) => void;
}) {
  const initials = user.nama
    .split(' ')
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();

  return (
    <div className="space-y-6">
      {/* Identity & Announcement Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <AppLogo src={config.logo_url} sizeClass="w-12 h-12" />
          <div className="w-11 h-11 rounded-full bg-[#0F294A] text-amber-300 font-bold flex items-center justify-center text-sm shrink-0">
            {initials}
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#0F294A]">{user.nama}</h2>
            <p className="text-xs text-slate-600 font-mono">
              {user.username} · Kelas {user.kelas || 'KIR IPA'}
            </p>
          </div>
        </div>
        {config.announcement && (
          <div className="md:max-w-md text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
            <span className="font-semibold text-[#0F294A]">Pengumuman: </span>
            {config.announcement}
          </div>
        )}
      </div>

      {/* Exam List */}
      <div className="space-y-3">
        <h3 className="text-base font-bold text-[#0F294A]">Daftar Ujian & Riwayat Pengerjaan</h3>
        {exams.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            Belum ada jadwal ujian yang ditugaskan untuk akun Anda.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {exams.map((ex) => {
              const isFinished =
                ex.participant_status === 'TERKUMPUL' || ex.participant_status === 'DIHENTIKAN';
              const isInProgress = ex.participant_status === 'MENGERJAKAN';
              const canStart = ex.status === 'ACTIVE' && !isFinished;
              const isPublished = ex.published === 1;

              return (
                <div
                  key={ex.exam_id}
                  className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1.5">
                      <span>{ex.subject} · {ex.total_questions} Soal · {ex.duration} Menit</span>
                      <span
                        className={`font-semibold ${
                          isFinished
                            ? 'text-emerald-700'
                            : isInProgress
                              ? 'text-blue-700'
                              : ex.status === 'ACTIVE'
                                ? 'text-amber-700'
                                : 'text-slate-500'
                        }`}
                      >
                        {isFinished
                          ? 'Selesai'
                          : isInProgress
                            ? 'Sedang Berlangsung'
                            : ex.status === 'ACTIVE'
                              ? 'Tersedia'
                              : ex.status}
                      </span>
                    </div>
                    <h4 className="text-base font-bold text-[#0F294A]">{ex.title}</h4>
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">{ex.description}</p>
                    <div className="mt-3 text-xs text-slate-500 flex items-center gap-1.5 font-mono">
                      <Clock className="w-3.5 h-3.5" />
                      <span>
                        {new Date(ex.start_time).toLocaleDateString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}{' '}
                        s/d{' '}
                        {new Date(ex.end_time).toLocaleDateString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    {canStart ? (
                      <button
                        type="button"
                        onClick={() => onStartExam(ex.exam_id)}
                        className="w-full py-2.5 px-4 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <Play className="w-4 h-4" />
                        {isInProgress ? 'Lanjutkan Ujian' : 'Mulai Ujian'}
                      </button>
                    ) : isFinished ? (
                      isPublished ? (
                        <div className="w-full flex items-center justify-between gap-3">
                          <div className="text-xs">
                            <span className="text-slate-500">Nilai Akhir: </span>
                            <span className="font-mono font-bold text-base text-[#0F294A]">
                              {ex.published_score}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => onViewResult(ex.exam_id)}
                            className="px-3.5 py-2 rounded-lg border border-blue-600 text-blue-700 hover:bg-blue-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Award className="w-3.5 h-3.5" />
                            Lihat Detail Hasil
                          </button>
                        </div>
                      ) : (
                        <div className="w-full flex items-center gap-2 text-xs text-slate-600">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>Jawaban terkumpul. Menunggu publikasi nilai oleh pembina.</span>
                        </div>
                      )
                    ) : (
                      <div className="text-xs text-slate-500">
                        Jadwal ujian belum dimulai.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

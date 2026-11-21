import { useCallback, useEffect, useState } from 'react';
import { AppShell } from './components/AppShell';
import { AppsScriptExportView } from './components/AppsScriptExportView';
import {
  AdminDashboardView,
  ProfessorDashboardView,
  StudentDashboardView,
  type AdminStatsData,
  type ProfessorStatsData,
  type StudentExamRow,
} from './components/Dashboards';
import { ExamManagerView } from './components/ExamManagerView';
import { ExamRunnerView } from './components/ExamRunnerView';
import { LoginView } from './components/LoginView';
import { EssayGradingView, MonitoringView } from './components/MonitoringAndGradingView';
import { QuestionBankView } from './components/QuestionBankView';
import {
  ItemAnalysisView,
  LeaderboardView,
  ReportsAndBeritaAcaraView,
  ResultsManagementView,
  StudentResultDetailModal,
} from './components/ResultsLeaderboardAnalyticsReports';
import {
  AuditLogView,
  BackupRestoreView,
  ProfilePasswordView,
  SettingsView,
} from './components/SystemAdminViews';
import { UserManagementView } from './components/UserManagementView';
import { apiFetch, setMemoryToken } from './utils/api';
import type { AppSettingsMap, NotificationRecord, UserRecord } from './shared/types';

export default function App() {
  const [config, setConfig] = useState<Partial<AppSettingsMap>>({});
  const [user, setUser] = useState<UserRecord | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [activeNav, setActiveNav] = useState('dashboard');
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  // Active CBT Runner examId (persisted in URL search param so page refresh resumes exam!)
  const [activeExamId, setActiveExamId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('exam');
  });
  const [viewingStudentResultExamId, setViewingStudentResultExamId] = useState<string | null>(null);

  // Dashboard data states
  const [adminStats, setAdminStats] = useState<AdminStatsData | null>(null);
  const [recentAudit, setRecentAudit] = useState<
    Array<{ log_id: string; nama?: string; activity: string; timestamp: string; details: string }>
  >([]);
  const [profStats, setProfStats] = useState<ProfessorStatsData | null>(null);
  const [studentExams, setStudentExams] = useState<StudentExamRow[]>([]);

  const loadPublicConfig = useCallback(async () => {
    try {
      const cfg = await apiFetch<Partial<AppSettingsMap>>('/public/config');
      setConfig(cfg);
    } catch {
      // Fallback to default visual config
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await apiFetch<{ notifications: NotificationRecord[] }>('/notifications');
      setNotifications(res.notifications);
    } catch {
      // Ignore if unauthenticated
    }
  }, []);

  const loadDashboardData = useCallback(async () => {
    try {
      const res = await apiFetch<Record<string, unknown>>('/dashboard/stats');
      if (res.role === 'SUPER_ADMIN') {
        setAdminStats(res.stats as AdminStatsData);
        setRecentAudit(
          (res.recent_audit as Array<{
            log_id: string;
            nama?: string;
            activity: string;
            timestamp: string;
            details: string;
          }>) || [],
        );
      } else if (res.role === 'PROFESSOR') {
        setProfStats(res.stats as ProfessorStatsData);
      } else if (res.role === 'SISWA') {
        setStudentExams((res.exams as StudentExamRow[]) || []);
      }
    } catch {
      // Ignore transient load error
    }
  }, []);

  // Bootstrap config + restore active HttpOnly session on reload
  useEffect(() => {
    const boot = async () => {
      await loadPublicConfig();
      try {
        const sess = await apiFetch<{ authenticated: boolean; user: UserRecord | null }>(
          '/auth/session',
        );
        setUser(sess.authenticated && sess.user ? sess.user : null);
      } catch {
        setUser(null);
      } finally {
        setInitializing(false);
      }
    };
    void boot();
  }, [loadPublicConfig]);

  useEffect(() => {
    if (!user) return;
    void loadDashboardData();
    void loadNotifications();
  }, [user, activeNav, loadDashboardData, loadNotifications]);

  const handleLoginSuccess = (payload: {
    token: string;
    session_id: string;
    user: UserRecord;
  }) => {
    setMemoryToken(payload.token);
    setUser(payload.user);
    setActiveNav('dashboard');
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
    setMemoryToken(null);
    setUser(null);
    setActiveExamId(null);
    window.history.replaceState(null, '', window.location.pathname);
  };

  const enterExamRunner = (examId: string) => {
    setActiveExamId(examId);
    const url = new URL(window.location.href);
    url.searchParams.set('exam', examId);
    window.history.replaceState(null, '', url.toString());
  };

  const exitExamRunner = () => {
    setActiveExamId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('exam');
    window.history.replaceState(null, '', url.toString());
    void loadDashboardData();
  };

  const markNotificationsRead = async () => {
    await apiFetch('/notifications/read', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
  };

  if (initializing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-sm text-slate-600">
        Memuat Portal CBT KIR IPA SMAN 1 Sukabumi...
      </div>
    );
  }

  if (!user) {
    return <LoginView config={config} onLoginSuccess={handleLoginSuccess} />;
  }

  // Focused OSN-style CBT Exam Runner for Siswa
  if (user.role === 'SISWA' && activeExamId) {
    return (
      <ExamRunnerView
        examId={activeExamId}
        user={user}
        config={config}
        onExitToDashboard={exitExamRunner}
      />
    );
  }

  const renderMainContent = () => {
    if (user.role === 'SUPER_ADMIN') {
      switch (activeNav) {
        case 'dashboard':
          return (
            <AdminDashboardView
              stats={adminStats}
              recentAudit={recentAudit}
              onNavigate={setActiveNav}
            />
          );
        case 'users':
          return <UserManagementView currentUser={user} />;
        case 'professors':
          return <UserManagementView currentUser={user} lockedRoleFilter="PROFESSOR" />;
        case 'students':
          return <UserManagementView currentUser={user} lockedRoleFilter="SISWA" />;
        case 'questions':
          return <QuestionBankView />;
        case 'create_question':
          return <QuestionBankView openCreatorImmediately />;
        case 'exams':
          return <ExamManagerView currentUser={user} />;
        case 'create_exam':
          return <ExamManagerView currentUser={user} openBuilderImmediately />;
        case 'monitoring':
          return <MonitoringView />;
        case 'essay_grading':
          return <EssayGradingView />;
        case 'results':
          return <ResultsManagementView config={config} currentUser={user} />;
        case 'leaderboard':
          return <LeaderboardView />;
        case 'analytics':
          return <ItemAnalysisView />;
        case 'reports':
          return <ReportsAndBeritaAcaraView config={config} currentUser={user} />;
        case 'audit':
          return <AuditLogView />;
        case 'backup':
          return <BackupRestoreView />;
        case 'settings_app':
          return <SettingsView mode="APP" onConfigUpdated={loadPublicConfig} />;
        case 'settings_security':
          return <SettingsView mode="SECURITY" onConfigUpdated={loadPublicConfig} />;
        case 'gas_export':
          return <AppsScriptExportView />;
        default:
          return null;
      }
    }

    if (user.role === 'PROFESSOR') {
      switch (activeNav) {
        case 'dashboard':
          return <ProfessorDashboardView stats={profStats} onNavigate={setActiveNav} />;
        case 'questions':
          return <QuestionBankView />;
        case 'create_question':
          return <QuestionBankView openCreatorImmediately />;
        case 'create_exam':
          return <ExamManagerView currentUser={user} openBuilderImmediately />;
        case 'exams':
          return <ExamManagerView currentUser={user} />;
        case 'students':
          return <UserManagementView currentUser={user} lockedRoleFilter="SISWA" />;
        case 'monitoring':
          return <MonitoringView />;
        case 'essay_grading':
          return <EssayGradingView />;
        case 'results':
          return <ResultsManagementView config={config} currentUser={user} />;
        case 'analytics':
          return <ItemAnalysisView />;
        case 'leaderboard':
          return <LeaderboardView />;
        case 'reports':
          return <ReportsAndBeritaAcaraView config={config} currentUser={user} />;
        default:
          return null;
      }
    }

    // SISWA
    switch (activeNav) {
      case 'dashboard':
        return (
          <StudentDashboardView
            user={user}
            config={config}
            exams={studentExams}
            onStartExam={enterExamRunner}
            onViewResult={(examId) => setViewingStudentResultExamId(examId)}
          />
        );
      case 'leaderboard':
        return <LeaderboardView />;
      case 'profile':
        return <ProfilePasswordView />;
      default:
        return null;
    }
  };

  return (
    <AppShell
      user={user}
      config={config}
      activeNav={activeNav}
      onSelectNav={setActiveNav}
      onLogout={handleLogout}
      notifications={notifications}
      onMarkNotificationsRead={markNotificationsRead}
    >
      {renderMainContent()}
      {viewingStudentResultExamId && (
        <StudentResultDetailModal
          examId={viewingStudentResultExamId}
          config={config}
          onClose={() => setViewingStudentResultExamId(null)}
        />
      )}
    </AppShell>
  );
}

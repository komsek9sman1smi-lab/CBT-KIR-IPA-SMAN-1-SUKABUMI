import { useCallback, useEffect, useRef, useState } from 'react';
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
  ServerMonitoringView,
  SettingsView,
} from './components/SystemAdminViews';
import { UserManagementView } from './components/UserManagementView';
import {
  apiFetch,
  setMemoryToken,
  subscribeConnectionState,
  type ServerConnectionState,
} from './utils/api';
import type {
  AppSettingsMap,
  NotificationRecord,
  SyncVersionsMap,
  UserRecord,
} from './shared/types';

const INITIAL_SYNC_VERSIONS: SyncVersionsMap = {
  config: 0,
  users: 0,
  questions: 0,
  exams: 0,
  results: 0,
  documents: 0,
  backups: 0,
};

export default function App() {
  const [config, setConfig] = useState<Partial<AppSettingsMap>>({});
  const [configError, setConfigError] = useState<string | null>(null);
  const [user, setUser] = useState<UserRecord | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [activeNav, setActiveNav] = useState('dashboard');
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  // Cross-device sync & server connection state
  const [connectionState, setConnectionState] = useState<ServerConnectionState>('online');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncVersions, setSyncVersions] = useState<SyncVersionsMap>(INITIAL_SYNC_VERSIONS);
  const configVersionRef = useRef<number>(0);
  const syncVersionsRef = useRef<SyncVersionsMap>(INITIAL_SYNC_VERSIONS);
  const syncInFlightRef = useRef(false);

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
      const cfg = await apiFetch<
        Partial<AppSettingsMap> & { config_version?: number }
      >('/public/config');
      setConfig(cfg);
      setConfigError(null);
      if (typeof cfg.config_version === 'number') {
        configVersionRef.current = cfg.config_version;
      }
      if (cfg.app_name) {
        document.title = cfg.app_name;
      }
    } catch (err) {
      // Never overwrite existing loaded config or silently fallback to defaults
      setConfigError(
        err instanceof Error
          ? err.message
          : 'Konfigurasi server tidak dapat dibaca dari database.',
      );
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
      // Handled by connection listener when server fails
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    setSyncing(true);
    try {
      const state = await apiFetch<{
        server_time: string;
        db_ok: boolean;
        config_version: number;
        sync_versions: Partial<SyncVersionsMap>;
      }>('/sync/version');

      setLastSyncAt(state.server_time || new Date().toISOString());
      setConnectionError(null);

      const prevCfgVer = configVersionRef.current;
      if (state.config_version !== prevCfgVer) {
        configVersionRef.current = state.config_version;
        await loadPublicConfig();
      }

      const incoming = state.sync_versions || {};
      const prevVersions = syncVersionsRef.current;
      const merged: SyncVersionsMap = {
        config: incoming.config ?? prevVersions.config,
        users: incoming.users ?? prevVersions.users,
        questions: incoming.questions ?? prevVersions.questions,
        exams: incoming.exams ?? prevVersions.exams,
        results: incoming.results ?? prevVersions.results,
        documents: incoming.documents ?? prevVersions.documents,
        backups: incoming.backups ?? prevVersions.backups,
      };

      const changed =
        merged.config !== prevVersions.config ||
        merged.users !== prevVersions.users ||
        merged.questions !== prevVersions.questions ||
        merged.exams !== prevVersions.exams ||
        merged.results !== prevVersions.results ||
        merged.documents !== prevVersions.documents ||
        merged.backups !== prevVersions.backups;

      if (changed) {
        const hadBaseline =
          prevVersions.config > 0 ||
          prevVersions.users > 0 ||
          prevVersions.exams > 0;
        syncVersionsRef.current = merged;
        setSyncVersions(merged);
        if (hadBaseline && user) {
          void loadDashboardData();
          void loadNotifications();
        }
      }
    } catch (err) {
      setConnectionError(
        err instanceof Error ? err.message : 'Gagal menyinkronkan status dengan server.',
      );
    } finally {
      syncInFlightRef.current = false;
      setSyncing(false);
    }
  }, [loadDashboardData, loadNotifications, loadPublicConfig, user]);

  // Subscribe to API connection status changes
  useEffect(() => {
    return subscribeConnectionState((state, msg) => {
      setConnectionState(state);
      if (state === 'online') {
        setConnectionError(null);
      } else if (msg) {
        setConnectionError(msg);
      }
    });
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
      void syncNow();
    };
    void boot();
  }, [loadPublicConfig]);

  useEffect(() => {
    if (!user) return;
    void loadDashboardData();
    void loadNotifications();
    void syncNow();
  }, [user, activeNav, loadDashboardData, loadNotifications]);

  // Cross-device version polling every 10s + on window focus/visibility/online
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void syncNow();
      }
    }, 10000);

    const handleVisibilityOrFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void syncNow();
      }
    };

    const handleOnline = () => {
      setConnectionState('online');
      setConnectionError(null);
      void syncNow();
    };

    const handleOffline = () => {
      setConnectionState('offline');
      setConnectionError(
        'Perangkat sedang offline. Perubahan tertunda tidak disimpan sebelum koneksi pulih.',
      );
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncNow]);

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

  const handleConfigUpdated = () => {
    void loadPublicConfig();
    void syncNow();
  };

  const handleDatabaseChanged = () => {
    void loadPublicConfig();
    void loadDashboardData();
    void loadNotifications();
    void syncNow();
  };

  if (initializing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-sm text-slate-600">
        Memuat Portal CBT KIR IPA SMAN 1 Sukabumi...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        config={config}
        configError={configError}
        onRetryConfig={() => {
          void loadPublicConfig();
          void syncNow();
        }}
        onLoginSuccess={handleLoginSuccess}
      />
    );
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
          return <UserManagementView currentUser={user} syncTick={syncVersions.users} />;
        case 'professors':
          return (
            <UserManagementView
              currentUser={user}
              lockedRoleFilter="PROFESSOR"
              syncTick={syncVersions.users}
            />
          );
        case 'students':
          return (
            <UserManagementView
              currentUser={user}
              lockedRoleFilter="SISWA"
              syncTick={syncVersions.users}
            />
          );
        case 'questions':
          return <QuestionBankView syncTick={syncVersions.questions} />;
        case 'create_question':
          return <QuestionBankView openCreatorImmediately syncTick={syncVersions.questions} />;
        case 'exams':
          return (
            <ExamManagerView
              currentUser={user}
              syncTick={syncVersions.exams + syncVersions.questions + syncVersions.users}
            />
          );
        case 'create_exam':
          return (
            <ExamManagerView
              currentUser={user}
              openBuilderImmediately
              syncTick={syncVersions.exams + syncVersions.questions + syncVersions.users}
            />
          );
        case 'monitoring':
          return <MonitoringView />;
        case 'essay_grading':
          return <EssayGradingView />;
        case 'results':
          return (
            <ResultsManagementView
              config={config}
              currentUser={user}
              syncTick={syncVersions.results + syncVersions.exams}
            />
          );
        case 'leaderboard':
          return (
            <LeaderboardView
              config={config}
              currentUser={user}
              syncTick={syncVersions.results + syncVersions.exams}
            />
          );
        case 'analytics':
          return (
            <ItemAnalysisView
              config={config}
              currentUser={user}
              syncTick={syncVersions.results + syncVersions.exams}
            />
          );
        case 'reports':
          return (
            <ReportsAndBeritaAcaraView
              config={config}
              currentUser={user}
              syncTick={syncVersions.documents + syncVersions.results + syncVersions.exams}
            />
          );
        case 'audit':
          return <AuditLogView />;
        case 'backup':
          return (
            <BackupRestoreView
              syncTick={syncVersions.backups}
              onDatabaseRestored={handleDatabaseChanged}
            />
          );
        case 'server_monitoring':
          return (
            <ServerMonitoringView
              syncTick={
                syncVersions.config +
                syncVersions.backups +
                syncVersions.users +
                syncVersions.exams +
                syncVersions.questions
              }
              onDatabaseChanged={handleDatabaseChanged}
            />
          );
        case 'settings_app':
          return (
            <SettingsView
              mode="APP"
              syncTick={syncVersions.config}
              onConfigUpdated={handleConfigUpdated}
            />
          );
        case 'settings_security':
          return (
            <SettingsView
              mode="SECURITY"
              syncTick={syncVersions.config}
              onConfigUpdated={handleConfigUpdated}
            />
          );
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
          return <QuestionBankView syncTick={syncVersions.questions} />;
        case 'create_question':
          return <QuestionBankView openCreatorImmediately syncTick={syncVersions.questions} />;
        case 'create_exam':
          return (
            <ExamManagerView
              currentUser={user}
              openBuilderImmediately
              syncTick={syncVersions.exams + syncVersions.questions + syncVersions.users}
            />
          );
        case 'exams':
          return (
            <ExamManagerView
              currentUser={user}
              syncTick={syncVersions.exams + syncVersions.questions + syncVersions.users}
            />
          );
        case 'students':
          return (
            <UserManagementView
              currentUser={user}
              lockedRoleFilter="SISWA"
              syncTick={syncVersions.users}
            />
          );
        case 'monitoring':
          return <MonitoringView />;
        case 'essay_grading':
          return <EssayGradingView />;
        case 'results':
          return (
            <ResultsManagementView
              config={config}
              currentUser={user}
              syncTick={syncVersions.results + syncVersions.exams}
            />
          );
        case 'analytics':
          return (
            <ItemAnalysisView
              config={config}
              currentUser={user}
              syncTick={syncVersions.results + syncVersions.exams}
            />
          );
        case 'leaderboard':
          return (
            <LeaderboardView
              config={config}
              currentUser={user}
              syncTick={syncVersions.results + syncVersions.exams}
            />
          );
        case 'reports':
          return (
            <ReportsAndBeritaAcaraView
              config={config}
              currentUser={user}
              syncTick={syncVersions.documents + syncVersions.results + syncVersions.exams}
            />
          );
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
        return (
          <LeaderboardView
            config={config}
            currentUser={user}
            syncTick={syncVersions.results + syncVersions.exams}
          />
        );
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
      connectionState={connectionState}
      syncing={syncing}
      lastSyncAt={lastSyncAt}
      connectionError={connectionError || configError}
      onManualSync={() => void syncNow()}
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

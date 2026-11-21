import { useState, type ReactNode } from 'react';
import {
  Activity,
  Award,
  BarChart3,
  Bell,
  BookOpenCheck,
  ClipboardCheck,
  Code2,
  DatabaseBackup,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  History,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  PenSquare,
  PlusCircle,
  Settings,
  ShieldAlert,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { AppLogo } from './AppLogo';
import type { AppSettingsMap, NotificationRecord, UserRecord } from '../shared/types';

export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
}

interface AppShellProps {
  user: UserRecord;
  config: Partial<AppSettingsMap>;
  activeNav: string;
  onSelectNav: (id: string) => void;
  onLogout: () => void;
  notifications: NotificationRecord[];
  onMarkNotificationsRead: () => void;
  children: ReactNode;
}

export function getNavItemsForRole(role: UserRecord['role']): NavItem[] {
  if (role === 'SUPER_ADMIN') {
    return [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
      { id: 'users', label: 'Manajemen Pengguna', icon: <Users className="w-4 h-4" /> },
      { id: 'professors', label: 'Manajemen Professor', icon: <UserCheck className="w-4 h-4" /> },
      { id: 'students', label: 'Manajemen Siswa', icon: <GraduationCap className="w-4 h-4" /> },
      { id: 'questions', label: 'Bank Soal', icon: <BookOpenCheck className="w-4 h-4" /> },
      { id: 'exams', label: 'Manajemen Ujian', icon: <ClipboardCheck className="w-4 h-4" /> },
      { id: 'monitoring', label: 'Monitoring Ujian', icon: <Activity className="w-4 h-4" /> },
      { id: 'essay_grading', label: 'Penilaian Esai', icon: <PenSquare className="w-4 h-4" /> },
      { id: 'results', label: 'Hasil dan Penilaian', icon: <FileSpreadsheet className="w-4 h-4" /> },
      { id: 'leaderboard', label: 'Leaderboard', icon: <Award className="w-4 h-4" /> },
      { id: 'analytics', label: 'Analisis Ujian', icon: <BarChart3 className="w-4 h-4" /> },
      { id: 'reports', label: 'Laporan & Berita Acara', icon: <FileText className="w-4 h-4" /> },
      { id: 'audit', label: 'Audit Log', icon: <History className="w-4 h-4" /> },
      { id: 'backup', label: 'Backup Database', icon: <DatabaseBackup className="w-4 h-4" /> },
      { id: 'settings_app', label: 'Pengaturan Aplikasi', icon: <Settings className="w-4 h-4" /> },
      { id: 'settings_security', label: 'Pengaturan Keamanan', icon: <Lock className="w-4 h-4" /> },
      { id: 'gas_export', label: 'Paket Apps Script', icon: <Code2 className="w-4 h-4" /> },
    ];
  }

  if (role === 'PROFESSOR') {
    return [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
      { id: 'questions', label: 'Bank Soal', icon: <BookOpenCheck className="w-4 h-4" /> },
      { id: 'create_question', label: 'Buat Soal', icon: <PlusCircle className="w-4 h-4" /> },
      { id: 'create_exam', label: 'Buat Ujian', icon: <PenSquare className="w-4 h-4" /> },
      { id: 'exams', label: 'Manajemen Ujian', icon: <ClipboardCheck className="w-4 h-4" /> },
      { id: 'students', label: 'Daftar Peserta', icon: <GraduationCap className="w-4 h-4" /> },
      { id: 'monitoring', label: 'Monitoring Ujian', icon: <ShieldAlert className="w-4 h-4" /> },
      { id: 'essay_grading', label: 'Penilaian Esai', icon: <PenSquare className="w-4 h-4" /> },
      { id: 'results', label: 'Hasil Ujian', icon: <FileSpreadsheet className="w-4 h-4" /> },
      { id: 'analytics', label: 'Analisis Soal', icon: <BarChart3 className="w-4 h-4" /> },
      { id: 'leaderboard', label: 'Leaderboard', icon: <Award className="w-4 h-4" /> },
      { id: 'reports', label: 'Laporan', icon: <FileText className="w-4 h-4" /> },
    ];
  }

  return [
    { id: 'dashboard', label: 'Dashboard Ujian', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'leaderboard', label: 'Leaderboard', icon: <Award className="w-4 h-4" /> },
    { id: 'profile', label: 'Ganti Password', icon: <KeyRound className="w-4 h-4" /> },
  ];
}

export function AppShell({
  user,
  config,
  activeNav,
  onSelectNav,
  onLogout,
  notifications,
  onMarkNotificationsRead,
  children,
}: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const navItems = getNavItemsForRole(user.role);
  const unreadCount = notifications.filter((n) => n.is_read === 0).length;
  const activeItem = navItems.find((n) => n.id === activeNav) ?? navItems[0];

  const roleLabel =
    user.role === 'SUPER_ADMIN'
      ? 'Super Admin'
      : user.role === 'PROFESSOR'
        ? 'Professor / Pembina'
        : 'Peserta Didik';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-[260px] lg:flex-col lg:fixed lg:inset-y-0 bg-[#0F294A] text-white border-r border-slate-800 no-print">
        <div className="p-4 border-b border-white/10 flex items-center gap-3">
          <AppLogo src={config.logo_url} sizeClass="w-10 h-10" />
          <div className="min-w-0">
            <div className="text-sm font-bold leading-tight truncate text-white">
              CBT KIR IPA
            </div>
            <div className="text-xs text-amber-300 truncate">SMAN 1 Sukabumi</div>
          </div>
        </div>

        <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            const isActive = item.id === activeNav;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectNav(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left cursor-pointer ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-200 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="shrink-0">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/10 text-xs text-slate-300 space-y-2">
          <div className="px-2">
            <div className="font-semibold text-white truncate">{user.nama}</div>
            <div className="text-amber-300">{roleLabel} · {user.kelas || user.username}</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-red-600/90 text-white font-medium transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Keluar
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-slate-900/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-[#0F294A] text-white flex flex-col h-full z-10">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <AppLogo src={config.logo_url} sizeClass="w-9 h-9" />
                <span className="font-bold text-sm">CBT KIR IPA</span>
              </div>
              <button
                type="button"
                aria-label="Tutup menu"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-200 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectNav(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left ${
                    item.id === activeNav ? 'bg-blue-600 text-white' : 'text-slate-200 hover:bg-white/10'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </nav>
            <div className="p-3 border-t border-white/10">
              <button
                type="button"
                onClick={onLogout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 text-white text-sm font-medium"
              >
                <LogOut className="w-4 h-4" />
                Keluar
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-[260px] flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 h-16 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Buka menu navigasi"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="lg:hidden">
              <AppLogo src={config.logo_url} sizeClass="w-8 h-8" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-[#0F294A] truncate">
                {activeItem.label}
              </h1>
              <p className="text-xs text-slate-500 truncate hidden sm:block">
                {config.app_name || 'CBT KIR IPA SMAN 1 SUKABUMI'} · {roleLabel}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 relative">
            <button
              type="button"
              aria-label="Notifikasi"
              onClick={() => {
                setNotifOpen((v) => !v);
                if (!notifOpen && unreadCount > 0) onMarkNotificationsRead();
              }}
              className="relative p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-12 w-80 bg-white border border-slate-200 rounded-xl shadow-lg p-3 z-50">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="text-xs font-semibold text-[#0F294A]">Notifikasi Sistem</span>
                  <button
                    type="button"
                    onClick={() => setNotifOpen(false)}
                    className="text-xs text-slate-500 hover:text-slate-800"
                  >
                    Tutup
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 mt-1">
                  {notifications.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">Belum ada notifikasi baru.</p>
                  ) : (
                    notifications.map((n) => (
                      <div key={n.notification_id} className="py-2.5 text-xs">
                        <div className="font-semibold text-slate-900">{n.title}</div>
                        <p className="text-slate-600 mt-0.5">{n.message}</p>
                        <span className="text-[11px] text-slate-400">
                          {new Date(n.created_at).toLocaleString('id-ID')}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="hidden sm:flex items-center gap-2 text-right pl-2 border-l border-slate-200">
              <div>
                <div className="text-xs font-semibold text-slate-900 truncate max-w-[160px]">
                  {user.nama}
                </div>
                <div className="text-[11px] text-slate-500 font-mono">{user.username}</div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}

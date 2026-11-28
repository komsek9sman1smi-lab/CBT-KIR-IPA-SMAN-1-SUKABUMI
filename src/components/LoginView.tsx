import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, LogIn, User as UserIcon } from 'lucide-react';
import { AppLogo } from './AppLogo';
import { apiFetch } from '../utils/api';
import type { AppSettingsMap, UserRecord } from '../shared/types';

interface LoginViewProps {
  config: Partial<AppSettingsMap>;
  configError?: string | null;
  onRetryConfig?: () => void;
  onLoginSuccess: (payload: { token: string; session_id: string; user: UserRecord }) => void;
}

export function LoginView({
  config,
  configError,
  onRetryConfig,
  onLoginSuccess,
}: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Masukkan username dan password Anda.');
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string; session_id: string; user: UserRecord }>(
        '/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ username: username.trim(), password }),
        },
      );
      onLoginSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk ke sistem.');
    } finally {
      setLoading(false);
    }
  };

  const hasLoadedConfig = Boolean(config.app_name);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6">
      <div className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        <div className="text-center space-y-3">
          <AppLogo src={config.logo_url} alt={config.app_name || 'Logo Aplikasi'} sizeClass="w-16 h-16 mx-auto" />
          <div>
            {config.org_name && (
              <p className="text-xs font-semibold text-amber-700 tracking-wide">
                {config.org_name}
              </p>
            )}
            <h1 className="text-xl font-bold text-[#0F294A] tracking-tight mt-0.5">
              {hasLoadedConfig
                ? config.app_name
                : configError
                  ? 'Konfigurasi Server Tidak Tersedia'
                  : 'Memuat Konfigurasi Server...'}
            </h1>
            {config.school_name && (
              <p className="text-xs text-slate-500 mt-0.5">
                {config.school_name}
              </p>
            )}
          </div>
        </div>

        {configError && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-red-50 border border-red-300 text-xs text-red-900 flex items-center justify-between gap-2"
          >
            <span>
              <strong>Koneksi / Database Bermasalah:</strong> {configError}. Sistem memblokir fallback ke pengaturan awal demi keamanan data.
            </span>
            {onRetryConfig && (
              <button
                type="button"
                onClick={onRetryConfig}
                className="px-2.5 py-1 rounded bg-red-700 hover:bg-red-800 text-white font-semibold shrink-0 cursor-pointer"
              >
                Coba Muat Ulang
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="login-username"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Username
            </label>
            <div className="relative">
              <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Masukkan username"
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan password"
                className="w-full pl-10 pr-11 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-700 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-lg bg-[#0F294A] hover:bg-blue-800 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogIn className="w-4 h-4" />
            {loading ? 'Memverifikasi Akun...' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}

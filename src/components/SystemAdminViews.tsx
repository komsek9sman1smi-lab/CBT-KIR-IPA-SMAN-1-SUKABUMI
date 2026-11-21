import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  DatabaseBackup,
  Download,
  History,
  ImagePlus,
  Lock,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { AppLogo } from './AppLogo';
import { apiFetch } from '../utils/api';
import { formatAuditDetails } from '../shared/grading';
import type { AppSettingsMap } from '../shared/types';

export function AuditLogView() {
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState('');
  const [activityFilter, setActivityFilter] = useState('');

  const loadLogs = async () => {
    const qs = new URLSearchParams();
    if (search.trim()) qs.set('search', search.trim());
    if (activityFilter.trim()) qs.set('activity', activityFilter.trim());
    const res = await apiFetch<{ logs: Array<Record<string, unknown>> }>(
      `/audit-logs?${qs.toString()}`,
    );
    setLogs(res.logs);
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari pengguna atau detail aktivitas..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <input
          type="text"
          value={activityFilter}
          onChange={(e) => setActivityFilter(e.target.value)}
          placeholder="Filter jenis aktivitas (mis. LOGIN, SCORE)"
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm min-w-[240px]"
        />
        <button
          type="button"
          onClick={() => void loadLogs()}
          className="px-4 py-2 rounded-lg bg-[#0F294A] text-white text-xs font-semibold cursor-pointer"
        >
          Terapkan Filter
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Waktu</th>
                <th className="px-4 py-3">Pengguna</th>
                <th className="px-4 py-3">Aktivitas</th>
                <th className="px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={String(l.log_id)} className="hover:bg-slate-50/70">
                  <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">
                    {new Date(String(l.timestamp)).toLocaleString('id-ID')}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-slate-900">{String(l.nama || 'Sistem')}</span>
                    {Boolean(l.role) && <span className="text-slate-400 ml-1">({String(l.role)})</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono font-semibold text-blue-700">
                    {String(l.activity)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 max-w-md break-words">
                    {formatAuditDetails(l.details)}
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

export function BackupRestoreView() {
  const [backups, setBackups] = useState<Array<Record<string, unknown>>>([]);
  const [pendingRestoreSnapshot, setPendingRestoreSnapshot] = useState<Record<string, unknown> | null>(
    null,
  );
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const loadBackups = async () => {
    const res = await apiFetch<{ backups: Array<Record<string, unknown>> }>('/backups');
    setBackups(res.backups);
  };

  useEffect(() => {
    void loadBackups();
  }, []);

  const handleCreateBackup = async () => {
    await apiFetch('/backups', { method: 'POST' });
    setToast('Snapshot backup database berhasil dibuat.');
    setTimeout(() => setToast(''), 3500);
    await loadBackups();
  };

  const handleUploadRestoreFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { snapshot?: Record<string, unknown> };
      setPendingRestoreSnapshot(parsed.snapshot || (parsed as Record<string, unknown>));
      setError('');
    } catch {
      setError('Berkas JSON backup tidak valid.');
    } finally {
      e.target.value = '';
    }
  };

  const confirmRestore = async () => {
    if (!pendingRestoreSnapshot) return;
    await apiFetch('/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ snapshot: pendingRestoreSnapshot }),
    });
    setPendingRestoreSnapshot(null);
    setToast('Pemulihan database dari snapshot berhasil dilakukan.');
    await loadBackups();
  };

  return (
    <div className="space-y-5">
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

      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-[#0F294A]">Backup & Pemulihan Database</h2>
          <p className="text-xs text-slate-500">
            Cadangkan seluruh 16 tabel database ke berkas JSON atau pulihkan kondisi sebelumnya.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
            <RotateCcw className="w-3.5 h-3.5" />
            Pulihkan dari Berkas JSON
            <input
              type="file"
              accept=".json"
              onChange={handleUploadRestoreFile}
              className="hidden"
            />
          </label>
          <button
            type="button"
            onClick={handleCreateBackup}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0F294A] text-white text-xs font-semibold hover:bg-blue-800 cursor-pointer"
          >
            <DatabaseBackup className="w-4 h-4" />
            Buat Backup Sekarang
          </button>
        </div>
      </div>

      {pendingRestoreSnapshot && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-amber-900">
            Konfirmasi Pemulihan Database Aktif
          </h3>
          <p className="text-xs text-amber-800">
            Pemulihan akan menimpa data pengguna, bank soal, ujian, dan hasil pada database aktif dengan isi snapshot JSON yang Anda unggah. Lanjutkan?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPendingRestoreSnapshot(null)}
              className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs cursor-pointer"
            >
              Batalkan
            </button>
            <button
              type="button"
              onClick={confirmRestore}
              className="px-4 py-1.5 rounded-lg bg-red-700 text-white text-xs font-semibold cursor-pointer"
            >
              Ya, Timpa & Pulihkan Database
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-3">ID Backup</th>
              <th className="px-4 py-3">Berkas Snapshot</th>
              <th className="px-4 py-3">Waktu Pembuatan</th>
              <th className="px-4 py-3">Dibuat Oleh</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Unduh</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {backups.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Belum ada riwayat backup database.
                </td>
              </tr>
            ) : (
              backups.map((b) => (
                <tr key={String(b.backup_id)}>
                  <td className="px-4 py-3 font-mono">{String(b.backup_id)}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">{String(b.file_id)}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">
                    {new Date(String(b.created_at)).toLocaleString('id-ID')}
                  </td>
                  <td className="px-4 py-3">{String(b.creator_name || 'Super Admin')}</td>
                  <td className="px-4 py-3 text-emerald-700 font-semibold">{String(b.status)}</td>
                  <td className="px-4 py-3 text-right">
                    <a
                      href={`/api/backups/${encodeURIComponent(String(b.file_id))}/download`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="w-3 h-3" />
                      Unduh JSON
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SettingsView({
  mode,
  onConfigUpdated,
}: {
  mode: 'APP' | 'SECURITY';
  onConfigUpdated: () => void;
}) {
  const [settings, setSettings] = useState<AppSettingsMap | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    void apiFetch<{ settings: AppSettingsMap }>('/settings').then((res) => setSettings(res.settings));
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    await apiFetch('/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    });
    setToast('Pengaturan sistem berhasil disimpan.');
    setTimeout(() => setToast(''), 3000);
    onConfigUpdated();
  };

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !settings) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSettings({ ...settings, logo_url: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  if (!settings) {
    return <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500">Memuat pengaturan...</div>;
  }

  return (
    <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 max-w-3xl">
      {toast && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {toast}
        </div>
      )}

      {mode === 'APP' ? (
        <>
          <div className="flex items-center gap-4 pb-4 border-b border-slate-200">
            <AppLogo src={settings.logo_url} sizeClass="w-14 h-14" />
            <div>
              <h2 className="text-lg font-bold text-[#0F294A]">Pengaturan Identitas Aplikasi</h2>
              <label className="inline-flex items-center gap-1.5 mt-1 text-xs font-medium text-blue-700 hover:underline cursor-pointer">
                <ImagePlus className="w-3.5 h-3.5" />
                Unggah Logo Baru KIR IPA
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Aplikasi</label>
              <input
                type="text"
                value={settings.app_name}
                onChange={(e) => setSettings({ ...settings, app_name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Organisasi</label>
              <input
                type="text"
                value={settings.org_name}
                onChange={(e) => setSettings({ ...settings, org_name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tahun Ajaran</label>
              <input
                type="text"
                value={settings.academic_year}
                onChange={(e) => setSettings({ ...settings, academic_year: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Periode Kepengurusan</label>
              <input
                type="text"
                value={settings.management_period}
                onChange={(e) => setSettings({ ...settings, management_period: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Informasi Kontak</label>
              <input
                type="text"
                value={settings.contact_info}
                onChange={(e) => setSettings({ ...settings, contact_info: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Pengumuman Portal</label>
              <textarea
                rows={3}
                value={settings.announcement}
                onChange={(e) => setSettings({ ...settings, announcement: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Identitas Footer Laporan</label>
              <input
                type="text"
                value={settings.report_footer}
                onChange={(e) => setSettings({ ...settings, report_footer: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
            <ShieldCheck className="w-5 h-5 text-[#0F294A]" />
            <h2 className="text-lg font-bold text-[#0F294A]">Pengaturan Keamanan & Hak Akses</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Maks Percobaan Login</label>
              <input
                type="number"
                min={3}
                max={15}
                value={settings.max_login_attempts}
                onChange={(e) => setSettings({ ...settings, max_login_attempts: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Durasi Blokir (Menit)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={settings.lockout_minutes}
                onChange={(e) => setSettings({ ...settings, lockout_minutes: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Masa Aktif Sesi (Jam)</label>
              <input
                type="number"
                min={1}
                max={24}
                value={settings.session_hours}
                onChange={(e) => setSettings({ ...settings, session_hours: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.professor_global_access === 'true'}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  professor_global_access: e.target.checked ? 'true' : 'false',
                })
              }
              className="mt-0.5"
            />
            <div>
              <strong className="text-slate-900">Izinkan Professor Mengelola Semua Bank Soal & Ujian</strong>
              <p className="text-slate-500 mt-0.5">
                Jika dinonaktifkan (default), Professor hanya dapat mengedit soal dan ujian yang dibuatnya sendiri.
              </p>
            </div>
          </label>
        </>
      )}

      <div className="pt-2">
        <button
          type="submit"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white text-sm font-semibold cursor-pointer"
        >
          <Save className="w-4 h-4" />
          Simpan Pengaturan
        </button>
      </div>
    </form>
  );
}

export function ProfilePasswordView() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    setErr('');
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setMsg('Password akun Anda berhasil diperbarui.');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Gagal memperbarui password.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-6 max-w-md space-y-4">
      <div className="flex items-center gap-2 text-[#0F294A] font-bold">
        <Lock className="w-4 h-4" />
        <h2>Ganti Password Akun</h2>
      </div>
      {msg && <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">{msg}</div>}
      {err && <div className="p-3 rounded bg-red-50 border border-red-200 text-xs text-red-700">{err}</div>}
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Password Saat Ini</label>
        <input
          required
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Password Baru (min. 6 karakter)</label>
        <input
          required
          minLength={6}
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
        />
      </div>
      <button
        type="submit"
        className="px-4 py-2 rounded-lg bg-[#0F294A] text-white text-sm font-semibold cursor-pointer"
      >
        Perbarui Password
      </button>
    </form>
  );
}

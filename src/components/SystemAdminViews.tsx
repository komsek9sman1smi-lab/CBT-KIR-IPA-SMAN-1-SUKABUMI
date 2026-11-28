import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  DatabaseBackup,
  Download,
  History,
  ImagePlus,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import { AppLogo } from './AppLogo';
import { ApiError, apiFetch, downloadAuthenticatedFile } from '../utils/api';
import { formatAuditDetails } from '../shared/grading';
import type {
  AppSettingsMap,
  BackupLogRecord,
  BaseConfigSource,
  ConfigVersionRecord,
  SystemMonitoringStatus,
} from '../shared/types';

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

export function BackupRestoreView({
  syncTick = 0,
  onDatabaseRestored,
}: {
  syncTick?: number;
  onDatabaseRestored?: () => void;
}) {
  const [backups, setBackups] = useState<BackupLogRecord[]>([]);
  const [pendingRestoreSnapshot, setPendingRestoreSnapshot] = useState<Record<string, unknown> | null>(
    null,
  );
  const [pendingServerFileId, setPendingServerFileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const loadBackups = async () => {
    try {
      const res = await apiFetch<{ backups: BackupLogRecord[] }>('/backups');
      setBackups(res.backups);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar backup server.');
    }
  };

  useEffect(() => {
    void loadBackups();
  }, [syncTick]);

  const handleCreateBackup = async () => {
    setLoading(true);
    setError('');
    try {
      await apiFetch('/backups', { method: 'POST' });
      setToast('Snapshot backup terverifikasi berhasil dibuat dan disimpan permanen di server.');
      setTimeout(() => setToast(''), 4000);
      await loadBackups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat backup database.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadBackup = async (fileId: string) => {
    setError('');
    try {
      await downloadAuthenticatedFile(`/backups/${encodeURIComponent(fileId)}/download`, fileId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunduh berkas backup.');
    }
  };

  const handleUploadRestoreFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { snapshot?: Record<string, unknown> };
      setPendingServerFileId(null);
      setPendingRestoreSnapshot(parsed.snapshot || (parsed as Record<string, unknown>));
      setError('');
    } catch {
      setError('Berkas JSON backup tidak valid.');
    } finally {
      e.target.value = '';
    }
  };

  const confirmRestore = async () => {
    if (!pendingRestoreSnapshot && !pendingServerFileId) return;
    setLoading(true);
    setError('');
    try {
      await apiFetch('/backups/restore', {
        method: 'POST',
        body: JSON.stringify(
          pendingServerFileId
            ? { file_id: pendingServerFileId }
            : { snapshot: pendingRestoreSnapshot },
        ),
      });
      setPendingRestoreSnapshot(null);
      setPendingServerFileId(null);
      setToast('Pemulihan database berhasil (backup pra-pemulihan otomatis telah dibuat di server).');
      await loadBackups();
      onDatabaseRestored?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pemulihan database gagal.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {toast && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-[#0F294A]">Backup & Pemulihan Database</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Backup otomatis berjalan berkala setiap 6 jam, sebelum migrasi skema, dan sebelum pemulihan/reset. Seluruh berkas diverifikasi checksum SHA-256.
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
            disabled={loading}
            onClick={handleCreateBackup}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0F294A] text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-60 cursor-pointer"
          >
            <DatabaseBackup className="w-4 h-4" />
            {loading ? 'Memproses...' : 'Buat Backup Sekarang'}
          </button>
        </div>
      </div>

      {(pendingRestoreSnapshot || pendingServerFileId) && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-amber-900">
            Konfirmasi Pemulihan Database Aktif
          </h3>
          <p className="text-xs text-amber-800">
            {pendingServerFileId
              ? `Database aktif akan dipulihkan dari berkas server "${pendingServerFileId}".`
              : 'Pemulihan akan memulihkan data pengguna, pengaturan, bank soal, ujian, dokumen, dan hasil dari berkas JSON yang dipilih.'}{' '}
            Sistem otomatis membuat snapshot cadangan kondisi saat ini sebelum pemulihan dijalankan.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setPendingRestoreSnapshot(null);
                setPendingServerFileId(null);
              }}
              className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs cursor-pointer"
            >
              Batalkan
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={confirmRestore}
              className="px-4 py-1.5 rounded-lg bg-red-700 text-white text-xs font-semibold disabled:opacity-60 cursor-pointer"
            >
              Ya, Buat Pra-Backup & Pulihkan Database
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">ID & Jenis</th>
                <th className="px-4 py-3">Berkas Snapshot</th>
                <th className="px-4 py-3">Waktu Pembuatan</th>
                <th className="px-4 py-3">Ukuran & Verifikasi</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {backups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Belum ada riwayat backup database.
                  </td>
                </tr>
              ) : (
                backups.map((b) => (
                  <tr key={b.backup_id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="font-mono font-semibold text-slate-900">{b.backup_id}</div>
                      <div className="text-[11px] text-slate-500">{b.backup_type || 'MANUAL'} · {b.creator_name || 'Sistem'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">{b.file_id}</td>
                    <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                      {new Date(b.created_at).toLocaleString('id-ID')}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          b.file_exists ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {b.file_exists ? 'Terverifikasi' : 'Berkas Hilang'}
                      </span>
                      {b.size_bytes ? (
                        <div className="text-[11px] text-slate-500 font-mono">
                          {(b.size_bytes / 1024).toFixed(1)} KB
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {b.file_exists && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setPendingRestoreSnapshot(null);
                                setPendingServerFileId(b.file_id);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Pulihkan
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDownloadBackup(b.file_id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              Unduh JSON
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type ConfigSaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

const APP_MODE_KEYS: Array<keyof AppSettingsMap> = [
  'app_name',
  'org_name',
  'school_name',
  'academic_year',
  'management_period',
  'logo_url',
  'primary_color',
  'accent_color',
  'contact_info',
  'announcement',
  'report_footer',
];

const SECURITY_MODE_KEYS: Array<keyof AppSettingsMap> = [
  'max_login_attempts',
  'lockout_minutes',
  'session_hours',
  'professor_global_access',
];

export function SettingsView({
  mode,
  syncTick = 0,
  onConfigUpdated,
}: {
  mode: 'APP' | 'SECURITY';
  syncTick?: number;
  onConfigUpdated: () => void;
}) {
  const [settings, setSettings] = useState<AppSettingsMap | null>(null);
  const [serverBaseline, setServerBaseline] = useState<AppSettingsMap | null>(null);
  const [configVersion, setConfigVersion] = useState<number>(1);
  const [baseConfigSource, setBaseConfigSource] = useState<BaseConfigSource>('INITIAL_DEFAULT');
  const [baseConfigUpdatedAt, setBaseConfigUpdatedAt] = useState<string>('');
  const [versions, setVersions] = useState<ConfigVersionRecord[]>([]);
  const [saveState, setSaveState] = useState<ConfigSaveState>('idle');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [conflictDetected, setConflictDetected] = useState(false);
  const [remoteUpdateAvailable, setRemoteUpdateAvailable] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const savingInFlightRef = useRef(false);
  const settingsRef = useRef<AppSettingsMap | null>(null);
  const baselineRef = useRef<AppSettingsMap | null>(null);
  const configVersionRef = useRef<number>(1);

  settingsRef.current = settings;
  baselineRef.current = serverBaseline;
  configVersionRef.current = configVersion;

  const activeModeKeys = mode === 'APP' ? APP_MODE_KEYS : SECURITY_MODE_KEYS;

  const changedPatch = useMemo(() => {
    const patch: Partial<AppSettingsMap> = {};
    if (!settings || !serverBaseline) return patch;
    for (const key of activeModeKeys) {
      if (String(settings[key] ?? '') !== String(serverBaseline[key] ?? '')) {
        patch[key] = settings[key];
      }
    }
    return patch;
  }, [activeModeKeys, serverBaseline, settings]);

  const changedKeys = useMemo(
    () => Object.keys(changedPatch) as Array<keyof AppSettingsMap>,
    [changedPatch],
  );
  const isDirty = changedKeys.length > 0;

  const loadSettingsAndHistory = useCallback(async (forceResetForm = false) => {
    try {
      const [cfgRes, verRes] = await Promise.all([
        apiFetch<{
          settings: AppSettingsMap;
          config_version: number;
          base_config_source?: BaseConfigSource;
          base_config_updated_at?: string;
        }>('/settings'),
        apiFetch<{ versions: ConfigVersionRecord[] }>('/settings/versions?limit=25'),
      ]);

      const currentlyDirty =
        !forceResetForm &&
        settingsRef.current !== null &&
        baselineRef.current !== null &&
        activeModeKeys.some(
          (k) => String(settingsRef.current?.[k] ?? '') !== String(baselineRef.current?.[k] ?? ''),
        );

      setVersions(verRes.versions);

      if (currentlyDirty) {
        if (cfgRes.config_version !== configVersionRef.current) {
          setRemoteUpdateAvailable(true);
        }
        return;
      }

      setSettings(cfgRes.settings);
      setServerBaseline(cfgRes.settings);
      setConfigVersion(cfgRes.config_version);
      if (cfgRes.base_config_source) setBaseConfigSource(cfgRes.base_config_source);
      if (cfgRes.base_config_updated_at !== undefined) {
        setBaseConfigUpdatedAt(cfgRes.base_config_updated_at);
      }
      setConflictDetected(false);
      setRemoteUpdateAvailable(false);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat pengaturan dari server.');
    }
  }, [activeModeKeys]);

  useEffect(() => {
    void loadSettingsAndHistory(false);
  }, [syncTick, loadSettingsAndHistory]);

  const executePartialSave = useCallback(
    async (trigger: 'manual' | 'autosave') => {
      if (savingInFlightRef.current) return;
      const currentSettings = settingsRef.current;
      const currentBaseline = baselineRef.current;
      if (!currentSettings || !currentBaseline) return;

      const patch: Partial<AppSettingsMap> = {};
      for (const key of activeModeKeys) {
        if (String(currentSettings[key] ?? '') !== String(currentBaseline[key] ?? '')) {
          patch[key] = currentSettings[key];
        }
      }
      const patchKeys = Object.keys(patch) as Array<keyof AppSettingsMap>;
      if (patchKeys.length === 0) {
        if (trigger === 'manual') {
          setSaveState('saved');
          setToast(`Tidak ada perubahan baru (Base Config aktif Versi #${configVersionRef.current}).`);
        }
        return;
      }

      savingInFlightRef.current = true;
      setSaveState('saving');
      setError('');
      setConflictDetected(false);

      try {
        const res = await apiFetch<{
          ok: boolean;
          verified: boolean;
          config_version: number;
          base_config_source?: BaseConfigSource;
          settings: AppSettingsMap;
          changed_keys: string[];
        }>('/settings', {
          method: 'PUT',
          body: JSON.stringify({
            settings: patch,
            expected_version: configVersionRef.current,
          }),
        });

        setServerBaseline(res.settings);
        setSettings((prev) => {
          if (!prev) return res.settings;
          // Preserve any newer keystrokes made while the request was in flight
          const merged: AppSettingsMap = { ...res.settings };
          for (const key of activeModeKeys) {
            if (String(prev[key] ?? '') !== String(currentSettings[key] ?? '')) {
              merged[key] = prev[key];
            }
          }
          return merged;
        });
        setConfigVersion(res.config_version);
        if (res.base_config_source) setBaseConfigSource(res.base_config_source);
        setBaseConfigUpdatedAt(new Date().toISOString());
        setRemoteUpdateAvailable(false);
        setSaveState('saved');
        setToast(
          res.changed_keys.length > 0
            ? `${trigger === 'autosave' ? 'Autosave: ' : ''}Tersimpan ke Base Configuration & terverifikasi (Versi #${res.config_version}: ${res.changed_keys.join(', ')}).`
            : `Tidak ada perubahan baru (Versi aktif #${res.config_version}).`,
        );
        const verRes = await apiFetch<{ versions: ConfigVersionRecord[] }>('/settings/versions?limit=25');
        setVersions(verRes.versions);
        onConfigUpdated();
      } catch (err) {
        setSaveState('error');
        if (err instanceof ApiError && err.status === 409) {
          setConflictDetected(true);
        }
        setError(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan ke Base Configuration server.');
      } finally {
        savingInFlightRef.current = false;
      }
    },
    [activeModeKeys, onConfigUpdated],
  );

  // Track dirty state cleanly
  useEffect(() => {
    if (savingInFlightRef.current) return;
    if (isDirty) {
      setSaveState('unsaved');
      setToast('');
    }
  }, [isDirty]);

  // Debounced autosave (1500ms) for edited fields
  useEffect(() => {
    if (!autosaveEnabled || !isDirty || uploadingLogo || conflictDetected) return;
    const timer = setTimeout(() => {
      void executePartialSave('autosave');
    }, 1500);
    return () => clearTimeout(timer);
  }, [autosaveEnabled, isDirty, uploadingLogo, conflictDetected, changedPatch, executePartialSave]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    await executePartialSave('manual');
  };

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !settings) return;
    setError('');
    setUploadingLogo(true);
    setSaveState('saving');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (typeof reader.result !== 'string') {
          throw new Error('Berkas gambar gagal dibaca.');
        }
        const res = await apiFetch<{
          ok: boolean;
          logo_url: string;
          config_version: number;
          base_config_source?: BaseConfigSource;
          verified: boolean;
        }>('/uploads/logo', {
          method: 'POST',
          body: JSON.stringify({
            data_url: reader.result,
            filename: file.name,
            apply_immediately: true,
            expected_version: configVersionRef.current,
          }),
        });
        setSettings((prev) => (prev ? { ...prev, logo_url: res.logo_url } : prev));
        setServerBaseline((prev) => (prev ? { ...prev, logo_url: res.logo_url } : prev));
        setConfigVersion(res.config_version);
        if (res.base_config_source) setBaseConfigSource(res.base_config_source);
        setBaseConfigUpdatedAt(new Date().toISOString());
        setSaveState('saved');
        setToast(
          `Logo berhasil diunggah ke SQLite & disk server lalu dijadikan Base Configuration permanen (Versi #${res.config_version}).`,
        );
        const verRes = await apiFetch<{ versions: ConfigVersionRecord[] }>('/settings/versions?limit=25');
        setVersions(verRes.versions);
        onConfigUpdated();
      } catch (err) {
        setSaveState('error');
        if (err instanceof ApiError && err.status === 409) {
          setConflictDetected(true);
        }
        setError(err instanceof Error ? err.message : 'Gagal mengunggah logo permanen ke server.');
      } finally {
        setUploadingLogo(false);
        e.target.value = '';
      }
    };
    reader.onerror = () => {
      setUploadingLogo(false);
      setSaveState('error');
      setError('Gagal membaca berkas gambar logo.');
    };
    reader.readAsDataURL(file);
  };

  const handleRollback = async (versionId: string) => {
    setError('');
    setSaveState('saving');
    try {
      const res = await apiFetch<{
        ok: boolean;
        config_version: number;
        base_config_source?: BaseConfigSource;
        settings: AppSettingsMap;
      }>(`/settings/rollback/${encodeURIComponent(versionId)}`, { method: 'POST' });
      setSettings(res.settings);
      setServerBaseline(res.settings);
      setConfigVersion(res.config_version);
      setBaseConfigSource(res.base_config_source || 'ROLLBACK');
      setSaveState('saved');
      setToast(`Rollback konfigurasi berhasil diterapkan ke Base Configuration (Versi baru #${res.config_version}).`);
      await loadSettingsAndHistory(true);
      onConfigUpdated();
    } catch (err) {
      setSaveState('error');
      setError(err instanceof Error ? err.message : 'Gagal melakukan rollback konfigurasi.');
    }
  };

  if (!settings && !error) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500">
        Memuat Base Configuration dari database server...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              {mode === 'SECURITY' && <ShieldCheck className="w-5 h-5 text-[#0F294A]" />}
              <h2 className="text-lg font-bold text-[#0F294A]">
                {mode === 'APP' ? 'Pengaturan Identitas Aplikasi (Base Config)' : 'Pengaturan Keamanan & Hak Akses'}
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Sumber Base Config: <span className="font-mono font-semibold text-slate-700">{baseConfigSource}</span>
              {baseConfigUpdatedAt ? ` · Diperbarui ${new Date(baseConfigUpdatedAt).toLocaleString('id-ID')}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid="config-save-status"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border ${
                saveState === 'saving'
                  ? 'bg-blue-50 border-blue-200 text-blue-800'
                  : saveState === 'unsaved'
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : saveState === 'saved'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : saveState === 'error'
                        ? 'bg-red-50 border-red-200 text-red-700'
                        : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}
            >
              {saveState === 'saving' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saveState === 'unsaved' && <Clock className="w-3.5 h-3.5" />}
              {saveState === 'saved' && <CheckCircle2 className="w-3.5 h-3.5" />}
              {saveState === 'error' && <AlertTriangle className="w-3.5 h-3.5" />}
              <span>
                {saveState === 'saving'
                  ? 'Sedang menyimpan...'
                  : saveState === 'unsaved'
                    ? `Belum disimpan (${changedKeys.length})`
                    : saveState === 'saved'
                      ? `Berhasil disimpan · #${configVersion}`
                      : saveState === 'error'
                        ? 'Gagal menyimpan'
                        : `Tersinkron · #${configVersion}`}
              </span>
            </span>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none px-2 py-1 rounded border border-slate-200 bg-slate-50">
              <input
                type="checkbox"
                checked={autosaveEnabled}
                onChange={(e) => setAutosaveEnabled(e.target.checked)}
              />
              Autosave
            </label>
          </div>
        </div>

        {remoteUpdateAvailable && (
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Pembaruan Server Terdeteksi:</strong> Perangkat lain memperbarui Base Configuration. Perubahan ketikan lokal Anda tetap dipertahankan.
            </span>
            <button
              type="button"
              onClick={() => void loadSettingsAndHistory(true)}
              className="px-3 py-1 rounded bg-blue-700 text-white font-semibold cursor-pointer"
            >
              Muat Versi Terbaru Server
            </button>
          </div>
        )}

        {toast && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{toast}</span>
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            {conflictDetected && (
              <button
                type="button"
                onClick={() => void loadSettingsAndHistory(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-red-700 text-white text-xs font-semibold cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Muat Versi Terbaru Server
              </button>
            )}
          </div>
        )}

        {settings && (mode === 'APP' ? (
          <>
            <div className="flex items-center gap-4 pb-4 border-b border-slate-100">
              <AppLogo src={settings.logo_url} sizeClass="w-16 h-16" />
              <div>
                <div className="text-xs font-medium text-slate-700">Logo Resmi Aplikasi & Kop Laporan</div>
                <label className="inline-flex items-center gap-1.5 mt-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-800 hover:bg-blue-100 cursor-pointer">
                  <ImagePlus className="w-3.5 h-3.5" />
                  {uploadingLogo ? 'Mengunggah ke Server...' : 'Unggah Logo Baru Permanen'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    disabled={uploadingLogo}
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                </label>
                <p className="text-[11px] text-slate-500 mt-1 font-mono truncate max-w-md">
                  URL Tersimpan: {settings.logo_url}
                </p>
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
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Sekolah / Instansi</label>
                <input
                  type="text"
                  value={settings.school_name}
                  onChange={(e) => setSettings({ ...settings, school_name: e.target.value })}
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
              <div>
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
        ))}

        {settings && (
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saveState === 'saving'}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0F294A] hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saveState === 'saving'
                ? 'Menyimpan ke Base Configuration...'
                : isDirty
                  ? `Simpan ${changedKeys.length} Perubahan Permanen`
                  : 'Simpan Pengaturan Permanen'}
            </button>
            <span className="text-xs text-slate-500">
              Hanya bagian yang diubah yang dikirim dan diperbarui di Base Configuration server (partial update).
            </span>
          </div>
        )}
      </form>

      {/* Configuration Version History & 1-Click Rollback */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#0F294A]" />
            <h3 className="text-sm font-bold text-[#0F294A]">Riwayat Versi Konfigurasi & Rollback</h3>
          </div>
          <span className="text-xs text-slate-500">
            Mengembalikan konfigurasi tidak memengaruhi data peserta, soal, maupun nilai.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
              <tr>
                <th className="px-3 py-2">Versi</th>
                <th className="px-3 py-2">Kunci Pengaturan</th>
                <th className="px-3 py-2">Nilai Lama → Baru</th>
                <th className="px-3 py-2">Diubah Oleh & Waktu</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {versions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    Belum ada perubahan konfigurasi yang tercatat sejak pengaktifan versioning.
                  </td>
                </tr>
              ) : (
                versions.map((v) => (
                  <tr key={v.version_id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2 font-mono font-semibold text-[#0F294A]">
                      #{v.version_number}
                      {v.status === 'ROLLED_BACK' && (
                        <span className="block text-[10px] text-amber-700 font-sans">ROLLBACK</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-800">{v.setting_key}</td>
                    <td className="px-3 py-2 text-slate-600 max-w-xs break-words">
                      <span className="text-slate-400 line-through mr-1">{v.old_value.slice(0, 45) || '(kosong)'}</span>
                      <span>→ {v.new_value.slice(0, 60) || '(kosong)'}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      <div>{v.changed_by_name || v.changed_by}</div>
                      <div className="font-mono text-[11px]">
                        {new Date(v.changed_at).toLocaleString('id-ID')}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void handleRollback(v.version_id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        <Undo2 className="w-3 h-3" />
                        Kembalikan Nilai Lama
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function ServerMonitoringView({
  syncTick = 0,
  onDatabaseChanged,
}: {
  syncTick?: number;
  onDatabaseChanged?: () => void;
}) {
  const [status, setStatus] = useState<SystemMonitoringStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Guarded Factory Reset state
  const [resetPanelOpen, setResetPanelOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetAck, setResetAck] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const loadMonitoring = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<SystemMonitoringStatus>('/system/monitoring');
      setStatus(res);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membaca status server & database.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMonitoring();
  }, [syncTick]);

  const handleRollbackVersion = async (versionId: string) => {
    try {
      await apiFetch(`/settings/rollback/${encodeURIComponent(versionId)}`, { method: 'POST' });
      setToast('Konfigurasi berhasil dikembalikan ke versi sebelumnya.');
      await loadMonitoring();
      onDatabaseChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback gagal.');
    }
  };

  const handleFactoryReset = async (e: FormEvent) => {
    e.preventDefault();
    setResetBusy(true);
    setError('');
    try {
      const res = await apiFetch<{
        ok: boolean;
        pre_reset_backup_file: string;
      }>('/system/factory-reset', {
        method: 'POST',
        body: JSON.stringify({
          password: resetPassword,
          confirmation_phrase: resetPhrase,
          acknowledge_backup_and_reset: resetAck,
        }),
      });
      setResetPanelOpen(false);
      setResetPassword('');
      setResetPhrase('');
      setResetAck(false);
      setToast(
        `Reset pabrik selesai. Backup pra-reset tersimpan aman di server: ${res.pre_reset_backup_file}`,
      );
      await loadMonitoring();
      onDatabaseChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset pabrik ditolak.');
    } finally {
      setResetBusy(false);
    }
  };

  const criticalEvents = (status?.recent_errors ?? []).filter(
    (ev) => ev.level === 'ERROR' || ev.level === 'CRITICAL',
  );

  return (
    <div className="space-y-6">
      {toast && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {criticalEvents.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong>Peringatan Sistem ({criticalEvents.length} kejadian tercatat):</strong> Periksa log error server di bawah untuk memastikan seluruh operasi penyimpanan dan backup berjalan lancar.
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-[#0F294A] flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-700" />
            Monitoring Kesehatan Server, Persistensi Database & Sinkronisasi
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            ID Instalasi Permanen: <span className="font-mono text-slate-800">{status?.installation_id || '-'}</span> · Migrasi Terakhir: <span className="font-mono">{status?.last_migration_version || '-'}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMonitoring()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Segarkan Status
        </button>
      </div>

      {status && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Status Server & Database</div>
              <div className="mt-1 flex items-center gap-2 font-bold text-sm text-emerald-700">
                <Database className="w-4 h-4" />
                {status.server_status} · DB {status.db_status}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 font-mono truncate" title={status.db_path}>
                Proteksi Anti-Reset: {status.database_initialized ? 'AKTIF' : 'BELUM'}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Versi & Base Configuration</div>
              <div className="mt-1 font-bold text-sm font-mono text-[#0F294A]">
                v{status.app_version} / DB v{status.db_version}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Base Config: #{status.config_version} ({status.base_config_source || 'INITIAL_DEFAULT'})
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Simpan & Sinkronisasi Terakhir</div>
              <div className="mt-1 font-bold text-xs font-mono text-slate-800">
                Simpan: {status.last_save_at ? new Date(status.last_save_at).toLocaleString('id-ID') : '-'}
              </div>
              <div className="text-[11px] text-slate-500 font-mono mt-1">
                Sync Check: {status.last_sync_check_at ? new Date(status.last_sync_check_at).toLocaleTimeString('id-ID') : '-'}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Backup Terverifikasi</div>
              <div className="mt-1 font-bold text-sm font-mono text-[#0F294A]">
                {status.backups_count} Berkas Aktif
              </div>
              <div className="text-[11px] text-slate-500 font-mono mt-1">
                Terakhir: {status.last_backup_at ? new Date(status.last_backup_at).toLocaleString('id-ID') : 'Menunggu jadwal'}
              </div>
            </div>
          </div>

          {/* Domain Sync Versions & Record Counts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-[#0F294A]">Jumlah Data Aktif di Database Server</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                {Object.entries(status.table_counts).map(([table, count]) => (
                  <div key={table} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="font-mono text-[11px] text-slate-500">{table}</div>
                    <div className="font-mono font-bold text-base text-[#0F294A]">{count}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-[#0F294A]">Versi Sinkronisasi Antar Perangkat (Polling HTTP)</h3>
              <p className="text-xs text-slate-500">
                Setiap penyimpanan di satu perangkat menaikkan counter domain sehingga perangkat lain otomatis menarik pembaruan setiap 10 detik atau saat jendela aktif kembali.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                {Object.entries(status.sync_versions).map(([domain, ver]) => (
                  <div key={domain} className="p-2.5 rounded-lg bg-blue-50/60 border border-blue-200">
                    <div className="uppercase text-[10px] font-semibold text-blue-700">{domain}</div>
                    <div className="font-mono font-bold text-base text-[#0F294A]">v{ver}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Config History */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-[#0F294A]">Riwayat Perubahan Konfigurasi</h3>
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Versi</th>
                    <th className="px-3 py-2">Kunci</th>
                    <th className="px-3 py-2">Perubahan</th>
                    <th className="px-3 py-2">Waktu & Aktor</th>
                    <th className="px-3 py-2 text-right">Rollback</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {status.config_versions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                        Belum ada perubahan konfigurasi tersimpan.
                      </td>
                    </tr>
                  ) : (
                    status.config_versions.map((cv) => (
                      <tr key={cv.version_id}>
                        <td className="px-3 py-2 font-mono font-semibold">#{cv.version_number}</td>
                        <td className="px-3 py-2 font-mono">{cv.setting_key}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-xs break-words">
                          <span className="line-through text-slate-400 mr-1">{cv.old_value.slice(0, 40)}</span>
                          → {cv.new_value.slice(0, 50)}
                        </td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                          {cv.changed_by_name || cv.changed_by} · {new Date(cv.changed_at).toLocaleString('id-ID')}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => void handleRollbackVersion(cv.version_id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 hover:bg-slate-100 cursor-pointer"
                          >
                            <Undo2 className="w-3 h-3" />
                            Rollback
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Server Error & Failure Log */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-[#0F294A]">Log Error Server & Kegagalan Penyimpanan</h3>
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Waktu</th>
                    <th className="px-3 py-2">Level</th>
                    <th className="px-3 py-2">Sumber</th>
                    <th className="px-3 py-2">Pesan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {status.recent_errors.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-5 text-center text-emerald-700">
                        Tidak ada error penyimpanan atau kegagalan database yang tercatat.
                      </td>
                    </tr>
                  ) : (
                    status.recent_errors.map((ev) => (
                      <tr key={ev.event_id}>
                        <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
                          {new Date(ev.created_at).toLocaleString('id-ID')}
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-red-700">{ev.level}</td>
                        <td className="px-3 py-2 font-mono text-slate-700">{ev.source}</td>
                        <td className="px-3 py-2 text-slate-700">{ev.message}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Guarded Explicit Factory Reset Zone */}
          <div className="bg-red-50/70 border border-red-200 rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-red-900">
                  Zona Berbahaya: Reset Pabrik Eksplisit (Khusus Super Admin)
                </h3>
                <p className="text-xs text-red-800 mt-0.5">
                  Aplikasi tidak akan pernah melakukan reset otomatis. Reset hanya bisa dijalankan secara sadar di sini dengan verifikasi password, konfirmasi teks, dan backup otomatis terlebih dahulu.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResetPanelOpen((v) => !v)}
                className="px-3.5 py-2 rounded-lg border border-red-300 bg-white text-xs font-semibold text-red-800 hover:bg-red-100 cursor-pointer"
              >
                {resetPanelOpen ? 'Tutup Panel Reset' : 'Buka Reset Pabrik'}
              </button>
            </div>

            {resetPanelOpen && (
              <form onSubmit={handleFactoryReset} className="pt-3 border-t border-red-200 space-y-3 max-w-lg text-xs">
                <label className="flex items-start gap-2 text-red-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resetAck}
                    onChange={(e) => setResetAck(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Saya memahami seluruh pengguna, bank soal, ujian, dan pengaturan akan dikembalikan ke awal setelah backup otomatis selesai dibuat.
                  </span>
                </label>
                <div>
                  <label className="block font-semibold text-red-900 mb-1">Password Super Admin Saat Ini</label>
                  <input
                    type="password"
                    required
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-red-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-red-900 mb-1">
                    Ketik persis: <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-red-200">RESET PABRIK CBT KIR IPA</code>
                  </label>
                  <input
                    type="text"
                    required
                    value={resetPhrase}
                    onChange={(e) => setResetPhrase(e.target.value)}
                    placeholder="RESET PABRIK CBT KIR IPA"
                    className="w-full px-3 py-2 rounded-lg border border-red-300 bg-white font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={resetBusy}
                  className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-white font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {resetBusy ? 'Membuat Backup & Mereset...' : 'Buat Backup & Jalankan Reset Pabrik'}
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
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

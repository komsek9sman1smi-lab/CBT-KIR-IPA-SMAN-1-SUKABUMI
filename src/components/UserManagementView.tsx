import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Download,
  FileSpreadsheet,
  KeyRound,
  Plus,
  Printer,
  Search,
  Trash2,
  Upload,
  UserCog,
} from 'lucide-react';
import { PrintPreviewModal } from './PrintPreviewModal';
import { SpreadsheetImportModal } from './SpreadsheetImportModal';
import { apiFetch } from '../utils/api';
import {
  downloadImportTemplate,
  exportRowsToCsv,
  exportRowsToExcel,
} from '../utils/exporters';
import type { ValidatedPreviewRow } from '../shared/spreadsheet';
import type { ImportSummaryResult, UserRecord, UserRole } from '../shared/types';

interface UserManagementViewProps {
  currentUser: UserRecord;
  lockedRoleFilter?: UserRole;
  syncTick?: number;
}

export function UserManagementView({
  currentUser,
  lockedRoleFilter,
  syncTick = 0,
}: UserManagementViewProps) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>(lockedRoleFilter || '');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Create / Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [formUsername, setFormUsername] = useState('');
  const [formNama, setFormNama] = useState('');
  const [formKelas, setFormKelas] = useState('');
  const [formRole, setFormRole] = useState<UserRole>(lockedRoleFilter || 'SISWA');
  const [formStatus, setFormStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [formPassword, setFormPassword] = useState('');

  // Reset password modal
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');

  // Import & Print modals
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const pageSize = 10;

  const loadUsers = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams();
      const effectiveRole = lockedRoleFilter || roleFilter;
      if (effectiveRole) qs.set('role', effectiveRole);
      if (search.trim()) qs.set('search', search.trim());
      const res = await apiFetch<{ users: UserRecord[] }>(`/users?${qs.toString()}`);
      setUsers(res.users);
      if (!silent) setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat pengguna.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    setRoleFilter(lockedRoleFilter || '');
  }, [lockedRoleFilter]);

  useEffect(() => {
    void loadUsers();
  }, [lockedRoleFilter, roleFilter]);

  useEffect(() => {
    if (syncTick > 0 && !modalOpen && !resetTarget && !importModalOpen) {
      void loadUsers(true);
    }
  }, [syncTick]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const openCreateModal = () => {
    setEditingUser(null);
    setFormUsername('');
    setFormNama('');
    setFormKelas('');
    setFormRole(lockedRoleFilter || 'SISWA');
    setFormStatus('ACTIVE');
    setFormPassword('');
    setError('');
    setModalOpen(true);
  };

  const openEditModal = (u: UserRecord) => {
    setEditingUser(u);
    setFormUsername(u.username);
    setFormNama(u.nama);
    setFormKelas(u.kelas);
    setFormRole(u.role);
    setFormStatus(u.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE');
    setFormPassword('');
    setError('');
    setModalOpen(true);
  };

  const handleSaveUser = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editingUser) {
        const body: Record<string, unknown> = {
          nama: formNama,
          kelas: formKelas,
          role: formRole,
          status: formStatus,
        };
        if (currentUser.role === 'SUPER_ADMIN') {
          body.username = formUsername;
          if (formPassword.trim()) {
            body.new_password = formPassword;
          }
        }
        await apiFetch(`/users/${editingUser.user_id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        showToast('Data akun berhasil diperbarui.');
      } else {
        await apiFetch('/users', {
          method: 'POST',
          body: JSON.stringify({
            username: formUsername,
            nama: formNama,
            kelas: formKelas,
            role: currentUser.role === 'PROFESSOR' ? 'SISWA' : formRole,
            password: formPassword,
          }),
        });
        showToast('Akun baru berhasil ditambahkan.');
      }
      setModalOpen(false);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan akun.');
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    try {
      await apiFetch(`/users/${resetTarget.user_id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ new_password: resetPasswordVal }),
      });
      setResetTarget(null);
      setResetPasswordVal('');
      showToast(`Password untuk ${resetTarget.username} berhasil direset.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mereset password.');
    }
  };

  const handleDeleteUser = async (u: UserRecord) => {
    try {
      await apiFetch(`/users/${u.user_id}`, { method: 'DELETE' });
      showToast(`Akun ${u.username} berhasil dihapus.`);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus akun.');
    }
  };

  const existingUsernames = useMemo(
    () => new Set(users.map((u) => u.username.toLowerCase())),
    [users],
  );

  const handleImportSubmit = async (
    validRows: ValidatedPreviewRow[],
  ): Promise<ImportSummaryResult> => {
    const payloadUsers = validRows.map((r) => ({
      _rowNumber: r.rowNumber,
      ...(r.normalizedPayload || r.mapped),
    }));
    const res = await apiFetch<ImportSummaryResult>('/users/import', {
      method: 'POST',
      body: JSON.stringify({ users: payloadUsers }),
    });
    await loadUsers();
    return res;
  };

  const filteredUsers = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      u.nama.toLowerCase().includes(q) ||
      u.kelas.toLowerCase().includes(q)
    );
  });

  const handleExportUsers = (format: 'xlsx' | 'csv') => {
    const rows = filteredUsers.map((u, idx) => ({
      No: idx + 1,
      Username: u.username,
      Nama_Lengkap: u.nama,
      Kelas_Divisi: u.kelas || '',
      Role: u.role,
      Status: u.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif',
      Dibuat_Pada: u.created_at ? new Date(u.created_at).toLocaleDateString('id-ID') : '',
    }));
    const suffix = lockedRoleFilter || roleFilter || 'Semua';
    if (format === 'csv') {
      exportRowsToCsv(`Data_Peserta_${suffix}.csv`, rows);
    } else {
      exportRowsToExcel(`Data_Peserta_${suffix}.xlsx`, 'Data_Peserta', rows);
    }
  };

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const pagedUsers = filteredUsers.slice((page - 1) * pageSize, page * pageSize);

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

      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari nama, username, atau kelas..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          {currentUser.role === 'SUPER_ADMIN' && !lockedRoleFilter && (
            <select
              aria-label="Filter role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="">Semua Role</option>
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="PROFESSOR">Professor</option>
              <option value="SISWA">Siswa</option>
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => downloadImportTemplate('USERS', 'xlsx')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Template Impor
          </button>
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Impor Excel/CSV
          </button>
          <button
            type="button"
            onClick={() => handleExportUsers('xlsx')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            Excel
          </button>
          <button
            type="button"
            onClick={() => handleExportUsers('csv')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-blue-700" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => setPrintOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Cetak Daftar
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Tambah Akun
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Nama Lengkap</th>
                <th className="px-4 py-3">Kelas / Divisi</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Memuat data pengguna...
                  </td>
                </tr>
              ) : pagedUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Tidak ada data pengguna yang cocok.
                  </td>
                </tr>
              ) : (
                pagedUsers.map((u) => (
                  <tr key={u.user_id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{u.username}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{u.nama}</td>
                    <td className="px-4 py-3 text-slate-600">{u.kelas || '—'}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-[#0F294A]">{u.role}</td>
                    <td className="px-4 py-3 text-xs">
                      <span
                        className={
                          u.status === 'ACTIVE'
                            ? 'text-emerald-700 font-medium'
                            : 'text-red-600 font-medium'
                        }
                      >
                        {u.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={`Edit ${u.nama}`}
                          onClick={() => openEditModal(u)}
                          className="p-1.5 rounded border border-slate-200 text-slate-600 hover:text-blue-700 hover:border-blue-300 cursor-pointer"
                        >
                          <UserCog className="w-3.5 h-3.5" />
                        </button>
                        {currentUser.role === 'SUPER_ADMIN' && (
                          <>
                            <button
                              type="button"
                              aria-label={`Reset password ${u.nama}`}
                              onClick={() => {
                                setResetTarget(u);
                                setResetPasswordVal('');
                              }}
                              className="p-1.5 rounded border border-slate-200 text-slate-600 hover:text-amber-700 hover:border-amber-300 cursor-pointer"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>
                            {u.user_id !== currentUser.user_id && (
                              <button
                                type="button"
                                aria-label={`Hapus ${u.nama}`}
                                onClick={() => handleDeleteUser(u)}
                                className="p-1.5 rounded border border-slate-200 text-slate-600 hover:text-red-700 hover:border-red-300 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
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

        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span>
            Menampilkan {pagedUsers.length} dari {filteredUsers.length} akun
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-2.5 py-1 rounded border border-slate-300 disabled:opacity-40 cursor-pointer"
            >
              Sebelumnya
            </button>
            <span className="font-mono">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-2.5 py-1 rounded border border-slate-300 disabled:opacity-40 cursor-pointer"
            >
              Berikutnya
            </button>
          </div>
        </div>
      </div>

      {/* Modal Create / Edit */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-[#0F294A]">
              {editingUser ? `Edit Akun: ${editingUser.username}` : 'Tambah Akun Baru'}
            </h3>
            <form onSubmit={handleSaveUser} className="space-y-3">
              {(!editingUser || currentUser.role === 'SUPER_ADMIN') && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Username</label>
                  <input
                    required
                    type="text"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap</label>
                <input
                  required
                  type="text"
                  value={formNama}
                  onChange={(e) => setFormNama(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Kelas / Divisi
                </label>
                <input
                  type="text"
                  value={formKelas}
                  onChange={(e) => setFormKelas(e.target.value)}
                  placeholder="Contoh: XI-IPA-1 atau Divisi Fisika"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              {currentUser.role === 'SUPER_ADMIN' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="SISWA">Siswa</option>
                    <option value="PROFESSOR">Professor</option>
                    <option value="SUPER_ADMIN">Super Admin</option>
                  </select>
                </div>
              )}
              {editingUser ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Status Akun</label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                    >
                      <option value="ACTIVE">Aktif</option>
                      <option value="INACTIVE">Nonaktif</option>
                    </select>
                  </div>
                  {currentUser.role === 'SUPER_ADMIN' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Password Baru (opsional, min. 6 karakter)
                      </label>
                      <input
                        type="password"
                        minLength={6}
                        value={formPassword}
                        onChange={(e) => setFormPassword(e.target.value)}
                        placeholder="Kosongkan jika tidak ingin mengganti password"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                      />
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Password Awal (min. 6 karakter)
                  </label>
                  <input
                    required
                    type="password"
                    minLength={6}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#0F294A] text-white text-sm font-semibold cursor-pointer"
                >
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-[#0F294A]">
              Reset Password: {resetTarget.nama}
            </h3>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Password Baru
                </label>
                <input
                  required
                  type="password"
                  minLength={6}
                  value={resetPasswordVal}
                  onChange={(e) => setResetPasswordVal(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 text-sm cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold cursor-pointer"
                >
                  Reset Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <SpreadsheetImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        entityType="USERS"
        title="Impor Data Peserta & Pengguna (Excel / CSV)"
        subtitle="Pratinjau data, pemetaan kolom otomatis, validasi format, dan pencegahan duplikasi username."
        existingKeys={existingUsernames}
        onImportSubmit={handleImportSubmit}
      />

      <PrintPreviewModal
        isOpen={printOpen}
        onClose={() => setPrintOpen(false)}
        documentTitle={
          lockedRoleFilter === 'SISWA'
            ? 'DAFTAR PESERTA DIDIK PORTAL CBT'
            : lockedRoleFilter === 'PROFESSOR'
              ? 'DAFTAR PEMBINA / PROFESSOR PORTAL CBT'
              : 'DAFTAR PENGGUNA PORTAL CBT'
        }
        subtitle={`Total data sesuai filter aktif: ${filteredUsers.length} akun`}
        activityName="Administrasi Peserta & Pengguna CBT KIR IPA"
        authorName={currentUser.nama}
        filePrefix="Daftar_Peserta_CBT"
        columns={[
          { key: 'no', label: 'No', align: 'center' },
          { key: 'username', label: 'Username / NIS' },
          { key: 'nama', label: 'Nama Lengkap' },
          { key: 'kelas', label: 'Kelas / Divisi' },
          { key: 'role', label: 'Role', align: 'center' },
          { key: 'status', label: 'Status', align: 'center' },
        ]}
        rows={filteredUsers.map((u, idx) => ({
          no: idx + 1,
          username: u.username,
          nama: u.nama,
          kelas: u.kelas || '—',
          role: u.role,
          status: u.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif',
        }))}
        summaryPairs={[
          { label: 'Total Ditampilkan', value: filteredUsers.length },
          { label: 'Akun Aktif', value: filteredUsers.filter((u) => u.status === 'ACTIVE').length },
          { label: 'Peserta Siswa', value: filteredUsers.filter((u) => u.role === 'SISWA').length },
          { label: 'Pembina / Admin', value: filteredUsers.filter((u) => u.role !== 'SISWA').length },
        ]}
      />
    </div>
  );
}

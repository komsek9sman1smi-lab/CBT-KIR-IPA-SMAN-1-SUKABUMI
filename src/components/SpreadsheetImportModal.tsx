import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Layers,
  Upload,
  X,
} from 'lucide-react';
import {
  IMPORT_FIELD_DEFINITIONS,
  applyMappingAndValidate,
  autoMapColumns,
  parseSpreadsheetBuffer,
  type ParsedWorkbookData,
  type ValidatedPreviewRow,
} from '../shared/spreadsheet';
import { downloadImportTemplate, exportRowsToExcel } from '../utils/exporters';
import type { ImportEntityType, ImportSummaryResult } from '../shared/types';

interface SpreadsheetImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: ImportEntityType;
  title: string;
  subtitle?: string;
  existingKeys: Set<string>;
  onImportSubmit: (
    validRows: ValidatedPreviewRow[],
    duplicateInDbRows: ValidatedPreviewRow[],
  ) => Promise<ImportSummaryResult>;
}

export function SpreadsheetImportModal({
  isOpen,
  onClose,
  entityType,
  title,
  subtitle,
  existingKeys,
  onImportSubmit,
}: SpreadsheetImportModalProps) {
  const fields = IMPORT_FIELD_DEFINITIONS[entityType];
  const [fileName, setFileName] = useState('');
  const [workbookData, setWorkbookData] = useState<ParsedWorkbookData | null>(null);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewFilter, setPreviewFilter] = useState<'ALL' | 'VALID' | 'DUPLICATE' | 'ERROR'>('ALL');
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState('');
  const [submitReport, setSubmitReport] = useState<ImportSummaryResult | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setFileName('');
      setWorkbookData(null);
      setSelectedSheet('');
      setMapping({});
      setPreviewFilter('ALL');
      setParseError('');
      setSubmitReport(null);
    }
  }, [isOpen]);

  const activeSheet = useMemo(() => {
    if (!workbookData || !selectedSheet) return null;
    return workbookData.sheets[selectedSheet] || null;
  }, [workbookData, selectedSheet]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    setSubmitReport(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseSpreadsheetBuffer(buf, file.name);
      if (parsed.sheetNames.length === 0) {
        setParseError('File tidak memiliki worksheet yang dapat dibaca.');
        return;
      }
      const firstSheetName = parsed.sheetNames[0];
      const firstSheet = parsed.sheets[firstSheetName];
      if (!firstSheet || firstSheet.rows.length === 0) {
        setParseError('Worksheet kosong atau tidak mengandung baris data.');
        return;
      }
      setFileName(file.name);
      setWorkbookData(parsed);
      setSelectedSheet(firstSheetName);
      setMapping(autoMapColumns(firstSheet.headers, entityType));
    } catch (err) {
      setParseError(
        err instanceof Error ? `Gagal membaca berkas: ${err.message}` : 'Gagal memproses berkas Excel/CSV.',
      );
    } finally {
      e.target.value = '';
    }
  };

  const handleSheetChange = (nextSheet: string) => {
    setSelectedSheet(nextSheet);
    if (workbookData?.sheets[nextSheet]) {
      setMapping(autoMapColumns(workbookData.sheets[nextSheet].headers, entityType));
    }
    setSubmitReport(null);
  };

  const validation = useMemo(() => {
    if (!activeSheet) {
      return {
        previewRows: [] as ValidatedPreviewRow[],
        validRows: [] as ValidatedPreviewRow[],
        duplicateRows: [] as ValidatedPreviewRow[],
        errorRows: [] as ValidatedPreviewRow[],
      };
    }
    return applyMappingAndValidate(activeSheet.rows, mapping, entityType, existingKeys);
  }, [activeSheet, mapping, entityType, existingKeys]);

  const missingRequiredFields = useMemo(
    () => fields.filter((f) => f.required && !mapping[f.key]),
    [fields, mapping],
  );

  const displayedRows = useMemo(() => {
    return validation.previewRows.filter((r) => {
      if (previewFilter === 'VALID') return r.status === 'VALID';
      if (previewFilter === 'DUPLICATE') {
        return r.status === 'DUPLICATE_IN_FILE' || r.status === 'DUPLICATE_IN_DB';
      }
      if (previewFilter === 'ERROR') return r.status === 'ERROR';
      return true;
    });
  }, [validation.previewRows, previewFilter]);

  const duplicateInDbRows = useMemo(
    () => validation.duplicateRows.filter((r) => r.status === 'DUPLICATE_IN_DB'),
    [validation.duplicateRows],
  );

  const canImport =
    Boolean(activeSheet) &&
    missingRequiredFields.length === 0 &&
    (validation.validRows.length > 0 ||
      (entityType === 'EXAM_QUESTIONS' && duplicateInDbRows.length > 0));

  const handleConfirmImport = async () => {
    if (!canImport) return;
    setSubmitting(true);
    setParseError('');
    try {
      const report = await onImportSubmit(validation.validRows, duplicateInDbRows);
      setSubmitReport(report);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Gagal menjalankan impor ke server.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadErrorsExcel = () => {
    const failedRows = validation.errorRows.map((err) => ({
      Baris: err.rowNumber,
      Alasan_Error: err.reason,
      ...err.mapped,
    }));
    if (failedRows.length === 0) return;
    exportRowsToExcel(`Rincian_Error_Impor_${entityType}.xlsx`, 'Baris_Gagal', failedRows);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto no-print">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-slate-50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#0F294A] text-white flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-[#0F294A] truncate">{title}</h3>
              <p className="text-xs text-slate-500 truncate">
                {subtitle || 'Mendukung Excel (.xlsx, .xls) dan CSV (UTF-8), pemetaan kolom fleksibel, dan pratinjau validasi.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Tutup modal impor"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Step 1: Download Template & Upload File */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/70 space-y-2.5">
              <div className="text-xs font-bold text-[#0F294A] flex items-center gap-1.5">
                <Download className="w-4 h-4 text-blue-700" />
                1. Unduh Template Standar Terlebih Dahulu
              </div>
              <p className="text-xs text-slate-600">
                Gunakan template resmi agar struktur kolom sesuai. Karakter khusus, simbol sains (Δ, α, °C), dan rumus KaTeX $...$ didukung penuh.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => downloadImportTemplate(entityType, 'xlsx')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                  Template Excel (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => downloadImportTemplate(entityType, 'csv')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-blue-700" />
                  Template CSV (UTF-8)
                </button>
              </div>
            </div>

            <div className="border border-dashed border-blue-300 rounded-xl p-4 bg-blue-50/30 flex flex-col justify-between gap-2.5">
              <div className="text-xs font-bold text-[#0F294A] flex items-center gap-1.5">
                <Upload className="w-4 h-4 text-blue-700" />
                2. Pilih Berkas Excel / CSV untuk Diimpor
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer">
                  <Upload className="w-4 h-4" />
                  {fileName ? 'Ganti File' : 'Pilih File (.xlsx / .xls / .csv)'}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                {fileName && (
                  <span className="text-xs font-mono text-slate-700 truncate max-w-[230px]">
                    {fileName}
                  </span>
                )}
              </div>
              {workbookData && workbookData.sheetNames.length > 1 && (
                <div className="flex items-center gap-2 text-xs">
                  <Layers className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-600">Pilih Worksheet:</span>
                  <select
                    value={selectedSheet}
                    onChange={(e) => handleSheetChange(e.target.value)}
                    className="px-2 py-1 rounded border border-slate-300 bg-white text-xs"
                  >
                    {workbookData.sheetNames.map((s) => (
                      <option key={s} value={s}>
                        {s} ({workbookData.sheets[s]?.rows.length ?? 0} baris)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {parseError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Post-Import Result Summary */}
          {submitReport && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-emerald-900 text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                Proses Impor Selesai
              </div>
              <div className="flex flex-wrap gap-4 text-emerald-900">
                <span>
                  Berhasil diimpor: <strong className="font-mono">{submitReport.imported}</strong>
                </span>
                {typeof submitReport.linked === 'number' && submitReport.linked > 0 && (
                  <span>
                    Soal bank soal ditautkan: <strong className="font-mono">{submitReport.linked}</strong>
                  </span>
                )}
                <span>
                  Duplikat dilewati: <strong className="font-mono">{submitReport.skipped_duplicates}</strong>
                </span>
                <span>
                  Gagal / ditolak: <strong className="font-mono text-red-700">{submitReport.failed_count}</strong>
                </span>
              </div>
              {submitReport.errors.length > 0 && (
                <div className="pt-2 border-t border-emerald-200 text-red-800 space-y-1">
                  <div className="font-semibold">Rincian baris bermasalah:</div>
                  <ul className="list-disc list-inside max-h-28 overflow-y-auto">
                    {submitReport.errors.map((err, i) => (
                      <li key={i}>
                        Baris {err.row}
                        {err.identifier ? ` (${err.identifier})` : ''}: {err.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Column Mapping */}
          {activeSheet && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-[#0F294A]">
                    3. Pemetaan Kolom (Urutan & Nama Kolom Fleksibel)
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Cocokkan kolom sistem dengan nama kolom pada file Anda ({activeSheet.rows.length} baris terbaca).
                  </p>
                </div>
                {missingRequiredFields.length > 0 && (
                  <span className="text-xs font-semibold text-red-700">
                    Kolom wajib belum dipetakan: {missingRequiredFields.map((f) => f.label).join(', ')}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {fields.map((f) => (
                  <div key={f.key} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <span className="font-semibold text-slate-800">
                        {f.label}
                        {f.required && <span className="text-red-600 ml-0.5">*</span>}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">{f.key}</span>
                    </div>
                    <select
                      aria-label={`Pemetaan kolom ${f.label}`}
                      value={mapping[f.key] || ''}
                      onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                      className={`w-full px-2 py-1.5 rounded border text-xs bg-white ${
                        f.required && !mapping[f.key] ? 'border-red-400' : 'border-slate-300'
                      }`}
                    >
                      <option value="">— Tidak dipetakan —</option>
                      {activeSheet.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Live Validation Preview */}
          {activeSheet && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-[#0F294A]">4. Pratinjau & Validasi Data:</span>
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('ALL')}
                    className={`px-2.5 py-1 rounded border cursor-pointer ${
                      previewFilter === 'ALL'
                        ? 'bg-[#0F294A] text-white border-[#0F294A]'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    Semua ({validation.previewRows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('VALID')}
                    className={`px-2.5 py-1 rounded border cursor-pointer ${
                      previewFilter === 'VALID'
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-emerald-800 border-emerald-300'
                    }`}
                  >
                    Siap Impor ({validation.validRows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('DUPLICATE')}
                    className={`px-2.5 py-1 rounded border cursor-pointer ${
                      previewFilter === 'DUPLICATE'
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white text-amber-800 border-amber-300'
                    }`}
                  >
                    Duplikat ({validation.duplicateRows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('ERROR')}
                    className={`px-2.5 py-1 rounded border cursor-pointer ${
                      previewFilter === 'ERROR'
                        ? 'bg-red-700 text-white border-red-700'
                        : 'bg-white text-red-700 border-red-300'
                    }`}
                  >
                    Error ({validation.errorRows.length})
                  </button>
                </div>

                {validation.errorRows.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadErrorsExcel}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-red-300 bg-white text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Unduh Daftar Error (.xlsx)
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 w-12">Baris</th>
                      <th className="px-3 py-2 w-32">Status</th>
                      <th className="px-3 py-2">
                        {entityType === 'USERS' || entityType === 'EXAM_PARTICIPANTS'
                          ? 'Username · Nama · Kelas'
                          : 'Tipe · Kategori · Pertanyaan · Kunci'}
                      </th>
                      <th className="px-3 py-2">Keterangan Validasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                          Tidak ada baris pada filter ini.
                        </td>
                      </tr>
                    ) : (
                      displayedRows.slice(0, 100).map((row) => {
                        const statusColor =
                          row.status === 'VALID'
                            ? 'text-emerald-700 font-semibold'
                            : row.status === 'ERROR'
                              ? 'text-red-700 font-semibold'
                              : 'text-amber-700 font-semibold';
                        const statusLabel =
                          row.status === 'VALID'
                            ? 'Valid'
                            : row.status === 'DUPLICATE_IN_FILE'
                              ? 'Duplikat File'
                              : row.status === 'DUPLICATE_IN_DB'
                                ? 'Sudah Ada'
                                : 'Error';

                        return (
                          <tr key={row.rowNumber} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono text-slate-500">#{row.rowNumber}</td>
                            <td className={`px-3 py-2 ${statusColor}`}>{statusLabel}</td>
                            <td className="px-3 py-2 max-w-md">
                              {entityType === 'USERS' || entityType === 'EXAM_PARTICIPANTS' ? (
                                <div>
                                  <span className="font-mono font-semibold text-[#0F294A]">
                                    {row.mapped.username || '—'}
                                  </span>{' '}
                                  · {row.mapped.nama || '—'}{' '}
                                  {row.mapped.kelas && (
                                    <span className="text-slate-500">({row.mapped.kelas})</span>
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-0.5">
                                  <div className="font-mono text-[11px] text-[#0F294A]">
                                    {row.mapped.question_type || '—'} · {row.mapped.category || 'Umum'} · Kunci:{' '}
                                    {row.mapped.correct_answer || '—'}
                                  </div>
                                  <div className="text-slate-700 truncate">
                                    {row.mapped.question_text.replace(/<[^>]+>/g, ' ') || '—'}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{row.reason}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {displayedRows.length > 100 && (
                <div className="px-4 py-2 text-[11px] text-slate-500 bg-slate-50 border-t border-slate-200">
                  Menampilkan 100 dari {displayedRows.length} baris pratinjau (seluruh baris valid akan diproses saat disimpan).
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-600">
            {activeSheet
              ? `${validation.validRows.length} baris baru valid · ${validation.duplicateRows.length} duplikat · ${validation.errorRows.length} error`
              : 'Unggah file Excel (.xlsx/.xls) atau CSV (UTF-8) untuk melihat pratinjau.'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              Tutup
            </button>
            <button
              type="button"
              disabled={!canImport || submitting}
              onClick={handleConfirmImport}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0F294A] hover:bg-blue-800 disabled:opacity-45 text-white text-xs font-semibold cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {submitting
                ? 'Mengimpor Data...'
                : entityType === 'EXAM_QUESTIONS' && duplicateInDbRows.length > 0
                  ? `Proses ${validation.validRows.length + duplicateInDbRows.length} Soal`
                  : `Impor ${validation.validRows.length} Baris Valid`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

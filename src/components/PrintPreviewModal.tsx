import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileSpreadsheet, Printer, X } from 'lucide-react';
import { AppLogo } from './AppLogo';
import {
  exportRowsToCsv,
  exportRowsToExcel,
  exportTableToPdf,
  injectDynamicPrintPageStyle,
} from '../utils/exporters';
import type { PaperOrientationOption, PaperSizeOption } from '../shared/types';

export interface PrintColumnDef {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
}

interface PrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentTitle: string;
  subtitle?: string;
  activityName?: string;
  appName?: string;
  orgName?: string;
  schoolName?: string;
  logoUrl?: string;
  authorName: string;
  columns: PrintColumnDef[];
  rows: Array<Record<string, unknown>>;
  summaryPairs?: Array<{ label: string; value: string | number }>;
  defaultPaperSize?: PaperSizeOption;
  defaultOrientation?: PaperOrientationOption;
  filePrefix?: string;
}

export function PrintPreviewModal({
  isOpen,
  onClose,
  documentTitle,
  subtitle = '',
  activityName = 'Evaluasi Akademik CBT',
  appName = 'CBT KIR IPA SMAN 1 SUKABUMI',
  orgName = 'Kelompok Ilmiah Remaja (KIR) IPA',
  schoolName = 'SMA Negeri 1 Sukabumi',
  logoUrl,
  authorName,
  columns,
  rows,
  summaryPairs = [],
  defaultPaperSize = 'A4',
  defaultOrientation = 'portrait',
  filePrefix = 'Dokumen_CBT',
}: PrintPreviewModalProps) {
  const [paperSize, setPaperSize] = useState<PaperSizeOption>(defaultPaperSize);
  const [orientation, setOrientation] = useState<PaperOrientationOption>(defaultOrientation);
  const [customTitle, setCustomTitle] = useState(documentTitle);
  const [placeAndDate, setPlaceAndDate] = useState(
    `Sukabumi, ${new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })}`,
  );
  const [signatoryRole, setSignatoryRole] = useState('Pembina / Penanggung Jawab Pelaksanaan');
  const [signatoryName, setSignatoryName] = useState(authorName);
  const [footerNote, setFooterNote] = useState(`${orgName} · ${schoolName}`);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => columns.map((c) => c.key));

  useEffect(() => {
    setCustomTitle(documentTitle);
  }, [documentTitle]);

  useEffect(() => {
    setVisibleKeys(columns.map((c) => c.key));
  }, [columns]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.classList.add('cbt-modal-print-active');
    injectDynamicPrintPageStyle(paperSize, orientation, 12);
    return () => {
      document.body.classList.remove('cbt-modal-print-active');
    };
  }, [isOpen, paperSize, orientation]);

  if (!isOpen) return null;

  const activeColumns = columns.filter((c) => visibleKeys.includes(c.key));

  const handleBrowserPrint = () => {
    injectDynamicPrintPageStyle(paperSize, orientation, 12);
    window.print();
  };

  const handleDownloadPdf = () => {
    exportTableToPdf(
      `${filePrefix}_${paperSize}.pdf`,
      {
        appName,
        orgName,
        schoolName,
        title: customTitle,
        activityName: subtitle || activityName,
        authorName,
      },
      activeColumns.map((c) => c.label),
      rows.map((r) => activeColumns.map((c) => String(r[c.key] ?? '—'))),
      {
        paperSize,
        orientation,
        footerText: footerNote,
        placeAndDate,
        signatoryName,
        signatoryRole,
      },
    );
  };

  const handleDownloadExcel = () => {
    const formatted = rows.map((r) => {
      const obj: Record<string, unknown> = {};
      for (const col of activeColumns) {
        obj[col.label] = r[col.key] ?? '';
      }
      return obj;
    });
    exportRowsToExcel(`${filePrefix}.xlsx`, 'Data_Cetak', formatted);
  };

  const handleDownloadCsv = () => {
    const formatted = rows.map((r) => {
      const obj: Record<string, unknown> = {};
      for (const col of activeColumns) {
        obj[col.label] = r[col.key] ?? '';
      }
      return obj;
    });
    exportRowsToCsv(`${filePrefix}.csv`, formatted);
  };

  const paperMaxWidthClass =
    orientation === 'landscape'
      ? paperSize === 'F4'
        ? 'max-w-[1160px]'
        : 'max-w-[1060px]'
      : paperSize === 'F4'
        ? 'max-w-[820px]'
        : 'max-w-[794px]';

  const modalContent = (
    <div className="print-modal-backdrop fixed inset-0 z-[70] bg-slate-900/70 flex items-center justify-center p-4 overflow-y-auto">
      <div className="print-modal-card bg-slate-100 border border-slate-300 rounded-2xl max-w-6xl w-full max-h-[94vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Top Toolbar (Hidden on print) */}
        <div className="no-print px-5 py-3.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Printer className="w-5 h-5 text-[#0F294A]" />
            <div>
              <h3 className="text-sm font-bold text-[#0F294A]">Pratinjau Cetak & Simpan PDF Resmi</h3>
              <p className="text-[11px] text-slate-500">
                Sesuaikan ukuran kertas ({paperSize}), orientasi ({orientation}), dan kolom tabel sebelum mencetak.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
              Excel
            </button>
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-blue-700" />
              CSV
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-700 text-blue-800 bg-blue-50 text-xs font-semibold hover:bg-blue-100 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Unduh PDF
            </button>
            <button
              type="button"
              onClick={handleBrowserPrint}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Cetak / Save PDF
            </button>
            <button
              type="button"
              aria-label="Tutup pratinjau cetak"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Settings Controls Strip (Hidden on print) */}
        <div className="no-print px-5 py-3 bg-slate-50 border-b border-slate-200 space-y-2.5 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Ukuran Kertas</label>
              <select
                aria-label="Ukuran kertas"
                value={paperSize}
                onChange={(e) => setPaperSize(e.target.value as PaperSizeOption)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
              >
                <option value="A4">A4 (210 × 297 mm)</option>
                <option value="F4">F4 / Folio (215 × 330 mm)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Orientasi</label>
              <select
                aria-label="Orientasi kertas"
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as PaperOrientationOption)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
              >
                <option value="portrait">Portrait (Tegak)</option>
                <option value="landscape">Landscape (Mendatar)</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Judul Dokumen</label>
              <input
                aria-label="Judul dokumen cetak"
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Tempat & Tanggal</label>
              <input
                aria-label="Tempat dan tanggal cetak"
                type="text"
                value={placeAndDate}
                onChange={(e) => setPlaceAndDate(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Penandatangan</label>
              <input
                aria-label="Nama penandatangan"
                type="text"
                value={signatoryName}
                onChange={(e) => setSignatoryName(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <span className="font-semibold text-slate-600">Kolom Ditampilkan:</span>
            {columns.map((col) => (
              <label key={col.key} className="inline-flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleKeys.includes(col.key)}
                  onChange={(e) => {
                    setVisibleKeys((prev) =>
                      e.target.checked
                        ? [...prev, col.key]
                        : prev.length > 1
                          ? prev.filter((k) => k !== col.key)
                          : prev,
                    );
                  }}
                />
                <span>{col.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Actual Printable Paper Surface */}
        <div className="p-4 sm:p-6 pb-10 overflow-y-auto flex-1 bg-slate-200/70">
          <div
            className={`print-sheet-surface ${paperMaxWidthClass} mx-auto bg-white border border-slate-300 shadow-sm p-6 sm:p-8 space-y-5 text-slate-900`}
          >
            {/* Official Header */}
            <div className="flex items-center gap-4 border-b-2 border-[#0F294A] pb-3.5">
              <AppLogo src={logoUrl} sizeClass="w-14 h-14" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                  {orgName} · {schoolName}
                </div>
                <h2 className="text-lg font-bold text-[#0F294A] leading-snug">{customTitle}</h2>
                <div className="text-xs text-slate-600 mt-0.5">
                  {subtitle || activityName} · Dicetak pada {new Date().toLocaleString('id-ID')}
                </div>
              </div>
            </div>

            {summaryPairs.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs print-avoid-break">
                {summaryPairs.map((pair, idx) => (
                  <div key={idx}>
                    <div className="text-[11px] text-slate-500">{pair.label}</div>
                    <div className="font-bold font-mono text-[#0F294A] text-sm">{pair.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Print-safe Table */}
            <table className="print-table w-full text-xs border border-slate-300 border-collapse">
              <thead>
                <tr className="bg-[#0F294A] text-white">
                  {activeColumns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-2.5 py-2 border border-slate-300 font-semibold ${
                        col.align === 'right'
                          ? 'text-right'
                          : col.align === 'center'
                            ? 'text-center'
                            : 'text-left'
                      }`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={Math.max(1, activeColumns.length)}
                      className="px-4 py-6 text-center text-slate-500 border border-slate-300"
                    >
                      Tidak ada baris data untuk dicetak.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, rIdx) => (
                    <tr key={rIdx} className={rIdx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                      {activeColumns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-2.5 py-1.5 border border-slate-300 align-top ${
                            col.align === 'right'
                              ? 'text-right font-mono'
                              : col.align === 'center'
                                ? 'text-center'
                                : 'text-left'
                          }`}
                        >
                          {String(r[col.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Signatory & Footer */}
            <div className="pt-4 flex flex-wrap justify-between items-end gap-4 text-xs print-avoid-break border-t border-slate-200">
              <div className="space-y-1 text-slate-500 max-w-sm">
                <input
                  type="text"
                  value={footerNote}
                  onChange={(e) => setFooterNote(e.target.value)}
                  aria-label="Catatan kaki dokumen"
                  className="no-print w-full px-2 py-1 border border-slate-200 rounded text-[11px]"
                />
                <div className="hidden print-only text-[11px]">{footerNote}</div>
              </div>

              <div className="text-right min-w-[200px]">
                <div>{placeAndDate}</div>
                <div className="text-slate-600">{signatoryRole}</div>
                <div className="mt-12 font-bold text-slate-900 underline">{signatoryName}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

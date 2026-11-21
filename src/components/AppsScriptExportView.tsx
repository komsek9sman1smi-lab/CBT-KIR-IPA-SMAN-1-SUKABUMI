import { useState } from 'react';
import { Check, Copy, Download, FileCode2, BookOpen } from 'lucide-react';
import { GAS_PROJECT_FILES } from '../gas/gasBundle';

export function AppsScriptExportView() {
  const [selectedPath, setSelectedPath] = useState(GAS_PROJECT_FILES[0].path);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const selectedFile =
    GAS_PROJECT_FILES.find((f) => f.path === selectedPath) ?? GAS_PROJECT_FILES[0];

  const handleCopy = async (text: string, path: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const handleDownloadAllBundle = () => {
    const content = GAS_PROJECT_FILES.map(
      (f) => `/* =====================================================\n * FILE: ${f.path} (${f.folder})\n * ${f.description}\n * ===================================================== */\n\n${f.content}\n\n`,
    ).join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CBT_KIR_IPA_Google_Apps_Script_Bundle.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-5">
        <div>
          <h2 className="text-xl font-bold text-[#0F294A]">
            Paket Kode Google Apps Script & Panduan Deploy
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Kode modular siap pasang untuk Google Apps Script Web App + Google Sheets (16 sheet) + Google Drive.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownloadAllBundle}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0F294A] text-white text-sm font-medium hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          Unduh Semua Berkas GAS
        </button>
      </div>

      {/* Step-by-step Deployment Guide */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-[#0F294A] font-semibold">
          <BookOpen className="w-5 h-5 text-amber-600" />
          <h3>Panduan Lengkap Penerapan di Google Apps Script & Google Sheets</h3>
        </div>
        <ol className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-700 list-decimal list-inside">
          <li className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <strong className="text-slate-900">Buat Google Spreadsheet & Project GAS:</strong> Buka Google Drive, buat Google Spreadsheet baru bernama <code className="font-mono text-xs bg-white px-1.5 py-0.5 border border-slate-200 rounded">DB_CBT_KIR_IPA_SMAN1_SUKABUMI</code>, lalu klik menu <strong>Ekstensi → Apps Script</strong>.
          </li>
          <li className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <strong className="text-slate-900">Salin Semua File Backend (.gs) & Frontend (.html):</strong> Di editor Apps Script, buat file Script (`.gs`) dan HTML (`.html`) sesuai daftar di bawah (misalnya <code className="font-mono text-xs bg-white px-1 py-0.5 border rounded">Code.gs</code>, <code className="font-mono text-xs bg-white px-1 py-0.5 border rounded">Config.gs</code>, <code className="font-mono text-xs bg-white px-1 py-0.5 border rounded">Database.gs</code>, dst.).
          </li>
          <li className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <strong className="text-slate-900">Inisialisasi 16 Sheet & Super Admin:</strong> Pilih fungsi <code className="font-mono text-xs bg-white px-1 py-0.5 border rounded">initializeDatabase</code> di toolbar editor GAS lalu klik <strong>Jalankan</strong> dan berikan izin akses Sheets/Drive. Jalankan <code className="font-mono text-xs bg-white px-1 py-0.5 border rounded">setupInitialSuperAdmin</code> sekali saja untuk membuat akun Pembina Utama.
          </li>
          <li className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <strong className="text-slate-900">Deploy sebagai Web App:</strong> Klik <strong>Deploy → New Deployment</strong>, pilih tipe <strong>Web app</strong>, atur <em>Execute as: Me</em> dan <em>Who has access: Anyone</em> (atau domain sekolah), lalu salin URL Web App untuk dibagikan ke siswa dan pengawas.
          </li>
        </ol>
      </div>

      {/* Interactive File Explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-3 max-h-[540px] overflow-y-auto space-y-1">
          {GAS_PROJECT_FILES.map((file) => {
            const active = file.path === selectedFile.path;
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#0F294A] text-white'
                    : 'hover:bg-slate-100 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileCode2 className="w-4 h-4 shrink-0" />
                  <span className="font-mono text-xs font-medium truncate">{file.path}</span>
                </div>
                <span className={`text-[11px] shrink-0 ${active ? 'text-amber-300' : 'text-slate-400'}`}>
                  {file.folder}
                </span>
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-4 bg-slate-50">
            <div className="min-w-0">
              <div className="font-mono text-sm font-semibold text-[#0F294A]">
                {selectedFile.path}
              </div>
              <p className="text-xs text-slate-600 truncate">{selectedFile.description}</p>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(selectedFile.content, selectedFile.path)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedPath === selectedFile.path ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  Tersalin
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Salin Kode
                </>
              )}
            </button>
          </div>
          <pre className="p-4 text-xs font-mono text-slate-800 bg-slate-950/5 overflow-x-auto max-h-[460px] leading-relaxed">
            <code>{selectedFile.content}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}

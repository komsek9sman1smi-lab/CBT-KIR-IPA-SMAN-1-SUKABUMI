import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  History,
  ImagePlus,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { AppLogo } from './AppLogo';
import { apiFetch } from '../utils/api';
import { exportOfficialDocumentDocx, type OfficialExportTablesData } from '../utils/docxExporter';
import {
  exportMultiSheetExcel,
  exportOfficialDocumentPdf,
  exportRowsToCsv,
  injectDynamicPrintPageStyle,
} from '../utils/exporters';
import {
  AVAILABLE_TEMPLATE_VARIABLES,
  createDefaultTemplatePayload,
  interpolateTemplateVariables,
} from '../shared/documentTemplates';
import { safeJsonParse, type RankedLeaderboardEntry } from '../shared/grading';
import type {
  AppSettingsMap,
  DocumentCategory,
  DocumentContentPayload,
  DocumentSectionItem,
  DocumentSectionKind,
  DocumentSignatoryItem,
  DocumentWinnerRow,
  ExamRecord,
  OfficialDocumentRecord,
  PaperOrientationOption,
  PaperSizeOption,
  ReportTemplateRecord,
  UserRecord,
} from '../shared/types';

interface OfficialDocumentStudioProps {
  config: Partial<AppSettingsMap>;
  currentUser: UserRecord;
  syncTick?: number;
}

interface LiveContextResponse {
  exam: ExamRecord;
  max_score: number;
  passing_grade: number;
  variables: Record<string, string>;
  summary: {
    registered: number;
    present: number;
    absent: number;
    finished: number;
    technical_issues: number;
    highest_score: number;
    lowest_score: number;
    average_score: number;
    passed_count: number;
    violations_count: number;
    supervisor_name: string;
  };
  results: Array<Record<string, unknown>>;
  leaderboard: RankedLeaderboardEntry[];
  winners: DocumentWinnerRow[];
  violations: Array<Record<string, unknown>>;
}

type StudioTab = 'LAPORAN_HASIL' | 'BERITA_ACARA' | 'PENGUMUMAN_PEMENANG' | 'HISTORY';
type EditorPanelTab = 'kop' | 'sections' | 'winners' | 'signatories';

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  LAPORAN_HASIL: 'Laporan Hasil Ujian',
  BERITA_ACARA: 'Berita Acara Ujian',
  PENGUMUMAN_PEMENANG: 'Pengumuman Pemenang',
};

const FONT_CLASS_MAP: Record<DocumentContentPayload['typography']['fontFamily'], string> = {
  sans: 'font-sans',
  serif: 'font-serif',
  times: 'font-serif',
  georgia: 'font-serif',
  mono: 'font-mono',
};

const FONT_FAMILY_STYLE: Record<DocumentContentPayload['typography']['fontFamily'], string> = {
  sans: "'DM Sans', system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  times: "'Times New Roman', Times, serif",
  georgia: "Georgia, serif",
  mono: "'JetBrains Mono', monospace",
};

export function OfficialDocumentStudio({ config, syncTick = 0 }: OfficialDocumentStudioProps) {
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [activeTab, setActiveTab] = useState<StudioTab>('LAPORAN_HASIL');
  const [editorTab, setEditorTab] = useState<EditorPanelTab>('kop');

  const [templates, setTemplates] = useState<ReportTemplateRecord[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [documents, setDocuments] = useState<OfficialDocumentRecord[]>([]);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [docStatus, setDocStatus] = useState<'DRAFT' | 'PUBLISHED'>('DRAFT');

  const [liveCtx, setLiveCtx] = useState<LiveContextResponse | null>(null);
  const [payload, setPayload] = useState<DocumentContentPayload>(() =>
    createDefaultTemplatePayload('LAPORAN_HASIL', config),
  );
  const [activeSectionId, setActiveSectionId] = useState<string>('');

  // Template save-as prompt state (inline UI, no window.prompt/alert)
  const [newTplNameInput, setNewTplNameInput] = useState('');
  const [showNewTplForm, setShowNewTplForm] = useState(false);
  const [confirmRestoreDefaults, setConfirmRestoreDefaults] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const activeCategory: DocumentCategory =
    activeTab === 'HISTORY' ? 'LAPORAN_HASIL' : activeTab;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const loadInitialLists = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [eRes, tRes, dRes] = await Promise.all([
        apiFetch<{ exams: ExamRecord[] }>('/exams'),
        apiFetch<{ templates: ReportTemplateRecord[] }>('/report-templates'),
        apiFetch<{ documents: OfficialDocumentRecord[] }>('/official-documents'),
      ]);
      setExams(eRes.exams);
      setTemplates(tRes.templates);
      setDocuments(dRes.documents);

      const pref = eRes.exams.find((e) => e.status === 'COMPLETED') || eRes.exams[0];
      if (pref) {
        setSelectedExamId((prev) => prev || pref.exam_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data laporan & template.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitialLists();
  }, [loadInitialLists]);

  const loadLiveContext = useCallback(async (examId: string) => {
    if (!examId) return;
    try {
      const ctx = await apiFetch<LiveContextResponse>(`/reports/${examId}/live-context`);
      setLiveCtx(ctx);
      setPayload((prev) => ({
        ...prev,
        winnerRows: prev.winnerRows.length > 0 ? prev.winnerRows : ctx.winners,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyinkronkan data aktual ujian.');
    }
  }, []);

  useEffect(() => {
    if (selectedExamId) {
      void loadLiveContext(selectedExamId);
    }
  }, [selectedExamId, loadLiveContext]);

  useEffect(() => {
    if (syncTick > 0) {
      void loadInitialLists(true);
      if (selectedExamId) {
        void loadLiveContext(selectedExamId);
      }
    }
  }, [syncTick, selectedExamId, loadInitialLists, loadLiveContext]);

  const categoryTemplates = useMemo(
    () => templates.filter((t) => t.doc_category === activeCategory),
    [templates, activeCategory],
  );

  // Switch active template automatically when switching category (unless currently editing a loaded doc of same category)
  const applyTemplateById = useCallback(
    (tpl: ReportTemplateRecord, syncedWinners?: DocumentWinnerRow[]) => {
      const fallback = createDefaultTemplatePayload(tpl.doc_category, config);
      const parsed = safeJsonParse<DocumentContentPayload>(tpl.content_json, fallback);
      setSelectedTemplateId(tpl.template_id);
      setEditingDocId(null);
      setDocStatus('DRAFT');
      setPayload({
        ...fallback,
        ...parsed,
        winnerRows:
          parsed.winnerRows && parsed.winnerRows.length > 0
            ? parsed.winnerRows
            : syncedWinners ?? liveCtx?.winners ?? [],
      });
      setActiveSectionId(parsed.sections?.[0]?.id || fallback.sections[0]?.id || '');
    },
    [config, liveCtx?.winners],
  );

  useEffect(() => {
    if (activeTab === 'HISTORY') return;
    if (categoryTemplates.length === 0) {
      const def = createDefaultTemplatePayload(activeCategory, config);
      setPayload({ ...def, winnerRows: liveCtx?.winners ?? [] });
      setActiveSectionId(def.sections[0]?.id || '');
      return;
    }
    const assignedForExam = categoryTemplates.find((t) => t.exam_id === selectedExamId);
    const currentStillValid = categoryTemplates.find((t) => t.template_id === selectedTemplateId);
    if (!editingDocId && !currentStillValid) {
      const chosen = assignedForExam || categoryTemplates[0];
      if (chosen) applyTemplateById(chosen, liveCtx?.winners);
    }
  }, [
    activeTab,
    activeCategory,
    categoryTemplates,
    selectedExamId,
    selectedTemplateId,
    editingDocId,
    applyTemplateById,
    config,
    liveCtx?.winners,
  ]);

  // Keep dynamic @page CSS synced with selected Paper Size & Orientation
  useEffect(() => {
    injectDynamicPrintPageStyle(
      payload.page.paperSize,
      payload.page.orientation,
      payload.page.marginMm,
    );
  }, [payload.page.paperSize, payload.page.orientation, payload.page.marginMm]);

  const vars = useMemo<Record<string, string>>(() => {
    const base = liveCtx?.variables ?? {};
    return {
      ...base,
      doc_number: payload.meta.docNumber || '',
      place_city: payload.meta.placeAndDate.split(',')[0]?.trim() || 'Sukabumi',
    };
  }, [liveCtx?.variables, payload.meta.docNumber, payload.meta.placeAndDate]);

  const tablesData: OfficialExportTablesData = useMemo(() => {
    const maxScore = liveCtx?.max_score || 100;
    const passingGrade = liveCtx?.passing_grade ?? 75;
    const resultsRows = (liveCtx?.results ?? []).map((r, i) => {
      const score = Number(r.total_score || 0);
      const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
      return {
        rank: i + 1,
        nama: String(r.nama || '—'),
        kelas: String(r.kelas || '—'),
        correct_count: Number(r.correct_count || 0),
        incorrect_count: Number(r.incorrect_count || 0),
        unanswered_count: Number(r.unanswered_count || 0),
        total_score: score,
        max_score: maxScore,
        percentage: pct,
        passed: pct >= passingGrade,
      };
    });
    const violationRows = (liveCtx?.violations ?? []).map((v) => ({
      nama: String(v.nama || '—'),
      event_type: String(v.event_type || ''),
      description: String(v.description || ''),
      event_time: String(v.event_time || ''),
    }));
    return { resultsRows, violationRows };
  }, [liveCtx]);

  const t = (str: string) => interpolateTemplateVariables(str, vars);

  // Template CRUD Handlers
  const handleUpdateCurrentTemplate = async () => {
    const tpl = templates.find((item) => item.template_id === selectedTemplateId);
    if (!tpl) {
      setShowNewTplForm(true);
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/report-templates/${tpl.template_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: tpl.name,
          content: payload,
        }),
      });
      const res = await apiFetch<{ templates: ReportTemplateRecord[] }>('/report-templates');
      setTemplates(res.templates);
      showToast(`Template "${tpl.name}" berhasil diperbarui.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui template.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAsNewTemplate = async () => {
    const cleanName = newTplNameInput.trim();
    if (!cleanName) {
      setError('Masukkan nama template baru.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ template: ReportTemplateRecord }>('/report-templates', {
        method: 'POST',
        body: JSON.stringify({
          name: cleanName,
          doc_category: activeCategory,
          exam_id: '',
          content: payload,
        }),
      });
      const list = await apiFetch<{ templates: ReportTemplateRecord[] }>('/report-templates');
      setTemplates(list.templates);
      setSelectedTemplateId(res.template.template_id);
      setNewTplNameInput('');
      setShowNewTplForm(false);
      showToast(`Template baru "${cleanName}" berhasil disimpan.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan template baru.');
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicateTemplate = async () => {
    if (!selectedTemplateId) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ template: ReportTemplateRecord }>(
        `/report-templates/${selectedTemplateId}/duplicate`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      const list = await apiFetch<{ templates: ReportTemplateRecord[] }>('/report-templates');
      setTemplates(list.templates);
      applyTemplateById(res.template);
      showToast('Template berhasil diduplikasi.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menduplikasi template.');
    } finally {
      setBusy(false);
    }
  };

  const handleAssignTemplateToExam = async () => {
    if (!selectedTemplateId || !selectedExamId) return;
    setBusy(true);
    try {
      await apiFetch(`/report-templates/${selectedTemplateId}`, {
        method: 'PUT',
        body: JSON.stringify({ exam_id: selectedExamId, content: payload }),
      });
      const list = await apiFetch<{ templates: ReportTemplateRecord[] }>('/report-templates');
      setTemplates(list.templates);
      showToast('Template ditetapkan sebagai format utama untuk ujian terpilih.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menetapkan template ke ujian.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId) return;
    setBusy(true);
    try {
      await apiFetch(`/report-templates/${selectedTemplateId}`, { method: 'DELETE' });
      const list = await apiFetch<{ templates: ReportTemplateRecord[] }>('/report-templates');
      setTemplates(list.templates);
      const next = list.templates.find((x) => x.doc_category === activeCategory);
      if (next) applyTemplateById(next);
      showToast('Template berhasil dihapus.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus template.');
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreDefaults = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ templates: ReportTemplateRecord[] }>(
        '/report-templates/restore-defaults',
        { method: 'POST' },
      );
      setTemplates(res.templates);
      const def = res.templates.find((x) => x.doc_category === activeCategory && x.is_default === 1);
      if (def) applyTemplateById(def);
      setConfirmRestoreDefaults(false);
      showToast('Template standar default berhasil dipulihkan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memulihkan template default.');
    } finally {
      setBusy(false);
    }
  };

  // Official Document CRUD Handlers (Save Draft / Publish / Duplicate / Delete / Load)
  const handleSaveOfficialDocument = async (nextStatus: 'DRAFT' | 'PUBLISHED') => {
    setBusy(true);
    setError('');
    try {
      const resolvedTitle = t(payload.meta.title).trim() || CATEGORY_LABELS[activeCategory];
      const resolvedNumber = t(payload.meta.docNumber).trim();
      if (editingDocId) {
        await apiFetch(`/official-documents/${editingDocId}`, {
          method: 'PUT',
          body: JSON.stringify({
            exam_id: selectedExamId,
            template_id: selectedTemplateId,
            title: resolvedTitle,
            doc_number: resolvedNumber,
            status: nextStatus,
            content: payload,
          }),
        });
        setDocStatus(nextStatus);
        showToast(
          nextStatus === 'PUBLISHED'
            ? 'Dokumen resmi berhasil dipublikasikan & disimpan.'
            : 'Perubahan draft dokumen berhasil disimpan.',
        );
      } else {
        const res = await apiFetch<{ document: OfficialDocumentRecord }>('/official-documents', {
          method: 'POST',
          body: JSON.stringify({
            exam_id: selectedExamId,
            template_id: selectedTemplateId,
            doc_category: activeCategory,
            title: resolvedTitle,
            doc_number: resolvedNumber,
            status: nextStatus,
            content: payload,
          }),
        });
        setEditingDocId(res.document.doc_id);
        setDocStatus(nextStatus);
        showToast(
          nextStatus === 'PUBLISHED'
            ? 'Dokumen resmi baru diterbitkan & disimpan ke riwayat.'
            : 'Dokumen baru disimpan sebagai Draft.',
        );
      }
      const docsRes = await apiFetch<{ documents: OfficialDocumentRecord[] }>('/official-documents');
      setDocuments(docsRes.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan dokumen.');
    } finally {
      setBusy(false);
    }
  };

  const handleLoadDocumentToEditor = async (doc: OfficialDocumentRecord) => {
    const fallback = createDefaultTemplatePayload(doc.doc_category, config);
    const parsed = safeJsonParse<DocumentContentPayload>(doc.content_json, fallback);
    if (doc.exam_id) {
      setSelectedExamId(doc.exam_id);
    }
    setActiveTab(doc.doc_category);
    setEditingDocId(doc.doc_id);
    setSelectedTemplateId(doc.template_id);
    setDocStatus(doc.status);
    setPayload({ ...fallback, ...parsed });
    setActiveSectionId(parsed.sections?.[0]?.id || '');
    showToast(`Dokumen "${doc.title}" dimuat ke editor.`);
  };

  const handleDuplicateDocument = async (docId: string) => {
    setBusy(true);
    try {
      const res = await apiFetch<{ document: OfficialDocumentRecord }>(
        `/official-documents/${docId}/duplicate`,
        { method: 'POST' },
      );
      const docsRes = await apiFetch<{ documents: OfficialDocumentRecord[] }>('/official-documents');
      setDocuments(docsRes.documents);
      await handleLoadDocumentToEditor(res.document);
      showToast('Dokumen berhasil diduplikasi sebagai Draft baru.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menduplikasi dokumen.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    setBusy(true);
    try {
      await apiFetch(`/official-documents/${docId}`, { method: 'DELETE' });
      const docsRes = await apiFetch<{ documents: OfficialDocumentRecord[] }>('/official-documents');
      setDocuments(docsRes.documents);
      if (editingDocId === docId) setEditingDocId(null);
      showToast('Dokumen dihapus dari riwayat.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus dokumen.');
    } finally {
      setBusy(false);
    }
  };

  // Export Actions
  const handleDownloadPdf = async () => {
    setBusy(true);
    try {
      const prefix =
        activeCategory === 'BERITA_ACARA'
          ? 'Berita_Acara'
          : activeCategory === 'PENGUMUMAN_PEMENANG'
            ? 'Pengumuman_Pemenang'
            : 'Laporan_Hasil';
      await exportOfficialDocumentPdf(
        `${prefix}_${selectedExamId || 'CBT'}.pdf`,
        payload,
        vars,
        tablesData,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat file PDF.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadDocx = async () => {
    setBusy(true);
    try {
      const prefix =
        activeCategory === 'BERITA_ACARA'
          ? 'Berita_Acara'
          : activeCategory === 'PENGUMUMAN_PEMENANG'
            ? 'Pengumuman_Pemenang'
            : 'Laporan_Hasil';
      await exportOfficialDocumentDocx(
        `${prefix}_${selectedExamId || 'CBT'}.docx`,
        payload,
        vars,
        tablesData,
      );
      showToast('Dokumen Microsoft Word (.docx) berhasil diunduh.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat dokumen Word (.docx).');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadExcel = () => {
    const sheets = [
      {
        name: 'Ringkasan_Ujian',
        rows: [
          { Indikator: 'Nama Ujian', Nilai: vars.nama_ujian || '' },
          { Indikator: 'Tanggal Pelaksanaan', Nilai: vars.tanggal_pelaksanaan || '' },
          { Indikator: 'Peserta Terdaftar', Nilai: Number(vars.jumlah_peserta || 0) },
          { Indikator: 'Peserta Hadir', Nilai: Number(vars.peserta_hadir || 0) },
          { Indikator: 'Tidak Hadir', Nilai: Number(vars.peserta_tidak_hadir || 0) },
          { Indikator: 'Peserta Selesai', Nilai: Number(vars.peserta_selesai || 0) },
          { Indikator: 'Nilai Tertinggi', Nilai: Number(vars.nilai_tertinggi || 0) },
          { Indikator: 'Nilai Terendah', Nilai: Number(vars.nilai_terendah || 0) },
          { Indikator: 'Nilai Rata-rata', Nilai: Number(vars.nilai_rata_rata || 0) },
          { Indikator: 'Total Pelanggaran', Nilai: Number(vars.total_pelanggaran || 0) },
        ],
      },
      {
        name: 'Daftar_Nilai',
        rows: tablesData.resultsRows.map((r, i) => ({
          No: i + 1,
          Nama_Peserta: r.nama,
          Kelas: r.kelas,
          Benar: r.correct_count,
          Salah: r.incorrect_count,
          Kosong: r.unanswered_count,
          Nilai_Akhir: r.total_score,
          Nilai_Maksimal: r.max_score,
          Persentase: `${r.percentage.toFixed(1)}%`,
          Status: r.passed ? 'Lulus' : 'Pembinaan',
        })),
      },
      {
        name: 'Daftar_Pemenang',
        rows: payload.winnerRows.map((w) => ({
          Peringkat: w.rank,
          Nama_Peserta: w.nama,
          Kelas: w.kelas,
          Nilai: w.total_score,
          Persentase: `${w.percentage}%`,
          Kategori_Juara: w.kategori_juara,
          Keterangan: w.keterangan || '',
        })),
      },
    ];
    exportMultiSheetExcel(`Dokumen_Hasil_${selectedExamId || 'CBT'}.xlsx`, sheets);
  };

  const handleDownloadCsv = () => {
    const rows =
      activeCategory === 'PENGUMUMAN_PEMENANG' || payload.winnerRows.length > 0
        ? payload.winnerRows.map((w) => ({
            Peringkat: w.rank,
            Nama_Peserta: w.nama,
            Kelas: w.kelas,
            Nilai: w.total_score,
            Persentase: `${w.percentage}%`,
            Kategori_Juara: w.kategori_juara,
            Keterangan: w.keterangan || '',
          }))
        : tablesData.resultsRows.map((r, i) => ({
            No: i + 1,
            Nama_Peserta: r.nama,
            Kelas: r.kelas,
            Nilai_Akhir: r.total_score,
            Persentase: `${r.percentage.toFixed(1)}%`,
            Status: r.passed ? 'Lulus' : 'Pembinaan',
          }));
    exportRowsToCsv(`Rekap_${activeCategory}_${selectedExamId || 'CBT'}.csv`, rows);
  };

  // Section manipulation helpers
  const updateSection = (secId: string, patch: Partial<DocumentSectionItem>) => {
    setPayload((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === secId ? { ...s, ...patch } : s)),
    }));
  };

  const addSection = (kind: DocumentSectionKind) => {
    const newId = `sec_${Date.now().toString(36)}`;
    const defaultTitles: Record<DocumentSectionKind, string> = {
      heading: 'Subjudul Bagian Baru',
      paragraph: 'Paragraf Keterangan Baru',
      info_grid: 'Tabel Identitas Kegiatan',
      stats_cards: 'Ringkasan Statistik Ujian',
      results_table: 'Tabel Nilai & Evaluasi Peserta',
      winners_table: 'Tabel Daftar Pemenang',
      violations_table: 'Tabel Rekapitulasi Pelanggaran',
      notes: 'Catatan & Ketentuan Tambahan',
      divider: '',
    };
    const newSec: DocumentSectionItem = {
      id: newId,
      kind,
      title: defaultTitles[kind],
      content:
        kind === 'paragraph' || kind === 'notes'
          ? 'Tuliskan uraian atau catatan di sini. Gunakan variabel seperti {{nama_ujian}} atau {{nilai_rata_rata}} bila diperlukan.'
          : '',
      visible: true,
      align: kind === 'paragraph' ? 'justify' : 'left',
      infoRows:
        kind === 'info_grid'
          ? [
              { label: 'Nama Kegiatan', value: '{{nama_kegiatan}}' },
              { label: 'Tanggal Pelaksanaan', value: '{{tanggal_pelaksanaan}}' },
            ]
          : undefined,
    };
    setPayload((prev) => ({ ...prev, sections: [...prev.sections, newSec] }));
    setActiveSectionId(newId);
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= payload.sections.length) return;
    setPayload((prev) => {
      const next = [...prev.sections];
      const temp = next[idx];
      next[idx] = next[target];
      next[target] = temp;
      return { ...prev, sections: next };
    });
  };

  const removeSection = (secId: string) => {
    setPayload((prev) => ({
      ...prev,
      sections: prev.sections.filter((s) => s.id !== secId),
    }));
  };

  const insertVariableIntoActiveSection = (varKey: string) => {
    const targetId = activeSectionId || payload.sections.find((s) => s.kind === 'paragraph' || s.kind === 'notes')?.id;
    if (!targetId) return;
    const sec = payload.sections.find((s) => s.id === targetId);
    if (!sec) return;
    updateSection(targetId, {
      content: `${sec.content}${sec.content && !sec.content.endsWith(' ') ? ' ' : ''}{{${varKey}}}`,
    });
  };

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPayload((prev) => ({
          ...prev,
          letterhead: { ...prev.letterhead, logoUrl: reader.result as string, showLogo: true },
        }));
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSyncWinnersFromLiveDb = () => {
    if (!liveCtx) return;
    setPayload((prev) => ({
      ...prev,
      winnerRows: liveCtx.winners,
    }));
    showToast(`Disinkronkan ${liveCtx.winners.length} peringkat aktual dari database.`);
  };

  const updateSignatory = (id: string, patch: Partial<DocumentSignatoryItem>) => {
    setPayload((prev) => ({
      ...prev,
      signatories: prev.signatories.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const paperMaxWidthClass =
    payload.page.orientation === 'landscape'
      ? payload.page.paperSize === 'F4'
        ? 'max-w-[1120px]'
        : 'max-w-[1040px]'
      : payload.page.paperSize === 'F4'
        ? 'max-w-[815px]'
        : 'max-w-[794px]';

  return (
    <div className="space-y-4">
      {toast && (
        <div className="no-print p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs sm:text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{toast}</span>
        </div>
      )}
      {error && (
        <div className="no-print p-3 rounded-lg bg-red-50 border border-red-200 text-xs sm:text-sm text-red-700 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-xs underline cursor-pointer">
            Tutup
          </button>
        </div>
      )}

      {/* Top Studio Bar */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Document Category Mode Selector */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(['LAPORAN_HASIL', 'BERITA_ACARA', 'PENGUMUMAN_PEMENANG'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setEditingDocId(null);
                  setSelectedTemplateId('');
                  setActiveTab(cat);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                  activeTab === cat
                    ? 'bg-[#0F294A] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActiveTab('HISTORY')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === 'HISTORY'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              Riwayat Dokumen ({documents.length})
            </button>
          </div>

          {/* Exam Context Selector */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Pilih ujian sumber data"
              value={selectedExamId}
              onChange={(e) => setSelectedExamId(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium bg-white min-w-[230px]"
            >
              {exams.map((ex) => (
                <option key={ex.exam_id} value={ex.exam_id}>
                  {ex.title} ({ex.status})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedExamId}
              onClick={() => void loadLiveContext(selectedExamId)}
              title="Ambil angka dan peringkat terbaru langsung dari database"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Sinkron DB
            </button>
          </div>
        </div>

        {/* Action & Export Strip */}
        {activeTab !== 'HISTORY' && (
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5">
            {/* Template Selector & Management */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-slate-600">Template:</span>
              <select
                aria-label="Pilih template dokumen"
                value={selectedTemplateId}
                onChange={(e) => {
                  const chosen = templates.find((item) => item.template_id === e.target.value);
                  if (chosen) applyTemplateById(chosen);
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white max-w-[210px]"
              >
                {categoryTemplates.map((tpl) => (
                  <option key={tpl.template_id} value={tpl.template_id}>
                    {tpl.name}
                    {tpl.exam_id === selectedExamId ? ' ★' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={handleUpdateCurrentTemplate}
                title="Simpan perubahan ke template yang sedang dipilih"
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Simpan Template
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowNewTplForm((v) => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-300 text-blue-800 bg-blue-50 hover:bg-blue-100 cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                Template Baru
              </button>
              <button
                type="button"
                disabled={busy || !selectedTemplateId}
                onClick={handleDuplicateTemplate}
                title="Duplikasi template"
                className="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={busy || !selectedTemplateId}
                onClick={handleAssignTemplateToExam}
                title="Jadikan template default untuk ujian ini"
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Set Ujian Ini
              </button>
              <button
                type="button"
                disabled={busy || categoryTemplates.length <= 1}
                onClick={handleDeleteTemplate}
                title="Hapus template terpilih"
                className="p-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              {!confirmRestoreDefaults ? (
                <button
                  type="button"
                  onClick={() => setConfirmRestoreDefaults(true)}
                  title="Pulihkan 3 template default bawaan"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Default
                </button>
              ) : (
                <div className="inline-flex items-center gap-1 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1">
                  <span className="text-[11px] text-amber-900">Pulihkan?</span>
                  <button
                    type="button"
                    onClick={handleRestoreDefaults}
                    className="px-2 py-0.5 rounded bg-amber-700 text-white text-[11px] font-semibold cursor-pointer"
                  >
                    Ya
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRestoreDefaults(false)}
                    className="px-1.5 py-0.5 text-[11px] text-slate-600 cursor-pointer"
                  >
                    Batal
                  </button>
                </div>
              )}
            </div>

            {/* Save Document & Download Outputs */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSaveOfficialDocument('DRAFT')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium hover:bg-slate-50 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                Simpan Draft
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSaveOfficialDocument('PUBLISHED')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Publikasikan
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleDownloadExcel}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                Excel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleDownloadCsv}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                CSV
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDownloadDocx()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-blue-700 text-blue-800 bg-blue-50 hover:bg-blue-100 font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Word (.docx)
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDownloadPdf()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#0F294A] text-[#0F294A] bg-white hover:bg-slate-100 font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                PDF
              </button>
              <button
                type="button"
                onClick={() => {
                  injectDynamicPrintPageStyle(
                    payload.page.paperSize,
                    payload.page.orientation,
                    payload.page.marginMm,
                  );
                  window.print();
                }}
                className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white font-semibold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Cetak / PDF Browser
              </button>
            </div>
          </div>
        )}

        {showNewTplForm && (
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <input
              type="text"
              value={newTplNameInput}
              onChange={(e) => setNewTplNameInput(e.target.value)}
              placeholder="Nama template baru (mis. Berita Acara OSN Kota Sukabumi)"
              className="flex-1 min-w-[260px] px-3 py-1.5 rounded-lg border border-slate-300"
            />
            <button
              type="button"
              disabled={busy}
              onClick={handleSaveAsNewTemplate}
              className="px-3.5 py-1.5 rounded-lg bg-[#0F294A] text-white font-semibold cursor-pointer"
            >
              Simpan Sebagai Template Baru
            </button>
            <button
              type="button"
              onClick={() => setShowNewTplForm(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 cursor-pointer"
            >
              Batal
            </button>
          </div>
        )}
      </div>

      {/* HISTORY VIEW */}
      {activeTab === 'HISTORY' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden no-print">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#0F294A]">
                Riwayat Dokumen Tersimpan (Laporan, Berita Acara, Pengumuman Pemenang)
              </h3>
              <p className="text-xs text-slate-500">
                Buka kembali untuk mengedit, menduplikasi, mengubah status Draft/Terpublikasi, atau mencetak ulang.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="px-4 py-3">Kategori & Nomor Surat</th>
                  <th className="px-4 py-3">Judul Dokumen</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Diperbarui</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      Belum ada dokumen tersimpan. Buat atau edit dokumen lalu klik Simpan Draft atau Publikasikan.
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => (
                    <tr key={doc.doc_id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#0F294A]">
                          {CATEGORY_LABELS[doc.doc_category]}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {doc.doc_number || 'Tanpa nomor surat'}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{doc.title}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded font-semibold ${
                            doc.status === 'PUBLISHED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {doc.status === 'PUBLISHED' ? 'Terpublikasi' : 'Draft'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-500">
                        {new Date(doc.updated_at).toLocaleString('id-ID')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleLoadDocumentToEditor(doc)}
                            className="px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            Buka / Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDuplicateDocument(doc.doc_id)}
                            className="p-1.5 rounded border border-slate-300 text-slate-600 hover:text-blue-700 cursor-pointer"
                            title="Duplikasi dokumen"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteDocument(doc.doc_id)}
                            className="p-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
                            title="Hapus dokumen"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          Memuat editor dokumen dan data ujian...
        </div>
      ) : (
        /* MAIN SPLIT EDITOR + LIVE PREVIEW CANVAS */
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* LEFT PANEL: FULL FORMAT & CONTENT EDITOR (Hidden on Print) */}
          <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden no-print">
            {/* Editing status indicator */}
            {editingDocId && (
              <div className="px-4 py-2 bg-blue-50 border-b border-blue-200 flex items-center justify-between text-xs text-blue-900">
                <span>
                  Mengedit Dokumen Tersimpan · Status:{' '}
                  <strong>{docStatus === 'PUBLISHED' ? 'Terpublikasi' : 'Draft'}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setEditingDocId(null)}
                  className="underline font-medium cursor-pointer"
                >
                  Dokumen Baru
                </button>
              </div>
            )}

            {/* Sub-Tabs */}
            <div className="grid grid-cols-4 border-b border-slate-200 bg-slate-50 text-xs font-semibold">
              {[
                { id: 'kop', label: 'Kop & Surat' },
                { id: 'sections', label: 'Isi & Bagian' },
                { id: 'winners', label: 'Pemenang' },
                { id: 'signatories', label: 'TTD & Kertas' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setEditorTab(tab.id as EditorPanelTab)}
                  className={`py-2.5 px-2 text-center border-b-2 transition-colors cursor-pointer ${
                    editorTab === tab.id
                      ? 'border-[#0F294A] text-[#0F294A] bg-white'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-4 space-y-4 max-h-[74vh] overflow-y-auto text-xs">
              {editorTab === 'kop' && (
                <div className="space-y-3">
                  <div className="font-bold text-[#0F294A]">Kop Surat & Logo Instansi</div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={payload.letterhead.showLogo}
                        onChange={(e) =>
                          setPayload((p) => ({
                            ...p,
                            letterhead: { ...p.letterhead, showLogo: e.target.checked },
                          }))
                        }
                      />
                      Tampilkan Logo
                    </label>
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer">
                      <ImagePlus className="w-3.5 h-3.5" />
                      Upload Logo
                      <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                    </label>
                    <select
                      aria-label="Gaya garis kop surat"
                      value={payload.letterhead.borderStyle}
                      onChange={(e) =>
                        setPayload((p) => ({
                          ...p,
                          letterhead: {
                            ...p.letterhead,
                            borderStyle: e.target.value as 'double' | 'solid' | 'none',
                          },
                        }))
                      }
                      className="px-2 py-1.5 rounded border border-slate-300 bg-white"
                    >
                      <option value="double">Garis Kop Ganda</option>
                      <option value="solid">Garis Kop Tunggal</option>
                      <option value="none">Tanpa Garis Kop</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Instansi Baris 1</label>
                    <input
                      type="text"
                      value={payload.letterhead.orgLine1}
                      onChange={(e) =>
                        setPayload((p) => ({
                          ...p,
                          letterhead: { ...p.letterhead, orgLine1: e.target.value },
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Penyelenggara / Organisasi</label>
                    <input
                      type="text"
                      value={payload.letterhead.orgLine2}
                      onChange={(e) =>
                        setPayload((p) => ({
                          ...p,
                          letterhead: { ...p.letterhead, orgLine2: e.target.value },
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Nama Sekolah / Lembaga</label>
                    <input
                      type="text"
                      value={payload.letterhead.institutionName}
                      onChange={(e) =>
                        setPayload((p) => ({
                          ...p,
                          letterhead: { ...p.letterhead, institutionName: e.target.value },
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">Alamat</label>
                      <input
                        type="text"
                        value={payload.letterhead.addressLine}
                        onChange={(e) =>
                          setPayload((p) => ({
                            ...p,
                            letterhead: { ...p.letterhead, addressLine: e.target.value },
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">Kontak / Email</label>
                      <input
                        type="text"
                        value={payload.letterhead.contactLine}
                        onChange={(e) =>
                          setPayload((p) => ({
                            ...p,
                            letterhead: { ...p.letterhead, contactLine: e.target.value },
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200 font-bold text-[#0F294A]">
                    Identitas & Judul Dokumen
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Judul Utama Dokumen</label>
                    <input
                      type="text"
                      value={payload.meta.title}
                      onChange={(e) =>
                        setPayload((p) => ({ ...p, meta: { ...p.meta, title: e.target.value } }))
                      }
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-semibold"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">Nomor Surat / Dokumen</label>
                      <input
                        type="text"
                        value={payload.meta.docNumber}
                        onChange={(e) =>
                          setPayload((p) => ({ ...p, meta: { ...p.meta, docNumber: e.target.value } }))
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">Tempat & Tanggal Terbit</label>
                      <input
                        type="text"
                        value={payload.meta.placeAndDate}
                        onChange={(e) =>
                          setPayload((p) => ({ ...p, meta: { ...p.meta, placeAndDate: e.target.value } }))
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Subjudul / Nama Kegiatan</label>
                    <input
                      type="text"
                      value={payload.meta.subtitle}
                      onChange={(e) =>
                        setPayload((p) => ({ ...p, meta: { ...p.meta, subtitle: e.target.value } }))
                      }
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Header & Footer Dokumen</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={payload.headerFooter.headerText}
                        onChange={(e) =>
                          setPayload((p) => ({
                            ...p,
                            headerFooter: { ...p.headerFooter, headerText: e.target.value },
                          }))
                        }
                        placeholder="Header atas..."
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                      />
                      <input
                        type="text"
                        value={payload.headerFooter.footerText}
                        onChange={(e) =>
                          setPayload((p) => ({
                            ...p,
                            headerFooter: { ...p.headerFooter, footerText: e.target.value },
                          }))
                        }
                        placeholder="Footer bawah..."
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                      />
                    </div>
                  </div>
                </div>
              )}

              {editorTab === 'sections' && (
                <div className="space-y-3">
                  {/* Variable Inserter */}
                  <div className="p-2.5 rounded-lg bg-blue-50/70 border border-blue-200 space-y-1.5">
                    <div className="font-bold text-[#0F294A] text-[11px]">
                      Variabel Otomatis Database (klik untuk menyisipkan ke bagian terpilih):
                    </div>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                      {AVAILABLE_TEMPLATE_VARIABLES.map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          title={`${v.label} (contoh: ${v.example})`}
                          onClick={() => insertVariableIntoActiveSection(v.key)}
                          className="px-1.5 py-0.5 rounded bg-white border border-blue-200 text-[10px] font-mono text-blue-900 hover:bg-blue-100 cursor-pointer"
                        >
                          {`{{${v.key}}}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Add Section Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-slate-600">+ Tambah Bagian:</span>
                    {(
                      [
                        ['paragraph', 'Paragraf'],
                        ['info_grid', 'Grid Identitas'],
                        ['results_table', 'Tabel Nilai'],
                        ['winners_table', 'Tabel Pemenang'],
                        ['violations_table', 'Tabel Pelanggaran'],
                        ['notes', 'Catatan'],
                        ['divider', 'Garis'],
                      ] as const
                    ).map(([kind, lbl]) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => addSection(kind)}
                        className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-[11px] cursor-pointer"
                      >
                        + {lbl}
                      </button>
                    ))}
                  </div>

                  {/* Sections List */}
                  <div className="space-y-2.5">
                    {payload.sections.map((sec, idx) => {
                      const isActive = activeSectionId === sec.id;
                      return (
                        <div
                          key={sec.id}
                          onClick={() => setActiveSectionId(sec.id)}
                          className={`border rounded-lg p-3 space-y-2 ${
                            isActive
                              ? 'border-blue-600 bg-blue-50/20'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-bold uppercase text-slate-500">
                              {idx + 1}. {sec.kind}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateSection(sec.id, { visible: !sec.visible });
                                }}
                                title={sec.visible ? 'Sembunyikan bagian' : 'Tampilkan bagian'}
                                className="p-1 rounded border border-slate-200 text-slate-600 cursor-pointer"
                              >
                                {sec.visible ? (
                                  <Eye className="w-3 h-3" />
                                ) : (
                                  <EyeOff className="w-3 h-3 text-slate-400" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveSection(idx, -1);
                                }}
                                className="p-1 rounded border border-slate-200 cursor-pointer"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveSection(idx, 1);
                                }}
                                className="p-1 rounded border border-slate-200 cursor-pointer"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeSection(sec.id);
                                }}
                                className="p-1 rounded border border-red-200 text-red-600 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {sec.kind !== 'divider' && (
                            <input
                              type="text"
                              value={sec.title}
                              onChange={(e) => updateSection(sec.id, { title: e.target.value })}
                              placeholder="Judul Bagian..."
                              className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-semibold"
                            />
                          )}

                          {(sec.kind === 'paragraph' ||
                            sec.kind === 'notes' ||
                            sec.kind === 'heading' ||
                            sec.kind === 'stats_cards' ||
                            sec.kind === 'violations_table') && (
                            <>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => updateSection(sec.id, { bold: !sec.bold })}
                                  className={`px-2 py-0.5 rounded border font-bold cursor-pointer ${
                                    sec.bold ? 'bg-[#0F294A] text-white' : 'bg-white'
                                  }`}
                                >
                                  B
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateSection(sec.id, { italic: !sec.italic })}
                                  className={`px-2 py-0.5 rounded border italic cursor-pointer ${
                                    sec.italic ? 'bg-[#0F294A] text-white' : 'bg-white'
                                  }`}
                                >
                                  I
                                </button>
                                {(['left', 'center', 'right', 'justify'] as const).map((al) => (
                                  <button
                                    key={al}
                                    type="button"
                                    onClick={() => updateSection(sec.id, { align: al })}
                                    className={`px-2 py-0.5 rounded border capitalize cursor-pointer ${
                                      sec.align === al ? 'bg-blue-700 text-white' : 'bg-white'
                                    }`}
                                  >
                                    {al}
                                  </button>
                                ))}
                              </div>
                              <textarea
                                rows={3}
                                value={sec.content}
                                onChange={(e) => updateSection(sec.id, { content: e.target.value })}
                                className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                              />
                            </>
                          )}

                          {sec.kind === 'info_grid' && (
                            <div className="space-y-1.5">
                              {(sec.infoRows || []).map((row, rIdx) => (
                                <div key={rIdx} className="grid grid-cols-12 gap-1.5">
                                  <input
                                    type="text"
                                    value={row.label}
                                    onChange={(e) => {
                                      const next = [...(sec.infoRows || [])];
                                      next[rIdx] = { ...next[rIdx], label: e.target.value };
                                      updateSection(sec.id, { infoRows: next });
                                    }}
                                    placeholder="Label"
                                    className="col-span-5 px-2 py-1 rounded border border-slate-300"
                                  />
                                  <input
                                    type="text"
                                    value={row.value}
                                    onChange={(e) => {
                                      const next = [...(sec.infoRows || [])];
                                      next[rIdx] = { ...next[rIdx], value: e.target.value };
                                      updateSection(sec.id, { infoRows: next });
                                    }}
                                    placeholder="Nilai / {{variabel}}"
                                    className="col-span-6 px-2 py-1 rounded border border-slate-300"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const next = (sec.infoRows || []).filter((_, i) => i !== rIdx);
                                      updateSection(sec.id, { infoRows: next });
                                    }}
                                    className="col-span-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() =>
                                  updateSection(sec.id, {
                                    infoRows: [
                                      ...(sec.infoRows || []),
                                      { label: 'Baris Baru', value: '' },
                                    ],
                                  })
                                }
                                className="text-[11px] text-blue-700 font-semibold cursor-pointer"
                              >
                                + Tambah Baris Identitas
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {editorTab === 'winners' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-[#0F294A]">
                      Daftar Pemenang & Kategori Juara
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={handleSyncWinnersFromLiveDb}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-blue-300 bg-blue-50 text-blue-800 font-semibold cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Isi dari Ranking DB
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPayload((p) => ({
                            ...p,
                            winnerRows: [
                              ...p.winnerRows,
                              {
                                rank: p.winnerRows.length + 1,
                                nama: 'Nama Peserta',
                                kelas: 'XI-IPA-1',
                                total_score: 0,
                                max_score: liveCtx?.max_score || 100,
                                percentage: 0,
                                kategori_juara: `Juara ${p.winnerRows.length + 1}`,
                                keterangan: 'Terbaik',
                              },
                            ],
                          }))
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#0F294A] text-white font-semibold cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        Baris
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {payload.winnerRows.length === 0 ? (
                      <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 text-center">
                        Belum ada baris pemenang. Klik "Isi dari Ranking DB" untuk menyinkronkan otomatis dari database.
                      </div>
                    ) : (
                      payload.winnerRows.map((w, idx) => (
                        <div key={idx} className="p-2.5 rounded-lg border border-slate-200 space-y-1.5">
                          <div className="grid grid-cols-12 gap-1.5">
                            <input
                              type="number"
                              min={1}
                              value={w.rank}
                              onChange={(e) => {
                                const next = [...payload.winnerRows];
                                next[idx] = { ...next[idx], rank: Number(e.target.value) };
                                setPayload((p) => ({ ...p, winnerRows: next }));
                              }}
                              aria-label="Peringkat"
                              className="col-span-2 px-2 py-1 rounded border border-slate-300 font-mono"
                            />
                            <input
                              type="text"
                              value={w.nama}
                              onChange={(e) => {
                                const next = [...payload.winnerRows];
                                next[idx] = { ...next[idx], nama: e.target.value };
                                setPayload((p) => ({ ...p, winnerRows: next }));
                              }}
                              placeholder="Nama Peserta"
                              className="col-span-6 px-2 py-1 rounded border border-slate-300 font-medium"
                            />
                            <input
                              type="text"
                              value={w.kelas}
                              onChange={(e) => {
                                const next = [...payload.winnerRows];
                                next[idx] = { ...next[idx], kelas: e.target.value };
                                setPayload((p) => ({ ...p, winnerRows: next }));
                              }}
                              placeholder="Kelas"
                              className="col-span-3 px-2 py-1 rounded border border-slate-300"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setPayload((p) => ({
                                  ...p,
                                  winnerRows: p.winnerRows.filter((_, i) => i !== idx),
                                }))
                              }
                              className="col-span-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                            >
                              ×
                            </button>
                          </div>
                          <div className="grid grid-cols-12 gap-1.5">
                            <input
                              type="number"
                              step={0.1}
                              value={w.total_score}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const pct = w.max_score > 0 ? Number(((val / w.max_score) * 100).toFixed(1)) : 0;
                                const next = [...payload.winnerRows];
                                next[idx] = { ...next[idx], total_score: val, percentage: pct };
                                setPayload((p) => ({ ...p, winnerRows: next }));
                              }}
                              placeholder="Nilai"
                              className="col-span-3 px-2 py-1 rounded border border-slate-300 font-mono"
                            />
                            <input
                              type="text"
                              value={w.kategori_juara}
                              onChange={(e) => {
                                const next = [...payload.winnerRows];
                                next[idx] = { ...next[idx], kategori_juara: e.target.value };
                                setPayload((p) => ({ ...p, winnerRows: next }));
                              }}
                              placeholder="Kategori Juara (mis. Juara I)"
                              className="col-span-5 px-2 py-1 rounded border border-slate-300"
                            />
                            <input
                              type="text"
                              value={w.keterangan || ''}
                              onChange={(e) => {
                                const next = [...payload.winnerRows];
                                next[idx] = { ...next[idx], keterangan: e.target.value };
                                setPayload((p) => ({ ...p, winnerRows: next }));
                              }}
                              placeholder="Keterangan"
                              className="col-span-4 px-2 py-1 rounded border border-slate-300"
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {editorTab === 'signatories' && (
                <div className="space-y-4">
                  <div className="font-bold text-[#0F294A]">Tipografi & Pengaturan Kertas Cetak</div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">Jenis Huruf (Font)</label>
                      <select
                        value={payload.typography.fontFamily}
                        onChange={(e) =>
                          setPayload((p) => ({
                            ...p,
                            typography: {
                              ...p.typography,
                              fontFamily: e.target.value as DocumentContentPayload['typography']['fontFamily'],
                            },
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                      >
                        <option value="sans">Modern Sans (DM Sans)</option>
                        <option value="serif">Resmi Serif (Georgia)</option>
                        <option value="times">Times New Roman</option>
                        <option value="mono">Monospace</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">Ukuran Teks (pt)</label>
                      <input
                        type="number"
                        min={9}
                        max={14}
                        value={payload.typography.fontSizePx}
                        onChange={(e) =>
                          setPayload((p) => ({
                            ...p,
                            typography: { ...p.typography, fontSizePx: Number(e.target.value) },
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">Ukuran Kertas</label>
                      <select
                        value={payload.page.paperSize}
                        onChange={(e) =>
                          setPayload((p) => ({
                            ...p,
                            page: { ...p.page, paperSize: e.target.value as PaperSizeOption },
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                      >
                        <option value="A4">A4 (210 × 297 mm)</option>
                        <option value="F4">F4 / Folio (215 × 330 mm)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">Orientasi Kertas</label>
                      <select
                        value={payload.page.orientation}
                        onChange={(e) =>
                          setPayload((p) => ({
                            ...p,
                            page: {
                              ...p.page,
                              orientation: e.target.value as PaperOrientationOption,
                            },
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                      >
                        <option value="portrait">Portrait</option>
                        <option value="landscape">Landscape</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(payload.showStampArea)}
                        onChange={(e) =>
                          setPayload((p) => ({ ...p, showStampArea: e.target.checked }))
                        }
                      />
                      Tampilkan Area Stempel Resmi
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={payload.headerFooter.showPageNumbers}
                        onChange={(e) =>
                          setPayload((p) => ({
                            ...p,
                            headerFooter: {
                              ...p.headerFooter,
                              showPageNumbers: e.target.checked,
                            },
                          }))
                        }
                      />
                      Nomor Halaman PDF/Word
                    </label>
                  </div>

                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                    <span className="font-bold text-[#0F294A]">Pejabat Penandatangan</span>
                    <button
                      type="button"
                      onClick={() =>
                        setPayload((p) => ({
                          ...p,
                          signatories: [
                            ...p.signatories,
                            {
                              id: `sig_${Date.now().toString(36)}`,
                              roleLabel: 'Mengetahui,',
                              name: 'Pejabat Terkait',
                              titleOrNip: 'NIP / Jabatan',
                              align: 'right',
                            },
                          ],
                        }))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#0F294A] text-white cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Tambah TTD
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {payload.signatories.map((sig) => (
                      <div key={sig.id} className="p-2.5 rounded-lg border border-slate-200 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <select
                            value={sig.align}
                            onChange={(e) =>
                              updateSignatory(sig.id, {
                                align: e.target.value as 'left' | 'center' | 'right',
                              })
                            }
                            className="px-2 py-1 rounded border border-slate-300 bg-white"
                          >
                            <option value="left">Posisi Kiri</option>
                            <option value="center">Posisi Tengah</option>
                            <option value="right">Posisi Kanan</option>
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              setPayload((p) => ({
                                ...p,
                                signatories: p.signatories.filter((s) => s.id !== sig.id),
                              }))
                            }
                            className="text-red-600 hover:bg-red-50 px-2 py-0.5 rounded cursor-pointer"
                          >
                            Hapus
                          </button>
                        </div>
                        <input
                          type="text"
                          value={sig.roleLabel}
                          onChange={(e) => updateSignatory(sig.id, { roleLabel: e.target.value })}
                          placeholder="Jabatan di atas TTD"
                          className="w-full px-2 py-1 rounded border border-slate-300"
                        />
                        <input
                          type="text"
                          value={sig.name}
                          onChange={(e) => updateSignatory(sig.id, { name: e.target.value })}
                          placeholder="Nama Terang"
                          className="w-full px-2 py-1 rounded border border-slate-300 font-semibold"
                        />
                        <input
                          type="text"
                          value={sig.titleOrNip}
                          onChange={(e) => updateSignatory(sig.id, { titleOrNip: e.target.value })}
                          placeholder="NIP / Keterangan"
                          className="w-full px-2 py-1 rounded border border-slate-300"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT PANEL: LIVE WYSIWYG PAPER CANVAS (Prints Cleanly) */}
          <div className="xl:col-span-7 overflow-x-auto">
            <div
              style={{
                fontFamily: FONT_FAMILY_STYLE[payload.typography.fontFamily],
                fontSize: `${payload.typography.fontSizePx}pt`,
                lineHeight: payload.typography.lineHeight,
              }}
              className={`print-sheet-surface ${paperMaxWidthClass} ${FONT_CLASS_MAP[payload.typography.fontFamily]} mx-auto bg-white border border-slate-300 shadow-sm p-7 sm:p-10 space-y-5 text-slate-900`}
            >
              {/* Page Top Header */}
              {payload.headerFooter.headerText.trim() && (
                <div className="text-[10px] text-slate-500 text-right border-b border-slate-100 pb-1">
                  {t(payload.headerFooter.headerText)}
                </div>
              )}

              {/* Kop Surat */}
              <div
                className={`flex items-center gap-4 pb-3.5 ${
                  payload.letterhead.borderStyle === 'double'
                    ? 'border-b-4 border-double border-[#0F294A]'
                    : payload.letterhead.borderStyle === 'solid'
                      ? 'border-b-2 border-[#0F294A]'
                      : ''
                }`}
              >
                {payload.letterhead.showLogo && (
                  <AppLogo src={payload.letterhead.logoUrl} sizeClass="w-16 h-16 shrink-0" />
                )}
                <div className="flex-1 text-center space-y-0.5">
                  <div className="text-[10px] font-semibold tracking-wider text-slate-600 uppercase">
                    {t(payload.letterhead.orgLine1)}
                  </div>
                  <div className="text-sm font-bold text-[#0F294A] uppercase">
                    {t(payload.letterhead.orgLine2)}
                  </div>
                  <div className="text-base font-extrabold text-[#0F294A] uppercase">
                    {t(payload.letterhead.institutionName)}
                  </div>
                  <div className="text-[10px] text-slate-600">
                    {t(payload.letterhead.addressLine)} · {t(payload.letterhead.contactLine)}
                  </div>
                </div>
              </div>

              {/* Judul & Nomor Dokumen */}
              <div
                className={
                  payload.typography.headerAlign === 'left'
                    ? 'text-left'
                    : payload.typography.headerAlign === 'right'
                      ? 'text-right'
                      : 'text-center'
                }
              >
                <h2 className="text-base font-extrabold text-[#0F294A] tracking-tight">
                  {t(payload.meta.title)}
                </h2>
                {payload.meta.subtitle.trim() && (
                  <div className="text-xs font-semibold text-slate-700 mt-0.5">
                    {t(payload.meta.subtitle)}
                  </div>
                )}
                {payload.meta.docNumber.trim() &&
                  !t(payload.meta.subtitle).includes(t(payload.meta.docNumber)) && (
                    <div className="text-xs font-mono text-slate-600 mt-0.5">
                      Nomor: {t(payload.meta.docNumber)}
                    </div>
                  )}
              </div>

              {/* Sections Render */}
              <div className="space-y-4">
                {payload.sections
                  .filter((sec) => sec.visible)
                  .map((sec) => {
                    if (sec.kind === 'divider') {
                      return <hr key={sec.id} className="border-slate-300" />;
                    }

                    return (
                      <div key={sec.id} className="space-y-2">
                        {sec.title.trim() && (
                          <h3 className="text-xs font-bold text-[#0F294A] uppercase tracking-wide print-avoid-break">
                            {t(sec.title)}
                          </h3>
                        )}

                        {(sec.kind === 'paragraph' || sec.kind === 'notes' || sec.kind === 'heading') && (
                          <div
                            className={`text-xs whitespace-pre-line ${
                              sec.bold ? 'font-bold' : ''
                            } ${sec.italic ? 'italic' : ''} ${
                              sec.align === 'center'
                                ? 'text-center'
                                : sec.align === 'right'
                                  ? 'text-right'
                                  : sec.align === 'justify'
                                    ? 'text-justify'
                                    : 'text-left'
                            } ${
                              sec.kind === 'notes'
                                ? 'p-3 rounded-lg bg-slate-50 border border-slate-200'
                                : ''
                            }`}
                          >
                            {t(sec.content)}
                          </div>
                        )}

                        {sec.kind === 'info_grid' && sec.infoRows && (
                          <table className="print-table w-full text-xs border border-slate-300 border-collapse">
                            <tbody>
                              {sec.infoRows.map((r, rIdx) => (
                                <tr key={rIdx}>
                                  <td className="px-3 py-1.5 border border-slate-300 bg-slate-50 font-semibold w-52">
                                    {t(r.label)}
                                  </td>
                                  <td className="px-3 py-1.5 border border-slate-300">{t(r.value)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        {sec.kind === 'stats_cards' && (
                          <div className="space-y-2 print-avoid-break">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                              <div className="p-2.5 rounded border border-slate-300 bg-slate-50">
                                <div className="text-[10px] text-slate-500">Peserta Terdaftar</div>
                                <div className="font-mono font-bold text-sm text-[#0F294A]">
                                  {vars.jumlah_peserta || '0'}
                                </div>
                              </div>
                              <div className="p-2.5 rounded border border-slate-300 bg-slate-50">
                                <div className="text-[10px] text-slate-500">Hadir / Selesai</div>
                                <div className="font-mono font-bold text-sm text-emerald-700">
                                  {vars.peserta_hadir || '0'} / {vars.peserta_selesai || '0'}
                                </div>
                              </div>
                              <div className="p-2.5 rounded border border-slate-300 bg-slate-50">
                                <div className="text-[10px] text-slate-500">Rata-rata Nilai</div>
                                <div className="font-mono font-bold text-sm text-blue-800">
                                  {vars.nilai_rata_rata || '0'}
                                </div>
                              </div>
                              <div className="p-2.5 rounded border border-slate-300 bg-slate-50">
                                <div className="text-[10px] text-slate-500">Tertinggi / Terendah</div>
                                <div className="font-mono font-bold text-sm text-[#0F294A]">
                                  {vars.nilai_tertinggi || '0'} / {vars.nilai_terendah || '0'}
                                </div>
                              </div>
                            </div>
                            {sec.content.trim() && (
                              <p className="text-xs text-slate-700">{t(sec.content)}</p>
                            )}
                          </div>
                        )}

                        {sec.kind === 'results_table' && (
                          <table className="print-table w-full text-xs border border-slate-300 border-collapse">
                            <thead>
                              <tr className="bg-[#0F294A] text-white">
                                <th className="px-2 py-1.5 border border-slate-300 text-left">No</th>
                                <th className="px-2 py-1.5 border border-slate-300 text-left">Nama Peserta</th>
                                <th className="px-2 py-1.5 border border-slate-300 text-left">Kelas</th>
                                <th className="px-2 py-1.5 border border-slate-300 text-center">B/S/K</th>
                                <th className="px-2 py-1.5 border border-slate-300 text-right">Nilai</th>
                                <th className="px-2 py-1.5 border border-slate-300 text-right">%</th>
                                <th className="px-2 py-1.5 border border-slate-300 text-left">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tablesData.resultsRows.length === 0 ? (
                                <tr>
                                  <td colSpan={7} className="px-3 py-4 text-center text-slate-500 border border-slate-300">
                                    Belum ada hasil ujian tercatat.
                                  </td>
                                </tr>
                              ) : (
                                tablesData.resultsRows.map((r, i) => (
                                  <tr key={i} className={i % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
                                    <td className="px-2 py-1.5 border border-slate-300 font-mono">{i + 1}</td>
                                    <td className="px-2 py-1.5 border border-slate-300 font-medium">{r.nama}</td>
                                    <td className="px-2 py-1.5 border border-slate-300">{r.kelas}</td>
                                    <td className="px-2 py-1.5 border border-slate-300 font-mono text-center">
                                      {r.correct_count}/{r.incorrect_count}/{r.unanswered_count}
                                    </td>
                                    <td className="px-2 py-1.5 border border-slate-300 font-mono text-right font-bold">
                                      {r.total_score}/{r.max_score}
                                    </td>
                                    <td className="px-2 py-1.5 border border-slate-300 font-mono text-right">
                                      {r.percentage.toFixed(1)}%
                                    </td>
                                    <td className="px-2 py-1.5 border border-slate-300">
                                      {r.passed ? 'Lulus' : 'Pembinaan'}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        )}

                        {sec.kind === 'winners_table' && (
                          <table className="print-table w-full text-xs border border-slate-300 border-collapse">
                            <thead>
                              <tr className="bg-[#0F294A] text-white">
                                <th className="px-2 py-1.5 border border-slate-300 text-center">Peringkat</th>
                                <th className="px-2 py-1.5 border border-slate-300 text-left">Nama Peserta</th>
                                <th className="px-2 py-1.5 border border-slate-300 text-left">Kelas</th>
                                <th className="px-2 py-1.5 border border-slate-300 text-right">Nilai Akhir</th>
                                <th className="px-2 py-1.5 border border-slate-300 text-left">Kategori Juara</th>
                                <th className="px-2 py-1.5 border border-slate-300 text-left">Keterangan</th>
                              </tr>
                            </thead>
                            <tbody>
                              {payload.winnerRows.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="px-3 py-4 text-center text-slate-500 border border-slate-300">
                                    Daftar pemenang belum diisi.
                                  </td>
                                </tr>
                              ) : (
                                payload.winnerRows.map((w, i) => (
                                  <tr key={i} className={i % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
                                    <td className="px-2 py-1.5 border border-slate-300 font-mono text-center font-bold text-[#0F294A]">
                                      #{w.rank}
                                    </td>
                                    <td className="px-2 py-1.5 border border-slate-300 font-semibold">{w.nama}</td>
                                    <td className="px-2 py-1.5 border border-slate-300">{w.kelas}</td>
                                    <td className="px-2 py-1.5 border border-slate-300 font-mono text-right">
                                      {w.total_score} ({w.percentage}%)
                                    </td>
                                    <td className="px-2 py-1.5 border border-slate-300 font-semibold text-amber-800">
                                      {w.kategori_juara}
                                    </td>
                                    <td className="px-2 py-1.5 border border-slate-300">{w.keterangan || '—'}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        )}

                        {sec.kind === 'violations_table' && (
                          <div className="space-y-2">
                            {sec.content.trim() && (
                              <p className="text-xs text-slate-700">{t(sec.content)}</p>
                            )}
                            {tablesData.violationRows.length > 0 && (
                              <table className="print-table w-full text-xs border border-slate-300 border-collapse">
                                <thead>
                                  <tr className="bg-slate-700 text-white">
                                    <th className="px-2 py-1.5 border border-slate-300 text-left">No</th>
                                    <th className="px-2 py-1.5 border border-slate-300 text-left">Peserta</th>
                                    <th className="px-2 py-1.5 border border-slate-300 text-left">Jenis</th>
                                    <th className="px-2 py-1.5 border border-slate-300 text-left">Waktu</th>
                                    <th className="px-2 py-1.5 border border-slate-300 text-left">Keterangan</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {tablesData.violationRows.map((v, i) => (
                                    <tr key={i}>
                                      <td className="px-2 py-1.5 border border-slate-300 font-mono">{i + 1}</td>
                                      <td className="px-2 py-1.5 border border-slate-300">{v.nama}</td>
                                      <td className="px-2 py-1.5 border border-slate-300 font-mono">{v.event_type}</td>
                                      <td className="px-2 py-1.5 border border-slate-300 font-mono">
                                        {new Date(v.event_time).toLocaleString('id-ID')}
                                      </td>
                                      <td className="px-2 py-1.5 border border-slate-300">{v.description}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>

              {/* Place & Date + Signatories */}
              <div className="pt-4 space-y-4 print-avoid-break">
                {payload.meta.placeAndDate.trim() && (
                  <div className="text-xs text-right">{t(payload.meta.placeAndDate)}</div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
                  {payload.signatories.map((sig) => (
                    <div
                      key={sig.id}
                      className={`text-xs ${
                        sig.align === 'center'
                          ? 'text-center'
                          : sig.align === 'right'
                            ? 'text-right'
                            : 'text-left'
                      }`}
                    >
                      <div>{t(sig.roleLabel)}</div>
                      <div className="mt-14 font-bold underline text-slate-900">{t(sig.name)}</div>
                      <div className="text-[11px] text-slate-600">{t(sig.titleOrNip)}</div>
                    </div>
                  ))}
                </div>

                {payload.showStampArea && (
                  <div className="flex justify-end">
                    <div className="border border-dashed border-slate-400 rounded-md px-4 py-2 text-[10px] text-slate-500 text-center">
                      Ruang Stempel Resmi Panitia / Sekolah
                    </div>
                  </div>
                )}
              </div>

              {/* Document Footer */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500 print-avoid-break">
                <span>{t(payload.headerFooter.footerText)}</span>
                <span>
                  Format: {payload.page.paperSize} ({payload.page.orientation})
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

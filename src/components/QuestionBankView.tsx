import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import * as XLSX from 'xlsx';
import {
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  FolderInput,
  ImagePlus,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { RichMathRenderer } from './RichMathRenderer';
import { apiFetch } from '../utils/api';
import { downloadQuestionImportTemplate, exportRowsToExcel } from '../utils/exporters';
import { safeJsonParse } from '../shared/grading';
import type {
  DifficultyLevel,
  QuestionOptionsPayload,
  QuestionRecord,
  QuestionType,
} from '../shared/types';

const SCIENTIFIC_SYMBOLS = ['α', 'β', 'γ', 'Δ', 'λ', 'μ', 'π', 'θ', 'Ω', '±', '≤', '≥', '→', '⇌', '°C'];
const MATH_SNIPPETS = [
  { label: 'Pecahan', code: '$\\frac{a}{b}$' },
  { label: 'Pangkat/Akar', code: '$\\sqrt{x^2 + y^2}$' },
  { label: 'Reaksi Kimia', code: '$$\\text{CH}_4 + 2\\text{O}_2 \\rightarrow \\text{CO}_2 + 2\\text{H}_2\\text{O}$$' },
  { label: 'Isotop', code: '$^{14}_{6}\\text{C}$' },
];

export function QuestionBankView({ openCreatorImmediately = false }: { openCreatorImmediately?: boolean }) {
  const [questions, setQuestions] = useState<Array<QuestionRecord & { creator_name?: string }>>([]);
  const [categories, setCategories] = useState<Array<{ category_id: string; category_name: string }>>([]);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [moveTargetCat, setMoveTargetCat] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  // Editor modal
  const [editorOpen, setEditorOpen] = useState(openCreatorImmediately);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [qType, setQType] = useState<QuestionType>('PG');
  const [qText, setQText] = useState('');
  const [qExplanation, setQExplanation] = useState('');
  const [qImageUrl, setQImageUrl] = useState('');
  const [qCategory, setQCategory] = useState('Fisika');
  const [qMateri, setQMateri] = useState('');
  const [qDifficulty, setQDifficulty] = useState<DifficultyLevel>('SEDANG');
  const [qScore, setQScore] = useState(10);
  const [showPreview, setShowPreview] = useState(false);

  // Type-specific option states
  const [choices, setChoices] = useState([
    { id: 'A', label: 'A', text: '' },
    { id: 'B', label: 'B', text: '' },
    { id: 'C', label: 'C', text: '' },
    { id: 'D', label: 'D', text: '' },
    { id: 'E', label: 'E', text: '' },
  ]);
  const [pgAnswer, setPgAnswer] = useState('A');
  const [pgkAnswers, setPgkAnswers] = useState<string[]>(['A']);
  const [pgkScoring, setPgkScoring] = useState<'PARTIAL' | 'EXACT'>('PARTIAL');
  const [pgkPenalty, setPgkPenalty] = useState(0);
  const [bsAnswer, setBsAnswer] = useState<'BENAR' | 'SALAH'>('BENAR');
  const [shortAnswers, setShortAnswers] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [essayMaxChars, setEssayMaxChars] = useState(1500);
  const [essayRubric, setEssayRubric] = useState([
    { criterion: 'Ketepatan Konsep Sains', max_points: 5, description: 'Penggunaan prinsip & hukum fisika/kimia/biologi yang benar.' },
    { criterion: 'Kelengkapan Analisis', max_points: 5, description: 'Langkah perhitungan atau argumentasi ilmiah lengkap.' },
  ]);
  const [matchingPairs, setMatchingPairs] = useState([
    { id: 'p1', left: '', right: '' },
    { id: 'p2', left: '', right: '' },
    { id: 'p3', left: '', right: '' },
  ]);
  const [orderingItems, setOrderingItems] = useState([
    { id: 'ord_1', text: '' },
    { id: 'ord_2', text: '' },
    { id: 'ord_3', text: '' },
  ]);

  // Import modal preview
  const [importPreviewRows, setImportPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [importReport, setImportReport] = useState<{ imported: number; failed: Array<{ row: number; reason: string }> } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [qRes, cRes] = await Promise.all([
        apiFetch<{ questions: Array<QuestionRecord & { creator_name?: string }> }>('/questions'),
        apiFetch<{ categories: Array<{ category_id: string; category_name: string }> }>('/categories'),
      ]);
      setQuestions(qRes.questions);
      setCategories(cRes.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat bank soal.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (openCreatorImmediately) {
      resetEditor();
      setEditorOpen(true);
    }
  }, [openCreatorImmediately]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const resetEditor = () => {
    setEditingId(null);
    setQType('PG');
    setQText('');
    setQExplanation('');
    setQImageUrl('');
    setQCategory(categories[0]?.category_name || 'Fisika');
    setQMateri('');
    setQDifficulty('SEDANG');
    setQScore(10);
    setChoices([
      { id: 'A', label: 'A', text: '' },
      { id: 'B', label: 'B', text: '' },
      { id: 'C', label: 'C', text: '' },
      { id: 'D', label: 'D', text: '' },
      { id: 'E', label: 'E', text: '' },
    ]);
    setPgAnswer('A');
    setPgkAnswers(['A']);
    setPgkScoring('PARTIAL');
    setPgkPenalty(0);
    setBsAnswer('BENAR');
    setShortAnswers('');
    setCaseSensitive(false);
    setEssayMaxChars(1500);
    setMatchingPairs([
      { id: 'p1', left: '', right: '' },
      { id: 'p2', left: '', right: '' },
      { id: 'p3', left: '', right: '' },
    ]);
    setOrderingItems([
      { id: 'ord_1', text: '' },
      { id: 'ord_2', text: '' },
      { id: 'ord_3', text: '' },
    ]);
    setShowPreview(false);
  };

  const openEditQuestion = (q: QuestionRecord) => {
    setEditingId(q.question_id);
    setQType(q.question_type);
    setQText(q.question_text);
    setQExplanation(q.explanation);
    setQImageUrl(q.image_url);
    setQCategory(q.category);
    setQMateri(q.materi || '');
    setQDifficulty(q.difficulty);
    setQScore(q.score);
    const opts = safeJsonParse<QuestionOptionsPayload>(q.options_json, {});

    if (q.question_type === 'PG' || q.question_type === 'PGK') {
      const base = ['A', 'B', 'C', 'D', 'E'].map((lbl) => {
        const found = opts.choices?.find((c) => c.label === lbl);
        return found || { id: lbl, label: lbl, text: '' };
      });
      setChoices(base);
      if (q.question_type === 'PG') {
        setPgAnswer(q.correct_answer || 'A');
      } else {
        setPgkAnswers(safeJsonParse<string[]>(q.correct_answer, ['A']));
        setPgkScoring(opts.pgk_scoring || 'PARTIAL');
        setPgkPenalty(opts.pgk_penalty || 0);
      }
    } else if (q.question_type === 'BENAR_SALAH') {
      setBsAnswer(q.correct_answer === 'SALAH' ? 'SALAH' : 'BENAR');
    } else if (q.question_type === 'ISIAN_SINGKAT') {
      setShortAnswers((opts.accepted_answers || [q.correct_answer]).join(' | '));
      setCaseSensitive(Boolean(opts.case_sensitive));
    } else if (q.question_type === 'ESAI') {
      setEssayMaxChars(opts.essay_max_chars || 1500);
      if (opts.essay_rubric?.length) setEssayRubric(opts.essay_rubric);
    } else if (q.question_type === 'MENJODOHKAN') {
      if (opts.matching_pairs?.length) setMatchingPairs(opts.matching_pairs);
    } else if (q.question_type === 'MENGURUTKAN') {
      if (opts.ordering_items?.length) setOrderingItems(opts.ordering_items);
    }

    setShowPreview(false);
    setEditorOpen(true);
  };

  const insertTagOrText = (snippet: string) => {
    setQText((prev) => `${prev}${snippet}`);
  };

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setQImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveQuestion = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    let options: QuestionOptionsPayload = {};
    let correctAnswer: unknown = '';

    if (qType === 'PG') {
      const validChoices = choices.filter((c) => c.text.trim().length > 0);
      if (validChoices.length < 2) {
        setError('Minimal sediakan 2 pilihan jawaban untuk Pilihan Ganda.');
        return;
      }
      options = { choices: validChoices };
      correctAnswer = pgAnswer;
    } else if (qType === 'PGK') {
      const validChoices = choices.filter((c) => c.text.trim().length > 0);
      if (validChoices.length < 2 || pgkAnswers.length === 0) {
        setError('Pilihan Ganda Kompleks membutuhkan minimal 2 opsi dan 1 kunci jawaban.');
        return;
      }
      options = { choices: validChoices, pgk_scoring: pgkScoring, pgk_penalty: pgkPenalty };
      correctAnswer = pgkAnswers;
    } else if (qType === 'BENAR_SALAH') {
      correctAnswer = bsAnswer;
    } else if (qType === 'ISIAN_SINGKAT') {
      const variants = shortAnswers
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      if (variants.length === 0) {
        setError('Isi minimal satu variasi kunci jawaban singkat.');
        return;
      }
      options = { accepted_answers: variants, case_sensitive: caseSensitive };
      correctAnswer = variants[0];
    } else if (qType === 'ESAI') {
      options = { essay_max_chars: essayMaxChars, essay_rubric: essayRubric };
      correctAnswer = 'RUBRIK_MANUAL';
    } else if (qType === 'MENJODOHKAN') {
      const validPairs = matchingPairs.filter((p) => p.left.trim() && p.right.trim());
      if (validPairs.length < 2) {
        setError('Minimal sediakan 2 pasangan untuk soal Menjodohkan.');
        return;
      }
      options = { matching_pairs: validPairs };
      const map: Record<string, string> = {};
      validPairs.forEach((p) => {
        map[p.id] = p.right;
      });
      correctAnswer = map;
    } else if (qType === 'MENGURUTKAN') {
      const validItems = orderingItems.filter((item) => item.text.trim());
      if (validItems.length < 2) {
        setError('Minimal sediakan 2 item untuk soal Mengurutkan.');
        return;
      }
      options = { ordering_items: validItems };
      correctAnswer = validItems.map((i) => i.id);
    }

    try {
      if (editingId) {
        await apiFetch(`/questions/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            question_type: qType,
            question_text: qText,
            options,
            correct_answer: correctAnswer,
            explanation: qExplanation,
            image_url: qImageUrl,
            category: qCategory,
            materi: qMateri,
            difficulty: qDifficulty,
            score: qScore,
          }),
        });
        showToast('Soal berhasil diperbarui.');
      } else {
        await apiFetch('/questions', {
          method: 'POST',
          body: JSON.stringify({
            question_type: qType,
            question_text: qText,
            options,
            correct_answer: correctAnswer,
            explanation: qExplanation,
            image_url: qImageUrl,
            category: qCategory,
            materi: qMateri,
            difficulty: qDifficulty,
            score: qScore,
          }),
        });
        showToast('Soal baru berhasil disimpan ke Bank Soal.');
      }
      setEditorOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan soal.');
    }
  };

  const handleDuplicate = async (id: string) => {
    await apiFetch(`/questions/${id}/duplicate`, { method: 'POST' });
    showToast('Soal berhasil digandakan.');
    await loadData();
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/questions/${id}`, { method: 'DELETE' });
    showToast('Soal dihapus.');
    await loadData();
  };

  const handleMoveCategory = async () => {
    if (!selectedIds.length || !moveTargetCat) return;
    await apiFetch('/questions/move-category', {
      method: 'POST',
      body: JSON.stringify({ question_ids: selectedIds, category: moveTargetCat }),
    });
    setSelectedIds([]);
    showToast('Kategori soal terpilih diperbarui.');
    await loadData();
  };

  const handleImportFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    setImportPreviewRows(rows);
    setImportReport(null);
    e.target.value = '';
  };

  const confirmImportRows = async () => {
    const res = await apiFetch<{ imported: number; failed: Array<{ row: number; reason: string }> }>(
      '/questions/import',
      {
        method: 'POST',
        body: JSON.stringify({ questions: importPreviewRows }),
      },
    );
    setImportReport(res);
    setImportPreviewRows([]);
    await loadData();
  };

  const handleExportBank = () => {
    const rows = filteredQuestions.map((q) => ({
      ID: q.question_id,
      Tipe: q.question_type,
      Kategori: q.category,
      Materi: q.materi || '',
      Kesulitan: q.difficulty,
      Bobot: q.score,
      Pertanyaan: q.question_text.replace(/<[^>]+>/g, ''),
      Kunci_Jawaban: q.correct_answer,
      Pembahasan: q.explanation.replace(/<[^>]+>/g, ''),
    }));
    exportRowsToExcel('Bank_Soal_KIR_IPA_SMAN1_Sukabumi.xlsx', 'Bank_Soal', rows);
  };

  const filteredQuestions = questions.filter((q) => {
    if (filterCategory && q.category !== filterCategory) return false;
    if (filterType && q.question_type !== filterType) return false;
    if (filterDifficulty && q.difficulty !== filterDifficulty) return false;
    if (search.trim()) {
      const s = search.toLowerCase();
      return (
        q.question_text.toLowerCase().includes(s) ||
        (q.materi || '').toLowerCase().includes(s) ||
        q.category.toLowerCase().includes(s)
      );
    }
    return true;
  });

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
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari isi soal, materi, atau kategori..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <select
              aria-label="Filter kategori"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="">Semua Kategori</option>
              {categories.map((c) => (
                <option key={c.category_id} value={c.category_name}>
                  {c.category_name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter jenis soal"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="">Semua Jenis</option>
              <option value="PG">Pilihan Ganda</option>
              <option value="PGK">PG Kompleks</option>
              <option value="BENAR_SALAH">Benar / Salah</option>
              <option value="ISIAN_SINGKAT">Isian Singkat</option>
              <option value="MENJODOHKAN">Menjodohkan</option>
              <option value="MENGURUTKAN">Mengurutkan</option>
              <option value="ESAI">Esai</option>
            </select>
            <select
              aria-label="Filter tingkat kesulitan"
              value={filterDifficulty}
              onChange={(e) => setFilterDifficulty(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="">Semua Kesulitan</option>
              <option value="MUDAH">Mudah</option>
              <option value="SEDANG">Sedang</option>
              <option value="SULIT">Sulit</option>
              <option value="OLIMPIADE">Olimpiade</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={downloadQuestionImportTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Template Excel
            </button>
            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              Impor Soal
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleImportFileSelect}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={handleExportBank}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Ekspor Excel
            </button>
            <button
              type="button"
              onClick={() => {
                resetEditor();
                setEditorOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Buat Soal Baru
            </button>
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-[#0F294A]">{selectedIds.length} soal dipilih:</span>
            <select
              value={moveTargetCat}
              onChange={(e) => setMoveTargetCat(e.target.value)}
              className="px-2.5 py-1.5 rounded border border-slate-300 bg-white"
            >
              <option value="">Pilih kategori tujuan...</option>
              {categories.map((c) => (
                <option key={c.category_id} value={c.category_name}>
                  {c.category_name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleMoveCategory}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-blue-700 text-white font-medium cursor-pointer"
            >
              <FolderInput className="w-3.5 h-3.5" />
              Pindahkan Kategori
            </button>
          </div>
        )}
      </div>

      {/* Import Preview Modal */}
      {importPreviewRows.length > 0 && (
        <div className="bg-white border border-blue-300 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-[#0F294A]">
              Preview Impor Soal ({importPreviewRows.length} baris terdeteksi)
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setImportPreviewRows([])}
                className="px-3 py-1.5 rounded border border-slate-300 text-xs cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmImportRows}
                className="px-3.5 py-1.5 rounded bg-[#0F294A] text-white text-xs font-semibold cursor-pointer"
              >
                Validasi & Simpan ke Bank Soal
              </button>
            </div>
          </div>
          <div className="max-h-48 overflow-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2">Tipe</th>
                  <th className="px-3 py-2">Kategori</th>
                  <th className="px-3 py-2">Pertanyaan</th>
                  <th className="px-3 py-2">Kunci</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {importPreviewRows.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-mono">{String(r.question_type || '')}</td>
                    <td className="px-3 py-2">{String(r.category || '')}</td>
                    <td className="px-3 py-2 truncate max-w-md">{String(r.question_text || '')}</td>
                    <td className="px-3 py-2 font-mono">{String(r.correct_answer || '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {importReport && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs space-y-1">
          <div className="font-semibold text-emerald-700">
            Berhasil mengimpor {importReport.imported} soal.
          </div>
          {importReport.failed.length > 0 && (
            <div className="text-red-700">
              <p className="font-semibold">Laporan soal gagal diimpor ({importReport.failed.length}):</p>
              <ul className="list-disc list-inside">
                {importReport.failed.map((f, idx) => (
                  <li key={idx}>Baris {f.row}: {f.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Question List */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            Memuat bank soal...
          </div>
        ) : filteredQuestions.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            Belum ada soal pada filter ini.
          </div>
        ) : (
          filteredQuestions.map((q) => (
            <div
              key={q.question_id}
              className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    aria-label={`Pilih soal ${q.question_id}`}
                    checked={selectedIds.includes(q.question_id)}
                    onChange={(e) => {
                      setSelectedIds((prev) =>
                        e.target.checked
                          ? [...prev, q.question_id]
                          : prev.filter((id) => id !== q.question_id),
                      );
                    }}
                  />
                  <span className="font-mono font-semibold text-[#0F294A]">{q.question_type}</span>
                  <span>·</span>
                  <span>{q.category}</span>
                  {q.materi && (
                    <>
                      <span>·</span>
                      <span>{q.materi}</span>
                    </>
                  )}
                  <span>·</span>
                  <span>{q.difficulty}</span>
                  <span>·</span>
                  <span className="font-mono font-semibold text-amber-700">Bobot {q.score}</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEditQuestion(q)}
                    className="px-2.5 py-1.5 rounded border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    aria-label="Duplikasi soal"
                    onClick={() => handleDuplicate(q.question_id)}
                    className="p-1.5 rounded border border-slate-200 text-slate-600 hover:text-blue-700 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Hapus soal"
                    onClick={() => handleDelete(q.question_id)}
                    className="p-1.5 rounded border border-slate-200 text-slate-600 hover:text-red-700 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <RichMathRenderer content={q.question_text} className="text-sm" />

              {q.image_url && (
                <img
                  src={q.image_url}
                  alt="Ilustrasi soal"
                  referrerPolicy="no-referrer"
                  className="max-h-48 rounded-lg border border-slate-200"
                />
              )}
            </div>
          ))
        )}
      </div>

      {/* Rich Question Editor Modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-4xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-[#0F294A]">
                {editingId ? 'Edit Soal Bank Soal' : 'Editor Soal Multiformat KIR IPA'}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPreview((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {showPreview ? 'Mode Edit' : 'Preview Rumus & Soal'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-100 cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveQuestion} className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jenis Soal</label>
                  <select
                    value={qType}
                    onChange={(e) => setQType(e.target.value as QuestionType)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="PG">Pilihan Ganda</option>
                    <option value="PGK">PG Kompleks</option>
                    <option value="BENAR_SALAH">Benar / Salah</option>
                    <option value="ISIAN_SINGKAT">Isian Singkat</option>
                    <option value="MENJODOHKAN">Menjodohkan</option>
                    <option value="MENGURUTKAN">Mengurutkan</option>
                    <option value="ESAI">Esai</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kategori</label>
                  <select
                    value={qCategory}
                    onChange={(e) => setQCategory(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    {categories.map((c) => (
                      <option key={c.category_id} value={c.category_name}>
                        {c.category_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Materi</label>
                  <input
                    type="text"
                    value={qMateri}
                    onChange={(e) => setQMateri(e.target.value)}
                    placeholder="Contoh: Termokimia"
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kesulitan</label>
                  <select
                    value={qDifficulty}
                    onChange={(e) => setQDifficulty(e.target.value as DifficultyLevel)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="MUDAH">Mudah</option>
                    <option value="SEDANG">Sedang</option>
                    <option value="SULIT">Sulit</option>
                    <option value="OLIMPIADE">Olimpiade</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Bobot Skor</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={qScore}
                    onChange={(e) => setQScore(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Rich Formatting Toolbar */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 border-b border-slate-200 p-2 flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => insertTagOrText('<strong>teks</strong>')} className="px-2 py-1 text-xs font-bold bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer">B</button>
                  <button type="button" onClick={() => insertTagOrText('<em>teks</em>')} className="px-2 py-1 text-xs italic bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer">I</button>
                  <button type="button" onClick={() => insertTagOrText('<u>teks</u>')} className="px-2 py-1 text-xs underline bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer">U</button>
                  <button type="button" onClick={() => insertTagOrText('<sub>2</sub>')} className="px-2 py-1 text-xs bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer">H₂O</button>
                  <button type="button" onClick={() => insertTagOrText('<sup>2</sup>')} className="px-2 py-1 text-xs bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer">x²</button>
                  <button
                    type="button"
                    onClick={() =>
                      insertTagOrText(
                        '<table><thead><tr><th>Variabel</th><th>Nilai</th></tr></thead><tbody><tr><td>Data 1</td><td>0</td></tr></tbody></table>',
                      )
                    }
                    className="px-2 py-1 text-xs bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                  >
                    + Tabel
                  </button>
                  {MATH_SNIPPETS.map((m) => (
                    <button
                      key={m.label}
                      type="button"
                      onClick={() => insertTagOrText(` ${m.code} `)}
                      className="px-2 py-1 text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded hover:bg-blue-100 cursor-pointer"
                    >
                      {m.label}
                    </button>
                  ))}
                  <div className="flex flex-wrap gap-1 ml-1">
                    {SCIENTIFIC_SYMBOLS.map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => insertTagOrText(sym)}
                        className="px-1.5 py-0.5 text-xs bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                      >
                        {sym}
                      </button>
                    ))}
                  </div>
                </div>

                {showPreview ? (
                  <div className="p-4 min-h-[140px] bg-white">
                    <RichMathRenderer content={qText || '<p class="text-slate-400">Belum ada teks pertanyaan.</p>'} />
                  </div>
                ) : (
                  <textarea
                    required
                    rows={5}
                    value={qText}
                    onChange={(e) => setQText(e.target.value)}
                    placeholder="Tuliskan pertanyaan. Gunakan $...$ untuk rumus matematika/kimia inline atau $$...$$ untuk rumus blok..."
                    className="w-full p-3 text-sm focus:outline-none"
                  />
                )}
              </div>

              {/* Image attachment */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <ImagePlus className="w-4 h-4" />
                  Unggah Gambar / Diagram
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
                <input
                  type="text"
                  value={qImageUrl}
                  onChange={(e) => setQImageUrl(e.target.value)}
                  placeholder="Atau tempel URL gambar / grafik..."
                  className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 text-xs"
                />
              </div>

              {/* Answer Key & Options Builder per Question Type */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                {qType === 'PG' && (
                  <>
                    <div className="text-xs font-semibold text-[#0F294A]">
                      Pilihan Jawaban & Kunci Benar (Pilih satu radio button)
                    </div>
                    {choices.map((c, idx) => (
                      <div key={c.label} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="pg_key"
                          checked={pgAnswer === c.label}
                          onChange={() => setPgAnswer(c.label)}
                        />
                        <span className="font-mono text-xs font-bold w-5">{c.label}.</span>
                        <input
                          type="text"
                          value={c.text}
                          onChange={(e) => {
                            const next = [...choices];
                            next[idx] = { ...next[idx], text: e.target.value };
                            setChoices(next);
                          }}
                          placeholder={`Opsi ${c.label} (mendukung LaTeX $...$)`}
                          className="flex-1 px-3 py-1.5 rounded border border-slate-300 text-xs bg-white"
                        />
                      </div>
                    ))}
                  </>
                )}

                {qType === 'PGK' && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#0F294A]">
                        Pilihan Ganda Kompleks (Centang semua jawaban benar)
                      </span>
                      <div className="flex items-center gap-3 text-xs">
                        <select
                          value={pgkScoring}
                          onChange={(e) => setPgkScoring(e.target.value as 'PARTIAL' | 'EXACT')}
                          className="px-2 py-1 rounded border border-slate-300 bg-white"
                        >
                          <option value="PARTIAL">Skor Parsial (Partial Credit)</option>
                          <option value="EXACT">Exact Match</option>
                        </select>
                        {pgkScoring === 'PARTIAL' && (
                          <label className="flex items-center gap-1">
                            Penalti salah:
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={pgkPenalty}
                              onChange={(e) => setPgkPenalty(Number(e.target.value))}
                              className="w-14 px-2 py-1 rounded border border-slate-300 bg-white font-mono"
                            />
                          </label>
                        )}
                      </div>
                    </div>
                    {choices.map((c, idx) => (
                      <div key={c.label} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={pgkAnswers.includes(c.label)}
                          onChange={(e) => {
                            setPgkAnswers((prev) =>
                              e.target.checked
                                ? [...prev, c.label]
                                : prev.filter((x) => x !== c.label),
                            );
                          }}
                        />
                        <span className="font-mono text-xs font-bold w-5">{c.label}.</span>
                        <input
                          type="text"
                          value={c.text}
                          onChange={(e) => {
                            const next = [...choices];
                            next[idx] = { ...next[idx], text: e.target.value };
                            setChoices(next);
                          }}
                          placeholder={`Opsi ${c.label}`}
                          className="flex-1 px-3 py-1.5 rounded border border-slate-300 text-xs bg-white"
                        />
                      </div>
                    ))}
                  </>
                )}

                {qType === 'BENAR_SALAH' && (
                  <div className="flex items-center gap-4 text-xs">
                    <span className="font-semibold text-[#0F294A]">Kunci Jawaban:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        checked={bsAnswer === 'BENAR'}
                        onChange={() => setBsAnswer('BENAR')}
                      />
                      Benar
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        checked={bsAnswer === 'SALAH'}
                        onChange={() => setBsAnswer('SALAH')}
                      />
                      Salah
                    </label>
                  </div>
                )}

                {qType === 'ISIAN_SINGKAT' && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-[#0F294A]">
                      Variasi Jawaban Benar (pisahkan dengan tanda | )
                    </label>
                    <input
                      type="text"
                      value={shortAnswers}
                      onChange={(e) => setShortAnswers(e.target.value)}
                      placeholder="Contoh: 2 | 2.0 | 2,0"
                      className="w-full px-3 py-2 rounded border border-slate-300 text-xs bg-white"
                    />
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={caseSensitive}
                        onChange={(e) => setCaseSensitive(e.target.checked)}
                      />
                      Peka huruf besar/kecil (case-sensitive)
                    </label>
                  </div>
                )}

                {qType === 'MENJODOHKAN' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#0F294A]">
                        Pasangan Informasi (Kiri → Kanan Benar)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setMatchingPairs((prev) => [
                            ...prev,
                            { id: `p${prev.length + 1}`, left: '', right: '' },
                          ])
                        }
                        className="text-xs text-blue-700 font-medium cursor-pointer"
                      >
                        + Tambah Pasangan
                      </button>
                    </div>
                    {matchingPairs.map((pair, idx) => (
                      <div key={pair.id} className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={pair.left}
                          onChange={(e) => {
                            const next = [...matchingPairs];
                            next[idx] = { ...next[idx], left: e.target.value };
                            setMatchingPairs(next);
                          }}
                          placeholder="Pernyataan kiri"
                          className="px-3 py-1.5 rounded border border-slate-300 text-xs bg-white"
                        />
                        <input
                          type="text"
                          value={pair.right}
                          onChange={(e) => {
                            const next = [...matchingPairs];
                            next[idx] = { ...next[idx], right: e.target.value };
                            setMatchingPairs(next);
                          }}
                          placeholder="Pasangan kanan"
                          className="px-3 py-1.5 rounded border border-slate-300 text-xs bg-white"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {qType === 'MENGURUTKAN' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#0F294A]">
                        Item Urutan (Susun dalam urutan yang BENAR dari atas ke bawah)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setOrderingItems((prev) => [
                            ...prev,
                            { id: `ord_${prev.length + 1}`, text: '' },
                          ])
                        }
                        className="text-xs text-blue-700 font-medium cursor-pointer"
                      >
                        + Tambah Langkah
                      </button>
                    </div>
                    {orderingItems.map((item, idx) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-500 w-5">{idx + 1}.</span>
                        <input
                          type="text"
                          value={item.text}
                          onChange={(e) => {
                            const next = [...orderingItems];
                            next[idx] = { ...next[idx], text: e.target.value };
                            setOrderingItems(next);
                          }}
                          placeholder={`Langkah urutan ke-${idx + 1}`}
                          className="flex-1 px-3 py-1.5 rounded border border-slate-300 text-xs bg-white"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {qType === 'ESAI' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#0F294A]">
                        Rubrik Penilaian Esai & Batas Karakter
                      </span>
                      <label className="text-xs flex items-center gap-1.5">
                        Maks karakter:
                        <input
                          type="number"
                          min={100}
                          max={10000}
                          value={essayMaxChars}
                          onChange={(e) => setEssayMaxChars(Number(e.target.value))}
                          className="w-20 px-2 py-1 rounded border border-slate-300 bg-white font-mono"
                        />
                      </label>
                    </div>
                    {essayRubric.map((rub, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2">
                        <input
                          type="text"
                          value={rub.criterion}
                          onChange={(e) => {
                            const next = [...essayRubric];
                            next[idx] = { ...next[idx], criterion: e.target.value };
                            setEssayRubric(next);
                          }}
                          placeholder="Kriteria"
                          className="col-span-4 px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white"
                        />
                        <input
                          type="number"
                          value={rub.max_points}
                          onChange={(e) => {
                            const next = [...essayRubric];
                            next[idx] = { ...next[idx], max_points: Number(e.target.value) };
                            setEssayRubric(next);
                          }}
                          placeholder="Poin"
                          className="col-span-2 px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white font-mono"
                        />
                        <input
                          type="text"
                          value={rub.description}
                          onChange={(e) => {
                            const next = [...essayRubric];
                            next[idx] = { ...next[idx], description: e.target.value };
                            setEssayRubric(next);
                          }}
                          placeholder="Deskripsi indikator penilaian"
                          className="col-span-6 px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Pembahasan Soal (ditampilkan setelah hasil dipublikasikan jika diaktifkan)
                </label>
                <textarea
                  rows={2}
                  value={qExplanation}
                  onChange={(e) => setQExplanation(e.target.value)}
                  placeholder="Tuliskan pembahasan ilmiah..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#0F294A] hover:bg-blue-800 text-white text-sm font-semibold cursor-pointer"
                >
                  Simpan Soal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

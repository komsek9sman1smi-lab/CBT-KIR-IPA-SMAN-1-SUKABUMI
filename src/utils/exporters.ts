import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ReportHeaderMeta {
  appName: string;
  orgName: string;
  schoolName: string;
  title: string;
  activityName: string;
  authorName: string;
}

export function exportRowsToExcel(
  fileName: string,
  sheetName: string,
  rows: Record<string, unknown>[],
) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

export function exportRowsToCsv(fileName: string, rows: Record<string, unknown>[]) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportTableToPdf(
  fileName: string,
  meta: ReportHeaderMeta,
  columns: string[],
  rows: Array<Array<string | number>>,
) {
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });

  doc.setFillColor(15, 41, 74);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(meta.appName, 14, 11);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`${meta.orgName} · ${meta.schoolName}`, 14, 18);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(meta.title, 14, 36);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Kegiatan: ${meta.activityName}`, 14, 42);
  doc.text(
    `Tanggal Cetak: ${new Date().toLocaleString('id-ID')} · Penyusun: ${meta.authorName}`,
    14,
    47,
  );

  autoTable(doc, {
    startY: 53,
    head: [columns],
    body: rows,
    styles: { fontSize: 8.5, cellPadding: 3 },
    headStyles: { fillColor: [15, 41, 74], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  doc.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}

export function downloadQuestionImportTemplate() {
  const sampleRows = [
    {
      question_type: 'PG',
      question_text: '<p>Rumus energi kinetik benda bermassa m dengan kecepatan v adalah...</p>',
      option_a: '$\\frac{1}{2}mv^2$',
      option_b: '$mv$',
      option_c: '$mgh$',
      option_d: '$ma$',
      option_e: '$\\frac{1}{2}kx^2$',
      correct_answer: 'A',
      explanation: 'Energi kinetik translasi dirumuskan $E_k = \\frac{1}{2}mv^2$.',
      category: 'Fisika',
      materi: 'Usaha dan Energi',
      difficulty: 'MUDAH',
      score: 10,
    },
    {
      question_type: 'PGK',
      question_text: '<p>Manakah gas rumah kaca utama di atmosfer?</p>',
      option_a: 'Karbon dioksida ($\\text{CO}_2$)',
      option_b: 'Nitrogen ($\\text{N}_2$)',
      option_c: 'Metana ($\\text{CH}_4$)',
      option_d: 'Argon ($\\text{Ar}$)',
      option_e: '',
      correct_answer: 'A,C',
      explanation: 'CO2 dan CH4 menyerap radiasi inframerah.',
      category: 'Kimia',
      materi: 'Kimia Lingkungan',
      difficulty: 'SEDANG',
      score: 15,
    },
    {
      question_type: 'ISIAN_SINGKAT',
      question_text: '<p>Simbol unsur kimia untuk Natrium adalah...</p>',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      option_e: '',
      correct_answer: 'Na|natrium',
      explanation: 'Natrium berasal dari bahasa Latin Natrium (Na).',
      category: 'Kimia',
      materi: 'Sistem Periodik Unsur',
      difficulty: 'MUDAH',
      score: 10,
    },
  ];
  exportRowsToExcel('Template_Import_Bank_Soal_KIR_IPA.xlsx', 'Template_Soal', sampleRows);
}

export function downloadParticipantImportTemplate() {
  const sampleRows = [
    {
      username: 'siswa08',
      nama: 'Rizky Ramadhan',
      kelas: 'X-MIPA-1',
      password: 'SiswaKir2026!',
      role: 'SISWA',
    },
    {
      username: 'siswa09',
      nama: 'Putri Amanda',
      kelas: 'XI-IPA-1',
      password: 'SiswaKir2026!',
      role: 'SISWA',
    },
  ];
  exportRowsToExcel('Template_Import_Peserta_KIR_IPA.xlsx', 'Peserta', sampleRows);
}

import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  buildMultiSheetWorkbook,
  generateUtf8Csv,
  getSampleTemplateRows,
} from '../shared/spreadsheet';
import { interpolateTemplateVariables } from '../shared/documentTemplates';
import type {
  DocumentContentPayload,
  ImportEntityType,
  PaperOrientationOption,
  PaperSizeOption,
} from '../shared/types';
import type { OfficialExportTablesData } from './docxExporter';

export interface ReportHeaderMeta {
  appName: string;
  orgName: string;
  schoolName: string;
  title: string;
  activityName: string;
  authorName: string;
}

export function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportRowsToExcel(
  fileName: string,
  sheetName: string,
  rows: Record<string, unknown>[],
) {
  const wb = buildMultiSheetWorkbook([{ name: sheetName || 'Data', rows }]);
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

export function exportMultiSheetExcel(
  fileName: string,
  sheets: Array<{ name: string; rows: Record<string, unknown>[] }>,
) {
  const wb = buildMultiSheetWorkbook(sheets);
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

export function exportRowsToCsv(
  fileName: string,
  rows: Record<string, unknown>[],
  orderedColumns?: string[],
) {
  const csv = generateUtf8Csv(rows, orderedColumns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerBlobDownload(blob, fileName.endsWith('.csv') ? fileName : `${fileName}.csv`);
}

export function exportTableToPdf(
  fileName: string,
  meta: ReportHeaderMeta,
  columns: string[],
  rows: Array<Array<string | number>>,
  options?: {
    paperSize?: PaperSizeOption;
    orientation?: PaperOrientationOption;
    footerText?: string;
    placeAndDate?: string;
    signatoryName?: string;
    signatoryRole?: string;
  },
) {
  const paper = options?.paperSize === 'F4' ? ([215, 330] as [number, number]) : 'a4';
  const orientation = options?.orientation || (columns.length > 6 ? 'landscape' : 'portrait');
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: paper,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFillColor(15, 41, 74);
  doc.rect(0, 0, pageWidth, 25, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(meta.appName, 14, 10.5);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`${meta.orgName} · ${meta.schoolName}`, 14, 17);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11.5);
  doc.setFont('helvetica', 'bold');
  doc.text(meta.title, 14, 34);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Kegiatan: ${meta.activityName}`, 14, 40);
  doc.text(
    `Dicetak: ${new Date().toLocaleString('id-ID')} · Penyusun: ${meta.authorName}`,
    14,
    45,
  );

  autoTable(doc, {
    startY: 51,
    head: [columns],
    body: rows,
    margin: { top: 20, left: 14, right: 14, bottom: 20 },
    styles: { fontSize: 8.5, cellPadding: 2.8 },
    headStyles: { fillColor: [15, 41, 74], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  const lastY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 60;
  if (options?.signatoryName && lastY + 32 < pageHeight - 15) {
    doc.setFontSize(8.5);
    doc.text(options.placeAndDate || `Sukabumi, ${new Date().toLocaleDateString('id-ID')}`, pageWidth - 65, lastY + 12);
    doc.text(options.signatoryRole || 'Penanggung Jawab', pageWidth - 65, lastY + 17);
    doc.setFont('helvetica', 'bold');
    doc.text(options.signatoryName, pageWidth - 65, lastY + 32);
    doc.setFont('helvetica', 'normal');
  }

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      options?.footerText || `${meta.orgName} · ${meta.schoolName}`,
      14,
      pageHeight - 8,
    );
    doc.text(`Halaman ${p} dari ${totalPages}`, pageWidth - 36, pageHeight - 8);
  }

  doc.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}

async function tryLoadDataUrlForPdf(
  logoUrl: string,
): Promise<{ dataUrl: string; format: 'PNG' | 'JPEG' } | null> {
  if (!logoUrl) return null;
  try {
    const resolved = logoUrl.startsWith('/') ? `${window.location.origin}${logoUrl}` : logoUrl;
    const res = await fetch(resolved);
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('svg')) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(blob);
    });
    if (!dataUrl.startsWith('data:image')) return null;
    return {
      dataUrl,
      format: ct.includes('png') || dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG',
    };
  } catch {
    return null;
  }
}

export async function exportOfficialDocumentPdf(
  fileName: string,
  payload: DocumentContentPayload,
  variables: Record<string, string>,
  tablesData: OfficialExportTablesData,
): Promise<void> {
  const vars: Record<string, string> = {
    ...variables,
    doc_number: payload.meta.docNumber || '',
    place_city: payload.meta.placeAndDate.split(',')[0]?.trim() || 'Sukabumi',
  };
  const t = (str: string) => interpolateTemplateVariables(str, vars);

  const paper = payload.page.paperSize === 'F4' ? ([215, 330] as [number, number]) : 'a4';
  const doc = new jsPDF({
    orientation: payload.page.orientation,
    unit: 'mm',
    format: paper,
  });

  const pdfFont =
    payload.typography.fontFamily === 'serif' ||
    payload.typography.fontFamily === 'times' ||
    payload.typography.fontFamily === 'georgia'
      ? 'times'
      : payload.typography.fontFamily === 'mono'
        ? 'courier'
        : 'helvetica';

  const margin = Math.max(10, Math.min(28, payload.page.marginMm || 15));
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  let y = margin + 4;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageHeight - margin - 12) {
      doc.addPage();
      y = margin + 6;
    }
  };

  // Letterhead
  const logoImg =
    payload.letterhead.showLogo && payload.letterhead.logoUrl
      ? await tryLoadDataUrlForPdf(payload.letterhead.logoUrl)
      : null;

  if (logoImg) {
    try {
      doc.addImage(logoImg.dataUrl, logoImg.format, margin, y, 16, 16);
    } catch {
      // Ignore invalid raster payload gracefully
    }
  }

  const centerX = logoImg ? margin + (contentWidth + 16) / 2 : pageWidth / 2;
  doc.setFont(pdfFont, 'bold');
  doc.setTextColor(51, 65, 85);
  doc.setFontSize(8.5);
  doc.text(t(payload.letterhead.orgLine1), centerX, y + 3, { align: 'center' });

  doc.setTextColor(15, 41, 74);
  doc.setFontSize(10.5);
  doc.text(t(payload.letterhead.orgLine2), centerX, y + 8, { align: 'center' });

  doc.setFontSize(12.5);
  doc.text(t(payload.letterhead.institutionName), centerX, y + 13.5, { align: 'center' });

  doc.setFont(pdfFont, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `${t(payload.letterhead.addressLine)} · ${t(payload.letterhead.contactLine)}`,
    centerX,
    y + 18,
    { align: 'center' },
  );

  y += 22;
  if (payload.letterhead.borderStyle !== 'none') {
    doc.setDrawColor(15, 41, 74);
    doc.setLineWidth(0.7);
    doc.line(margin, y, pageWidth - margin, y);
    if (payload.letterhead.borderStyle === 'double') {
      doc.setLineWidth(0.25);
      doc.line(margin, y + 1.2, pageWidth - margin, y + 1.2);
    }
    y += 7;
  }

  // Document title block
  const headerAlign =
    payload.typography.headerAlign === 'left'
      ? 'left'
      : payload.typography.headerAlign === 'right'
        ? 'right'
        : 'center';
  const headerX =
    headerAlign === 'center' ? pageWidth / 2 : headerAlign === 'right' ? pageWidth - margin : margin;

  doc.setFont(pdfFont, 'bold');
  doc.setTextColor(15, 41, 74);
  doc.setFontSize(13);
  doc.text(t(payload.meta.title), headerX, y, { align: headerAlign });
  y += 5.5;

  if (payload.meta.subtitle.trim()) {
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    doc.text(t(payload.meta.subtitle), headerX, y, { align: headerAlign });
    y += 5;
  }
  if (payload.meta.docNumber.trim()) {
    doc.setFont(pdfFont, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`Nomor: ${t(payload.meta.docNumber)}`, headerX, y, { align: headerAlign });
    y += 6;
  }

  y += 2;
  const baseFontSize = Math.max(8.5, Math.min(13, (payload.typography.fontSizePx || 11) * 0.88));

  for (const sec of payload.sections) {
    if (!sec.visible) continue;

    if (sec.kind === 'divider') {
      ensureSpace(6);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);
      doc.line(margin, y, pageWidth - margin, y);
      y += 5;
      continue;
    }

    if (sec.title.trim()) {
      ensureSpace(12);
      doc.setFont(pdfFont, 'bold');
      doc.setFontSize(baseFontSize + 0.5);
      doc.setTextColor(15, 41, 74);
      doc.text(t(sec.title), margin, y);
      y += 5;
    }

    if (sec.kind === 'paragraph' || sec.kind === 'notes' || sec.kind === 'heading') {
      doc.setFont(
        pdfFont,
        sec.bold && sec.italic
          ? 'bolditalic'
          : sec.bold
            ? 'bold'
            : sec.italic
              ? 'italic'
              : 'normal',
      );
      doc.setFontSize(baseFontSize);
      doc.setTextColor(15, 23, 42);
      const wrapped = doc.splitTextToSize(t(sec.content || ''), contentWidth) as string[];
      for (const line of wrapped) {
        ensureSpace(5);
        doc.text(line, margin, y);
        y += 4.5 * (payload.typography.lineHeight / 1.5);
      }
      y += 3;
    } else if (sec.kind === 'info_grid' && sec.infoRows?.length) {
      autoTable(doc, {
        startY: y,
        body: sec.infoRows.map((r) => [t(r.label), t(r.value)]),
        margin: { left: margin, right: margin, bottom: margin + 10 },
        theme: 'grid',
        styles: { font: pdfFont, fontSize: baseFontSize - 0.8, cellPadding: 2.2 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55, fillColor: [248, 250, 252] } },
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y) + 5;
    } else if (sec.kind === 'stats_cards') {
      autoTable(doc, {
        startY: y,
        head: [['Indikator Evaluasi', 'Nilai Aktual Database']],
        body: [
          ['Peserta Terdaftar / Hadir / Tidak Hadir', `${vars.jumlah_peserta || 0} / ${vars.peserta_hadir || 0} / ${vars.peserta_tidak_hadir || 0}`],
          ['Peserta Menyelesaikan Ujian', `${vars.peserta_selesai || 0} peserta (${vars.jumlah_lulus || 0} memenuhi passing grade)`],
          ['Nilai Tertinggi / Terendah / Rata-rata', `${vars.nilai_tertinggi || 0} / ${vars.nilai_terendah || 0} / ${vars.nilai_rata_rata || 0}`],
          ['Kendala Teknis & Log Pelanggaran', `${vars.gangguan_teknis || 0} kendala · ${vars.total_pelanggaran || 0} catatan`],
        ],
        margin: { left: margin, right: margin, bottom: margin + 10 },
        styles: { font: pdfFont, fontSize: baseFontSize - 0.8, cellPadding: 2.2 },
        headStyles: { fillColor: [15, 41, 74], textColor: [255, 255, 255] },
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y) + 5;
    } else if (sec.kind === 'results_table') {
      autoTable(doc, {
        startY: y,
        head: [['No', 'Nama Peserta', 'Kelas', 'B / S / K', 'Nilai', '%', 'Status']],
        body: tablesData.resultsRows.map((r, i) => [
          i + 1,
          r.nama,
          r.kelas || '—',
          `${r.correct_count}/${r.incorrect_count}/${r.unanswered_count}`,
          `${r.total_score}/${r.max_score}`,
          `${r.percentage.toFixed(1)}%`,
          r.passed ? 'Lulus' : 'Pembinaan',
        ]),
        margin: { left: margin, right: margin, bottom: margin + 10 },
        styles: { font: pdfFont, fontSize: baseFontSize - 1.2, cellPadding: 2.2 },
        headStyles: { fillColor: [15, 41, 74], textColor: [255, 255, 255] },
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y) + 5;
    } else if (sec.kind === 'winners_table') {
      autoTable(doc, {
        startY: y,
        head: [['Peringkat', 'Nama Peserta', 'Kelas', 'Nilai Akhir', 'Kategori Juara', 'Keterangan']],
        body: payload.winnerRows.map((w) => [
          `#${w.rank}`,
          w.nama,
          w.kelas || '—',
          `${w.total_score} (${w.percentage}%)`,
          w.kategori_juara,
          w.keterangan || '—',
        ]),
        margin: { left: margin, right: margin, bottom: margin + 10 },
        styles: { font: pdfFont, fontSize: baseFontSize - 1, cellPadding: 2.3 },
        headStyles: { fillColor: [15, 41, 74], textColor: [255, 255, 255] },
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y) + 5;
    } else if (sec.kind === 'violations_table') {
      autoTable(doc, {
        startY: y,
        head: [['No', 'Peserta', 'Jenis Pelanggaran', 'Waktu', 'Keterangan']],
        body:
          tablesData.violationRows.length > 0
            ? tablesData.violationRows.map((v, i) => [
                i + 1,
                v.nama,
                v.event_type,
                new Date(v.event_time).toLocaleString('id-ID'),
                v.description,
              ])
            : [['—', 'Tidak ada catatan pelanggaran', '—', '—', 'Pelaksanaan tertib']],
        margin: { left: margin, right: margin, bottom: margin + 10 },
        styles: { font: pdfFont, fontSize: baseFontSize - 1.2, cellPadding: 2.2 },
        headStyles: { fillColor: [15, 41, 74], textColor: [255, 255, 255] },
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y) + 5;
    }
  }

  // Place & Date + Signatories block
  ensureSpace(38);
  y += 4;
  if (payload.meta.placeAndDate.trim()) {
    doc.setFont(pdfFont, 'normal');
    doc.setFontSize(baseFontSize);
    doc.setTextColor(15, 23, 42);
    doc.text(t(payload.meta.placeAndDate), pageWidth - margin, y, { align: 'right' });
    y += 7;
  }

  if (payload.signatories.length > 0) {
    const colW = contentWidth / payload.signatories.length;
    payload.signatories.forEach((sig, idx) => {
      const cx = margin + idx * colW + (sig.align === 'center' ? colW / 2 : sig.align === 'right' ? colW - 4 : 0);
      const textAlign = sig.align === 'center' ? 'center' : sig.align === 'right' ? 'right' : 'left';
      doc.setFont(pdfFont, 'normal');
      doc.setFontSize(baseFontSize - 0.5);
      doc.text(t(sig.roleLabel), cx, y, { align: textAlign });

      doc.setFont(pdfFont, 'bold');
      doc.text(t(sig.name), cx, y + 19, { align: textAlign });

      doc.setFont(pdfFont, 'normal');
      doc.setFontSize(baseFontSize - 1.2);
      doc.setTextColor(71, 85, 105);
      doc.text(t(sig.titleOrNip), cx, y + 23.5, { align: textAlign });
      doc.setTextColor(15, 23, 42);
    });
  }

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont(pdfFont, 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    if (payload.headerFooter.headerText.trim() && p > 1) {
      doc.text(t(payload.headerFooter.headerText), pageWidth - margin, 8, { align: 'right' });
    }
    doc.text(t(payload.headerFooter.footerText), margin, pageHeight - 7);
    if (payload.headerFooter.showPageNumbers) {
      doc.text(`Halaman ${p} dari ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
    }
  }

  doc.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}

export function downloadImportTemplate(
  entityType: ImportEntityType,
  format: 'xlsx' | 'csv' = 'xlsx',
) {
  const rows = getSampleTemplateRows(entityType);
  const nameMap: Record<ImportEntityType, { file: string; sheet: string }> = {
    USERS: { file: 'Template_Import_Peserta_KIR_IPA', sheet: 'Peserta' },
    QUESTIONS: { file: 'Template_Import_Bank_Soal_KIR_IPA', sheet: 'Bank_Soal' },
    EXAM_QUESTIONS: { file: 'Template_Import_Soal_Ujian_KIR_IPA', sheet: 'Soal_Ujian' },
    EXAM_PARTICIPANTS: { file: 'Template_Import_Peserta_Ujian_KIR_IPA', sheet: 'Peserta_Ujian' },
  };
  const info = nameMap[entityType];
  if (format === 'csv') {
    exportRowsToCsv(`${info.file}.csv`, rows);
  } else {
    exportRowsToExcel(`${info.file}.xlsx`, info.sheet, rows);
  }
}

export function downloadQuestionImportTemplate() {
  downloadImportTemplate('QUESTIONS', 'xlsx');
}

export function downloadParticipantImportTemplate() {
  downloadImportTemplate('USERS', 'xlsx');
}

export function injectDynamicPrintPageStyle(
  paperSize: PaperSizeOption,
  orientation: PaperOrientationOption,
  marginMm = 12,
) {
  const styleId = 'cbt-dynamic-page-css';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  const sizeExpr =
    paperSize === 'F4'
      ? orientation === 'landscape'
        ? '330mm 215mm'
        : '215mm 330mm'
      : `A4 ${orientation}`;
  styleEl.textContent = `@media print { @page { size: ${sizeExpr}; margin: ${marginMm}mm; } }`;
}

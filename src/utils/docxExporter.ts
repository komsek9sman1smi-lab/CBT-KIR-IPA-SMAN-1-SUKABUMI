import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertMillimetersToTwip,
} from 'docx';
import { interpolateTemplateVariables } from '../shared/documentTemplates';
import type { DocumentContentPayload } from '../shared/types';

export interface OfficialExportTablesData {
  resultsRows: Array<{
    rank: number;
    nama: string;
    kelas: string;
    correct_count: number;
    incorrect_count: number;
    unanswered_count: number;
    total_score: number;
    max_score: number;
    percentage: number;
    passed: boolean;
  }>;
  violationRows: Array<{
    nama: string;
    event_type: string;
    description: string;
    event_time: string;
  }>;
}

const FONT_MAP: Record<DocumentContentPayload['typography']['fontFamily'], string> = {
  sans: 'Calibri',
  serif: 'Georgia',
  times: 'Times New Roman',
  georgia: 'Georgia',
  mono: 'Courier New',
};

async function tryFetchRasterImageBuffer(
  logoUrl: string,
): Promise<{ data: Uint8Array; type: 'png' | 'jpg' } | null> {
  if (!logoUrl) return null;
  try {
    const resolvedUrl = logoUrl.startsWith('/') ? `${window.location.origin}${logoUrl}` : logoUrl;
    const res = await fetch(resolvedUrl);
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('svg')) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) return null;
    const bytes = new Uint8Array(buf);
    const isPng =
      contentType.includes('png') ||
      (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47);
    return {
      data: bytes,
      type: isPng ? 'png' : 'jpg',
    };
  } catch {
    return null;
  }
}

function toDocxAlignment(
  align?: 'left' | 'center' | 'right' | 'justify',
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  switch (align) {
    case 'center':
      return AlignmentType.CENTER;
    case 'right':
      return AlignmentType.RIGHT;
    case 'justify':
      return AlignmentType.JUSTIFIED;
    default:
      return AlignmentType.LEFT;
  }
}

function makeSimpleCell(
  text: string,
  options: {
    bold?: boolean;
    fill?: string;
    color?: string;
    align?: 'left' | 'center' | 'right' | 'justify';
    fontFamily: string;
    fontSizeHalfPt: number;
  },
): TableCell {
  return new TableCell({
    shading: options.fill ? { fill: options.fill } : undefined,
    margins: {
      top: 80,
      bottom: 80,
      left: 110,
      right: 110,
    },
    children: [
      new Paragraph({
        alignment: toDocxAlignment(options.align || 'left'),
        children: [
          new TextRun({
            text,
            bold: options.bold,
            color: options.color || '0F172A',
            font: options.fontFamily,
            size: options.fontSizeHalfPt,
          }),
        ],
      }),
    ],
  });
}

export async function exportOfficialDocumentDocx(
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

  const fontFamily = FONT_MAP[payload.typography.fontFamily] || 'Times New Roman';
  const bodySizeHalfPt = Math.max(16, Math.round((payload.typography.fontSizePx || 11) * 1.9));
  const smallSizeHalfPt = Math.max(14, bodySizeHalfPt - 2);
  const headerBgHex = (payload.tableHeaderBg || '#0F294A').replace('#', '').toUpperCase();

  // Page dimensions in twips: A4 = 210x297mm, F4 (Folio Indonesia) = 215x330mm
  const isF4 = payload.page.paperSize === 'F4';
  const widthMm = isF4 ? 215 : 210;
  const heightMm = isF4 ? 330 : 297;
  const isLandscape = payload.page.orientation === 'landscape';
  const marginTwip = convertMillimetersToTwip(Math.max(10, Math.min(30, payload.page.marginMm || 15)));

  const children: Array<Paragraph | Table> = [];

  // Letterhead with optional logo
  const logoBuffer =
    payload.letterhead.showLogo && payload.letterhead.logoUrl
      ? await tryFetchRasterImageBuffer(payload.letterhead.logoUrl)
      : null;

  const letterheadParagraphs = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 30 },
      children: [
        new TextRun({
          text: t(payload.letterhead.orgLine1),
          bold: true,
          font: fontFamily,
          size: smallSizeHalfPt,
          color: '334155',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 30 },
      children: [
        new TextRun({
          text: t(payload.letterhead.orgLine2),
          bold: true,
          font: fontFamily,
          size: bodySizeHalfPt + 2,
          color: '0F294A',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 30 },
      children: [
        new TextRun({
          text: t(payload.letterhead.institutionName),
          bold: true,
          font: fontFamily,
          size: bodySizeHalfPt + 6,
          color: '0F294A',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: `${t(payload.letterhead.addressLine)} · ${t(payload.letterhead.contactLine)}`,
          font: fontFamily,
          size: Math.max(14, smallSizeHalfPt - 2),
          color: '475569',
        }),
      ],
    }),
  ];

  if (logoBuffer) {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE },
          bottom:
            payload.letterhead.borderStyle === 'none'
              ? { style: BorderStyle.NONE }
              : {
                  style:
                    payload.letterhead.borderStyle === 'double'
                      ? BorderStyle.DOUBLE
                      : BorderStyle.SINGLE,
                  size: 16,
                  color: '0F294A',
                },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 16, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new ImageRun({
                        data: logoBuffer.data,
                        type: logoBuffer.type,
                        transformation: { width: 58, height: 58 },
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 84, type: WidthType.PERCENTAGE },
                children: letterheadParagraphs,
              }),
            ],
          }),
        ],
      }),
    );
  } else {
    children.push(...letterheadParagraphs);
    if (payload.letterhead.borderStyle !== 'none') {
      children.push(
        new Paragraph({
          border: {
            bottom: {
              style:
                payload.letterhead.borderStyle === 'double'
                  ? BorderStyle.DOUBLE
                  : BorderStyle.SINGLE,
              size: 14,
              color: '0F294A',
            },
          },
          spacing: { after: 140 },
          children: [],
        }),
      );
    }
  }

  // Document Title & Subtitle
  children.push(
    new Paragraph({
      alignment: toDocxAlignment(payload.typography.headerAlign),
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 180, after: 40 },
      children: [
        new TextRun({
          text: t(payload.meta.title),
          bold: true,
          font: fontFamily,
          size: bodySizeHalfPt + 6,
          color: '0F294A',
        }),
      ],
    }),
  );

  if (payload.meta.subtitle.trim()) {
    children.push(
      new Paragraph({
        alignment: toDocxAlignment(payload.typography.headerAlign),
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: t(payload.meta.subtitle),
            bold: true,
            font: fontFamily,
            size: bodySizeHalfPt,
            color: '334155',
          }),
        ],
      }),
    );
  }

  if (payload.meta.docNumber.trim()) {
    children.push(
      new Paragraph({
        alignment: toDocxAlignment(payload.typography.headerAlign),
        spacing: { after: 160 },
        children: [
          new TextRun({
            text: `Nomor Dokumen: ${t(payload.meta.docNumber)}`,
            font: fontFamily,
            size: smallSizeHalfPt,
            color: '475569',
          }),
        ],
      }),
    );
  }

  // Dynamic Sections
  for (const sec of payload.sections) {
    if (!sec.visible) continue;

    if (sec.kind === 'divider') {
      children.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' } },
          spacing: { before: 100, after: 100 },
          children: [],
        }),
      );
      continue;
    }

    if (sec.title.trim()) {
      children.push(
        new Paragraph({
          spacing: { before: 160, after: 60 },
          children: [
            new TextRun({
              text: t(sec.title),
              bold: true,
              font: fontFamily,
              size: bodySizeHalfPt + 2,
              color: '0F294A',
            }),
          ],
        }),
      );
    }

    if (sec.kind === 'paragraph' || sec.kind === 'notes' || sec.kind === 'heading') {
      const lines = t(sec.content || '').split('\n');
      for (const line of lines) {
        children.push(
          new Paragraph({
            alignment: toDocxAlignment(sec.align || payload.typography.bodyAlign),
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: line,
                bold: Boolean(sec.bold),
                italics: Boolean(sec.italic),
                font: fontFamily,
                size: bodySizeHalfPt,
                color: '0F172A',
              }),
            ],
          }),
        );
      }
    } else if (sec.kind === 'info_grid' && sec.infoRows?.length) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: sec.infoRows.map(
            (row) =>
              new TableRow({
                children: [
                  makeSimpleCell(t(row.label), {
                    bold: true,
                    fill: 'F8FAFC',
                    fontFamily,
                    fontSizeHalfPt: smallSizeHalfPt,
                  }),
                  makeSimpleCell(t(row.value), {
                    fontFamily,
                    fontSizeHalfPt: smallSizeHalfPt,
                  }),
                ],
              }),
          ),
        }),
      );
    } else if (sec.kind === 'stats_cards') {
      const statSummaryRows = [
        ['Peserta Terdaftar', vars.jumlah_peserta || '0'],
        ['Peserta Mengikuti', vars.peserta_hadir || '0'],
        ['Tidak Hadir', vars.peserta_tidak_hadir || '0'],
        ['Peserta Selesai', vars.peserta_selesai || '0'],
        ['Nilai Tertinggi', vars.nilai_tertinggi || '0'],
        ['Nilai Terendah', vars.nilai_terendah || '0'],
        ['Nilai Rata-rata', vars.nilai_rata_rata || '0'],
        ['Total Catatan Pelanggaran', vars.total_pelanggaran || '0'],
      ];
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: statSummaryRows.map(
            ([lbl, val]) =>
              new TableRow({
                children: [
                  makeSimpleCell(lbl, {
                    bold: true,
                    fill: 'F1F5F9',
                    fontFamily,
                    fontSizeHalfPt: smallSizeHalfPt,
                  }),
                  makeSimpleCell(val, {
                    fontFamily,
                    fontSizeHalfPt: smallSizeHalfPt,
                  }),
                ],
              }),
          ),
        }),
      );
      if (sec.content.trim()) {
        children.push(
          new Paragraph({
            spacing: { before: 80, after: 80 },
            children: [
              new TextRun({
                text: t(sec.content),
                font: fontFamily,
                size: smallSizeHalfPt,
                color: '334155',
              }),
            ],
          }),
        );
      }
    } else if (sec.kind === 'results_table') {
      const headerRow = new TableRow({
        tableHeader: true,
        children: ['No', 'Nama Peserta', 'Kelas', 'B / S / K', 'Nilai', 'Persentase', 'Status'].map(
          (col) =>
            makeSimpleCell(col, {
              bold: true,
              fill: headerBgHex,
              color: 'FFFFFF',
              fontFamily,
              fontSizeHalfPt: smallSizeHalfPt,
            }),
        ),
      });
      const bodyRows = tablesData.resultsRows.map(
        (r, i) =>
          new TableRow({
            children: [
              makeSimpleCell(String(i + 1), { fontFamily, fontSizeHalfPt: smallSizeHalfPt }),
              makeSimpleCell(r.nama, { fontFamily, fontSizeHalfPt: smallSizeHalfPt }),
              makeSimpleCell(r.kelas || '—', { fontFamily, fontSizeHalfPt: smallSizeHalfPt }),
              makeSimpleCell(`${r.correct_count}/${r.incorrect_count}/${r.unanswered_count}`, {
                fontFamily,
                fontSizeHalfPt: smallSizeHalfPt,
              }),
              makeSimpleCell(`${r.total_score}/${r.max_score}`, {
                bold: true,
                fontFamily,
                fontSizeHalfPt: smallSizeHalfPt,
              }),
              makeSimpleCell(`${r.percentage.toFixed(1)}%`, {
                fontFamily,
                fontSizeHalfPt: smallSizeHalfPt,
              }),
              makeSimpleCell(r.passed ? 'Lulus' : 'Pembinaan', {
                fontFamily,
                fontSizeHalfPt: smallSizeHalfPt,
              }),
            ],
          }),
      );
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows:
            bodyRows.length > 0
              ? [headerRow, ...bodyRows]
              : [
                  headerRow,
                  new TableRow({
                    children: [
                      makeSimpleCell('Belum ada hasil ujian tercatat.', {
                        fontFamily,
                        fontSizeHalfPt: smallSizeHalfPt,
                      }),
                    ],
                  }),
                ],
        }),
      );
    } else if (sec.kind === 'winners_table') {
      const headerRow = new TableRow({
        tableHeader: true,
        children: ['Peringkat', 'Nama Peserta', 'Kelas', 'Nilai Akhir', 'Kategori Juara', 'Keterangan'].map(
          (col) =>
            makeSimpleCell(col, {
              bold: true,
              fill: headerBgHex,
              color: 'FFFFFF',
              fontFamily,
              fontSizeHalfPt: smallSizeHalfPt,
            }),
        ),
      });
      const bodyRows = payload.winnerRows.map(
        (w) =>
          new TableRow({
            children: [
              makeSimpleCell(`#${w.rank}`, {
                bold: true,
                fontFamily,
                fontSizeHalfPt: smallSizeHalfPt,
              }),
              makeSimpleCell(w.nama, { bold: true, fontFamily, fontSizeHalfPt: smallSizeHalfPt }),
              makeSimpleCell(w.kelas || '—', { fontFamily, fontSizeHalfPt: smallSizeHalfPt }),
              makeSimpleCell(`${w.total_score} (${w.percentage}%)`, {
                fontFamily,
                fontSizeHalfPt: smallSizeHalfPt,
              }),
              makeSimpleCell(w.kategori_juara, {
                bold: true,
                fontFamily,
                fontSizeHalfPt: smallSizeHalfPt,
              }),
              makeSimpleCell(w.keterangan || '—', { fontFamily, fontSizeHalfPt: smallSizeHalfPt }),
            ],
          }),
      );
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows:
            bodyRows.length > 0
              ? [headerRow, ...bodyRows]
              : [
                  headerRow,
                  new TableRow({
                    children: [
                      makeSimpleCell('Daftar pemenang belum ditambahkan.', {
                        fontFamily,
                        fontSizeHalfPt: smallSizeHalfPt,
                      }),
                    ],
                  }),
                ],
        }),
      );
    } else if (sec.kind === 'violations_table') {
      if (tablesData.violationRows.length === 0) {
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: 'Tidak ada catatan pelanggaran pada pelaksanaan ujian ini.',
                italics: true,
                font: fontFamily,
                size: smallSizeHalfPt,
                color: '475569',
              }),
            ],
          }),
        );
      } else {
        const headerRow = new TableRow({
          tableHeader: true,
          children: ['No', 'Peserta', 'Jenis Pelanggaran', 'Waktu', 'Keterangan'].map((col) =>
            makeSimpleCell(col, {
              bold: true,
              fill: headerBgHex,
              color: 'FFFFFF',
              fontFamily,
              fontSizeHalfPt: smallSizeHalfPt,
            }),
          ),
        });
        const vRows = tablesData.violationRows.map(
          (v, i) =>
            new TableRow({
              children: [
                makeSimpleCell(String(i + 1), { fontFamily, fontSizeHalfPt: smallSizeHalfPt }),
                makeSimpleCell(v.nama, { fontFamily, fontSizeHalfPt: smallSizeHalfPt }),
                makeSimpleCell(v.event_type, { fontFamily, fontSizeHalfPt: smallSizeHalfPt }),
                makeSimpleCell(new Date(v.event_time).toLocaleString('id-ID'), {
                  fontFamily,
                  fontSizeHalfPt: smallSizeHalfPt,
                }),
                makeSimpleCell(v.description, { fontFamily, fontSizeHalfPt: smallSizeHalfPt }),
              ],
            }),
        );
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [headerRow, ...vRows],
          }),
        );
      }
    }
  }

  // Place & Date + Signatories
  if (payload.meta.placeAndDate.trim()) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 240, after: 80 },
        children: [
          new TextRun({
            text: t(payload.meta.placeAndDate),
            font: fontFamily,
            size: bodySizeHalfPt,
          }),
        ],
      }),
    );
  }

  if (payload.signatories.length > 0) {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE },
          bottom: { style: BorderStyle.NONE },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE },
        },
        rows: [
          new TableRow({
            children: payload.signatories.map((sig) => {
              const align = toDocxAlignment(sig.align);
              return new TableCell({
                children: [
                  new Paragraph({
                    alignment: align,
                    spacing: { after: 40 },
                    children: [
                      new TextRun({
                        text: t(sig.roleLabel),
                        font: fontFamily,
                        size: smallSizeHalfPt,
                      }),
                    ],
                  }),
                  new Paragraph({
                    alignment: align,
                    spacing: { before: 420, after: 20 },
                    children: [
                      new TextRun({
                        text: t(sig.name),
                        bold: true,
                        underline: {},
                        font: fontFamily,
                        size: smallSizeHalfPt,
                      }),
                    ],
                  }),
                  new Paragraph({
                    alignment: align,
                    children: [
                      new TextRun({
                        text: t(sig.titleOrNip),
                        font: fontFamily,
                        size: Math.max(14, smallSizeHalfPt - 2),
                        color: '475569',
                      }),
                    ],
                  }),
                ],
              });
            }),
          }),
        ],
      }),
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(widthMm),
              height: convertMillimetersToTwip(heightMm),
              orientation: isLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: marginTwip,
              bottom: marginTwip,
              left: marginTwip,
              right: marginTwip,
            },
          },
        },
        headers: payload.headerFooter.headerText.trim()
          ? {
              default: new Header({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({
                        text: t(payload.headerFooter.headerText),
                        italics: true,
                        font: fontFamily,
                        size: 16,
                        color: '64748B',
                      }),
                    ],
                  }),
                ],
              }),
            }
          : undefined,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `${t(payload.headerFooter.footerText)}${
                      payload.headerFooter.showPageNumbers ? '   ·   Halaman ' : ''
                    }`,
                    font: fontFamily,
                    size: 16,
                    color: '64748B',
                  }),
                  ...(payload.headerFooter.showPageNumbers
                    ? [
                        new TextRun({ children: [PageNumber.CURRENT], font: fontFamily, size: 16 }),
                        new TextRun({ text: ' / ', font: fontFamily, size: 16 }),
                        new TextRun({
                          children: [PageNumber.TOTAL_PAGES],
                          font: fontFamily,
                          size: 16,
                        }),
                      ]
                    : []),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.docx') ? fileName : `${fileName}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

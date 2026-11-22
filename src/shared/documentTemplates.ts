import type {
  AppSettingsMap,
  DocumentCategory,
  DocumentContentPayload,
  DocumentWinnerRow,
  ExamRecord,
} from './types.ts';

export interface TemplateVariableMeta {
  key: string;
  label: string;
  example: string;
}

export const AVAILABLE_TEMPLATE_VARIABLES: TemplateVariableMeta[] = [
  { key: 'nama_kegiatan', label: 'Nama Kegiatan / Subjek', example: 'Seleksi Internal OSN KIR IPA 2026' },
  { key: 'nama_ujian', label: 'Nama Ujian', example: 'Tryout Dasar Olimpiade Sains Tahap 1' },
  { key: 'bidang_mapel', label: 'Bidang / Mata Pelajaran', example: 'Sains Terpadu (IPA)' },
  { key: 'hari_pelaksanaan', label: 'Hari Pelaksanaan', example: 'Senin' },
  { key: 'tanggal_pelaksanaan', label: 'Tanggal Pelaksanaan', example: '12 Oktober 2026' },
  { key: 'waktu_mulai', label: 'Waktu Mulai', example: '08:00 WIB' },
  { key: 'waktu_selesai', label: 'Waktu Selesai', example: '09:30 WIB' },
  { key: 'durasi_menit', label: 'Durasi Ujian', example: '60 Menit' },
  { key: 'tempat_pelaksanaan', label: 'Tempat Pelaksanaan', example: 'Lab Komputer SMA Negeri 1 Sukabumi' },
  { key: 'nama_instansi', label: 'Nama Organisasi / Penyelenggara', example: 'Kelompok Ilmiah Remaja (KIR) IPA' },
  { key: 'nama_sekolah', label: 'Nama Sekolah', example: 'SMA Negeri 1 Sukabumi' },
  { key: 'tahun_ajaran', label: 'Tahun Ajaran', example: '2026 / 2027' },
  { key: 'jumlah_peserta', label: 'Jumlah Peserta Terdaftar', example: '30' },
  { key: 'peserta_hadir', label: 'Peserta Mengikuti Ujian', example: '28' },
  { key: 'peserta_tidak_hadir', label: 'Peserta Tidak Hadir', example: '2' },
  { key: 'peserta_selesai', label: 'Peserta Menyelesaikan Ujian', example: '28' },
  { key: 'gangguan_teknis', label: 'Kendala Teknis', example: '0' },
  { key: 'nilai_tertinggi', label: 'Nilai Tertinggi', example: '98.5' },
  { key: 'nilai_terendah', label: 'Nilai Terendah', example: '42.0' },
  { key: 'nilai_rata_rata', label: 'Nilai Rata-rata', example: '78.4' },
  { key: 'passing_grade', label: 'Passing Grade', example: '75%' },
  { key: 'jumlah_lulus', label: 'Jumlah Peserta Lulus', example: '22' },
  { key: 'total_pelanggaran', label: 'Total Catatan Pelanggaran', example: '1' },
  { key: 'pemenang_utama', label: 'Nama Pemenang Peringkat 1', example: 'Nadia Putri Ramadhani (XI-IPA-1)' },
  { key: 'nama_peserta', label: 'Daftar Singkat Juara 1–3', example: '1. Nadia Putri Ramadhani, 2. Rafi Ahmad Fauzan' },
  { key: 'asal_kelas', label: 'Kelas Peringkat 1', example: 'XI-IPA-1' },
  { key: 'nilai_akhir', label: 'Nilai Tertinggi / Akhir', example: '98.5' },
  { key: 'peringkat', label: 'Peringkat Utama', example: 'Peringkat 1' },
  { key: 'kategori_juara', label: 'Kategori Penghargaan Utama', example: 'Juara I' },
  { key: 'ringkasan_hasil', label: 'Ringkasan Statistik Otomatis', example: '28 peserta selesai dengan rata-rata 78.4' },
  { key: 'tanggal_terbit', label: 'Tanggal Penerbitan Dokumen', example: '22 November 2026' },
  { key: 'nama_penanggung_jawab', label: 'Nama Penanggung Jawab', example: 'Drs. Hendra Wijaya, M.Pd.' },
];

export interface DocumentVariableContext {
  exam?: Partial<ExamRecord>;
  settings?: Partial<AppSettingsMap>;
  registeredCount: number;
  attendedCount: number;
  absentCount: number;
  completedCount: number;
  technicalIssuesCount: number;
  highestScore: number;
  lowestScore: number;
  averageScore: number;
  passingGrade: number;
  passedCount: number;
  violationsCount: number;
  supervisorName?: string;
  topWinner?: Partial<DocumentWinnerRow>;
  winners?: DocumentWinnerRow[];
  venue?: string;
  issuedDate?: Date;
}

export function sanitizeLogoUrl(url: string | undefined | null): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '/src/assets/images/kir_ipa_logo_1795216569338.jpg';
  if (raw.startsWith('/')) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(raw)) return raw;
  return '/src/assets/images/kir_ipa_logo_1795216569338.jpg';
}

export function computeDocumentVariables(ctx: DocumentVariableContext): Record<string, string> {
  const startDate = ctx.exam?.start_time ? new Date(ctx.exam.start_time) : new Date();
  const endDate = ctx.exam?.end_time ? new Date(ctx.exam.end_time) : new Date();
  const validStart = Number.isNaN(startDate.getTime()) ? new Date() : startDate;
  const validEnd = Number.isNaN(endDate.getTime()) ? new Date() : endDate;
  const issued = ctx.issuedDate ?? new Date();

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
  const formatDate = (d: Date) =>
    d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const formatWeekday = (d: Date) => d.toLocaleDateString('id-ID', { weekday: 'long' });

  const winner = ctx.topWinner ?? ctx.winners?.[0];
  const top3Text = (ctx.winners ?? [])
    .slice(0, 3)
    .map((w, idx) => `${idx + 1}. ${w.nama} (${w.kelas}) - ${w.kategori_juara} [${w.total_score}]`)
    .join('; ');

  return {
    nama_kegiatan: ctx.exam?.title || 'Kegiatan Evaluasi Akademik KIR IPA',
    nama_ujian: ctx.exam?.title || 'Ujian Seleksi KIR IPA',
    bidang_mapel: ctx.exam?.subject || 'IPA Terpadu',
    hari_pelaksanaan: formatWeekday(validStart),
    tanggal_pelaksanaan: formatDate(validStart),
    waktu_mulai: formatTime(validStart),
    waktu_selesai: formatTime(validEnd),
    durasi_menit: `${ctx.exam?.duration ?? 60} Menit`,
    tempat_pelaksanaan: ctx.venue || 'Portal CBT Digital SMA Negeri 1 Sukabumi',
    nama_instansi: ctx.settings?.org_name || 'Kelompok Ilmiah Remaja (KIR) IPA',
    nama_sekolah: ctx.settings?.school_name || 'SMA Negeri 1 Sukabumi',
    tahun_ajaran: ctx.settings?.academic_year || '2026 / 2027',
    jumlah_peserta: String(ctx.registeredCount),
    peserta_terdaftar: String(ctx.registeredCount),
    peserta_hadir: String(ctx.attendedCount),
    peserta_tidak_hadir: String(ctx.absentCount),
    peserta_selesai: String(ctx.completedCount),
    gangguan_teknis: String(ctx.technicalIssuesCount),
    nilai_tertinggi: Number(ctx.highestScore || 0).toFixed(2).replace(/\.00$/, ''),
    nilai_terendah: Number(ctx.lowestScore || 0).toFixed(2).replace(/\.00$/, ''),
    nilai_rata_rata: Number(ctx.averageScore || 0).toFixed(2).replace(/\.00$/, ''),
    passing_grade: `${ctx.passingGrade ?? 75}%`,
    jumlah_lulus: String(ctx.passedCount),
    total_pelanggaran: String(ctx.violationsCount),
    pemenang_utama: winner ? `${winner.nama} (${winner.kelas || '-'})` : 'Belum tersedia',
    nama_peserta: top3Text || winner?.nama || 'Belum ada data',
    asal_kelas: winner?.kelas || '-',
    nilai_akhir: winner ? String(winner.total_score) : Number(ctx.highestScore || 0).toFixed(2).replace(/\.00$/, ''),
    peringkat: winner ? `Peringkat ${winner.rank}` : 'Peringkat 1',
    kategori_juara: winner?.kategori_juara || 'Juara I',
    ringkasan_hasil: `${ctx.completedCount} dari ${ctx.registeredCount} peserta terdaftar telah menyelesaikan ujian dengan nilai rata-rata ${Number(ctx.averageScore || 0).toFixed(1)}, nilai tertinggi ${Number(ctx.highestScore || 0).toFixed(1)}, dan tingkat kelulusan ${ctx.passedCount} peserta.`,
    keterangan_tambahan: ctx.violationsCount > 0
      ? `Tercatat ${ctx.violationsCount} log pengawasan integritas ujian dan seluruhnya telah diverifikasi panitia.`
      : 'Pelaksanaan ujian berjalan tertib, objektif, dan bebas dari gangguan teknis yang berarti.',
    tanggal_terbit: formatDate(issued),
    nama_penanggung_jawab: ctx.supervisorName || 'Pembina Utama KIR IPA',
  };
}

export function interpolateTemplateVariables(
  templateText: string,
  variables: Record<string, string>,
): string {
  return String(templateText ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key: string) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : `{{${key}}}`;
  });
}

export function defaultAwardCategoryForRank(rank: number): string {
  if (rank === 1) return 'Juara I (Terbaik 1)';
  if (rank === 2) return 'Juara II (Terbaik 2)';
  if (rank === 3) return 'Juara III (Terbaik 3)';
  if (rank === 4) return 'Harapan I';
  if (rank === 5) return 'Harapan II';
  if (rank === 6) return 'Harapan III';
  return `Finalis / Peringkat ${rank}`;
}

export function buildDefaultWinnerRows(
  ranked: Array<{
    rank: number;
    user_id?: string;
    nama: string;
    kelas: string;
    total_score: number;
    max_score: number;
    percentage: number;
  }>,
  passingGrade = 75,
): DocumentWinnerRow[] {
  return ranked.map((r) => ({
    rank: r.rank,
    user_id: r.user_id,
    nama: r.nama,
    kelas: r.kelas || '—',
    total_score: r.total_score,
    max_score: r.max_score,
    percentage: r.percentage,
    kategori_juara: defaultAwardCategoryForRank(r.rank),
    keterangan: r.percentage >= passingGrade ? 'Lulus / Memenuhi Kriteria' : 'Peserta Aktif',
  }));
}

export function createDefaultTemplatePayload(
  category: DocumentCategory,
  settings?: Partial<AppSettingsMap>,
): DocumentContentPayload {
  const school = settings?.school_name || 'SMA NEGERI 1 SUKABUMI';
  const org = settings?.org_name || 'KELOMPOK ILMIAH REMAJA (KIR) IPA';
  const logoUrl = sanitizeLogoUrl(settings?.logo_url);
  const contact = settings?.contact_info || 'Jl. RH. Didi Sukardi No. 124, Sukabumi · kiripa@sman1sukabumi.sch.id';
  const footerText =
    settings?.report_footer || 'Dokumen Resmi Panitia Evaluasi Akademik KIR IPA SMA Negeri 1 Sukabumi';

  const baseLetterhead = {
    showLogo: true,
    logoUrl,
    orgLine1: 'PEMERINTAH DAERAH PROVINSI JAWA BARAT · DINAS PENDIDIKAN',
    orgLine2: org.toUpperCase(),
    institutionName: school.toUpperCase(),
    addressLine: 'Sekretariat KIR IPA SMA Negeri 1 Sukabumi',
    contactLine: contact,
    borderStyle: 'double' as const,
  };

  if (category === 'LAPORAN_HASIL') {
    return {
      typography: {
        fontFamily: 'sans',
        fontSizePx: 11,
        lineHeight: 1.5,
        headerAlign: 'center',
        bodyAlign: 'left',
      },
      page: {
        paperSize: 'A4',
        orientation: 'portrait',
        marginMm: 15,
      },
      letterhead: baseLetterhead,
      meta: {
        title: 'LAPORAN HASIL PELAKSANAAN UJIAN DIGITAL',
        subtitle: '{{nama_ujian}} · Bidang {{bidang_mapel}}',
        docNumber: 'LAP/KIR-IPA/2026/001',
        subjectLine: 'Laporan Evaluasi & Rekapitulasi Nilai Peserta',
        activityName: '{{nama_kegiatan}}',
        placeAndDate: 'Sukabumi, {{tanggal_terbit}}',
      },
      sections: [
        {
          id: 'sec_identitas',
          kind: 'info_grid',
          title: 'I. Identitas Pelaksanaan Ujian',
          content: '',
          visible: true,
          infoRows: [
            { label: 'Nama Kegiatan / Ujian', value: '{{nama_ujian}}' },
            { label: 'Bidang / Mata Pelajaran', value: '{{bidang_mapel}}' },
            { label: 'Hari / Tanggal Pelaksanaan', value: '{{hari_pelaksanaan}}, {{tanggal_pelaksanaan}}' },
            { label: 'Durasi & Tahun Ajaran', value: '{{durasi_menit}} · T.A. {{tahun_ajaran}}' },
            { label: 'Penanggung Jawab', value: '{{nama_penanggung_jawab}}' },
          ],
        },
        {
          id: 'sec_stats',
          kind: 'stats_cards',
          title: 'II. Ringkasan Partisipasi & Statistik Nilai',
          content: '{{ringkasan_hasil}}',
          visible: true,
        },
        {
          id: 'sec_narasi',
          kind: 'paragraph',
          title: 'III. Uraian Pelaksanaan',
          content:
            'Pelaksanaan {{nama_ujian}} diikuti oleh {{peserta_hadir}} peserta dari total {{peserta_terdaftar}} peserta terdaftar ({{peserta_tidak_hadir}} tidak hadir). Sebanyak {{peserta_selesai}} peserta berhasil menyelesaikan ujian dengan nilai tertinggi {{nilai_tertinggi}}, nilai terendah {{nilai_terendah}}, dan rata-rata {{nilai_rata_rata}}.',
          visible: true,
          align: 'justify',
        },
        {
          id: 'sec_tabel_hasil',
          kind: 'results_table',
          title: 'IV. Rekapitulasi Daftar Nilai & Peringkat Peserta',
          content: '',
          visible: true,
          tableColumns: ['peringkat', 'nama', 'kelas', 'benar_salah', 'nilai_akhir', 'persentase', 'status_lulus'],
        },
        {
          id: 'sec_pelanggaran',
          kind: 'violations_table',
          title: 'V. Rekapitulasi Pengawasan & Integritas',
          content: '{{keterangan_tambahan}}',
          visible: true,
        },
        {
          id: 'sec_catatan',
          kind: 'notes',
          title: 'VI. Catatan & Rekomendasi Tindak Lanjut',
          content:
            'Peserta yang memenuhi kriteria batas kelulusan ({{passing_grade}}) berhak mengikuti pembinaan lanjutan maupun seleksi tahap berikutnya bersama tim pembina {{nama_instansi}}.',
          visible: true,
        },
      ],
      winnerRows: [],
      signatories: [
        {
          id: 'sig_1',
          roleLabel: 'Ketua Pelaksana Kegiatan',
          name: 'Panitia Evaluasi KIR IPA',
          titleOrNip: 'Sekretariat {{nama_instansi}}',
          align: 'left',
        },
        {
          id: 'sig_2',
          roleLabel: 'Pembina / Penanggung Jawab',
          name: '{{nama_penanggung_jawab}}',
          titleOrNip: '{{nama_sekolah}}',
          align: 'right',
        },
      ],
      headerFooter: {
        headerText: '{{nama_instansi}} · {{nama_sekolah}}',
        footerText,
        showPageNumbers: true,
      },
      showStampArea: false,
      tableHeaderBg: '#0F294A',
    };
  }

  if (category === 'BERITA_ACARA') {
    return {
      typography: {
        fontFamily: 'serif',
        fontSizePx: 11,
        lineHeight: 1.55,
        headerAlign: 'center',
        bodyAlign: 'justify',
      },
      page: {
        paperSize: 'F4',
        orientation: 'portrait',
        marginMm: 16,
      },
      letterhead: baseLetterhead,
      meta: {
        title: 'BERITA ACARA HASIL PELAKSANAAN UJIAN / LOMBA',
        subtitle: '{{nama_ujian}}',
        docNumber: 'BA/014/KIR-IPA/SMAN1-SMI/2026',
        subjectLine: 'Berita Acara Resmi Penyelenggaraan & Penetapan Hasil',
        activityName: '{{nama_kegiatan}}',
        placeAndDate: 'Sukabumi, {{tanggal_terbit}}',
      },
      sections: [
        {
          id: 'ba_pembuka',
          kind: 'paragraph',
          title: 'I. Pernyataan Pelaksanaan',
          content:
            'Pada hari ini, {{hari_pelaksanaan}} tanggal {{tanggal_pelaksanaan}}, bertempat di {{tempat_pelaksanaan}}, telah diselenggarakan kegiatan {{nama_ujian}} bidang {{bidang_mapel}} di bawah koordinasi {{nama_instansi}} {{nama_sekolah}} Tahun Ajaran {{tahun_ajaran}}.',
          visible: true,
          align: 'justify',
        },
        {
          id: 'ba_identitas',
          kind: 'info_grid',
          title: 'II. Identitas Kegiatan, Panitia & Kehadiran',
          content: '',
          visible: true,
          infoRows: [
            { label: 'Nama Kegiatan / Ujian', value: '{{nama_ujian}}' },
            { label: 'Bidang / Lomba', value: '{{bidang_mapel}}' },
            { label: 'Waktu & Tempat', value: '{{waktu_mulai}} – {{waktu_selesai}} · {{tempat_pelaksanaan}}' },
            { label: 'Jumlah Peserta Terdaftar', value: '{{peserta_terdaftar}} peserta' },
            { label: 'Peserta Mengikuti / Selesai', value: '{{peserta_hadir}} hadir / {{peserta_selesai}} selesai ({{peserta_tidak_hadir}} tidak hadir)' },
            { label: 'Kendala & Pengawasan', value: '{{gangguan_teknis}} gangguan teknis · {{total_pelanggaran}} log pelanggaran' },
          ],
        },
        {
          id: 'ba_uraian',
          kind: 'paragraph',
          title: 'III. Uraian Singkat & Statistik Hasil',
          content:
            'Berdasarkan rekapitulasi sistem penilaian CBT, diperoleh nilai tertinggi {{nilai_tertinggi}}, nilai terendah {{nilai_terendah}}, dan nilai rata-rata {{nilai_rata_rata}}. Peringkat pertama diraih oleh {{pemenang_utama}} dengan perolehan nilai {{nilai_akhir}}.',
          visible: true,
          align: 'justify',
        },
        {
          id: 'ba_tabel_hasil',
          kind: 'winners_table',
          title: 'IV. Tabel Hasil Akhir / Daftar Peringkat Pemenang',
          content: '',
          visible: true,
          tableColumns: ['peringkat', 'nama', 'kelas', 'nilai_akhir', 'persentase', 'kategori_juara'],
        },
        {
          id: 'ba_keterangan',
          kind: 'notes',
          title: 'V. Keterangan Tambahan',
          content: '{{keterangan_tambahan}}',
          visible: true,
        },
        {
          id: 'ba_penutup',
          kind: 'paragraph',
          title: 'VI. Penutup',
          content:
            'Demikian Berita Acara Hasil Pelaksanaan Ujian/Lomba ini dibuat dengan sebenar-benarnya untuk dapat dipergunakan sebagaimana mestinya sebagai dokumen pertanggungjawaban akademik dan administratif resmi.',
          visible: true,
          align: 'justify',
        },
      ],
      winnerRows: [],
      signatories: [
        {
          id: 'ba_sig_ketua',
          roleLabel: 'Ketua Pelaksana,',
          name: '{{nama_penanggung_jawab}}',
          titleOrNip: 'Pembina / Ketua Panitia',
          align: 'left',
        },
        {
          id: 'ba_sig_sekretaris',
          roleLabel: 'Sekretaris / Pengawas Ruang,',
          name: 'Sekretaris Panitia CBT',
          titleOrNip: '{{nama_instansi}}',
          align: 'center',
        },
        {
          id: 'ba_sig_mengetahui',
          roleLabel: 'Mengetahui, Pihak Terkait / Pembina',
          name: 'Koordinator Kesiswaan / Pembina',
          titleOrNip: '{{nama_sekolah}}',
          align: 'right',
        },
      ],
      headerFooter: {
        headerText: 'Berita Acara Resmi · {{nama_ujian}}',
        footerText,
        showPageNumbers: true,
      },
      showStampArea: true,
      tableHeaderBg: '#0F294A',
    };
  }

  // PENGUMUMAN_PEMENANG
  return {
    typography: {
      fontFamily: 'serif',
      fontSizePx: 11,
      lineHeight: 1.55,
      headerAlign: 'center',
      bodyAlign: 'justify',
    },
    page: {
      paperSize: 'A4',
      orientation: 'portrait',
      marginMm: 16,
    },
    letterhead: baseLetterhead,
    meta: {
      title: 'SURAT KEPUTUSAN & PENGUMUMAN RESMI PENETAPAN PEMENANG',
      subtitle: '{{nama_ujian}} · Bidang {{bidang_mapel}}',
      docNumber: 'SK-PEM/021/KIR-IPA/2026',
      subjectLine: 'Penetapan Hasil Akhir dan Pemenang {{nama_ujian}}',
      activityName: '{{nama_kegiatan}}',
      placeAndDate: 'Sukabumi, {{tanggal_terbit}}',
    },
    sections: [
      {
        id: 'sk_perihal',
        kind: 'info_grid',
        title: 'Identitas Surat Resmi',
        content: '',
        visible: true,
        infoRows: [
          { label: 'Nomor Surat', value: 'SK-PEM/021/KIR-IPA/2026' },
          { label: 'Perihal', value: 'Pengumuman Hasil Akhir & Penetapan Pemenang {{nama_ujian}}' },
          { label: 'Kegiatan / Bidang', value: '{{nama_kegiatan}} ({{bidang_mapel}})' },
          { label: 'Tanggal Pelaksanaan', value: '{{hari_pelaksanaan}}, {{tanggal_pelaksanaan}}' },
          { label: 'Total Peserta Evaluasi', value: '{{peserta_selesai}} dari {{peserta_terdaftar}} peserta' },
        ],
      },
      {
        id: 'sk_dasar',
        kind: 'paragraph',
        title: 'I. Dasar dan Pertimbangan Penetapan',
        content:
          'Berdasarkan hasil verifikasi lembar jawaban digital, penilaian soal objektif dan esai, serta rekapitulasi catatan pengawasan ujian pada {{nama_ujian}} yang diselenggarakan oleh {{nama_instansi}} {{nama_sekolah}} pada tanggal {{tanggal_pelaksanaan}}, panitia dan tim dewan juri telah menetapkan hasil akhir yang sah dan objektif.',
        visible: true,
        align: 'justify',
      },
      {
        id: 'sk_pernyataan',
        kind: 'paragraph',
        title: 'II. Pernyataan Penetapan Hasil Akhir',
        content:
          'Dengan memohon rahmat Tuhan Yang Maha Esa, Panitia Pelaksana {{nama_instansi}} menetapkan daftar peserta peraih peringkat terbaik dan pemenang pada kegiatan {{nama_kegiatan}} (nilai tertinggi {{nilai_tertinggi}}, rata-rata {{nilai_rata_rata}}) sebagaimana tercantum pada tabel berikut:',
        visible: true,
        align: 'justify',
      },
      {
        id: 'sk_tabel_pemenang',
        kind: 'winners_table',
        title: 'III. Daftar Pemenang dan Kategori Penghargaan',
        content: '',
        visible: true,
        tableColumns: ['peringkat', 'nama', 'kelas', 'nilai_akhir', 'persentase', 'kategori_juara', 'keterangan'],
      },
      {
        id: 'sk_ketentuan',
        kind: 'notes',
        title: 'IV. Ketentuan & Keterangan Tambahan',
        content:
          '1. Keputusan panitia dan pembina bersifat final berdasarkan data nilai aktual dan verifikasi integritas ujian.\n2. Para pemenang diundang untuk menghadiri penyerahan sertifikat/penghargaan dan pembinaan intensif lanjutan {{nama_instansi}}.\n3. Apabila terdapat kekeliruan administratif di kemudian hari, surat keputusan ini akan ditinjau dan diperbaiki sebagaimana mestinya.',
        visible: true,
      },
      {
        id: 'sk_penutup',
        kind: 'paragraph',
        title: 'V. Penutup',
        content:
          'Demikian Surat Pengumuman dan Penetapan Pemenang ini diterbitkan secara resmi untuk disampaikan kepada seluruh peserta, pembina, dan pihak sekolah.',
        visible: true,
        align: 'justify',
      },
    ],
    winnerRows: [],
    signatories: [
      {
        id: 'sk_sig_1',
        roleLabel: 'Ketua Dewan Juri / Panitia,',
        name: 'Koordinator Akademik KIR IPA',
        titleOrNip: '{{nama_instansi}}',
        align: 'left',
      },
      {
        id: 'sk_sig_2',
        roleLabel: 'Ditetapkan di {{place_city}} · Pembina Utama,',
        name: '{{nama_penanggung_jawab}}',
        titleOrNip: 'Penanggung Jawab {{nama_sekolah}}',
        align: 'right',
      },
    ],
    headerFooter: {
      headerText: 'Surat Keputusan Resmi · {{nama_instansi}}',
      footerText,
      showPageNumbers: true,
    },
    showStampArea: true,
    tableHeaderBg: '#0F294A',
  };
}

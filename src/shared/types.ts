export type UserRole = 'SUPER_ADMIN' | 'PROFESSOR' | 'SISWA';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'LOCKED';

export type QuestionType =
  | 'PG'
  | 'PGK'
  | 'BENAR_SALAH'
  | 'ESAI'
  | 'ISIAN_SINGKAT'
  | 'MENJODOHKAN'
  | 'MENGURUTKAN';

export type DifficultyLevel = 'MUDAH' | 'SEDANG' | 'SULIT' | 'OLIMPIADE';

export type ExamStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';

export type ParticipantStatus =
  | 'BELUM_MULAI'
  | 'MENGERJAKAN'
  | 'TERKUMPUL'
  | 'GANGGUAN'
  | 'DIHENTIKAN';

export interface UserRecord {
  user_id: string;
  username: string;
  nama: string;
  kelas: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
}

export interface PgkOption {
  id: string;
  label: string;
  text: string;
}

export interface MatchingPair {
  id: string;
  left: string;
  right: string;
}

export interface QuestionOptionsPayload {
  choices?: PgkOption[];
  pgk_scoring?: 'EXACT' | 'PARTIAL';
  pgk_penalty?: number;
  accepted_answers?: string[];
  case_sensitive?: boolean;
  essay_max_chars?: number;
  essay_rubric?: { criterion: string; max_points: number; description: string }[];
  matching_pairs?: MatchingPair[];
  ordering_items?: { id: string; text: string }[];
}

export interface QuestionRecord {
  question_id: string;
  question_type: QuestionType;
  question_text: string;
  options_json: string;
  correct_answer: string;
  explanation: string;
  image_url: string;
  category: string;
  materi?: string;
  difficulty: DifficultyLevel;
  score: number;
  created_by: string;
  created_at: string;
}

export interface StudentSafeQuestion {
  question_id: string;
  question_type: QuestionType;
  question_text: string;
  options: QuestionOptionsPayload;
  image_url: string;
  category: string;
  materi?: string;
  difficulty: DifficultyLevel;
  score: number;
  question_order: number;
}

export interface ExamSettings {
  exam_type: 'EVALUASI' | 'SELEKSI' | 'LATIHAN' | 'SIMULASI_OSN' | 'KUIS';
  total_score_target: number;
  passing_grade: number;
  target_classes: string[];
  shuffle_questions: boolean;
  shuffle_options: boolean;
  allow_free_navigation: boolean;
  max_attempts: number;
  show_result_after_publish: boolean;
  show_explanation_after_publish: boolean;
  show_leaderboard: boolean;
  leaderboard_anonymous: boolean;
  anti_cheat_tab_switch: boolean;
  anti_cheat_fullscreen: boolean;
  anti_cheat_block_copy: boolean;
  anti_cheat_block_context_menu: boolean;
  anti_cheat_single_session: boolean;
}

export interface ExamRecord {
  exam_id: string;
  title: string;
  description: string;
  subject: string;
  start_time: string;
  end_time: string;
  duration: number;
  status: ExamStatus;
  total_questions: number;
  created_by: string;
  settings_json: string;
}

export interface ExamQuestionLink {
  id: string;
  exam_id: string;
  question_id: string;
  question_order: number;
  score: number;
}

export interface ExamParticipantRecord {
  id: string;
  exam_id: string;
  user_id: string;
  status: ParticipantStatus;
  started_at: string;
  submitted_at: string;
  score: number;
  session_id: string;
}

export interface AnswerRecord {
  answer_id: string;
  exam_id: string;
  user_id: string;
  question_id: string;
  answer_json: string;
  is_doubtful: number;
  saved_at: string;
  score: number;
}

export interface ViolationLogRecord {
  log_id: string;
  exam_id: string;
  user_id: string;
  event_type: string;
  event_time: string;
  description: string;
}

export interface ResultRecord {
  result_id: string;
  exam_id: string;
  user_id: string;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  total_score: number;
  published: number;
  graded_at: string;
}

export interface EssayGradeRecord {
  grade_id: string;
  exam_id: string;
  question_id: string;
  user_id: string;
  score: number;
  feedback: string;
  graded_by: string;
  graded_at: string;
}

export interface AuditLogRecord {
  log_id: string;
  user_id: string;
  activity: string;
  timestamp: string;
  details: string;
}

export interface AppSettingsMap {
  app_name: string;
  org_name: string;
  school_name: string;
  academic_year: string;
  management_period: string;
  logo_url: string;
  primary_color: string;
  accent_color: string;
  contact_info: string;
  announcement: string;
  report_footer: string;
  max_login_attempts: string;
  lockout_minutes: string;
  session_hours: string;
  professor_global_access: string;
}

export interface NotificationRecord {
  notification_id: string;
  user_id: string;
  title: string;
  message: string;
  created_at: string;
  is_read: number;
}

export type DocumentCategory = 'LAPORAN_HASIL' | 'BERITA_ACARA' | 'PENGUMUMAN_PEMENANG';
export type PaperSizeOption = 'A4' | 'F4';
export type PaperOrientationOption = 'portrait' | 'landscape';
export type DocumentSectionKind =
  | 'heading'
  | 'paragraph'
  | 'info_grid'
  | 'stats_cards'
  | 'results_table'
  | 'winners_table'
  | 'violations_table'
  | 'notes'
  | 'divider';

export interface DocumentTypographyConfig {
  fontFamily: 'sans' | 'serif' | 'times' | 'georgia' | 'mono';
  fontSizePx: number;
  lineHeight: number;
  headerAlign: 'left' | 'center' | 'right';
  bodyAlign: 'left' | 'justify';
}

export interface DocumentPageConfig {
  paperSize: PaperSizeOption;
  orientation: PaperOrientationOption;
  marginMm: number;
}

export interface DocumentLetterheadConfig {
  showLogo: boolean;
  logoUrl: string;
  orgLine1: string;
  orgLine2: string;
  institutionName: string;
  addressLine: string;
  contactLine: string;
  borderStyle: 'double' | 'solid' | 'none';
}

export interface DocumentMetaConfig {
  title: string;
  subtitle: string;
  docNumber: string;
  subjectLine: string;
  activityName: string;
  placeAndDate: string;
}

export interface DocumentSectionItem {
  id: string;
  kind: DocumentSectionKind;
  title: string;
  content: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  bold?: boolean;
  italic?: boolean;
  visible: boolean;
  tableColumns?: string[];
  infoRows?: Array<{ label: string; value: string }>;
}

export interface DocumentSignatoryItem {
  id: string;
  roleLabel: string;
  name: string;
  titleOrNip: string;
  align: 'left' | 'center' | 'right';
}

export interface DocumentWinnerRow {
  rank: number;
  user_id?: string;
  nama: string;
  kelas: string;
  total_score: number;
  max_score: number;
  percentage: number;
  kategori_juara: string;
  keterangan?: string;
}

export interface DocumentHeaderFooterConfig {
  headerText: string;
  footerText: string;
  showPageNumbers: boolean;
}

export interface DocumentContentPayload {
  typography: DocumentTypographyConfig;
  page: DocumentPageConfig;
  letterhead: DocumentLetterheadConfig;
  meta: DocumentMetaConfig;
  sections: DocumentSectionItem[];
  winnerRows: DocumentWinnerRow[];
  signatories: DocumentSignatoryItem[];
  headerFooter: DocumentHeaderFooterConfig;
  showStampArea?: boolean;
  tableHeaderBg?: string;
}

export interface ReportTemplateRecord {
  template_id: string;
  name: string;
  doc_category: DocumentCategory;
  exam_id: string;
  is_default: number;
  content_json: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface OfficialDocumentRecord {
  doc_id: string;
  exam_id: string;
  template_id: string;
  doc_category: DocumentCategory;
  title: string;
  doc_number: string;
  status: 'DRAFT' | 'PUBLISHED';
  content_json: string;
  created_by: string;
  creator_name?: string;
  created_at: string;
  updated_at: string;
}

export type ImportEntityType = 'USERS' | 'QUESTIONS' | 'EXAM_QUESTIONS' | 'EXAM_PARTICIPANTS';

export interface ImportErrorDetail {
  row: number;
  reason: string;
  identifier?: string;
}

export interface ImportSummaryResult {
  imported: number;
  linked?: number;
  skipped_duplicates: number;
  failed_count: number;
  errors: ImportErrorDetail[];
}

export type SyncDomain =
  | 'config'
  | 'users'
  | 'questions'
  | 'exams'
  | 'results'
  | 'documents'
  | 'backups';

export type SyncVersionsMap = Record<SyncDomain, number>;

export type BaseConfigSource = 'INITIAL_DEFAULT' | 'MIGRATED_SETTINGS' | 'SUPER_ADMIN' | 'ROLLBACK' | 'RESTORE';

export interface BaseConfigRecord {
  config_key: string;
  config_value: string;
  source: BaseConfigSource;
  config_version: number;
  updated_by: string;
  updated_at: string;
}

export interface SystemSyncState {
  server_time: string;
  db_ok: boolean;
  installation_id: string;
  app_version: string;
  db_version: string;
  config_version: number;
  base_config_source?: BaseConfigSource;
  base_config_updated_at?: string;
  last_save_at: string;
  last_backup_at: string;
  sync_versions: SyncVersionsMap;
}

export interface ConfigVersionRecord {
  version_id: string;
  version_number: number;
  setting_key: string;
  category: 'APP' | 'SECURITY';
  old_value: string;
  new_value: string;
  changed_by: string;
  changed_by_name?: string;
  changed_at: string;
  status: 'APPLIED' | 'ROLLED_BACK';
  note: string;
}

export interface ServerEventRecord {
  event_id: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  source: string;
  event_type: string;
  message: string;
  details: string;
  created_at: string;
}

export interface BackupLogRecord {
  backup_id: string;
  file_id: string;
  created_at: string;
  created_by: string;
  creator_name?: string;
  status: string;
  backup_type?: string;
  size_bytes?: number;
  checksum_sha256?: string;
  file_exists?: boolean;
}

export interface SystemMonitoringStatus {
  server_status: 'ONLINE';
  db_status: 'CONNECTED' | 'ERROR';
  db_error?: string;
  db_path: string;
  installation_id: string;
  app_version: string;
  db_version: string;
  last_migration_version: string;
  database_initialized: boolean;
  config_version: number;
  base_config_source: BaseConfigSource;
  base_config_updated_at: string;
  base_config_updated_by: string;
  last_save_at: string;
  last_backup_at: string;
  last_sync_check_at: string;
  auto_backup_interval_minutes: number;
  sync_versions: SyncVersionsMap;
  gas_bundle_status: {
    ready: boolean;
    version: string;
    files_count: number;
  };
  table_counts: Record<string, number>;
  backups_count: number;
  recent_errors: ServerEventRecord[];
  config_versions: ConfigVersionRecord[];
}


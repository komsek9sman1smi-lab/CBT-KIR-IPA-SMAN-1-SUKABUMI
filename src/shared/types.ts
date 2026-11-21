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

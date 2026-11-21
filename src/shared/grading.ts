import type {
  AnswerRecord,
  EssayGradeRecord,
  QuestionOptionsPayload,
  QuestionRecord,
} from './types.ts';

export function normalizeAnswerText(input: string, caseSensitive = false): string {
  const cleaned = String(input ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  return caseSensitive ? cleaned : cleaned.toLowerCase();
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function isAnswerProvided(questionType: string, parsedAnswer: unknown): boolean {
  if (parsedAnswer === null || parsedAnswer === undefined) return false;
  if (typeof parsedAnswer === 'string') return parsedAnswer.trim().length > 0;
  if (Array.isArray(parsedAnswer)) return parsedAnswer.length > 0;
  if (typeof parsedAnswer === 'object') {
    const entries = Object.values(parsedAnswer as Record<string, unknown>);
    return entries.some((v) => String(v ?? '').trim().length > 0);
  }
  return false;
}

export interface QuestionGradeOutcome {
  score: number;
  maxScore: number;
  status: 'CORRECT' | 'PARTIAL' | 'INCORRECT' | 'UNANSWERED' | 'PENDING_MANUAL';
}

export function gradeSingleQuestion(
  question: Pick<QuestionRecord, 'question_type' | 'options_json' | 'correct_answer' | 'score'>,
  rawAnswerJson: string | null | undefined,
  overrideScore?: number,
  manualEssayScore?: number | null,
): QuestionGradeOutcome {
  const maxScore = Number(overrideScore ?? question.score ?? 1);
  const parsedAnswer = safeJsonParse<unknown>(rawAnswerJson, null);
  const options = safeJsonParse<QuestionOptionsPayload>(question.options_json, {});

  if (!isAnswerProvided(question.question_type, parsedAnswer)) {
    if (question.question_type === 'ESAI' && typeof manualEssayScore === 'number') {
      const bounded = Math.max(0, Math.min(maxScore, manualEssayScore));
      return {
        score: bounded,
        maxScore,
        status: bounded >= maxScore ? 'CORRECT' : bounded > 0 ? 'PARTIAL' : 'INCORRECT',
      };
    }
    return { score: 0, maxScore, status: 'UNANSWERED' };
  }

  switch (question.question_type) {
    case 'PG':
    case 'BENAR_SALAH': {
      const expected = normalizeAnswerText(question.correct_answer);
      const actual = normalizeAnswerText(String(parsedAnswer));
      const isCorrect = expected.length > 0 && actual === expected;
      return {
        score: isCorrect ? maxScore : 0,
        maxScore,
        status: isCorrect ? 'CORRECT' : 'INCORRECT',
      };
    }

    case 'PGK': {
      const expectedList = safeJsonParse<string[]>(question.correct_answer, [])
        .map((s) => normalizeAnswerText(s))
        .filter(Boolean);
      const actualList = Array.isArray(parsedAnswer)
        ? parsedAnswer.map((s) => normalizeAnswerText(String(s))).filter(Boolean)
        : [];
      const expectedSet = new Set(expectedList);
      const actualSet = new Set(actualList);

      if (expectedSet.size === 0) {
        return { score: 0, maxScore, status: 'INCORRECT' };
      }

      let truePositives = 0;
      let falsePositives = 0;
      for (const item of actualSet) {
        if (expectedSet.has(item)) truePositives++;
        else falsePositives++;
      }

      const mode = options.pgk_scoring ?? 'PARTIAL';
      if (mode === 'EXACT') {
        const isExact = truePositives === expectedSet.size && falsePositives === 0;
        return {
          score: isExact ? maxScore : 0,
          maxScore,
          status: isExact ? 'CORRECT' : 'INCORRECT',
        };
      }

      const penaltyPerWrong = Number(options.pgk_penalty ?? 0);
      const perCorrect = maxScore / expectedSet.size;
      const rawScore = truePositives * perCorrect - falsePositives * penaltyPerWrong;
      const bounded = Number(Math.max(0, Math.min(maxScore, rawScore)).toFixed(2));
      const isExact = truePositives === expectedSet.size && falsePositives === 0;
      return {
        score: bounded,
        maxScore,
        status: isExact ? 'CORRECT' : bounded > 0 ? 'PARTIAL' : 'INCORRECT',
      };
    }

    case 'ISIAN_SINGKAT': {
      const acceptedFromOptions = Array.isArray(options.accepted_answers)
        ? options.accepted_answers
        : [];
      const acceptedFromKey = safeJsonParse<string[] | string>(
        question.correct_answer,
        question.correct_answer,
      );
      const keyPool = [
        ...acceptedFromOptions,
        ...(Array.isArray(acceptedFromKey) ? acceptedFromKey : [acceptedFromKey]),
      ]
        .map((k) => normalizeAnswerText(String(k), Boolean(options.case_sensitive)))
        .filter(Boolean);

      const actual = normalizeAnswerText(String(parsedAnswer), Boolean(options.case_sensitive));
      const isCorrect = keyPool.includes(actual);
      return {
        score: isCorrect ? maxScore : 0,
        maxScore,
        status: isCorrect ? 'CORRECT' : 'INCORRECT',
      };
    }

    case 'MENJODOHKAN': {
      // correct_answer stores Record<leftId, rightTextOrId> or MatchingPair[]
      const expectedMap = safeJsonParse<Record<string, string>>(question.correct_answer, {});
      const actualMap =
        parsedAnswer && typeof parsedAnswer === 'object' && !Array.isArray(parsedAnswer)
          ? (parsedAnswer as Record<string, string>)
          : {};
      const keys = Object.keys(expectedMap);
      if (keys.length === 0) return { score: 0, maxScore, status: 'INCORRECT' };

      let matched = 0;
      for (const k of keys) {
        if (normalizeAnswerText(actualMap[k] ?? '') === normalizeAnswerText(expectedMap[k] ?? '')) {
          matched++;
        }
      }
      const score = Number(((matched / keys.length) * maxScore).toFixed(2));
      return {
        score,
        maxScore,
        status: matched === keys.length ? 'CORRECT' : matched > 0 ? 'PARTIAL' : 'INCORRECT',
      };
    }

    case 'MENGURUTKAN': {
      const expectedOrder = safeJsonParse<string[]>(question.correct_answer, []);
      const actualOrder = Array.isArray(parsedAnswer) ? parsedAnswer.map(String) : [];
      if (expectedOrder.length === 0) return { score: 0, maxScore, status: 'INCORRECT' };

      const isExact =
        expectedOrder.length === actualOrder.length &&
        expectedOrder.every((id, idx) => id === actualOrder[idx]);

      return {
        score: isExact ? maxScore : 0,
        maxScore,
        status: isExact ? 'CORRECT' : 'INCORRECT',
      };
    }

    case 'ESAI': {
      if (typeof manualEssayScore === 'number') {
        const bounded = Number(Math.max(0, Math.min(maxScore, manualEssayScore)).toFixed(2));
        return {
          score: bounded,
          maxScore,
          status: bounded >= maxScore ? 'CORRECT' : bounded > 0 ? 'PARTIAL' : 'INCORRECT',
        };
      }
      return { score: 0, maxScore, status: 'PENDING_MANUAL' };
    }

    default:
      return { score: 0, maxScore, status: 'INCORRECT' };
  }
}

export interface ExamGradeSummary {
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  pending_essay_count: number;
  total_score: number;
  max_possible_score: number;
  percentage: number;
  passed: boolean;
  question_scores: Record<string, QuestionGradeOutcome>;
}

export function computeExamGradeSummary(
  questions: Array<
    Pick<QuestionRecord, 'question_id' | 'question_type' | 'options_json' | 'correct_answer' | 'score'> & {
      exam_score?: number;
    }
  >,
  answersByQuestionId: Record<string, Pick<AnswerRecord, 'answer_json'>>,
  essayGradesByQuestionId: Record<string, Pick<EssayGradeRecord, 'score'>>,
  passingGrade = 75,
): ExamGradeSummary {
  let correct_count = 0;
  let incorrect_count = 0;
  let unanswered_count = 0;
  let pending_essay_count = 0;
  let total_score = 0;
  let max_possible_score = 0;
  const question_scores: Record<string, QuestionGradeOutcome> = {};

  for (const q of questions) {
    const qMax = Number(q.exam_score ?? q.score ?? 1);
    max_possible_score += qMax;
    const ans = answersByQuestionId[q.question_id]?.answer_json;
    const manual = essayGradesByQuestionId[q.question_id]?.score ?? null;
    const outcome = gradeSingleQuestion(q, ans, qMax, manual);
    question_scores[q.question_id] = outcome;
    total_score += outcome.score;

    if (outcome.status === 'CORRECT') correct_count++;
    else if (outcome.status === 'PARTIAL') correct_count++;
    else if (outcome.status === 'UNANSWERED') unanswered_count++;
    else if (outcome.status === 'PENDING_MANUAL') pending_essay_count++;
    else incorrect_count++;
  }

  total_score = Number(total_score.toFixed(2));
  const percentage =
    max_possible_score > 0 ? Number(((total_score / max_possible_score) * 100).toFixed(2)) : 0;

  return {
    correct_count,
    incorrect_count,
    unanswered_count,
    pending_essay_count,
    total_score,
    max_possible_score,
    percentage,
    passed: percentage >= passingGrade,
    question_scores,
  };
}

export interface LeaderboardInputEntry {
  user_id: string;
  nama: string;
  kelas: string;
  total_score: number;
  max_score: number;
  percentage: number;
  duration_seconds: number;
}

export interface RankedLeaderboardEntry extends LeaderboardInputEntry {
  rank: number;
}

export function computeLeaderboardRanks(entries: LeaderboardInputEntry[]): RankedLeaderboardEntry[] {
  const sorted = [...entries].sort((a, b) => {
    if (b.total_score !== a.total_score) return b.total_score - a.total_score;
    return a.duration_seconds - b.duration_seconds;
  });

  let currentRank = 0;
  let prevScore: number | null = null;
  let prevDuration: number | null = null;

  return sorted.map((entry, idx) => {
    if (prevScore === null || entry.total_score !== prevScore || entry.duration_seconds !== prevDuration) {
      currentRank = idx + 1;
    }
    prevScore = entry.total_score;
    prevDuration = entry.duration_seconds;
    return { ...entry, rank: currentRank };
  });
}

export interface ItemAnalysisResult {
  question_id: string;
  question_type: string;
  question_text_preview: string;
  total_respondents: number;
  correct_count: number;
  incorrect_count: number;
  unanswered_count: number;
  correct_percentage: number;
  difficulty_label: 'Terlalu Mudah' | 'Mudah' | 'Sedang' | 'Sukar' | 'Terlalu Sukar';
  discrimination_index: number | null;
  discrimination_label: string;
  problematic: boolean;
  problem_reason: string;
  sample_warning: string | null;
  option_distribution: Record<string, number>;
}

export function computeItemAnalysis(
  questions: Array<
    Pick<QuestionRecord, 'question_id' | 'question_type' | 'question_text' | 'options_json' | 'correct_answer' | 'score'> & {
      exam_score?: number;
    }
  >,
  participantResults: Array<{ user_id: string; total_score: number }>,
  allAnswers: Array<Pick<AnswerRecord, 'user_id' | 'question_id' | 'answer_json' | 'score'>>,
): ItemAnalysisResult[] {
  const totalN = participantResults.length;
  const sortedParticipants = [...participantResults].sort((a, b) => b.total_score - a.total_score);
  const groupSize = totalN >= 6 ? Math.max(1, Math.round(totalN * 0.27)) : 0;
  const upperSet = new Set(sortedParticipants.slice(0, groupSize).map((p) => p.user_id));
  const lowerSet = new Set(sortedParticipants.slice(totalN - groupSize).map((p) => p.user_id));

  const answerLookup = new Map<string, Map<string, Pick<AnswerRecord, 'answer_json' | 'score'>>>();
  for (const ans of allAnswers) {
    if (!answerLookup.has(ans.question_id)) {
      answerLookup.set(ans.question_id, new Map());
    }
    answerLookup.get(ans.question_id)!.set(ans.user_id, ans);
  }

  return questions.map((q) => {
    const qMax = Number(q.exam_score ?? q.score ?? 1);
    const qAnswers = answerLookup.get(q.question_id) ?? new Map();
    let correct_count = 0;
    let incorrect_count = 0;
    let unanswered_count = 0;
    let upperCorrect = 0;
    let lowerCorrect = 0;
    const option_distribution: Record<string, number> = {};

    if (q.question_type === 'PG' || q.question_type === 'BENAR_SALAH') {
      const opts = safeJsonParse<QuestionOptionsPayload>(q.options_json, {});
      if (q.question_type === 'BENAR_SALAH') {
        option_distribution['BENAR'] = 0;
        option_distribution['SALAH'] = 0;
      } else {
        for (const c of opts.choices ?? []) {
          option_distribution[c.label] = 0;
        }
      }
    }

    for (const p of participantResults) {
      const ans = qAnswers.get(p.user_id);
      const parsed = safeJsonParse<unknown>(ans?.answer_json, null);
      if (!isAnswerProvided(q.question_type, parsed)) {
        unanswered_count++;
        continue;
      }

      if (q.question_type === 'PG' || q.question_type === 'BENAR_SALAH') {
        const key = String(parsed).trim().toUpperCase();
        option_distribution[key] = (option_distribution[key] ?? 0) + 1;
      }

      const outcome =
        q.question_type === 'ESAI'
          ? {
              status:
                (ans?.score ?? 0) >= qMax * 0.6
                  ? ('CORRECT' as const)
                  : ('INCORRECT' as const),
            }
          : gradeSingleQuestion(q, ans?.answer_json, qMax);

      const isRight = outcome.status === 'CORRECT' || outcome.status === 'PARTIAL';
      if (isRight) {
        correct_count++;
        if (upperSet.has(p.user_id)) upperCorrect++;
        if (lowerSet.has(p.user_id)) lowerCorrect++;
      } else {
        incorrect_count++;
      }
    }

    const pIndex = totalN > 0 ? correct_count / totalN : 0;
    const correct_percentage = Number((pIndex * 100).toFixed(1));

    let difficulty_label: ItemAnalysisResult['difficulty_label'] = 'Sedang';
    if (pIndex >= 0.85) difficulty_label = 'Terlalu Mudah';
    else if (pIndex >= 0.7) difficulty_label = 'Mudah';
    else if (pIndex >= 0.3) difficulty_label = 'Sedang';
    else if (pIndex >= 0.15) difficulty_label = 'Sukar';
    else difficulty_label = 'Terlalu Sukar';

    let discrimination_index: number | null = null;
    let discrimination_label = 'Data peserta belum mencukupi (min. 6)';
    if (groupSize > 0) {
      discrimination_index = Number(((upperCorrect - lowerCorrect) / groupSize).toFixed(2));
      if (discrimination_index >= 0.4) discrimination_label = 'Sangat Baik';
      else if (discrimination_index >= 0.3) discrimination_label = 'Baik';
      else if (discrimination_index >= 0.2) discrimination_label = 'Cukup';
      else if (discrimination_index >= 0) discrimination_label = 'Lemah (Perlu Revisi)';
      else discrimination_label = 'Negatif (Bermasalah)';
    }

    let problematic = false;
    const reasons: string[] = [];
    if (totalN >= 6) {
      if (discrimination_index !== null && discrimination_index < 0.15) {
        problematic = true;
        reasons.push('Daya pembeda rendah/negatif');
      }
      if (pIndex < 0.15 || pIndex > 0.92) {
        problematic = true;
        reasons.push(pIndex < 0.15 ? 'Terlalu sukar (<15%)' : 'Terlalu mudah (>92%)');
      }
    }

    const stripped = q.question_text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    let preview = stripped;
    if (stripped.length > 180) {
      preview = stripped.slice(0, 180);
      // Avoid leaving an unclosed inline $ formula that breaks KaTeX preview rendering
      const dollarCount = (preview.match(/\$/g) || []).length;
      if (dollarCount % 2 === 1) {
        const lastDollar = preview.lastIndexOf('$');
        if (lastDollar > 0) preview = preview.slice(0, lastDollar);
      }
      preview = preview.trimEnd() + '...';
    }

    return {
      question_id: q.question_id,
      question_type: q.question_type,
      question_text_preview: preview,
      total_respondents: totalN,
      correct_count,
      incorrect_count,
      unanswered_count,
      correct_percentage,
      difficulty_label,
      discrimination_index,
      discrimination_label,
      problematic,
      problem_reason: reasons.join(' · '),
      sample_warning:
        totalN < 6
          ? `Jumlah peserta (${totalN}) terlalu sedikit untuk menyimpulkan validitas statistik butir soal.`
          : null,
      option_distribution,
    };
  });
}

export function formatAuditDetails(raw: unknown): string {
  const str = String(raw ?? '').trim();
  if (!str || str === '{}') return '—';
  const parsed = safeJsonParse<Record<string, unknown> | null>(str, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const parts = Object.entries(parsed)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    return parts.length > 0 ? parts.join(' · ') : '—';
  }
  return str;
}

export function sanitizeRichHtml(html: string): string {
  return String(html ?? '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

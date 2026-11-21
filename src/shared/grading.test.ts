import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeExamGradeSummary,
  computeItemAnalysis,
  computeLeaderboardRanks,
  gradeSingleQuestion,
  normalizeAnswerText,
  sanitizeRichHtml,
} from './grading.ts';

test('PG and Benar/Salah exact grading', () => {
  const pg = {
    question_type: 'PG' as const,
    options_json: '{}',
    correct_answer: 'B',
    score: 5,
  };
  assert.equal(gradeSingleQuestion(pg, JSON.stringify('b')).score, 5);
  assert.equal(gradeSingleQuestion(pg, JSON.stringify('C')).score, 0);
  assert.equal(gradeSingleQuestion(pg, null).status, 'UNANSWERED');

  const bs = {
    question_type: 'BENAR_SALAH' as const,
    options_json: '{}',
    correct_answer: 'BENAR',
    score: 2,
  };
  assert.equal(gradeSingleQuestion(bs, JSON.stringify('BENAR')).score, 2);
  assert.equal(gradeSingleQuestion(bs, JSON.stringify('SALAH')).score, 0);
});

test('PGK supports partial credit with wrong-answer penalty and exact mode', () => {
  const partialQ = {
    question_type: 'PGK' as const,
    options_json: JSON.stringify({ pgk_scoring: 'PARTIAL', pgk_penalty: 1 }),
    correct_answer: JSON.stringify(['A', 'C']),
    score: 4,
  };
  assert.equal(gradeSingleQuestion(partialQ, JSON.stringify(['A', 'C'])).score, 4);
  // 1 right (2 pts) - 1 wrong (1 pt) = 1 pt
  assert.equal(gradeSingleQuestion(partialQ, JSON.stringify(['A', 'B'])).score, 1);
  // Clamped at 0
  assert.equal(gradeSingleQuestion(partialQ, JSON.stringify(['B', 'D'])).score, 0);

  const exactQ = {
    question_type: 'PGK' as const,
    options_json: JSON.stringify({ pgk_scoring: 'EXACT' }),
    correct_answer: JSON.stringify(['A', 'C']),
    score: 4,
  };
  assert.equal(gradeSingleQuestion(exactQ, JSON.stringify(['A'])).score, 0);
  assert.equal(gradeSingleQuestion(exactQ, JSON.stringify(['C', 'A'])).score, 4);
});

test('Isian Singkat, Menjodohkan, and Mengurutkan grading', () => {
  const isian = {
    question_type: 'ISIAN_SINGKAT' as const,
    options_json: JSON.stringify({
      accepted_answers: ['H2O', 'air murni'],
      case_sensitive: false,
    }),
    correct_answer: 'H2O',
    score: 3,
  };
  assert.equal(gradeSingleQuestion(isian, JSON.stringify('  Air   Murni ')).score, 3);
  assert.equal(gradeSingleQuestion(isian, JSON.stringify('CO2')).score, 0);

  const matchQ = {
    question_type: 'MENJODOHKAN' as const,
    options_json: '{}',
    correct_answer: JSON.stringify({ p1: 'Newton', p2: 'Joule' }),
    score: 4,
  };
  assert.equal(gradeSingleQuestion(matchQ, JSON.stringify({ p1: 'Newton', p2: 'Watt' })).score, 2);
  assert.equal(gradeSingleQuestion(matchQ, JSON.stringify({ p1: 'Newton', p2: 'Joule' })).score, 4);

  const orderQ = {
    question_type: 'MENGURUTKAN' as const,
    options_json: '{}',
    correct_answer: JSON.stringify(['s1', 's2', 's3']),
    score: 3,
  };
  assert.equal(gradeSingleQuestion(orderQ, JSON.stringify(['s1', 's2', 's3'])).score, 3);
  assert.equal(gradeSingleQuestion(orderQ, JSON.stringify(['s2', 's1', 's3'])).score, 0);
});

test('Exam grade summary integrates manual essay scores', () => {
  const questions = [
    {
      question_id: 'q1',
      question_type: 'PG' as const,
      options_json: '{}',
      correct_answer: 'A',
      score: 10,
    },
    {
      question_id: 'q2',
      question_type: 'ESAI' as const,
      options_json: '{}',
      correct_answer: '',
      score: 10,
    },
  ];
  const answers = {
    q1: { answer_json: JSON.stringify('A') },
    q2: { answer_json: JSON.stringify('Fotosintesis menghasilkan glukosa dan oksigen.') },
  };
  const pendingSummary = computeExamGradeSummary(questions, answers, {}, 75);
  assert.equal(pendingSummary.pending_essay_count, 1);
  assert.equal(pendingSummary.total_score, 10);

  const gradedSummary = computeExamGradeSummary(questions, answers, { q2: { score: 8 } }, 75);
  assert.equal(gradedSummary.pending_essay_count, 0);
  assert.equal(gradedSummary.total_score, 18);
  assert.equal(gradedSummary.percentage, 90);
  assert.equal(gradedSummary.passed, true);
});

test('Leaderboard ranking handles ties and duration tie-breaker', () => {
  const ranked = computeLeaderboardRanks([
    { user_id: 'u1', nama: 'Budi', kelas: 'XI-1', total_score: 90, max_score: 100, percentage: 90, duration_seconds: 1200 },
    { user_id: 'u2', nama: 'Ani', kelas: 'XI-2', total_score: 90, max_score: 100, percentage: 90, duration_seconds: 900 },
    { user_id: 'u3', nama: 'Cici', kelas: 'XI-1', total_score: 90, max_score: 100, percentage: 90, duration_seconds: 900 },
    { user_id: 'u4', nama: 'Dedi', kelas: 'XI-3', total_score: 80, max_score: 100, percentage: 80, duration_seconds: 800 },
  ]);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 1); // exact tie in score + duration
  assert.equal(ranked[2].rank, 3); // same score, slower duration
  assert.equal(ranked[3].rank, 4);
});

test('Item analysis protects against small sample conclusions and computes discrimination for >=6', () => {
  const questions = [
    {
      question_id: 'q1',
      question_type: 'PG' as const,
      question_text: '<p>Berapa percepatan gravitasi standar?</p>',
      options_json: JSON.stringify({ choices: [{ id: '1', label: 'A', text: '9.8' }, { id: '2', label: 'B', text: '5' }] }),
      correct_answer: 'A',
      score: 10,
    },
  ];
  const smallResults = [
    { user_id: 's1', total_score: 10 },
    { user_id: 's2', total_score: 0 },
  ];
  const smallAnswers = [
    { user_id: 's1', question_id: 'q1', answer_json: JSON.stringify('A'), score: 10 },
    { user_id: 's2', question_id: 'q1', answer_json: JSON.stringify('B'), score: 0 },
  ];
  const smallAnalysis = computeItemAnalysis(questions, smallResults, smallAnswers);
  assert.ok(smallAnalysis[0].sample_warning);
  assert.equal(smallAnalysis[0].discrimination_index, null);
  assert.equal(smallAnalysis[0].problematic, false);

  const fullResults = [
    { user_id: 's1', total_score: 100 },
    { user_id: 's2', total_score: 90 },
    { user_id: 's3', total_score: 80 },
    { user_id: 's4', total_score: 50 },
    { user_id: 's5', total_score: 40 },
    { user_id: 's6', total_score: 20 },
  ];
  const fullAnswers = [
    { user_id: 's1', question_id: 'q1', answer_json: JSON.stringify('A'), score: 10 },
    { user_id: 's2', question_id: 'q1', answer_json: JSON.stringify('A'), score: 10 },
    { user_id: 's3', question_id: 'q1', answer_json: JSON.stringify('A'), score: 10 },
    { user_id: 's4', question_id: 'q1', answer_json: JSON.stringify('B'), score: 0 },
    { user_id: 's5', question_id: 'q1', answer_json: JSON.stringify('B'), score: 0 },
    { user_id: 's6', question_id: 'q1', answer_json: JSON.stringify('B'), score: 0 },
  ];
  const fullAnalysis = computeItemAnalysis(questions, fullResults, fullAnswers);
  assert.equal(fullAnalysis[0].sample_warning, null);
  assert.equal(fullAnalysis[0].discrimination_index, 1);
  assert.equal(fullAnalysis[0].option_distribution.A, 3);
  assert.equal(fullAnalysis[0].option_distribution.B, 3);
});

test('HTML sanitization and text normalization strip unsafe handlers', () => {
  const dirty = '<p onclick="alert(1)">H<sub>2</sub>O</p><script>evil()</script>';
  const clean = sanitizeRichHtml(dirty);
  assert.equal(clean.includes('<script>'), false);
  assert.equal(clean.includes('onclick'), false);
  assert.equal(clean.includes('H<sub>2</sub>O'), true);
  assert.equal(normalizeAnswerText('  Fotosintesis   Gelap '), 'fotosintesis gelap');
});

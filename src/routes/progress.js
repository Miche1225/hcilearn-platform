// src/routes/progress.js
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/authGuard');

const { getContent, unlockedKeys } = require('../contentStore');

const router = express.Router();
router.use(requireAuth);

async function logActivity(userId, type, description) {
  await pool.query(
    'INSERT INTO activity_log (user_id, type, description) VALUES ($1, $2, $3)',
    [userId, type, description]
  );
}

async function getCaseStudyRow(userId) {
  let { rows } = await pool.query('SELECT * FROM case_study_progress WHERE user_id = $1', [userId]);
  if (!rows[0]) {
    await pool.query('INSERT INTO case_study_progress (user_id) VALUES ($1)', [userId]);
    ({ rows } = await pool.query('SELECT * FROM case_study_progress WHERE user_id = $1', [userId]));
  }
  return rows[0];
}

async function getStudyCardRow(userId) {
  let { rows } = await pool.query('SELECT * FROM study_card_progress WHERE user_id = $1', [userId]);
  if (!rows[0]) {
    await pool.query('INSERT INTO study_card_progress (user_id) VALUES ($1)', [userId]);
    ({ rows } = await pool.query('SELECT * FROM study_card_progress WHERE user_id = $1', [userId]));
  }
  return rows[0];
}

async function getLessonRow(userId) {
  let { rows } = await pool.query('SELECT * FROM lesson_progress WHERE user_id = $1', [userId]);
  if (!rows[0]) {
    await pool.query('INSERT INTO lesson_progress (user_id) VALUES ($1)', [userId]);
    ({ rows } = await pool.query('SELECT * FROM lesson_progress WHERE user_id = $1', [userId]));
  }
  return rows[0];
}

// "Continue where you left off": the video paused most recently (or the
// next unwatched one), plus the next deck and case study not done yet.
// Same resume window as the player: at least 5s in, more than 15s left.
async function continueItems(userId, content, solvedIds, completedIds) {
  const videoIds = [...content.videoTitles.keys()];
  const { rows: [paused] } = await pool.query(
    `SELECT video_id, position_seconds, duration_seconds FROM video_positions
     WHERE user_id = $1 AND video_id = ANY($2) AND position_seconds >= 5 AND position_seconds < duration_seconds - 15
     ORDER BY updated_at DESC LIMIT 1`,
    [userId, videoIds]
  );
  let video = null;
  if (paused) {
    video = { key: paused.video_id, title: content.videoTitles.get(paused.video_id), position: paused.position_seconds, duration: paused.duration_seconds };
  } else {
    const { rows } = await pool.query('SELECT video_id FROM video_progress WHERE user_id = $1', [userId]);
    const watched = new Set(rows.map(r => r.video_id));
    const next = content.videos.find(v => !watched.has(v.key));
    if (next) video = { key: next.key, title: next.title, position: 0, duration: 0 };
  }

  const solved = new Set(solvedIds.map(Number));
  const caseKey = content.caseOrder.find(k => !solved.has(k));
  const done = new Set(completedIds.map(Number));
  const deckKey = content.deckOrder.find(k => !done.has(k));
  const deck = deckKey !== undefined && content.deckByKey.get(deckKey);
  const scenario = caseKey !== undefined && content.caseByKey.get(caseKey);

  return {
    video,
    deck: deck ? { key: deckKey, number: deck.number, title: deck.title, cards: deck.cards.length } : null,
    caseStudy: scenario ? { key: caseKey, number: scenario.number, question: scenario.question } : null,
  };
}

// ---------- Dashboard summary ----------
// GET /api/progress/summary
router.get('/summary', async (req, res, next) => {
  try {
    const userId = req.userId;

    const content = await getContent();
    const cs = await getCaseStudyRow(userId);
    const sc = await getStudyCardRow(userId);
    const lesson = await getLessonRow(userId);
    // Only count content that is currently published
    const videosWatchedResult = await pool.query(
      'SELECT COUNT(DISTINCT video_id)::int AS n FROM video_progress WHERE user_id = $1 AND video_id = ANY($2)',
      [userId, [...content.videoTitles.keys()]]
    );
    const videosWatched = videosWatchedResult.rows[0].n;

    const solvedCount = JSON.parse(cs.solved_ids).filter(id => content.caseByKey.has(Number(id))).length;
    const completedLessonsCount = JSON.parse(sc.completed_ids).filter(id => content.deckByKey.has(Number(id))).length;

    const { caseStudies, decks, videos } = content.totals;
    const totalActivities = caseStudies + decks + videos;
    const completedActivities = solvedCount + completedLessonsCount + videosWatched;

    const overallPercent = totalActivities ? Math.round((completedActivities / totalActivities) * 100) : 0;

    const { rows: recentActivities } = await pool.query(
      "SELECT type, description, created_at FROM activity_log WHERE user_id = $1 AND type != 'lesson' ORDER BY created_at DESC LIMIT 5",
      [userId]
    );

    res.json({
      continue: await continueItems(userId, content, JSON.parse(cs.solved_ids), JSON.parse(sc.completed_ids)),
      overallPercent,
      caseStudiesSolved: solvedCount,
      caseStudiesTotal: caseStudies,
      videosWatched,
      videosTotal: videos,
      studyCardsCompleted: completedLessonsCount,
      studyCardsTotal: decks,
      lessonCompleted: !!lesson.completed,
      recentActivities,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Case Studies ----------
// The case-study keys a student has solved and can open, in course order.
function caseProgress(content, solvedIds) {
  const solved = solvedIds.map(Number).filter(id => content.caseByKey.has(id));
  return { solvedIds: solved, unlockedIds: unlockedKeys(content.caseOrder, solved) };
}

// GET /api/progress/case-studies
router.get('/case-studies', async (req, res, next) => {
  try {
    const content = await getContent();
    const row = await getCaseStudyRow(req.userId);
    res.json(caseProgress(content, JSON.parse(row.solved_ids)));
  } catch (err) {
    next(err);
  }
});

// POST /api/progress/case-studies/submit  { scenarioId, correct }
router.post('/case-studies/submit', async (req, res, next) => {
  try {
    const { scenarioId, correct } = req.body || {};
    const id = Number(scenarioId);
    const content = await getContent();
    const scenario = content.caseByKey.get(id);
    if (!scenario) {
      return res.status(400).json({ error: 'Invalid scenario id.' });
    }

    const row = await getCaseStudyRow(req.userId);
    const solvedIds = JSON.parse(row.solved_ids).map(Number);
    if (!caseProgress(content, solvedIds).unlockedIds.includes(id)) {
      return res.status(403).json({ error: 'This scenario is still locked.' });
    }

    if (correct && !solvedIds.includes(id)) {
      solvedIds.push(id);
      await logActivity(req.userId, 'case_study', `Solved Case Study Scenario ${scenario.number}`);
      await pool.query(
        'UPDATE case_study_progress SET solved_ids = $1 WHERE user_id = $2',
        [JSON.stringify(solvedIds), req.userId]
      );
    }

    res.json(caseProgress(content, solvedIds));
  } catch (err) {
    next(err);
  }
});

// ---------- Study Cards ----------
// The deck keys a student has mastered and can open, in course order.
function deckProgress(content, completedIds) {
  const completed = completedIds.map(Number).filter(id => content.deckByKey.has(id));
  return { completedIds: completed, unlockedIds: unlockedKeys(content.deckOrder, completed) };
}

// GET /api/progress/study-cards
router.get('/study-cards', async (req, res, next) => {
  try {
    const content = await getContent();
    const row = await getStudyCardRow(req.userId);
    res.json(deckProgress(content, JSON.parse(row.completed_ids)));
  } catch (err) {
    next(err);
  }
});

// POST /api/progress/study-cards/complete  { lessonId }
router.post('/study-cards/complete', async (req, res, next) => {
  try {
    const { lessonId } = req.body || {};
    const id = Number(lessonId);
    const content = await getContent();
    const deck = content.deckByKey.get(id);
    if (!deck) {
      return res.status(400).json({ error: 'Invalid lesson id.' });
    }

    const row = await getStudyCardRow(req.userId);
    const completedIds = JSON.parse(row.completed_ids).map(Number);
    if (!deckProgress(content, completedIds).unlockedIds.includes(id)) {
      return res.status(403).json({ error: 'This deck is still locked.' });
    }

    if (!completedIds.includes(id)) {
      completedIds.push(id);
      await logActivity(req.userId, 'study_card', `Mastered Study Card Lesson ${deck.number}`);
      await pool.query(
        'UPDATE study_card_progress SET completed_ids = $1 WHERE user_id = $2',
        [JSON.stringify(completedIds), req.userId]
      );
    }

    res.json(deckProgress(content, completedIds));
  } catch (err) {
    next(err);
  }
});

// ---------- Videos ----------
// GET /api/progress/videos
router.get('/videos', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT video_id, title, watched_at FROM video_progress WHERE user_id = $1',
      [req.userId]
    );
    const { rows: positions } = await pool.query(
      'SELECT video_id, position_seconds, duration_seconds FROM video_positions WHERE user_id = $1',
      [req.userId]
    );
    res.json({ watched: rows, positions });
  } catch (err) {
    next(err);
  }
});

// PUT /api/progress/videos/position  { videoId, position, duration }
// Remembers where the user stopped so the player can resume there.
router.put('/videos/position', async (req, res, next) => {
  try {
    const { videoId, position, duration } = req.body || {};
    if (typeof videoId !== 'string' || !(await getContent()).videoTitles.has(videoId)) {
      return res.status(400).json({ error: 'Unknown video.' });
    }
    const pos = Math.floor(Number(position));
    const dur = Math.floor(Number(duration));
    if (!Number.isFinite(pos) || !Number.isFinite(dur) || pos < 0 || dur <= 0 || dur > 6 * 3600 || pos > dur) {
      return res.status(400).json({ error: 'Invalid position.' });
    }

    await pool.query(
      `INSERT INTO video_positions (user_id, video_id, position_seconds, duration_seconds, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, video_id)
       DO UPDATE SET position_seconds = EXCLUDED.position_seconds,
                     duration_seconds = EXCLUDED.duration_seconds,
                     updated_at = NOW()`,
      [req.userId, videoId, pos, dur]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/progress/videos/watch  { videoId }
router.post('/videos/watch', async (req, res, next) => {
  try {
    const { videoId } = req.body || {};
    const videoTitles = (await getContent()).videoTitles;
    if (typeof videoId !== 'string' || !videoTitles.has(videoId)) {
      return res.status(400).json({ error: 'Unknown video.' });
    }
    const title = videoTitles.get(videoId); // trusted title, not the one from the browser

    const already = await pool.query(
      'SELECT 1 FROM video_progress WHERE user_id = $1 AND video_id = $2',
      [req.userId, videoId]
    );

    if (already.rows.length === 0) {
      await pool.query(
        'INSERT INTO video_progress (user_id, video_id, title) VALUES ($1, $2, $3)',
        [req.userId, videoId, title]
      );
      await logActivity(req.userId, 'video', `Watched video: ${title}`);
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Read Lesson ----------
// GET /api/progress/lesson
router.get('/lesson', async (req, res, next) => {
  try {
    const row = await getLessonRow(req.userId);
    res.json({ completed: !!row.completed, completedAt: row.completed_at });
  } catch (err) {
    next(err);
  }
});

// POST /api/progress/lesson/complete
router.post('/lesson/complete', async (req, res, next) => {
  try {
    const row = await getLessonRow(req.userId);
    if (!row.completed) {
      await pool.query(
        "UPDATE lesson_progress SET completed = 1, completed_at = NOW() WHERE user_id = $1",
        [req.userId]
      );
      await logActivity(req.userId, 'lesson', 'Completed reading: Introduction to HCI 2 lesson');
    }
    res.json({ completed: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Review my mistakes ----------
// Case Studies use the scenario key ("12"); Study Cards use the card key
// ("3-7"). Only questions that are currently published are accepted.
function isValidMistakeKey(content, source, itemKey) {
  if (typeof itemKey !== 'string') return false;
  if (source === 'case_study') return /^\d{1,6}$/.test(itemKey) && content.caseByKey.has(Number(itemKey));
  if (source === 'study_card') return content.cardKeys.has(itemKey);
  return false;
}

// GET /api/progress/mistakes?source=case_study|study_card
router.get('/mistakes', async (req, res, next) => {
  try {
    const { source } = req.query;
    if (source !== 'case_study' && source !== 'study_card') {
      return res.status(400).json({ error: 'Invalid source.' });
    }
    const { rows } = await pool.query(
      `SELECT item_key, wrong_count, last_wrong_at FROM mistakes
       WHERE user_id = $1 AND source = $2
       ORDER BY last_wrong_at ASC`,
      [req.userId, source]
    );
    // Skip questions an instructor has since removed
    const content = await getContent();
    res.json({
      mistakes: rows
        .filter(r => isValidMistakeKey(content, source, r.item_key))
        .map(r => ({ itemKey: r.item_key, wrongCount: r.wrong_count, lastWrongAt: r.last_wrong_at })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/progress/mistakes  { source, itemKey }  — answered wrong
router.post('/mistakes', async (req, res, next) => {
  try {
    const { source, itemKey } = req.body || {};
    if (!isValidMistakeKey(await getContent(), source, itemKey)) {
      return res.status(400).json({ error: 'Invalid question.' });
    }
    await pool.query(
      `INSERT INTO mistakes (user_id, source, item_key) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, source, item_key)
       DO UPDATE SET wrong_count = mistakes.wrong_count + 1, last_wrong_at = NOW()`,
      [req.userId, source, itemKey]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/progress/mistakes/resolve  { source, itemKey }  — answered right in review
router.post('/mistakes/resolve', async (req, res, next) => {
  try {
    const { source, itemKey } = req.body || {};
    // Removed questions can still be cleared, so only check the shape
    if (!['case_study', 'study_card'].includes(source) || typeof itemKey !== 'string' || itemKey.length > 40) {
      return res.status(400).json({ error: 'Invalid question.' });
    }
    await pool.query(
      'DELETE FROM mistakes WHERE user_id = $1 AND source = $2 AND item_key = $3',
      [req.userId, source, itemKey]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

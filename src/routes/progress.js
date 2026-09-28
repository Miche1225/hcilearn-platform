// src/routes/progress.js
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/authGuard');

const router = express.Router();
router.use(requireAuth);

// These mirror the content that's hard-coded into the front-end pages.
const TOTAL_CASE_STUDIES = 50;
const TOTAL_STUDY_CARD_LESSONS = 11;
const TOTAL_VIDEOS = 9;

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

// ---------- Dashboard summary ----------
// GET /api/progress/summary
router.get('/summary', async (req, res, next) => {
  try {
    const userId = req.userId;

    const cs = await getCaseStudyRow(userId);
    const sc = await getStudyCardRow(userId);
    const lesson = await getLessonRow(userId);
    const videosWatchedResult = await pool.query(
      'SELECT COUNT(*)::int AS n FROM video_progress WHERE user_id = $1',
      [userId]
    );
    const videosWatched = videosWatchedResult.rows[0].n;

    const solvedCount = JSON.parse(cs.solved_ids).length;
    const completedLessonsCount = JSON.parse(sc.completed_ids).length;

    const totalActivities = TOTAL_CASE_STUDIES + TOTAL_STUDY_CARD_LESSONS + TOTAL_VIDEOS;
    const completedActivities = solvedCount + completedLessonsCount + videosWatched;

    const overallPercent = Math.round((completedActivities / totalActivities) * 100);

    const { rows: recentActivities } = await pool.query(
      "SELECT type, description, created_at FROM activity_log WHERE user_id = $1 AND type != 'lesson' ORDER BY created_at DESC LIMIT 5",
      [userId]
    );

    res.json({
      overallPercent,
      caseStudiesSolved: solvedCount,
      caseStudiesTotal: TOTAL_CASE_STUDIES,
      videosWatched,
      videosTotal: TOTAL_VIDEOS,
      studyCardsCompleted: completedLessonsCount,
      studyCardsTotal: TOTAL_STUDY_CARD_LESSONS,
      lessonCompleted: !!lesson.completed,
      recentActivities,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Case Studies ----------
// GET /api/progress/case-studies
router.get('/case-studies', async (req, res, next) => {
  try {
    const row = await getCaseStudyRow(req.userId);
    res.json({ unlockedLevel: row.unlocked_level, solvedIds: JSON.parse(row.solved_ids) });
  } catch (err) {
    next(err);
  }
});

// POST /api/progress/case-studies/submit  { scenarioId, correct }
router.post('/case-studies/submit', async (req, res, next) => {
  try {
    const { scenarioId, correct } = req.body || {};
    const id = Number(scenarioId);
    if (!id || id < 1 || id > TOTAL_CASE_STUDIES) {
      return res.status(400).json({ error: 'Invalid scenario id.' });
    }

    const row = await getCaseStudyRow(req.userId);
    let unlockedLevel = row.unlocked_level;
    const solvedIds = JSON.parse(row.solved_ids);

    if (correct) {
      if (!solvedIds.includes(id)) {
        solvedIds.push(id);
        await logActivity(req.userId, 'case_study', `Solved Case Study Scenario ${id}`);
      }
      if (id === unlockedLevel && unlockedLevel < TOTAL_CASE_STUDIES) {
        unlockedLevel += 1;
      }
      await pool.query(
        'UPDATE case_study_progress SET unlocked_level = $1, solved_ids = $2 WHERE user_id = $3',
        [unlockedLevel, JSON.stringify(solvedIds), req.userId]
      );
    }

    res.json({ unlockedLevel, solvedIds });
  } catch (err) {
    next(err);
  }
});

// ---------- Study Cards ----------
// GET /api/progress/study-cards
router.get('/study-cards', async (req, res, next) => {
  try {
    const row = await getStudyCardRow(req.userId);
    res.json({ unlockedLesson: row.unlocked_lesson, completedIds: JSON.parse(row.completed_ids) });
  } catch (err) {
    next(err);
  }
});

// POST /api/progress/study-cards/complete  { lessonId }
router.post('/study-cards/complete', async (req, res, next) => {
  try {
    const { lessonId } = req.body || {};
    const id = Number(lessonId);
    if (!id || id < 1 || id > TOTAL_STUDY_CARD_LESSONS) {
      return res.status(400).json({ error: 'Invalid lesson id.' });
    }

    const row = await getStudyCardRow(req.userId);
    let unlockedLesson = row.unlocked_lesson;
    const completedIds = JSON.parse(row.completed_ids);

    if (!completedIds.includes(id)) {
      completedIds.push(id);
      await logActivity(req.userId, 'study_card', `Mastered Study Card Lesson ${id}`);
    }
    if (id === unlockedLesson && unlockedLesson < TOTAL_STUDY_CARD_LESSONS) {
      unlockedLesson += 1;
    }

    await pool.query(
      'UPDATE study_card_progress SET unlocked_lesson = $1, completed_ids = $2 WHERE user_id = $3',
      [unlockedLesson, JSON.stringify(completedIds), req.userId]
    );

    res.json({ unlockedLesson, completedIds });
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
    res.json({ watched: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/progress/videos/watch  { videoId, title }
router.post('/videos/watch', async (req, res, next) => {
  try {
    const { videoId, title } = req.body || {};
    if (!videoId) return res.status(400).json({ error: 'videoId is required.' });

    const already = await pool.query(
      'SELECT 1 FROM video_progress WHERE user_id = $1 AND video_id = $2',
      [req.userId, videoId]
    );

    if (already.rows.length === 0) {
      await pool.query(
        'INSERT INTO video_progress (user_id, video_id, title) VALUES ($1, $2, $3)',
        [req.userId, videoId, title || null]
      );
      await logActivity(req.userId, 'video', `Watched video: ${title || videoId}`);
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

module.exports = router;

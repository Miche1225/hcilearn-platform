// src/routes/gamify.js
// Study streak, daily goal and badges.
//
// "Today" is counted in Philippine time, since every user is a UEP student.
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/authGuard');
const { TOTAL_CASE_STUDIES, TOTAL_STUDY_CARD_LESSONS, VIDEOS, TOTAL_VIDEOS } = require('../content');

const router = express.Router();
router.use(requireAuth);

const TIME_ZONE = 'Asia/Manila';
const GOAL_CHOICES = [5, 10, 20, 30];
const MAX_ANSWERS_PER_DAY = 5000; // stops a runaway script from inflating stats

// ---------- Badges ----------
// stat = key in the object built by getStats(); earned when stat >= target.
const BADGES = [
  { id: 'first_steps',      name: 'First Steps',      description: 'Answer your first question.',          icon: 'fa-shoe-prints',      color: 'mint',  stat: 'answers',        target: 1 },
  { id: 'on_fire',          name: 'On Fire',          description: 'Study 3 days in a row.',               icon: 'fa-fire',             color: 'coral', stat: 'longestStreak',  target: 3 },
  { id: 'week_warrior',     name: 'Week Warrior',     description: 'Study 7 days in a row.',               icon: 'fa-calendar-check',   color: 'sun',   stat: 'longestStreak',  target: 7 },
  { id: 'goal_getter',      name: 'Goal Getter',      description: 'Reach your daily goal.',               icon: 'fa-flag-checkered',   color: 'mint',  stat: 'goalDays',       target: 1 },
  { id: 'sharpshooter',     name: 'Sharpshooter',     description: 'Get 50 answers right.',                icon: 'fa-bullseye',         color: 'coral', stat: 'correct',        target: 50 },
  { id: 'quiz_whiz',        name: 'Quiz Whiz',        description: 'Answer 250 questions.',                icon: 'fa-brain',            color: 'grape', stat: 'answers',        target: 250 },
  { id: 'case_cracker',     name: 'Case Cracker',     description: 'Solve 10 case studies.',               icon: 'fa-magnifying-glass', color: 'sky',   stat: 'caseSolved',     target: 10 },
  { id: 'master_detective', name: 'Master Detective', description: `Solve all ${TOTAL_CASE_STUDIES} case studies.`, icon: 'fa-user-secret', color: 'grape', stat: 'caseSolved', target: TOTAL_CASE_STUDIES },
  { id: 'deck_master',      name: 'Deck Master',      description: 'Master your first study card deck.',   icon: 'fa-clone',            color: 'sun',   stat: 'decks',          target: 1 },
  { id: 'card_champion',    name: 'Card Champion',    description: `Master all ${TOTAL_STUDY_CARD_LESSONS} decks.`, icon: 'fa-crown', color: 'sun', stat: 'decks', target: TOTAL_STUDY_CARD_LESSONS },
  { id: 'binge_watcher',    name: 'Binge Watcher',    description: 'Watch 5 videos.',                      icon: 'fa-film',             color: 'sky',   stat: 'videos',         target: 5 },
  { id: 'film_buff',        name: 'Film Buff',        description: `Watch all ${TOTAL_VIDEOS} videos.`,    icon: 'fa-clapperboard',     color: 'pink',  stat: 'videos',         target: TOTAL_VIDEOS },
  { id: 'clean_slate',      name: 'Clean Slate',      description: 'Clear 10 mistakes in review.',         icon: 'fa-broom',            color: 'mint',  stat: 'cleared',        target: 10 },
  { id: 'note_taker',       name: 'Note Taker',       description: 'Write notes on 5 saved items.',        icon: 'fa-pen-nib',          color: 'pink',  stat: 'notes',          target: 5 },
];

// ---------- Dates (YYYY-MM-DD strings in Philippine time) ----------
function todayLocal() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// DATE values from Postgres: node-pg gives a Date at local midnight
// (so use the local parts), other drivers may give a string.
function toYmd(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function weekdayLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

// Active days (newest first) -> current and longest streak
function computeStreaks(activeDays, today) {
  const set = new Set(activeDays);

  // The streak stays alive until the end of today, so start from
  // yesterday if nothing has been done yet today.
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let previous = null;
  for (const day of [...activeDays].sort()) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }

  return { current, longest: Math.max(longest, current), activeToday: set.has(today) };
}

// ---------- Data helpers ----------
async function getGoal(userId) {
  const { rows } = await pool.query('SELECT daily_goal FROM users WHERE id = $1', [userId]);
  return rows[0] ? rows[0].daily_goal : 10;
}

async function getActiveDays(userId) {
  const { rows } = await pool.query(
    `SELECT day FROM daily_activity
     WHERE user_id = $1 AND (answers > 0 OR videos > 0 OR topics_read > 0)
     ORDER BY day DESC
     LIMIT 400`,
    [userId]
  );
  return rows.map(r => toYmd(r.day));
}

async function getToday(userId, today, goal) {
  const { rows } = await pool.query(
    'SELECT answers, correct, goal_met FROM daily_activity WHERE user_id = $1 AND day = $2',
    [userId, today]
  );
  const answers = rows[0] ? rows[0].answers : 0;
  return { answers, correct: rows[0] ? rows[0].correct : 0, goal, goalMet: answers >= goal };
}

async function getStats(userId, today) {
  const totals = (await pool.query(
    `SELECT COALESCE(SUM(answers), 0)::int AS answers,
            COALESCE(SUM(correct), 0)::int AS correct,
            COALESCE(SUM(mistakes_cleared), 0)::int AS cleared,
            COALESCE(SUM(CASE WHEN goal_met THEN 1 ELSE 0 END), 0)::int AS goal_days
     FROM daily_activity WHERE user_id = $1`,
    [userId]
  )).rows[0];

  const cs = (await pool.query('SELECT solved_ids FROM case_study_progress WHERE user_id = $1', [userId])).rows[0];
  const sc = (await pool.query('SELECT completed_ids FROM study_card_progress WHERE user_id = $1', [userId])).rows[0];
  const videos = (await pool.query(
    'SELECT COUNT(DISTINCT video_id)::int AS n FROM video_progress WHERE user_id = $1 AND video_id = ANY($2)',
    [userId, [...VIDEOS.keys()]]
  )).rows[0].n;
  const notes = (await pool.query(
    "SELECT COUNT(*)::int AS n FROM bookmarks WHERE user_id = $1 AND note <> ''",
    [userId]
  )).rows[0].n;

  const streak = computeStreaks(await getActiveDays(userId), today);

  return {
    answers: totals.answers,
    correct: totals.correct,
    cleared: totals.cleared,
    goalDays: totals.goal_days,
    longestStreak: streak.longest,
    caseSolved: cs ? JSON.parse(cs.solved_ids).length : 0,
    decks: sc ? JSON.parse(sc.completed_ids).length : 0,
    videos,
    notes,
  };
}

// Awards any badges the user now qualifies for. Returns the new ones.
async function awardBadges(userId, stats) {
  const { rows } = await pool.query('SELECT badge_id FROM user_badges WHERE user_id = $1', [userId]);
  const owned = new Set(rows.map(r => r.badge_id));
  const earnedNow = BADGES.filter(b => !owned.has(b.id) && stats[b.stat] >= b.target);

  for (const badge of earnedNow) {
    await pool.query(
      'INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2) ON CONFLICT (user_id, badge_id) DO NOTHING',
      [userId, badge.id]
    );
  }
  return earnedNow.map(publicBadge);
}

function publicBadge(b) {
  return { id: b.id, name: b.name, description: b.description, icon: b.icon, color: b.color };
}

async function checkBadges(userId, today) {
  return awardBadges(userId, await getStats(userId, today));
}

// ---------- Routes ----------

// GET /api/gamify/summary  — everything the Dashboard / Account page shows
router.get('/summary', async (req, res, next) => {
  try {
    const userId = req.userId;
    const today = todayLocal();
    const goal = await getGoal(userId);

    const stats = await getStats(userId, today);
    const newBadges = await awardBadges(userId, stats);

    const activeDays = await getActiveDays(userId);
    const streak = computeStreaks(activeDays, today);

    const { rows: weekRows } = await pool.query(
      'SELECT day, answers FROM daily_activity WHERE user_id = $1 AND day >= $2',
      [userId, addDays(today, -6)]
    );
    const byDay = new Map(weekRows.map(r => [toYmd(r.day), r.answers]));
    const active = new Set(activeDays);
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const day = addDays(today, -i);
      week.push({ day, label: weekdayLabel(day), answers: byDay.get(day) || 0, active: active.has(day), isToday: i === 0 });
    }

    const { rows: earnedRows } = await pool.query(
      'SELECT badge_id, earned_at FROM user_badges WHERE user_id = $1',
      [userId]
    );
    const earned = new Map(earnedRows.map(r => [r.badge_id, r.earned_at]));
    const badges = BADGES.map(b => ({
      ...publicBadge(b),
      earned: earned.has(b.id),
      earnedAt: earned.get(b.id) || null,
      progress: Math.min(stats[b.stat], b.target),
      target: b.target,
    }));

    res.json({
      streak,
      today: await getToday(userId, today, goal),
      goalChoices: GOAL_CHOICES,
      week,
      badges,
      newBadges,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/gamify/activity  { type: 'answer'|'video'|'read'|'cleared', correct? }
router.post('/activity', async (req, res, next) => {
  try {
    const { type, correct } = req.body || {};
    const columns = { answer: 'answers', video: 'videos', read: 'topics_read', cleared: 'mistakes_cleared' };
    if (!columns[type]) {
      return res.status(400).json({ error: 'Invalid activity.' });
    }

    const userId = req.userId;
    const today = todayLocal();
    const goal = await getGoal(userId);

    const inc = { answers: 0, correct: 0, videos: 0, topics_read: 0, mistakes_cleared: 0 };
    inc[columns[type]] = 1;
    if (type === 'answer' && correct === true) inc.correct = 1;

    await pool.query(
      `INSERT INTO daily_activity (user_id, day, answers, correct, videos, topics_read, mistakes_cleared)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, day) DO UPDATE SET
         answers = daily_activity.answers + EXCLUDED.answers,
         correct = daily_activity.correct + EXCLUDED.correct,
         videos = daily_activity.videos + EXCLUDED.videos,
         topics_read = daily_activity.topics_read + EXCLUDED.topics_read,
         mistakes_cleared = daily_activity.mistakes_cleared + EXCLUDED.mistakes_cleared
       WHERE daily_activity.answers < ${MAX_ANSWERS_PER_DAY}`,
      [userId, today, inc.answers, inc.correct, inc.videos, inc.topics_read, inc.mistakes_cleared]
    );

    // First time today's answers reach the goal -> celebrate once
    const goalResult = await pool.query(
      `UPDATE daily_activity SET goal_met = TRUE
       WHERE user_id = $1 AND day = $2 AND answers >= $3 AND goal_met = FALSE`,
      [userId, today, goal]
    );

    const streak = computeStreaks(await getActiveDays(userId), today);
    const newBadges = await checkBadges(userId, today);

    res.json({
      today: await getToday(userId, today, goal),
      streak,
      justMetGoal: goalResult.rowCount > 0,
      newBadges,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/gamify/check  — after saving progress elsewhere (solved, mastered, watched, notes)
router.post('/check', async (req, res, next) => {
  try {
    res.json({ newBadges: await checkBadges(req.userId, todayLocal()) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/gamify/goal  { goal }
router.put('/goal', async (req, res, next) => {
  try {
    const goal = Number((req.body || {}).goal);
    if (!GOAL_CHOICES.includes(goal)) {
      return res.status(400).json({ error: 'Invalid goal.' });
    }
    await pool.query('UPDATE users SET daily_goal = $1 WHERE id = $2', [goal, req.userId]);

    // Lowering the goal can complete today's goal right away
    const today = todayLocal();
    const goalResult = await pool.query(
      `UPDATE daily_activity SET goal_met = TRUE
       WHERE user_id = $1 AND day = $2 AND answers >= $3 AND goal_met = FALSE`,
      [req.userId, today, goal]
    );

    res.json({
      today: await getToday(req.userId, today, goal),
      justMetGoal: goalResult.rowCount > 0,
      newBadges: await checkBadges(req.userId, today),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.computeStreaks = computeStreaks; // exported for tests

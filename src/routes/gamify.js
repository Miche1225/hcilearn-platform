// src/routes/gamify.js
// Study streak, daily goal and badges.
//
// "Today" is counted in Philippine time, since every user is a UEP student.
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/authGuard');
const { getContent } = require('../contentStore');
const { todayLocal, addDays, toYmd, weekdayLabel, computeStreaks } = require('../utils/dates');

const router = express.Router();
router.use(requireAuth);

const GOAL_CHOICES = [5, 10, 20, 30];
const MAX_ANSWERS_PER_DAY = 5000; // stops a runaway script from inflating stats

// ---------- Badges ----------
// stat = key in the object built by getStats(); earned when stat >= target.
// "All ..." badges use the number of items currently published.
// Answer badges only count CORRECT answers; a study day only counts if you
// got something right, watched a video or read a topic.
const BADGE_DEFS = [
  { id: 'first_steps',      name: 'First Steps',      description: 'Get your first answer right.',         icon: 'fa-shoe-prints',      color: 'mint',  stat: 'correct',        target: 1 },
  { id: 'on_fire',          name: 'On Fire',          description: 'Study 3 days in a row.',               icon: 'fa-fire',             color: 'coral', stat: 'longestStreak',  target: 3 },
  { id: 'week_warrior',     name: 'Week Warrior',     description: 'Study 7 days in a row.',               icon: 'fa-calendar-check',   color: 'sun',   stat: 'longestStreak',  target: 7 },
  { id: 'month_master',     name: 'Month Master',     description: 'Study 30 days in a row.',              icon: 'fa-calendar-days',    color: 'pink',  stat: 'longestStreak',  target: 30 },
  { id: 'sharpshooter',     name: 'Sharpshooter',     description: 'Get 50 answers right.',                icon: 'fa-bullseye',         color: 'coral', stat: 'correct',        target: 50 },
  { id: 'century',          name: 'Century',          description: 'Get 100 answers right.',               icon: 'fa-medal',            color: 'sun',   stat: 'correct',        target: 100 },
  { id: 'quiz_whiz',        name: 'Quiz Whiz',        description: 'Get 250 answers right.',               icon: 'fa-brain',            color: 'grape', stat: 'correct',        target: 250 },
  { id: 'legend',           name: 'Legend',           description: 'Get 500 answers right.',               icon: 'fa-trophy',           color: 'pink',  stat: 'correct',        target: 500 },
  { id: 'hot_streak',       name: 'Hot Streak',       description: 'Get 10 answers right in a row.',       icon: 'fa-bolt',             color: 'coral', stat: 'bestCombo',      target: 10 },
  { id: 'unstoppable',      name: 'Unstoppable',      description: 'Get 25 answers right in a row.',       icon: 'fa-meteor',           color: 'grape', stat: 'bestCombo',      target: 25 },
  { id: 'busy_bee',         name: 'Busy Bee',         description: 'Get 30 answers right in one day.',     icon: 'fa-sun',              color: 'sun',   stat: 'bestDay',        target: 30 },
  { id: 'case_cracker',     name: 'Case Cracker',     description: 'Solve 10 case studies.',               icon: 'fa-magnifying-glass', color: 'sky',   stat: 'caseSolved',     target: 10 },
  { id: 'halfway_hero',     name: 'Halfway Hero',     description: 'Solve 25 case studies.',               icon: 'fa-flag',             color: 'mint',  stat: 'caseSolved',     target: 25 },
  { id: 'master_detective', name: 'Master Detective', description: (t) => `Solve all ${t.caseStudies} case studies.`, icon: 'fa-user-secret', color: 'grape', stat: 'caseSolved', target: (t) => t.caseStudies },
  { id: 'deck_master',      name: 'Deck Master',      description: 'Master your first study card deck.',   icon: 'fa-clone',            color: 'sun',   stat: 'decks',          target: 1 },
  { id: 'flawless',         name: 'Flawless',         description: 'Master a deck without a single mistake.', icon: 'fa-gem',           color: 'sky',   stat: 'perfectDecks',   target: 1 },
  { id: 'card_champion',    name: 'Card Champion',    description: (t) => `Master all ${t.decks} decks.`, icon: 'fa-crown', color: 'sun', stat: 'decks', target: (t) => t.decks },
  { id: 'binge_watcher',    name: 'Binge Watcher',    description: 'Watch 5 videos.',                      icon: 'fa-film',             color: 'sky',   stat: 'videos',         target: 5 },
  { id: 'film_buff',        name: 'Film Buff',        description: (t) => `Watch all ${t.videos} videos.`, icon: 'fa-clapperboard', color: 'pink', stat: 'videos', target: (t) => t.videos },
  { id: 'clean_slate',      name: 'Clean Slate',      description: 'Clear 10 mistakes in review.',         icon: 'fa-broom',            color: 'mint',  stat: 'cleared',        target: 10 },
  { id: 'note_taker',       name: 'Note Taker',       description: 'Write notes on 5 saved items.',        icon: 'fa-pen-nib',          color: 'pink',  stat: 'notes',          target: 5 },
];

// The badge list with targets/descriptions for the current content totals
function getBadges(totals) {
  return BADGE_DEFS.map(b => ({
    ...b,
    description: typeof b.description === 'function' ? b.description(totals) : b.description,
    target: Math.max(1, typeof b.target === 'function' ? b.target(totals) : b.target),
  }));
}

// ---------- Data helpers ----------
async function getGoal(userId) {
  const { rows } = await pool.query('SELECT daily_goal FROM users WHERE id = $1', [userId]);
  return rows[0] ? rows[0].daily_goal : 10;
}

async function getActiveDays(userId) {
  const { rows } = await pool.query(
    `SELECT day FROM daily_activity
     WHERE user_id = $1 AND (correct > 0 OR videos > 0 OR topics_read > 0)
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
  // The daily goal counts correct answers
  const correct = rows[0] ? rows[0].correct : 0;
  return { answers: rows[0] ? rows[0].answers : 0, correct, goal, goalMet: correct >= goal };
}

async function getStats(userId, today, content) {
  const totals = (await pool.query(
    `SELECT COALESCE(SUM(answers), 0)::int AS answers,
            COALESCE(SUM(correct), 0)::int AS correct,
            COALESCE(SUM(mistakes_cleared), 0)::int AS cleared,
            COALESCE(SUM(CASE WHEN goal_met THEN 1 ELSE 0 END), 0)::int AS goal_days,
            COALESCE(MAX(best_combo), 0)::int AS best_combo,
            COALESCE(SUM(perfect_decks), 0)::int AS perfect_decks,
            COALESCE(MAX(correct), 0)::int AS best_day
     FROM daily_activity WHERE user_id = $1`,
    [userId]
  )).rows[0];

  const cs = (await pool.query('SELECT solved_ids FROM case_study_progress WHERE user_id = $1', [userId])).rows[0];
  const sc = (await pool.query('SELECT completed_ids FROM study_card_progress WHERE user_id = $1', [userId])).rows[0];
  const videos = (await pool.query(
    'SELECT COUNT(DISTINCT video_id)::int AS n FROM video_progress WHERE user_id = $1 AND video_id = ANY($2)',
    [userId, [...content.videoTitles.keys()]]
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
    bestCombo: totals.best_combo,
    perfectDecks: totals.perfect_decks,
    bestDay: totals.best_day,
    longestStreak: streak.longest,
    caseSolved: cs ? JSON.parse(cs.solved_ids).filter(id => content.caseByKey.has(Number(id))).length : 0,
    decks: sc ? JSON.parse(sc.completed_ids).filter(id => content.deckByKey.has(Number(id))).length : 0,
    videos,
    notes,
  };
}

// Awards any badges the user now qualifies for. Returns the new ones.
async function awardBadges(userId, stats, badges) {
  const { rows } = await pool.query('SELECT badge_id FROM user_badges WHERE user_id = $1', [userId]);
  const owned = new Set(rows.map(r => r.badge_id));
  const earnedNow = badges.filter(b => !owned.has(b.id) && stats[b.stat] >= b.target);

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
  const content = await getContent();
  return awardBadges(userId, await getStats(userId, today, content), getBadges(content.totals));
}

// ---------- Routes ----------

// GET /api/gamify/summary  — everything the Dashboard / Account page shows
router.get('/summary', async (req, res, next) => {
  try {
    const userId = req.userId;
    const today = todayLocal();
    const goal = await getGoal(userId);

    const content = await getContent();
    const BADGES = getBadges(content.totals);
    const stats = await getStats(userId, today, content);
    const newBadges = await awardBadges(userId, stats, BADGES);

    const activeDays = await getActiveDays(userId);
    const streak = computeStreaks(activeDays, today);

    const { rows: weekRows } = await pool.query(
      'SELECT day, correct FROM daily_activity WHERE user_id = $1 AND day >= $2',
      [userId, addDays(today, -6)]
    );
    const byDay = new Map(weekRows.map(r => [toYmd(r.day), r.correct]));
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
      progress: earned.has(b.id) ? b.target : Math.min(stats[b.stat], b.target),
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

// POST /api/gamify/activity
//   { type: 'answer', correct, combo? }   combo = correct answers in a row so far
//   { type: 'video' | 'read' | 'cleared' | 'perfect' }   perfect = deck with no mistakes
router.post('/activity', async (req, res, next) => {
  try {
    const { type, correct } = req.body || {};
    const columns = { answer: 'answers', video: 'videos', read: 'topics_read', cleared: 'mistakes_cleared', perfect: 'perfect_decks' };
    if (!columns[type]) {
      return res.status(400).json({ error: 'Invalid activity.' });
    }

    const userId = req.userId;
    const today = todayLocal();
    const goal = await getGoal(userId);

    const inc = { answers: 0, correct: 0, videos: 0, topics_read: 0, mistakes_cleared: 0, perfect_decks: 0 };
    inc[columns[type]] = 1;
    if (type === 'answer' && correct === true) inc.correct = 1;
    // A run of correct answers can't be longer than today's correct answers
    const combo = type === 'answer' && correct === true
      ? Math.max(0, Math.min(1000, Math.floor(Number(req.body.combo) || 1)))
      : 0;

    await pool.query(
      `INSERT INTO daily_activity (user_id, day, answers, correct, videos, topics_read, mistakes_cleared, perfect_decks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, day) DO UPDATE SET
         answers = daily_activity.answers + EXCLUDED.answers,
         correct = daily_activity.correct + EXCLUDED.correct,
         videos = daily_activity.videos + EXCLUDED.videos,
         topics_read = daily_activity.topics_read + EXCLUDED.topics_read,
         mistakes_cleared = daily_activity.mistakes_cleared + EXCLUDED.mistakes_cleared,
         perfect_decks = daily_activity.perfect_decks + EXCLUDED.perfect_decks
       WHERE daily_activity.answers < ${MAX_ANSWERS_PER_DAY}`,
      [userId, today, inc.answers, inc.correct, inc.videos, inc.topics_read, inc.mistakes_cleared, inc.perfect_decks]
    );

    // A combo can never be longer than today's real correct answers
    if (combo > 0) {
      await pool.query(
        `UPDATE daily_activity SET best_combo = GREATEST(best_combo, LEAST($3::int, correct))
         WHERE user_id = $1 AND day = $2`,
        [userId, today, combo]
      );
    }

    // First time today's correct answers reach the goal -> celebrate once
    const goalResult = await pool.query(
      `UPDATE daily_activity SET goal_met = TRUE
       WHERE user_id = $1 AND day = $2 AND correct >= $3 AND goal_met = FALSE`,
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
       WHERE user_id = $1 AND day = $2 AND correct >= $3 AND goal_met = FALSE`,
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

// ---------- Leaderboards ----------
// Ranks every student by correct answers in the last 7 days. Students with
// no points are left off the top list (you always see your own rank).
// Names are shortened to "Juan D." and no ids are sent.
const LEADERBOARD_TOP = 10;
const LEADERBOARD_ALL_MAX = 2000; // shortcut: whole list in one response, add paging if students ever exceed this

function shortName(row) {
  const parts = row.full_name.split(' ').filter(Boolean);
  const first = row.first_name || parts[0] || 'Student';
  const last = row.last_name || (parts.length > 1 ? parts[parts.length - 1] : '');
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

// GET /api/gamify/leaderboard
router.get('/leaderboard', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name, u.first_name, u.last_name, COALESCE(SUM(d.correct), 0)::int AS points
       FROM users u
       LEFT JOIN daily_activity d ON d.user_id = u.id AND d.day >= $1
       WHERE u.disabled_at IS NULL
       GROUP BY u.id
       ORDER BY points DESC, u.full_name`,
      [addDays(todayLocal(), -6)]
    );
    // Same points = same rank
    let rank = 0;
    const ranked = rows.map((r, i) => {
      if (i === 0 || r.points !== rows[i - 1].points) rank = i + 1;
      return { rank, name: shortName(r), points: r.points, isMe: r.id === req.userId };
    });
    // ?all=1 (the "See all" pop-up) lists everyone, 0 points included
    if (req.query.all === '1') {
      return res.json({ total: ranked.length, entries: ranked.slice(0, LEADERBOARD_ALL_MAX) });
    }
    const entries = ranked.filter(e => e.points > 0).slice(0, LEADERBOARD_TOP);
    const mine = ranked.find(e => e.isMe);
    if (mine && !entries.includes(mine)) entries.push(mine);

    res.json({ total: ranked.length, entries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.getBadges = getBadges; // used by the admin dashboard

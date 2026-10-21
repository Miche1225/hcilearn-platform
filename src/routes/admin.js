// src/routes/admin.js
// Admin dashboard (read-only): student progress, class insights, CSV export
// and the audit log. Every route needs an instructor login
// (see middleware/instructorGuard.js and routes/instructor.js).
const express = require('express');
const { pool } = require('../db');
const { requireInstructor } = require('../middleware/instructorGuard');
const { getContent } = require('../contentStore');
const { todayLocal, addDays, toYmd, computeStreaks } = require('../utils/dates');
const { getBadges } = require('./gamify');

const router = express.Router();
router.use(requireInstructor);

const INACTIVE_AFTER_DAYS = 7;

async function audit(instructorRowId, action, targetUserId = null, details = '') {
  await pool.query(
    'INSERT INTO instructor_audit_log (instructor_id, action, target_user_id, details) VALUES ($1, $2, $3, $4)',
    [instructorRowId, action, targetUserId, details]
  );
}

// Timestamp -> YYYY-MM-DD in Philippine time
function tsToYmd(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(ts));
}

// Can this instructor see this student? Admins see everyone; other
// instructors only the sections assigned to them (program + year/section).
function canSee(instructor, student) {
  if (instructor.isAdmin) return true;
  return instructor.sections.some(sec =>
    sec.program === (student.program || '') && sec.yearSection === (student.year_section || ''));
}

// Every student this instructor can see, with progress numbers
async function loadStudents(instructor) {
  const content = await getContent();
  const { caseStudies, decks: deckTotal, videos: videoTotal } = content.totals;
  const totalActivities = caseStudies + deckTotal + videoTotal;
  const videoIds = [...content.videoTitles.keys()];
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.program, u.year_section, u.student_id, u.profile_photo,
            u.created_at, u.disabled_at,
            cs.solved_ids, sc.completed_ids
     FROM users u
     LEFT JOIN case_study_progress cs ON cs.user_id = u.id
     LEFT JOIN study_card_progress sc ON sc.user_id = u.id
     ORDER BY u.full_name`
  );
  const students = rows.filter(r => canSee(instructor, r));
  const ids = students.map(s => s.id);
  if (!ids.length) return [];

  const perUser = async (sql, params = []) => {
    const { rows: r } = await pool.query(sql, [ids, ...params]);
    return new Map(r.map(x => [x.user_id, x]));
  };

  const videos = await perUser(
    `SELECT user_id, COUNT(DISTINCT video_id)::int AS n FROM video_progress
     WHERE user_id = ANY($1::int[]) AND video_id = ANY($2) GROUP BY user_id`, [videoIds]);
  const badges = await perUser(
    'SELECT user_id, COUNT(*)::int AS n FROM user_badges WHERE user_id = ANY($1::int[]) GROUP BY user_id');
  const answers = await perUser(
    `SELECT user_id, COALESCE(SUM(answers), 0)::int AS answers, COALESCE(SUM(correct), 0)::int AS correct
     FROM daily_activity WHERE user_id = ANY($1::int[]) GROUP BY user_id`);
  const lastLog = await perUser(
    'SELECT user_id, MAX(created_at) AS last FROM activity_log WHERE user_id = ANY($1::int[]) GROUP BY user_id');

  const today = todayLocal();
  const { rows: dayRows } = await pool.query(
    `SELECT user_id, day FROM daily_activity
     WHERE user_id = ANY($1::int[]) AND day >= $2 AND (answers > 0 OR videos > 0 OR topics_read > 0)`,
    [ids, addDays(today, -400)]
  );
  const daysByUser = new Map();
  for (const r of dayRows) {
    if (!daysByUser.has(r.user_id)) daysByUser.set(r.user_id, []);
    daysByUser.get(r.user_id).push(toYmd(r.day));
  }

  return students.map(s => {
    // Only published items count
    const solved = s.solved_ids ? JSON.parse(s.solved_ids).filter(id => content.caseByKey.has(Number(id))).length : 0;
    const decks = s.completed_ids ? JSON.parse(s.completed_ids).filter(id => content.deckByKey.has(Number(id))).length : 0;
    const watched = videos.get(s.id) ? videos.get(s.id).n : 0;
    const days = (daysByUser.get(s.id) || []).sort().reverse();
    const streak = computeStreaks(days, today);

    // Last active = latest study day or logged activity
    const candidates = [days[0]];
    if (lastLog.get(s.id) && lastLog.get(s.id).last) candidates.push(tsToYmd(lastLog.get(s.id).last));
    const lastActive = candidates.filter(Boolean).sort().pop() || null;

    const a = answers.get(s.id);
    return {
      id: s.id,
      fullName: s.full_name,
      program: s.program || '',
      yearSection: s.year_section || '',
      studentId: s.student_id || '',
      profilePhoto: s.profile_photo || null,
      joinedAt: s.created_at,
      caseSolved: solved,
      decksMastered: decks,
      videosWatched: watched,
      overallPercent: totalActivities ? Math.round(((solved + decks + watched) / totalActivities) * 100) : 0,
      answers: a ? a.answers : 0,
      correct: a ? a.correct : 0,
      currentStreak: streak.current,
      longestStreak: streak.longest,
      badges: badges.get(s.id) ? badges.get(s.id).n : 0,
      lastActive,
      inactive: !lastActive || lastActive < addDays(today, -INACTIVE_AFTER_DAYS),
      deactivated: !!s.disabled_at,
    };
  });
}

// ---------- Routes ----------

// GET /api/admin/students — every student with progress numbers
router.get('/students', async (req, res, next) => {
  try {
    res.json({
      today: todayLocal(),
      inactiveAfterDays: INACTIVE_AFTER_DAYS,
      totals: { ...(await getContent()).totals, badges: getBadges((await getContent()).totals).length },
      students: await loadStudents(req.instructor),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/insights — most-missed questions and least-watched videos
router.get('/insights', async (req, res, next) => {
  try {
    const students = await loadStudents(req.instructor);
    const ids = students.map(s => s.id);

    const { rows: missed } = await pool.query(
      `SELECT source, item_key, COUNT(*)::int AS students, SUM(wrong_count)::int AS wrong
       FROM mistakes WHERE user_id = ANY($1::int[])
       GROUP BY source, item_key
       ORDER BY students DESC, wrong DESC
       LIMIT 10`,
      [ids]
    );

    const { rows: watchRows } = await pool.query(
      `SELECT video_id, COUNT(DISTINCT user_id)::int AS n FROM video_progress
       WHERE user_id = ANY($1::int[]) GROUP BY video_id`,
      [ids]
    );
    const watchCount = new Map(watchRows.map(r => [r.video_id, r.n]));
    const videos = [...(await getContent()).videoTitles.entries()]
      .map(([id, title]) => ({ id, title, watchedBy: watchCount.get(id) || 0 }))
      .sort((a, b) => a.watchedBy - b.watchedBy);

    res.json({
      studentCount: ids.length,
      mostMissed: missed.map(m => ({ source: m.source, itemKey: m.item_key, students: m.students, wrong: m.wrong })),
      leastWatched: videos.slice(0, 6),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/students/:id — one student's details
router.get('/students/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid student.' });

    const student = (await loadStudents(req.instructor)).find(s => s.id === id);
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    const content = await getContent();
    const cs = (await pool.query('SELECT unlocked_level, solved_ids FROM case_study_progress WHERE user_id = $1', [id])).rows[0];
    const sc = (await pool.query('SELECT unlocked_lesson, completed_ids FROM study_card_progress WHERE user_id = $1', [id])).rows[0];
    const { rows: watched } = await pool.query(
      'SELECT video_id, watched_at FROM video_progress WHERE user_id = $1 AND video_id = ANY($2) ORDER BY watched_at DESC',
      [id, [...content.videoTitles.keys()]]
    );
    const { rows: mistakes } = await pool.query(
      'SELECT source, item_key, wrong_count, last_wrong_at FROM mistakes WHERE user_id = $1 ORDER BY wrong_count DESC, last_wrong_at DESC',
      [id]
    );
    const { rows: earned } = await pool.query('SELECT badge_id, earned_at FROM user_badges WHERE user_id = $1', [id]);
    const { rows: activity } = await pool.query(
      'SELECT type, description, created_at FROM activity_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [id]
    );
    const today = todayLocal();
    const { rows: dayRows } = await pool.query(
      'SELECT day, answers, correct, videos, topics_read FROM daily_activity WHERE user_id = $1 AND day >= $2',
      [id, addDays(today, -13)]
    );
    const byDay = new Map(dayRows.map(r => [toYmd(r.day), r]));
    const last14 = [];
    for (let i = 13; i >= 0; i--) {
      const day = addDays(today, -i);
      const r = byDay.get(day);
      last14.push({ day, answers: r ? r.answers : 0, correct: r ? r.correct : 0, videos: r ? r.videos : 0, topicsRead: r ? r.topics_read : 0 });
    }

    const earnedAt = new Map(earned.map(b => [b.badge_id, b.earned_at]));
    await audit(req.instructor.id, 'view_student', id);

    res.json({
      student,
      caseStudies: {
        solvedIds: (cs ? JSON.parse(cs.solved_ids) : []).map(Number).filter(k => content.caseByKey.has(k)),
        total: content.totals.caseStudies,
      },
      studyCards: {
        completedIds: (sc ? JSON.parse(sc.completed_ids) : []).map(Number).filter(k => content.deckByKey.has(k)),
        decks: content.decks.map(d => ({ key: Number(d.key), number: d.number, title: d.title })),
      },
      videos: watched.map(v => ({ id: v.video_id, title: content.videoTitles.get(v.video_id), watchedAt: v.watched_at })),
      mistakes: mistakes.map(m => ({ source: m.source, itemKey: m.item_key, wrongCount: m.wrong_count, lastWrongAt: m.last_wrong_at })),
      badges: getBadges(content.totals).map(b => ({ id: b.id, name: b.name, icon: b.icon, color: b.color, earnedAt: earnedAt.get(b.id) || null })),
      recentActivity: activity,
      last14,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/export.csv — progress of every student, for grading/reports
router.get('/export.csv', async (req, res, next) => {
  try {
    const students = await loadStudents(req.instructor);
    const { totals } = await getContent();
    // Cells starting with = + - @ could run as formulas in Excel
    const cell = (value) => {
      let text = value === null || value === undefined ? '' : String(value);
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const header = ['Name', 'Student ID', 'Program', 'Year & Section', 'Overall %',
      `Case studies solved (of ${totals.caseStudies})`, `Decks mastered (of ${totals.decks})`,
      `Videos watched (of ${totals.videos})`, 'Questions answered', 'Correct answers',
      'Current streak (days)', 'Longest streak (days)', `Badges (of ${getBadges(totals).length})`, 'Last active', 'Joined'];
    const lines = [header.map(cell).join(',')];
    for (const s of students) {
      lines.push([
        s.fullName, s.studentId, s.program, s.yearSection, s.overallPercent,
        s.caseSolved, s.decksMastered, s.videosWatched, s.answers, s.correct,
        s.currentStreak, s.longestStreak, s.badges, s.lastActive || 'Never', tsToYmd(s.joinedAt),
      ].map(cell).join(','));
    }

    await audit(req.instructor.id, 'export_csv', null, `${students.length} students`);

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="hcilearn-progress-${todayLocal()}.csv"`);
    // BOM so Excel opens accented names correctly
    res.send('﻿' + lines.join('\r\n') + '\r\n');
  } catch (err) {
    next(err);
  }
});

// ---------- Student management ----------
// Each action is confirmed in the page and recorded in the audit log.
async function studentFor(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return null;
  const { rows } = await pool.query('SELECT id, full_name, program, year_section, disabled_at FROM users WHERE id = $1', [id]);
  return rows[0] && canSee(req.instructor, rows[0]) ? rows[0] : null;
}

const studentAction = (action, run) => async (req, res, next) => {
  try {
    const student = await studentFor(req);
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    await run(student);
    await audit(req.instructor.id, action, student.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// Log the student out on every device
router.post('/students/:id/signout', studentAction('signout_student', (s) =>
  pool.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [s.id])));

// Block / unblock logging in (deactivating also logs them out)
router.post('/students/:id/deactivate', studentAction('deactivate_student', (s) =>
  pool.query('UPDATE users SET disabled_at = NOW(), session_version = session_version + 1 WHERE id = $1', [s.id])));
router.post('/students/:id/reactivate', studentAction('reactivate_student', (s) =>
  pool.query('UPDATE users SET disabled_at = NULL WHERE id = $1', [s.id])));

// Start over: clears learning progress (keeps the account, profile and saved items)
const PROGRESS_TABLES = ['case_study_progress', 'study_card_progress', 'lesson_progress', 'video_progress',
  'video_positions', 'mistakes', 'daily_activity', 'user_badges', 'activity_log'];
router.post('/students/:id/reset', studentAction('reset_progress', async (s) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of PROGRESS_TABLES) {
      await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [s.id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));


// ---------- Announcements ----------
// The admin sees all announcements; other instructors only their own.
// GET /api/admin/announcements
router.get('/announcements', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.instructor_id, a.title, a.body, a.ends_on, a.created_at, a.target_sections, i.full_name AS instructor_name
       FROM announcements a LEFT JOIN instructors i ON i.id = a.instructor_id
       ORDER BY a.created_at DESC, a.id DESC`
    );
    res.json({
      today: todayLocal(),
      canPostToEveryone: req.instructor.isAdmin,
      sections: req.instructor.sections,
      announcements: rows
        .filter(r => req.instructor.isAdmin || r.instructor_id === req.instructor.id)
        .map(r => ({
          id: r.id, title: r.title, body: r.body, endsOn: r.ends_on ? toYmd(r.ends_on) : null,
          createdAt: r.created_at, by: r.instructor_name || '(removed instructor)',
          audience: r.target_sections || null,
        })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/announcements  { title, body, endsOn?, sections? }
// sections = [{ program, yearSection }]; null/empty = everyone (admin only).
// Other instructors can only post to their own sections.
router.post('/announcements', async (req, res, next) => {
  try {
    const { title, body, endsOn } = req.body || {};
    const t = typeof title === 'string' ? title.trim() : '';
    const b = typeof body === 'string' ? body.trim() : '';
    if (!t || t.length > 120) return res.status(400).json({ error: 'Give a title (up to 120 characters).' });
    if (b.length > 1000) return res.status(400).json({ error: 'The message can be up to 1000 characters.' });
    let ends = null;
    if (endsOn) {
      if (typeof endsOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || Number.isNaN(Date.parse(endsOn))) {
        return res.status(400).json({ error: 'Pick a valid end date.' });
      }
      if (endsOn < todayLocal()) return res.status(400).json({ error: 'The end date is already in the past.' });
      ends = endsOn;
    }

    const mine = req.instructor.sections;
    const wanted = Array.isArray(req.body.sections) ? req.body.sections : [];
    let audience = wanted
      .filter(x => x && typeof x.program === 'string' && typeof x.yearSection === 'string')
      .map(x => ({ program: x.program, yearSection: x.yearSection }));
    if (!req.instructor.isAdmin) {
      if (!mine.length) return res.status(400).json({ error: 'You have no sections yet. Ask the main admin to assign them.' });
      if (!audience.length) audience = mine; // default: all of my sections
      const ok = audience.every(a => mine.some(m => m.program === a.program && m.yearSection === a.yearSection));
      if (!ok) return res.status(403).json({ error: 'You can only post to your own sections.' });
    }

    const { rows } = await pool.query(
      'INSERT INTO announcements (instructor_id, title, body, ends_on, target_sections) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id',
      [req.instructor.id, t, b, ends, audience.length ? JSON.stringify(audience) : null]
    );
    await audit(req.instructor.id, 'post_announcement', null, t);
    res.json({ id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/announcements/:id
router.delete('/announcements/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid announcement.' });
    const owner = req.instructor.isAdmin ? '' : ' AND instructor_id = $2';
    const params = req.instructor.isAdmin ? [id] : [id, req.instructor.id];
    const { rows } = await pool.query(`DELETE FROM announcements WHERE id = $1${owner} RETURNING title`, params);
    if (rows[0]) await audit(req.instructor.id, 'delete_announcement', null, rows[0].title);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});


// GET /api/admin/audit — latest admin actions
router.get('/audit', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.action, l.details, l.created_at,
              i.full_name AS instructor_name, i.instructor_id AS instructor_code,
              t.full_name AS target_name
       FROM instructor_audit_log l
       LEFT JOIN instructors i ON i.id = l.instructor_id
       LEFT JOIN users t ON t.id = l.target_user_id
       WHERE $1::boolean OR l.instructor_id = $2
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT 200`,
      [req.instructor.isAdmin, req.instructor.id]
    );
    res.json({
      entries: rows.map(r => ({
        id: r.id, action: r.action, details: r.details, createdAt: r.created_at,
        adminName: r.instructor_name ? `${r.instructor_name} (ID ${r.instructor_code})` : '(removed instructor)',
        targetName: r.target_name,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// src/routes/admin.js
// Admin dashboard (read-only): student progress, class insights, CSV export
// and the audit log. Every route needs the admin login
// (see middleware/adminGuard.js and routes/adminAuth.js).
const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/adminGuard');
const { getContent } = require('../contentStore');
const { todayLocal, addDays, toYmd, computeStreaks } = require('../utils/dates');
const { getBadges } = require('./gamify');
const { decryptEmail } = require('../utils/emailSecurity');
const { sendInactiveReminder } = require('../utils/mailer');
const { bus, notifyPresence } = require('../presence');

const router = express.Router();
router.use(requireAdmin);

const INACTIVE_AFTER_DAYS = 7;

// Online = checked in within the last 75 s (open pages check in every 30 s),
// has not logged out since, and has not left the site. Logging out drops the
// student at once; leaving (Back button, closing the tab) after 3 s, the time
// a click to another HCILearn page gets to check in first.
const ONLINE_SQL = `COALESCE(u.last_seen_at > NOW() - INTERVAL '75 seconds'
              AND (u.signed_out_at IS NULL OR u.signed_out_at < u.last_seen_at)
              AND NOT COALESCE(u.left_at >= u.last_seen_at AND u.left_at < NOW() - INTERVAL '3 seconds', FALSE)
              AND u.disabled_at IS NULL, FALSE)`;

async function audit(adminRowId, action, targetUserId = null, details = '') {
  await pool.query(
    'INSERT INTO admin_audit_log (admin_id, action, target_user_id, details) VALUES ($1, $2, $3, $4)',
    [adminRowId, action, targetUserId, details]
  );
}

// Timestamp -> YYYY-MM-DD in Philippine time
function tsToYmd(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(ts));
}

// Every student, with progress numbers (the admin sees all students)
async function loadStudents() {
  const content = await getContent();
  const { caseStudies, decks: deckTotal, videos: videoTotal } = content.totals;
  const totalActivities = caseStudies + deckTotal + videoTotal;
  const videoIds = [...content.videoTitles.keys()];
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.program, u.year_section, u.student_id, u.profile_photo,
            u.created_at, u.disabled_at, u.email_enc IS NOT NULL AS can_email, u.reminded_at, u.last_seen_at,
            ${ONLINE_SQL} AS online,
            cs.solved_ids, sc.completed_ids
     FROM users u
     LEFT JOIN case_study_progress cs ON cs.user_id = u.id
     LEFT JOIN study_card_progress sc ON sc.user_id = u.id
     ORDER BY u.full_name`
  );
  const students = rows;
  const ids = students.map(s => s.id);
  if (!ids.length) return [];

  const perUser = async (sql, params = []) => {
    const { rows: r } = await pool.query(sql, [ids, ...params]);
    return new Map(r.map(x => [x.user_id, x]));
  };

  const videos = await perUser(
    `SELECT user_id, COUNT(DISTINCT video_id)::int AS n FROM video_progress
     WHERE user_id = ANY($1::int[]) AND video_id = ANY($2) GROUP BY user_id`, [videoIds]);
  // Only badges that still exist (the daily-goal ones were removed)
  const badges = await perUser(
    'SELECT user_id, COUNT(*)::int AS n FROM user_badges WHERE user_id = ANY($1::int[]) AND badge_id = ANY($2) GROUP BY user_id',
    [getBadges(content.totals).map(b => b.id)]);
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

    // Last active = latest study day, logged activity, or opening the system
    const candidates = [days[0]];
    if (lastLog.get(s.id) && lastLog.get(s.id).last) candidates.push(tsToYmd(lastLog.get(s.id).last));
    if (s.last_seen_at) candidates.push(tsToYmd(s.last_seen_at));
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
      canEmail: s.can_email,
      remindedAt: s.reminded_at,
      // Has the system open right now (checked in within 75 s, not logged out)
      online: s.online && !s.disabled_at,
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
      students: await loadStudents(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/events — stays open and sends "presence" whenever a student
// logs in, logs out or comes back online (Server-Sent Events). The page then
// asks /online for the new numbers.
router.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // proxies must pass each message on at once
  });
  res.flushHeaders();
  res.write('retry: 2000\n\n');

  const send = () => res.write('event: presence\ndata: 1\n\n');
  // A comment every 20 s keeps proxies from closing a quiet connection
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
  bus.on('presence', send);
  req.on('close', () => {
    clearInterval(keepAlive);
    bus.off('presence', send);
  });
});

// GET /api/admin/online — who is online right now and who opened the system
// today. Small and fast, so the dashboard can check every couple of seconds.
router.get('/online', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, ${ONLINE_SQL} AS online,
              COALESCE((u.last_seen_at AT TIME ZONE 'Asia/Manila')::date
                       = (NOW() AT TIME ZONE 'Asia/Manila')::date, FALSE) AS seen_today
       FROM users u`
    );
    res.json({
      today: todayLocal(),
      ids: rows.map(r => r.id),
      online: rows.filter(r => r.online).map(r => r.id),
      seenToday: rows.filter(r => r.seen_today).map(r => r.id),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/insights — most-missed questions and least-watched videos
router.get('/insights', async (req, res, next) => {
  try {
    const students = await loadStudents();
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

    const student = (await loadStudents()).find(s => s.id === id);
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
    await audit(req.admin.id, 'view_student', id);

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
    const students = await loadStudents();
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

    await audit(req.admin.id, 'export_csv', null, `${students.length} students`);

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
  return rows[0] || null;
}

const studentAction = (action, run) => async (req, res, next) => {
  try {
    const student = await studentFor(req);
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    await run(student);
    await audit(req.admin.id, action, student.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// Log the student out on every device
router.post('/students/:id/signout', studentAction('signout_student', (s) =>
  pool.query('UPDATE users SET session_version = session_version + 1, signed_out_at = NOW() WHERE id = $1', [s.id])
    .then(notifyPresence)));

// Block / unblock logging in (deactivating also logs them out)
router.post('/students/:id/deactivate', studentAction('deactivate_student', (s) =>
  pool.query('UPDATE users SET disabled_at = NOW(), session_version = session_version + 1, signed_out_at = NOW() WHERE id = $1', [s.id])
    .then(notifyPresence)));
router.post('/students/:id/reactivate', studentAction('reactivate_student', (s) =>
  pool.query('UPDATE users SET disabled_at = NULL WHERE id = $1', [s.id])));

// Remove the account for good (progress, saved items, everything). Same as a
// student deleting their own account. The name is kept in the audit log.
router.post('/students/:id/remove', async (req, res, next) => {
  try {
    const student = await studentFor(req);
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    await audit(req.admin.id, 'remove_student', null, student.full_name);
    await pool.query('DELETE FROM users WHERE id = $1', [student.id]);
    // Best effort: also remove the profile photo from Cloudinary
    try {
      require('cloudinary').v2.uploader
        .destroy(`hcilearn/profile_photos/user${student.id}`, { resource_type: 'image' })
        .catch(err => console.error('Could not delete profile photo:', err.message));
    } catch (err) { /* Cloudinary not set up */ }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Email an inactive student a nudge to come back. Once a day at most, so a
// student can't be spammed by repeated clicks.
const REMIND_COOLDOWN_HOURS = 24;
router.post('/students/:id/remind', async (req, res, next) => {
  try {
    const student = await studentFor(req);
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    if (student.disabled_at) return res.status(400).json({ error: 'This account is deactivated.' });
    const { rows: [u] } = await pool.query(
      `SELECT first_name, email_enc, reminded_at > NOW() - make_interval(hours => $2) AS recent
       FROM users WHERE id = $1`, [student.id, REMIND_COOLDOWN_HOURS]);
    if (!u.email_enc) return res.status(409).json({ error: 'No email on file yet. It is saved the next time this student logs in.' });
    if (u.recent) return res.status(429).json({ error: 'A reminder was already sent in the last 24 hours.' });

    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const sent = await sendInactiveReminder(decryptEmail(u.email_enc), u.first_name, `${base}/login.html`);
    if (!sent) return res.status(502).json({ error: 'The email could not be sent. Check the email settings.' });

    await pool.query('UPDATE users SET reminded_at = NOW() WHERE id = $1', [student.id]);
    await audit(req.admin.id, 'remind_student', student.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

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
// Every section students have signed up with, for choosing an audience
async function studentSections() {
  const { rows } = await pool.query(
    `SELECT DISTINCT COALESCE(program, '') AS program, COALESCE(year_section, '') AS year_section
     FROM users WHERE year_section IS NOT NULL ORDER BY 1, 2`
  );
  return rows.map(r => ({ program: r.program, yearSection: r.year_section }));
}

// GET /api/admin/announcements
router.get('/announcements', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.body, a.ends_on, a.created_at, a.target_sections, ad.full_name AS admin_name
       FROM announcements a LEFT JOIN admin ad ON ad.id = a.admin_id
       ORDER BY a.created_at DESC, a.id DESC`
    );
    res.json({
      today: todayLocal(),
      sections: await studentSections(),
      announcements: rows.map(r => ({
        id: r.id, title: r.title, body: r.body, endsOn: r.ends_on ? toYmd(r.ends_on) : null,
        createdAt: r.created_at, by: r.admin_name || 'Admin',
        audience: r.target_sections || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/announcements  { title, body, endsOn?, sections? }
// sections = [{ program, yearSection }]; null/empty = everyone.
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

    const wanted = Array.isArray(req.body.sections) ? req.body.sections : [];
    const audience = wanted
      .filter(x => x && typeof x.program === 'string' && typeof x.yearSection === 'string')
      .map(x => ({ program: x.program, yearSection: x.yearSection }));

    const { rows } = await pool.query(
      'INSERT INTO announcements (admin_id, title, body, ends_on, target_sections) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id',
      [req.admin.id, t, b, ends, audience.length ? JSON.stringify(audience) : null]
    );
    await audit(req.admin.id, 'post_announcement', null, t);
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
    const { rows } = await pool.query('DELETE FROM announcements WHERE id = $1 RETURNING title', [id]);
    if (rows[0]) await audit(req.admin.id, 'delete_announcement', null, rows[0].title);
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
              ad.full_name AS admin_name, ad.admin_id AS admin_code,
              t.full_name AS target_name
       FROM admin_audit_log l
       LEFT JOIN admin ad ON ad.id = l.admin_id
       LEFT JOIN users t ON t.id = l.target_user_id
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT 200`
    );
    res.json({
      entries: rows.map(r => ({
        id: r.id, action: r.action, details: r.details, createdAt: r.created_at,
        adminName: r.admin_name ? `${r.admin_name} (ID ${r.admin_code})` : 'Admin',
        targetName: r.target_name,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/audit — clear the whole log; the clear itself is
// recorded so a wiped log never looks untouched
router.delete('/audit', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM admin_audit_log');
    await audit(req.admin.id, 'clear_audit');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/audit/:id — remove an entry
router.delete('/audit/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid entry.' });
    await pool.query('DELETE FROM admin_audit_log WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

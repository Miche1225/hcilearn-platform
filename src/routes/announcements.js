// src/routes/announcements.js
// Announcements from the admin for the signed-in student: the Dashboard
// banner and the notification bell on every student page.
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/authGuard');
const { todayLocal } = require('../utils/dates');

const router = express.Router();
router.use(requireAuth);

const MAX_SHOWN = 20;

// Active announcements meant for this student (everyone, or their section)
async function forStudent(userId) {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.body, a.created_at, a.target_sections, ad.full_name AS admin_name
     FROM announcements a LEFT JOIN admin ad ON ad.id = a.admin_id
     WHERE a.ends_on IS NULL OR a.ends_on >= $1
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 200`,
    [todayLocal()]
  );
  const me = (await pool.query(
    'SELECT program, year_section, announcements_seen_at FROM users WHERE id = $1',
    [userId]
  )).rows[0] || {};
  const forMe = (r) => !r.target_sections || r.target_sections.some(sec =>
    sec.program === (me.program || '') && sec.yearSection === (me.year_section || ''));
  const seenAt = me.announcements_seen_at ? new Date(me.announcements_seen_at).getTime() : 0;

  return rows.filter(forMe).slice(0, MAX_SHOWN).map(r => ({
    id: r.id,
    title: r.title,
    body: r.body,
    createdAt: r.created_at,
    by: r.admin_name || 'Admin',
    unread: new Date(r.created_at).getTime() > seenAt,
  }));
}

// GET /api/announcements — newest first, with unread flags
router.get('/', async (req, res, next) => {
  try {
    const announcements = await forStudent(req.userId);
    res.json({ announcements, unreadCount: announcements.filter(a => a.unread).length });
  } catch (err) {
    next(err);
  }
});

// POST /api/announcements/seen — the student opened their notifications
router.post('/seen', async (req, res, next) => {
  try {
    await pool.query('UPDATE users SET announcements_seen_at = NOW() WHERE id = $1', [req.userId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

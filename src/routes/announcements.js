// src/routes/announcements.js
// Active announcements from instructors, shown on the student Dashboard.
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/authGuard');
const { todayLocal } = require('../utils/dates');

const router = express.Router();
router.use(requireAuth);

// GET /api/announcements — newest first; hides ones past their end date and
// ones meant for other sections (instructors post to their own sections)
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.body, a.created_at, a.target_sections, i.full_name AS instructor_name
       FROM announcements a LEFT JOIN instructors i ON i.id = a.instructor_id
       WHERE a.ends_on IS NULL OR a.ends_on >= $1
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 100`,
      [todayLocal()]
    );
    const me = (await pool.query('SELECT program, year_section FROM users WHERE id = $1', [req.userId])).rows[0] || {};
    const forMe = (r) => !r.target_sections || r.target_sections.some(sec =>
      sec.program === (me.program || '') && sec.yearSection === (me.year_section || ''));
    res.json({
      announcements: rows.filter(forMe).slice(0, 5).map(r => ({
        id: r.id, title: r.title, body: r.body, createdAt: r.created_at, by: r.instructor_name || 'Your instructor',
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
